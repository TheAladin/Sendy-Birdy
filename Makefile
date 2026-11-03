SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

BACKEND := backend
FRONTEND := frontend
ADMIN_PORT ?= 8000
PUBLIC_PORT ?= 8001

.PHONY: help install db-setup db-migrate create-admin seed-demo gen-api build start start-admin start-public dev dev-api dev-web check fmt

help: ## List available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-12s %s\n", $$1, $$2}'

install: .env ## Install backend and frontend dependencies
	cd $(BACKEND) && uv sync
	cd $(FRONTEND) && npm ci

# Only runs when .env does not exist yet, so an existing one is never overwritten.
.env:
	@key="$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"; \
	sed "s|^SECRET_KEY=$$|SECRET_KEY=$$key|" .env.example > .env
	@chmod 600 .env
	@echo "Created .env with a random SECRET_KEY"

db-setup: .env ## Create the PostgreSQL role and databases (asks for your sudo password)
	./scripts/db-setup.sh

db-migrate: ## Apply database migrations
	cd $(BACKEND) && uv run alembic upgrade head

create-admin: ## Create your admin account (prompts for email, name and password)
	cd $(BACKEND) && uv run python -m app.cli create-admin

seed-demo: ## Fill an empty library with demo screenshots, notes and a video
	cd $(BACKEND) && uv run python -m app.cli seed-demo

dev: ## Run the API and the frontend together (Ctrl+C stops both)
	@$(MAKE) --no-print-directory -j2 dev-api dev-web

dev-api: ## Run only the API (http://127.0.0.1:8000)
	cd $(BACKEND) && uv run uvicorn app.main:create_app --factory --reload

dev-web: ## Run only the frontend (http://localhost:5173)
	cd $(FRONTEND) && npm run dev

build: ## Build the frontend into frontend/dist, which the API then serves
	cd $(FRONTEND) && npm run build

# Both bind to 127.0.0.1: the admin app must never be reachable from outside, and the public one
# is only exposed through the tunnel, which connects locally.
start: ## Migrate, then run the admin (:8000) and public (:8001) apps from the build
	@test -f $(FRONTEND)/dist/index.html || { echo "No frontend build: run make build first." >&2; exit 1; }
	cd $(BACKEND) && uv run alembic upgrade head
	@$(MAKE) --no-print-directory -j2 start-admin start-public

start-admin: ## Run only the admin app (http://127.0.0.1:8000)
	cd $(BACKEND) && APP_MODE=admin uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port $(ADMIN_PORT)

start-public: ## Run only the public app (http://127.0.0.1:8001), the one to expose
	cd $(BACKEND) && APP_MODE=public uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port $(PUBLIC_PORT)

# The schema goes through a temporary file inside node_modules, which git ignores.
gen-api: ## Regenerate the frontend's API types from the backend's OpenAPI schema
	mkdir -p $(FRONTEND)/node_modules/.cache
	cd $(BACKEND) && uv run python -m app.openapi > ../$(FRONTEND)/node_modules/.cache/openapi.json
	cd $(FRONTEND) && npx openapi-typescript node_modules/.cache/openapi.json -o src/api/schema.d.ts

check: ## Run every linter, type check and test
	cd $(BACKEND) && uv run ruff check && uv run ruff format --check && uv run pytest
	cd $(FRONTEND) && npm run lint && npm run typecheck && npm run format:check && npm test

fmt: ## Fix lint issues where possible and format all code
	cd $(BACKEND) && uv run ruff check --fix && uv run ruff format
	cd $(FRONTEND) && npm run format
