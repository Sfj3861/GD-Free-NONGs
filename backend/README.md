# Backend API — development guide

## Run locally

```bash
cd backend
python -m venv .venv
# activate the environment
pip install -r requirements.txt
GFN_ADMIN_TOKEN="replace-with-a-long-random-value" uvicorn app:app --reload
```

The development API uses SQLite and stores uploaded audio in `backend/data/audio/` by default. Set `GFN_DATA_DIR` to move that data directory. Set `GFN_CORS_ORIGINS` to a comma-separated allowlist for the deployed frontend.

## Current endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/v1/songs` | Songs with approved community versions |
| GET | `/api/v1/songs/{gd_song_id}/nongs` | Approved versions for one song |
| POST | `/api/v1/nongs/upload` | Submit an audio file for moderation |
| POST | `/api/v1/admin/nongs/{id}/moderate` | Approve or reject a pending upload |
| GET | `/api/v1/nongs/{id}/download` | Download an approved audio file |
| POST | `/api/v1/selections/save` | Save one selected version for a device/song |
| GET | `/api/v1/selections/{device_id}` | Read a device's selections |
| GET | `/api/v1/sync/{device_id}` | Read selections and download metadata for the mod |

## Moderation

Uploads are always created with status `pending`; they are not listed or downloadable until approved. Set `GFN_ADMIN_TOKEN` on the server and send it in the `X-Admin-Token` header when calling the moderation endpoint.

Example request body:

```json
{"decision":"approve"}
```

Allowed decisions are `approve` and `reject`.

## Current limitations — do not deploy publicly yet

This is an early development API. It does not yet have user accounts, verified device pairing, per-user authorization, rate limiting, malware scanning, object storage/CDN, automated rights review, or a production database migration system. The current `device_id` is a client-provided identifier, not proof of identity. Before public deployment, add authentication and authorization to selection, sync, upload and moderation operations, plus a formal takedown process.

Only accept audio that the uploader is legally authorized to redistribute. A track ID is an identifier, not a distribution license.
