from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings

VALID_KEY = "x" * 32
VALID_URL = "postgresql+asyncpg://sendy:hunter2@127.0.0.1:5432/sendy"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)


def test_secret_key_is_required() -> None:
    with pytest.raises(ValidationError, match="secret_key"):
        Settings(_env_file=None, database_url=VALID_URL)


def test_empty_secret_key_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "")

    with pytest.raises(ValidationError, match="Field required"):
        Settings(_env_file=None, database_url=VALID_URL)


def test_secret_key_must_be_at_least_32_characters() -> None:
    with pytest.raises(ValidationError, match="at least 32"):
        Settings(_env_file=None, secret_key="too-short", database_url=VALID_URL)


def test_database_url_is_required() -> None:
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None, secret_key=VALID_KEY)


def test_database_url_must_use_asyncpg() -> None:
    with pytest.raises(ValidationError, match=r"postgresql\+asyncpg://"):
        Settings(
            _env_file=None,
            secret_key=VALID_KEY,
            database_url="postgresql://sendy:hunter2@127.0.0.1/sendy",
        )


def test_database_password_is_hidden_when_printed() -> None:
    settings = Settings(_env_file=None, secret_key=VALID_KEY, database_url=VALID_URL)

    assert "hunter2" not in repr(settings)
    assert "hunter2" not in str(settings.model_dump())


def test_env_file_is_read_and_unknown_keys_are_ignored(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"SECRET_KEY={VALID_KEY}\nDATABASE_URL={VALID_URL}\nMAX_UPLOAD_MB=50\nSOME_OTHER_TOOL=1\n"
    )

    settings = Settings(_env_file=env_file)

    assert settings.secret_key.get_secret_value() == VALID_KEY
    assert settings.max_upload_mb == 50
