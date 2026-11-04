#!/usr/bin/env bash
# End-to-end tests: wipes a dedicated database and data folder, fills them with the demo library
# and an admin, builds the frontend, and runs Playwright against both apps (admin on :8100,
# public on :8101, started by playwright.config.ts). Extra arguments go to `playwright test`.
#
# The database comes from E2E_DATABASE_URL, or else is the test database from .env with its name
# ending in _e2e instead of _test (`make db-setup` creates sendy_e2e). Its name must end in _e2e:
# everything in it is deleted.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

url="${E2E_DATABASE_URL:-}"
if [[ -z "$url" ]]; then
    test_url="${TEST_DATABASE_URL:-$(sed -n 's|^TEST_DATABASE_URL=||p' .env 2>/dev/null | tail -n 1)}"
    [[ "$test_url" == *_test ]] && url="${test_url%_test}_e2e"
fi
if [[ "$url" != *_e2e ]]; then
    echo "Set E2E_DATABASE_URL to a database whose name ends in _e2e (it gets wiped)," >&2
    echo "or run 'make db-setup' so TEST_DATABASE_URL is in .env." >&2
    exit 1
fi

# Environment variables win over .env, so the servers Playwright starts use these too.
export DATABASE_URL="$url"
export DATA_DIR="$REPO/.e2e/data"
export PUBLIC_BASE_URL="http://localhost:8101"
export SECRET_KEY="${E2E_SECRET_KEY:-e2e-only-secret-key-not-used-anywhere-else}"
export E2E_ADMIN_EMAIL="admin@example.com"
export E2E_ADMIN_PASSWORD="end to end password"

echo "Preparing a fresh library in ${url##*/}"
rm -rf "${DATA_DIR:?}"
cd "$REPO/backend"
uv run python - <<'PY'
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


asyncio.run(main())
PY
uv run alembic upgrade head
printf '%s\n' "$E2E_ADMIN_PASSWORD" |
    uv run python -m app.cli create-admin --email "$E2E_ADMIN_EMAIL" --name "Alex Morgan"
uv run python -m app.cli seed-demo

cd "$REPO/frontend"
npm run build
npx playwright test "$@"
