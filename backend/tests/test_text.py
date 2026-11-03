import pytest

from app.services.text import excerpt, markdown_to_text


@pytest.mark.parametrize(
    ("markdown", "text"),
    [
        ("# Release notes v2.3\n\n## New\n- Apple Pay", "Release notes v2.3 New Apple Pay"),
        (
            "Keep the **blue** accent and *Team* plan, use `Inter`.",
            "Keep the blue accent and Team plan, use Inter.",
        ),
        ("1. First\n2) Second\n> quoted\n- [x] done", "First Second quoted done"),
        ("See [the mockup](https://x.example) ![hero](a.png)", "See the mockup hero"),
        ("| Token | Value |\n|---|---|\n| Brand | `#2563EB` |", "Token · Value Brand · #2563EB"),
        ("```python\nprint('hi')\n```", "print('hi')"),
        ("snake_case_name and 2 * 3 * 4", "snake_case_name and 2 * 3 * 4"),
    ],
    ids=[
        "headings-lists",
        "emphasis-code",
        "numbered-quote-task",
        "links-images",
        "table",
        "fence",
        "not-emphasis",
    ],
)
def test_markdown_becomes_readable_text(markdown: str, text: str) -> None:
    assert markdown_to_text(markdown) == text


def test_long_text_is_cut_with_an_ellipsis() -> None:
    assert excerpt("word " * 100, 20) == "word word word word…"
    assert excerpt("short", 20) == "short"
