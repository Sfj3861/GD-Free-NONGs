#!/usr/bin/env python3
"""Static checks for the offline GD Free NONGs browser interface."""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


class InterfaceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.nav_views = []
        self.forms = set()
        self.rights_confirmation = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "button" and attrs.get("data-view"):
            self.nav_views.append(attrs["data-view"])
        if tag == "form" and attrs.get("id"):
            self.forms.add(attrs["id"])
        if tag == "input" and attrs.get("name") == "rights_confirmed":
            self.rights_confirmation = attrs.get("type") == "checkbox" and "required" in attrs


def main():
    root = Path(__file__).resolve().parents[1]
    html_path = root / "web" / "index.html"
    source = html_path.read_text(encoding="utf-8")
    parser = InterfaceParser()
    parser.feed(source)
    parser.close()

    duplicates = [name for name, count in Counter(parser.ids).items() if count > 1]
    if duplicates:
        raise SystemExit("Duplicate HTML IDs: " + ", ".join(sorted(duplicates)))

    required_ids = {
        "hero", "libraryView", "detailView", "importView", "songGrid",
        "emptyState", "search", "importForm", "importStatus", "rights_confirmed",
        "infoDialog", "saveDialog", "backToLibrary",
    }
    required_ids.discard("rights_confirmed")  # This is an input name, not an ID.
    missing = sorted(required_ids.difference(parser.ids))
    if missing:
        raise SystemExit("Missing required interface IDs: " + ", ".join(missing))

    if not {"library", "import"}.issubset(parser.nav_views):
        raise SystemExit("Offline Library and Import navigation entries are required")
    if "importForm" not in parser.forms:
        raise SystemExit("The local import form is required")
    if not parser.rights_confirmation:
        raise SystemExit("Import must require confirmation of audio-use rights")

    js_path = root / "web" / "app.js"
    css_path = root / "web" / "styles.css"
    if not js_path.is_file() or not css_path.is_file():
        raise SystemExit("The local JavaScript and CSS assets must both exist")
    js = js_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")

    for expected in (
        'indexedDB.open(DB_NAME, DB_VERSION)',
        'store.add(record)',
        'crypto.subtle.digest("SHA-256", buffer)',
        'downloadBlob(item.audio, "song-"',
        'function exportSelection()',
        'if (!(file instanceof File) || !file.size)',
        'const extension = file.name.includes(".")',
    ):
        if expected not in js:
            raise SystemExit("Missing or unsafe local browser flow: " + expected)

    for forbidden in ("fetch(", "XMLHttpRequest", "/api/v1/", "GFN_API_BASE", "cloudflare", "WebSocket", "EventSource"):
        if forbidden in js or forbidden in source or forbidden in css:
            raise SystemExit("Remote dependency found in offline interface: " + forbidden)

    for asset_name, asset_source in (("HTML", source), ("JavaScript", js), ("CSS", css)):
        if "https://" in asset_source or "http://" in asset_source:
            raise SystemExit("External network URL found in offline " + asset_name + " asset")

    print("Offline browser structure, local assets, IndexedDB storage, checksum and Geode export passed")


if __name__ == "__main__":
    main()
