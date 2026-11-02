# Sendy Birdy

A self-hosted app for sending screenshots, demo videos and notes to clients through private, expiring links. It runs entirely on your own machine: no cloud storage, no monthly bill.

> **Work in progress.**

## Run the backend (development)

Requires [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env    # then set SECRET_KEY (the file explains how)
cd backend
uv sync
uv run uvicorn app.main:create_app --factory --reload
```

Check it's running at <http://127.0.0.1:8000/api/health>. API docs are at <http://127.0.0.1:8000/api/docs>.

## Run the frontend (development)

Requires Node.js 22.12 or newer (an LTS release). With the backend running:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Requests to `/api` are forwarded to the backend, so the page shows "API: ok".

## Tests and linting

Backend, from `backend/`:

```bash
uv run pytest           # tests (add --cov for a coverage report)
uv run ruff check       # lint
uv run ruff format      # format
```

Frontend, from `frontend/`:

```bash
npm test                # tests
npm run lint            # lint
npm run typecheck       # type check
npm run format          # format
```

## License

[MIT](LICENSE)00
