# Sendy Birdy

A self-hosted app for sending screenshots, demo videos and notes to clients through private, expiring links. It runs entirely on your own machine: no cloud storage, no monthly bill.

> **Work in progress.**

## Quick start

Requires [uv](https://docs.astral.sh/uv/), Node.js 22.12 or newer (an LTS release), PostgreSQL 18 running locally, and `make`.

```bash
make install     # installs dependencies and creates .env with a random SECRET_KEY
make db-setup    # creates the database role and databases (asks for your sudo password)
make db-migrate  # applies database migrations
make dev         # runs the API and the frontend together; Ctrl+C stops both
```

Open <http://localhost:5173>. The page shows "API: ok" once the backend is up. API docs are at <http://127.0.0.1:8000/api/docs>.

## Commands

| Command | What it does |
|---|---|
| `make install` | Install backend and frontend dependencies; create `.env` if it doesn't exist |
| `make db-setup` | Create the `sendy` PostgreSQL role and the `sendy` / `sendy_test` databases, and add their URLs to `.env` |
| `make db-migrate` | Apply database migrations |
| `make dev` | Run the API (port 8000) and the frontend (port 5173) together |
| `make dev-api` / `make dev-web` | Run only one of them |
| `make check` | Run every linter, type check and test |
| `make fmt` | Fix lint issues where possible and format all code |

Run `make` on its own to list them.

## License

[MIT](LICENSE)
