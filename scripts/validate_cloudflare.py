from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
worker = (ROOT / "cloudflare/src/index.js").read_text()
schema = (ROOT / "cloudflare/migrations/0001_initial.sql").read_text()
config = (ROOT / "cloudflare/wrangler.jsonc").read_text()
deploy = (ROOT / ".github/workflows/deploy-cloudflare.yml").read_text()

required_routes = [
    '"/health"',
    '"/api/v1/songs"',
    '"/api/v1/catalog/songs"',
    '"/api/v1/nongs/upload"',
    '"/api/v1/admin/nongs/pending"',
    '"/api/v1/pairing/request"',
    '"/api/v1/pairing/claim"',
    '"/api/v1/selections/save"',
]
for route in required_routes:
    assert route in worker, f"Missing Cloudflare API route marker: {route}"

for table in ("songs", "nongs", "selections", "pairing_codes", "device_pairs", "pairing_rate_limits"):
    assert f"CREATE TABLE IF NOT EXISTS {table}" in schema, f"Missing D1 table: {table}"

assert "env.DB" in worker and "env.AUDIO" in worker
assert "env.ASSETS.fetch(request)" in worker
assert "MAX_AUDIO_BYTES = 30 * 1024 * 1024" in worker
assert "GFN_ADMIN_TOKEN" in worker
assert "__D1_DATABASE_ID__" in config
assert "workflow_dispatch:" in deploy
assert "CLOUDFLARE_API_TOKEN" in deploy
assert "GFN_ADMIN_TOKEN" in deploy

# Validate that the initial migration is valid SQLite SQL, as D1 is SQLite-based.
connection = sqlite3.connect(":memory:")
connection.executescript(schema)
tables = {
    row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )
}
expected = {"songs", "nongs", "selections", "pairing_codes", "device_pairs", "pairing_rate_limits"}
assert expected.issubset(tables), f"Missing tables after migration: {expected - tables}"
indexes = {
    row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    )
}
assert "idx_nongs_unique_audio" in indexes, "Duplicate audio protection index is missing"
connection.close()

print("Cloudflare Worker routes, bindings, deployment config and D1 migration validated.")
