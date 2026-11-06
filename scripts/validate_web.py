#!/usr/bin/env python3
"""Static checks for the GD Free NONGs browser interface."""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


class InterfaceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.nav_views = []
        self.rights_confirmation = False
        self.admin_token = False
        self.pairing_code = False
        self.forms = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        element_id = attrs.get("id")
        if element_id:
            self.ids.append(element_id)
        if tag == "button" and attrs.get("data-view"):
            self.nav_views.append(attrs["data-view"])
        if tag == "form" and element_id:
            self.forms.add(element_id)
        if tag == "input" and attrs.get("name") == "rights_confirmed":
            self.rights_confirmation = (
                attrs.get("type") == "checkbox" and "required" in attrs
            )
        if tag == "input" and element_id == "adminToken":
            self.admin_token = (
                attrs.get("type") == "password"
                and attrs.get("autocomplete") == "off"
            )
        if tag == "input" and element_id == "pairCode":
            self.pairing_code = (
                attrs.get("type") == "text"
                and attrs.get("maxlength") == "16"
                and "required" in attrs
                and attrs.get("pattern") == "[A-Fa-f0-9]{16}"
            )


def main():
    html_path = Path(__file__).resolve().parents[1] / "web" / "index.html"
    source = html_path.read_text(encoding="utf-8")
    parser = InterfaceParser()
    parser.feed(source)
    parser.close()

    duplicates = [name for name, count in Counter(parser.ids).items() if count > 1]
    if duplicates:
        raise SystemExit("Duplicate HTML IDs: " + ", ".join(sorted(duplicates)))

    required_ids = {
        "hero", "libraryView", "detailView", "publishView", "moderateView",
        "songGrid", "songPagination", "previousPage", "nextPage", "pageInfo",
        "uploadForm", "uploadStatus", "rights_confirmed", "adminForm",
        "adminToken", "adminLogout", "moderationStatus", "pendingList",
        "infoDialog", "saveDialog", "pairView", "pairForm",
        "pairCode", "pairStatus",
    }
    # The rights declaration is a field name, not an HTML id.
    required_ids.discard("rights_confirmed")
    missing = sorted(required_ids.difference(parser.ids))
    if missing:
        raise SystemExit("Missing required interface IDs: " + ", ".join(missing))

    if not {"library", "publish", "moderate", "pair"}.issubset(parser.nav_views):
        raise SystemExit("Library, Publish and Moderate navigation entries are required")
    if not {"uploadForm", "adminForm"}.issubset(parser.forms):
        raise SystemExit("Upload and admin forms are required")
    if not parser.rights_confirmation:
        raise SystemExit("Uploads must require a rights-confirmation checkbox")
    if not parser.admin_token:
        raise SystemExit("Admin token input must be password-type with autocomplete off")
    if not parser.pairing_code:
        raise SystemExit("Pairing code must require a 16-character hexadecimal value")

    js = html_path.with_name("app.js").read_text(encoding="utf-8")
    for expected in (
        'async function claimGamePairing',
        '/api/v1/pairing/claim',
        'deviceId()',
        'result.paired',
        '/api/v1/admin/nongs/pending',
        'moderateNong',
    ):
        if expected not in js:
            raise SystemExit("Missing browser flow: " + expected)

    print("Web interface structure, pairing, moderation and safety controls passed")


if __name__ == "__main__":
    main()
