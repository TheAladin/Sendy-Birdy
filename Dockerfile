# syntax=docker/dockerfile:1

# 1. The frontend: only its built files (dist/) reach the final image.
FROM node:22-trixie-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

# 2. The Python dependencies, installed with uv into a virtualenv that's copied over as a whole.
FROM python:3.12-slim-trixie AS python
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project

# 3. The image that runs: no Node, no uv, no compilers.
FROM python:3.12-slim-trixie

# ffmpeg makes video posters. pg_dump/pg_restore (for `app.cli backup`) must be at least the
# server's version, and Debian ships an older one, so they come from PostgreSQL's own repository.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg postgresql-client-18; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

# A fixed, unprivileged user: the app never runs as root.
RUN useradd --system --uid 10001 --user-group --home-dir /app --shell /usr/sbin/nologin sendy \
    && install -d -o sendy -g sendy /data

# Same layout as the repository, so the app finds alembic.ini and frontend/dist where it expects.
WORKDIR /app/backend
COPY --from=python /app/backend/.venv ./.venv
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY --from=web /app/frontend/dist /app/frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint

ENV PATH="/app/backend/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data

USER sendy
VOLUME /data
EXPOSE 8000 8001
ENTRYPOINT ["entrypoint"]
# Inside a container the app has to listen on all interfaces; which of them reach the outside
# world is decided where the container is run (compose.yaml publishes on 127.0.0.1 only).
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
