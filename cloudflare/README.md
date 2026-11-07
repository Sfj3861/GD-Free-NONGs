# Cloudflare deployment — GD Free NONGs

This is the production-oriented Cloudflare implementation. It uses:
- Workers for the HTTPS API and static website routing.
- D1 for songs, approved/pending NONG metadata, selections and pairing.
- R2 for persistent audio objects.
- Workers Static Assets to serve the existing `web/` frontend from the same origin.

The existing `backend/` FastAPI + SQLite + local filesystem service remains available for local development. It is **not** the production deployment target.

## Required Cloudflare resources

Create a D1 database named `gfn-production` and an R2 bucket named `gfn-audio`. Apply the SQL migration in `migrations/0001_initial.sql`. Put a long random secret in the Worker secret `GFN_ADMIN_TOKEN`.

The generated `wrangler.jsonc` expects the D1 database ID to replace `__D1_DATABASE_ID__`. Never commit API tokens or admin secrets.

## Deploy manually

1. Install Node.js 22+ and Wrangler 4.
2. Authenticate with `npx wrangler login`.
3. Create resources:
   ```sh
   npx wrangler d1 create gfn-production
   npx wrangler r2 bucket create gfn-audio
   ```
4. Replace `__D1_DATABASE_ID__` in `wrangler.jsonc` with the ID returned by Cloudflare.
5. Apply schema and set the admin secret:
   ```sh
   npx wrangler d1 migrations apply gfn-production --remote
   npx wrangler secret put GFN_ADMIN_TOKEN
   ```
6. Deploy:
   ```sh
   npx wrangler deploy
   ```

Cloudflare will print the public `workers.dev` URL. Configure the Geode mod's API URL to that HTTPS address.

## API compatibility

The Worker implements the routes currently used by the web frontend and Geode mod:
- `GET /health`
- `GET /api/v1/songs`
- `GET /api/v1/catalog/songs`
- `GET /api/v1/songs/{gd_song_id}/nongs`
- `POST /api/v1/nongs/upload`
- `GET /api/v1/admin/nongs/pending`
- `POST /api/v1/admin/nongs/{id}/moderate`
- `GET /api/v1/nongs/{id}/download`
- `POST /api/v1/pairing/request`
- `POST /api/v1/pairing/claim`
- `POST /api/v1/selections/save`
- `GET /api/v1/selections/{device_id}`
- `GET /api/v1/sync/{device_id}`

Uploads are limited to 30 MiB and supported audio container signatures are checked. New uploads remain pending until approved. Rejected audio objects are deleted from R2. The game mod verifies SHA-256 after downloading.

## Free-plan constraints

Cloudflare Free is not unlimited. Current documented Workers limits include 100,000 requests/day and 10 ms CPU time per request. D1 Free includes 5 GB total storage, 5 million rows read/day and 100,000 rows written/day. R2 includes 10 GB-month Standard storage, 1 million Class A operations and 10 million Class B operations per month. Exceeding included allowances may require waiting for quota reset or upgrading; do not promise unlimited service.

## Security and launch checklist

- Keep `GFN_ADMIN_TOKEN` in Worker secrets only.
- Use the Cloudflare account's built-in TLS on the `workers.dev` hostname.
- Add an explicit rights/takedown contact and process before public community uploads.
- Add stricter upload abuse controls and moderation audit logs before opening uploads widely.
- Configure alerts/analytics and backup/export procedures for D1 metadata.
- Do not treat a successful Worker deploy as an end-to-end test. Verify upload → moderation → download → pairing → selection → game sync against the live service.

## Important current limitation

The first cloud implementation keeps the same client-provided device ID model as the existing API. Pairing codes are single-use and expire after 10 minutes, but device IDs are not user authentication. Before large-scale public launch, add account/device authentication and more granular upload abuse protection.
