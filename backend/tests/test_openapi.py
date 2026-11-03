import pytest

from app.openapi import schema


def test_schema_export_needs_no_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    paths = schema()["paths"]

    assert isinstance(paths, dict)
    assert "/api/health" in paths
