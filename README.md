# GD Free NONGs

A Geometry Dash-inspired community library for alternative audio versions (NONGs) that users are authorized to distribute.

## Repository layout
- `web/`: responsive browser interface.
- `backend/`: FastAPI service, SQLite development database and audio storage.
- `infra/`: local Docker setup.

## Local development

### Web
Open `web/index.html` directly, or serve the folder with any static HTTP server. Set `window.GFN_API_BASE` before loading the app to connect it to the API (default: `http://localhost:8000`).

### API
```bash
cd backend
python -m venv .venv
# activate the environment
pip install -r requirements.txt
uvicorn app:app --reload
```

Audio uploads are limited to 30 MiB and accepted formats are MP3, OGG, WAV, FLAC and M4A. Each upload requires an explicit rights confirmation, is checked for duplicate audio, and enters the pending moderation queue.

To enable local moderation, start the API with an admin token:
```bash
GFN_ADMIN_TOKEN=your-local-secret uvicorn app:app --reload
```

Open the **MODERATE** section in the web interface, enter the token, and approve or reject pending uploads. The token is held only in the current page session and sent through the `X-Admin-Token` header; it is not stored in browser storage.

The catalogue supports server-side search and pagination through `GET /api/v1/catalog/songs?q=...&page=1&limit=20`. The original `GET /api/v1/songs` endpoint remains available for existing clients.

Browser/game pairing uses `POST /api/v1/pairing/request` from the game device and `POST /api/v1/pairing/claim` from the browser profile. The game receives a random 16-character hexadecimal code that expires in 10 minutes and is stored server-side only as a SHA-256 hash. Codes are single-use; requesting a new code for the same game device replaces the previous one. Pairing request/claim calls are limited per API-observed client IP. If deployed behind a reverse proxy, configure rate limiting at the proxy too.

After pairing, `POST /api/v1/selections/save` automatically maps the browser profile ID to the linked game device ID. The mod reads those selections through `GET /api/v1/sync/{game_device_id}` and downloads only approved NONGs through the existing download endpoint. The mod verifies the SHA-256 digest before registering local replacements.

The browser and game can be paired with a one-time 16-character code. In the Jukebox, request a code with **Pair website**, then enter it in the web **PAIR** tab. Codes expire after 10 minutes, are single-use, and pairing attempts are rate-limited by client IP. Once paired, website selections are stored against the game device ID; press **Sync website** in the Jukebox to download approved NONGs, verify their SHA-256 digests, and apply them locally.

The API currently uses SQLite and local file storage for development. It is not publicly deployed. Before production use, add managed database/object storage, user authentication and secure device pairing, rate limiting, backups, monitoring, and a documented rights/takedown process. The admin token is a basic single-server moderation control, not a complete account system.

## Rights and safety
Only upload audio you own or are authorized to redistribute. A Newgrounds or Geometry Dash ID identifies a track; it does not grant redistribution rights. Public deployment must add authentication, moderation, abuse controls and a suitable rights/takedown process.
