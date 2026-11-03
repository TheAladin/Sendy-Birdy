"""Turning Markdown into short plain-text previews."""

import re

_FENCE = re.compile(r"^\s*(```|~~~)")
_TABLE_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
_LINE_PREFIX = re.compile(r"^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_EMPHASIS = re.compile(r"(\*\*|\*|~~|`)(\S(?:.*?\S)?)\1")
# Underscores only mean emphasis at word boundaries, so snake_case_names stay intact.
_UNDERSCORE_EMPHASIS = re.compile(r"(?<!\w)(__|_)(\S(?:.*?\S)?)\1(?!\w)")


def markdown_to_text(markdown: str) -> str:
    """The readable text of a Markdown document on one line: no #, **, `, pipes or links."""
    lines = []
    for line in markdown.splitlines():
        if _FENCE.match(line) or _TABLE_SEPARATOR.match(line):
            continue
        line = _LINE_PREFIX.sub("", line)
        if line.strip().startswith("|"):
            line = " · ".join(cell.strip() for cell in line.strip().strip("|").split("|"))
        line = _IMAGE.sub(r"\1", line)
        line = _LINK.sub(r"\1", line)
        line = _EMPHASIS.sub(r"\2", line)
        line = _UNDERSCORE_EMPHASIS.sub(r"\2", line)
        lines.append(line)
    return " ".join(" ".join(lines).split())


def excerpt(markdown: str, length: int) -> str:
    text = markdown_to_text(markdown)
    return text if len(text) <= length else text[:length].rstrip() + "…"
