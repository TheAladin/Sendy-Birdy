"""Application settings, read from environment variables and the repo-root .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# This file is backend/app/core/config.py, so the repository root is three levels up.
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        # `KEY=` counts as unset, so a blank SECRET_KEY reports "missing", not "too short".
        env_ignore_empty=True,
        # Other tools may keep their own variables in .env; don't fail on them.
        extra="ignore",
    )

    # Required: signs cookies and tokens. There is deliberately no default.
    secret_key: SecretStr = Field(min_length=32)

    # Where uploaded media is stored. Kept outside git.
    data_dir: Path = REPO_ROOT / "data"

    # Base URL clients use to open share links (your tunnel URL in production).
    public_base_url: str = "http://localhost:5173"

    # Send cookies over HTTPS only. Browsers treat http://localhost as secure, so this can stay on.
    cookie_secure: bool = True

    # Largest accepted upload, in megabytes.
    max_upload_mb: int = Field(default=1024, gt=0)

    # Days to keep access-log entries before they're deleted automatically.
    log_retention_days: int = Field(default=90, gt=0)


@lru_cache
def get_settings() -> Settings:
    """Return the settings, loading them once per process."""
    return Settings()
