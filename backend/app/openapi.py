"""Print the API's OpenAPI schema as JSON: `uv run python -m app.openapi`.

The frontend's TypeScript types are generated from this output (`make gen-api`).
"""

import json
import sys

from app.core.config import Settings
from app.main import create_app


def schema() -> dict[str, object]:
    # Placeholder settings: building the schema never connects to the database or reads .env.
    settings = Settings(
        _env_file=None,
        secret_key="schema-export-only-not-a-real-secret",  # noqa: S106 (placeholder)
        database_url="postgresql+asyncpg://schema-export@localhost/unused",
    )
    return create_app(settings).openapi()


if __name__ == "__main__":
    json.dump(schema(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
