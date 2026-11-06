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

Audio uploads are limited to 30 MiB and accepted formats are MP3, OGG, WAV, FLAC and M4A. The API stores files locally for development; production object storage, authentication, moderation and rate limiting are not yet configured.

## Rights and safety
Only upload audio you own or are authorized to redistribute. A Newgrounds or Geometry Dash ID identifies a track; it does not grant redistribution rights. Public deployment must add authentication, moderation, abuse controls and a suitable rights/takedown process.
