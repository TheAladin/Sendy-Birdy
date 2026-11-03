"""A small stand-in for `make build`'s output."""

from pathlib import Path

INDEX = "<!doctype html><title>Sendy Birdy</title>"
SCRIPT = "console.log('app')"
ASSET = "/assets/index-Ab12Cd34.js"


def make_build(dist: Path) -> Path:
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / ASSET.lstrip("/")).write_text(SCRIPT)
    (dist / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    return dist
