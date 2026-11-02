# Sendy Birdy

A self-hosted app for sending screenshots, demo videos and notes to clients through private, expiring links. It runs entirely on your own machine: no cloud storage, no monthly bill.

> **Work in progress.**

## Run the backend (development)

Requires [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env    # then set SECRET_KEY (the file explains how)
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Check it's running at <http://127.0.0.1:8000/api/health>. API docs are at <http://127.0.0.1:8000/api/docs>.

## License

[MIT](LICENSE)
