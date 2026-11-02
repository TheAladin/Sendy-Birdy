from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.fixture(autouse=True)
def no_secret_key_in_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRET_KEY", raising=False)


def test_secret_key_is_required() -> None:
    with pytest.raises(ValidationError, match="secret_key"):
        Settings(_env_file=None)


def test_empty_secret_key_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "")

    with pytest.raises(ValidationError, match="Field required"):
        Settings(_env_file=None)


def test_secret_key_must_be_at_least_32_characters() -> None:
    with pytest.raises(ValidationError, match="at least 32"):
        Settings(_env_file=None, secret_key="too-short")


def test_env_file_is_read_and_unknown_keys_are_ignored(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(f"SECRET_KEY={'x' * 32}\nMAX_UPLOAD_MB=50\nSOME_OTHER_TOOL=1\n")

    settings = Settings(_env_file=env_file)

    assert settings.secret_key.get_secret_value() == "x" * 32
    assert settings.max_upload_mb == 50
