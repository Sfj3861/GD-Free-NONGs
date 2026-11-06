from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv("GFN_DATA_DIR", ROOT / "data"))
UPLOADS = DATA / "audio"
DB = DATA / "gfn.sqlite3"
MAX_BYTES = 30 * 1024 * 1024
ALLOWED = {".mp3", ".ogg", ".wav", ".flac", ".m4a"}
MEDIA_TYPES = {
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".flac": "audio/flac", ".m4a": "audio/mp4",
}
DATA.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="GD Free NONGs API",
    version="0.2.0",
    description="Development API for the GD Free NONGs platform.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "GFN_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,null",
    ).split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@contextmanager
def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS songs(
            gd_song_id TEXT PRIMARY KEY,
            ng_song_id TEXT,
            original_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS nongs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gd_song_id TEXT NOT NULL,
            ng_song_id TEXT,
            original_name TEXT NOT NULL,
            custom_name TEXT,
            description TEXT,
            filename TEXT NOT NULL,
            format TEXT NOT NULL,
            size INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            uploader TEXT NOT NULL DEFAULT 'Community',
            status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_nongs_song ON nongs(gd_song_id);
        INSERT OR IGNORE INTO songs(gd_song_id,ng_song_id,original_name)
            SELECT gd_song_id, MAX(ng_song_id), MIN(original_name)
            FROM nongs GROUP BY gd_song_id;
        CREATE TABLE IF NOT EXISTS selections(
            device_id TEXT NOT NULL,
            gd_song_id TEXT NOT NULL,
            nong_id INTEGER,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(device_id, gd_song_id)
        );
        """)


init()


class Selection(BaseModel):
    gd_song_id: str
    nong_id: Optional[int] = None
    device_id: str = "browser-local"


class ModerationDecision(BaseModel):
    decision: Literal["approve", "reject"]


def audio_signature_matches(suffix: str, data: bytes) -> bool:
    """Cheap container signature check; extension alone is never trusted."""
    if suffix == ".mp3":
        return data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)
    if suffix == ".ogg":
        return data.startswith(b"OggS")
    if suffix == ".wav":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    if suffix == ".flac":
        return data.startswith(b"fLaC")
    if suffix == ".m4a":
        return len(data) >= 12 and data[4:8] == b"ftyp"
    return False


def public_nong(row):
    return {
        "id": row["id"],
        "gd_song_id": row["gd_song_id"],
        "original_name": row["original_name"],
        "custom_name": row["custom_name"],
        "display_name": row["custom_name"] or row["original_name"],
        "description": row["description"],
        "format": row["format"],
        "size": row["size"],
        "sha256": row["sha256"],
        "uploader": row["uploader"],
    }


def require_admin(token: Optional[str]):
    expected = os.getenv("GFN_ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Moderation is not configured on this server")
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(401, "Invalid admin token")


@app.get("/health")
def health():
    return {"status": "ok", "service": "GD Free NONGs API", "version": "0.2.0"}


@app.get("/api/v1/songs")
def songs():
    with db() as c:
        rows = c.execute(
            "SELECT s.gd_song_id,s.original_name,"
            "SUM(CASE WHEN n.status='approved' THEN 1 ELSE 0 END) AS nongs "
            "FROM songs s LEFT JOIN nongs n ON n.gd_song_id=s.gd_song_id "
            "GROUP BY s.gd_song_id,s.original_name ORDER BY s.original_name"
        ).fetchall()
    return [
        {
            "gd_song_id": r["gd_song_id"],
            "name": r["original_name"],
            "artist": "Community catalog",
            "nongs": r["nongs"] or 0,
        }
        for r in rows
    ]


@app.get("/api/v1/catalog/songs")
def paginated_song_catalog(
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """Search the community catalogue without requiring clients to download every song."""
    query = q.strip()
    where = ""
    params: tuple[str, ...] = ()
    if query:
        where = " WHERE instr(lower(s.original_name), lower(?)) > 0 OR instr(s.gd_song_id, ?) > 0"
        params = (query, query)

    with db() as c:
        total = c.execute(
            "SELECT COUNT(*) FROM songs s" + where,
            params,
        ).fetchone()[0]

        pages = (total + limit - 1) // limit
        current_page = min(page, pages) if pages else 1
        offset = (current_page - 1) * limit
        rows = c.execute(
            "SELECT s.gd_song_id,s.original_name,"
            "SUM(CASE WHEN n.status='approved' THEN 1 ELSE 0 END) AS nongs "
            "FROM songs s LEFT JOIN nongs n ON n.gd_song_id=s.gd_song_id"
            + where
            + " GROUP BY s.gd_song_id,s.original_name "
            "ORDER BY s.original_name COLLATE NOCASE,s.gd_song_id "
            "LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()

    return {
        "items": [
            {
                "gd_song_id": row["gd_song_id"],
                "name": row["original_name"],
                "artist": "Community catalog",
                "nongs": row["nongs"] or 0,
            }
            for row in rows
        ],
        "pagination": {
            "page": current_page,
            "limit": limit,
            "total": total,
            "pages": pages,
            "has_previous": current_page > 1,
            "has_next": current_page < pages,
        },
    }


@app.get("/api/v1/songs/{gd_song_id}/nongs")
def song_nongs(gd_song_id: str):
    with db() as c:
        rows = c.execute(
            "SELECT * FROM nongs WHERE gd_song_id=? AND status='approved' ORDER BY id DESC",
            (gd_song_id,),
        ).fetchall()
    return [public_nong(r) for r in rows]


@app.post("/api/v1/nongs/upload")
async def upload_nong(
    file: UploadFile = File(...),
    gd_song_id: str = Form(...),
    original_name: str = Form(...),
    ng_song_id: str = Form(""),
    custom_name: str = Form(""),
    description: str = Form(""),
):
    gd_song_id = gd_song_id.strip()
    if not gd_song_id or len(gd_song_id) > 32 or not gd_song_id.replace("-", "").isalnum():
        raise HTTPException(400, "Invalid Geometry Dash song ID")
    if not original_name.strip() or len(original_name) > 180:
        raise HTTPException(400, "Original song name is required (max 180 characters)")
    if len(custom_name) > 180 or len(ng_song_id) > 32:
        raise HTTPException(400, "Custom name or Newgrounds ID is too long")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, "Unsupported audio format")
    data = await file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "Audio must be between 1 byte and 30 MiB")

    if not audio_signature_matches(suffix, data):
        raise HTTPException(415, "The file contents do not match the selected audio format")

    digest = hashlib.sha256(data).hexdigest()
    filename = f"{uuid.uuid4().hex}{suffix}"
    stored_path = UPLOADS / filename

    try:
        # Serialize duplicate checks and inserts so simultaneous requests cannot
        # register the same song/audio pair twice in SQLite.
        stored_path.write_bytes(data)
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            duplicate = c.execute(
                "SELECT id FROM nongs WHERE gd_song_id=? AND sha256=?",
                (gd_song_id, digest),
            ).fetchone()
            if duplicate:
                raise HTTPException(
                    409,
                    f"This exact audio file is already registered for this song (NONG {duplicate['id']})",
                )

            c.execute(
                "INSERT INTO songs(gd_song_id,ng_song_id,original_name) VALUES(?,?,?) "
                "ON CONFLICT(gd_song_id) DO NOTHING",
                (gd_song_id, ng_song_id.strip() or None, original_name.strip()),
            )
            song = c.execute(
                "SELECT original_name,ng_song_id FROM songs WHERE gd_song_id=?",
                (gd_song_id,),
            ).fetchone()
            canonical_name = song["original_name"]
            canonical_ng_id = ng_song_id.strip() or song["ng_song_id"]

            cur = c.execute(
                "INSERT INTO nongs(gd_song_id,ng_song_id,original_name,custom_name,"
                "description,filename,format,size,sha256,status) "
                "VALUES(?,?,?,?,?,?,?,?,?,'pending')",
                (
                    gd_song_id, canonical_ng_id, canonical_name,
                    custom_name.strip() or None, description.strip()[:2000],
                    filename, suffix[1:], len(data), digest,
                ),
            )
            item_id = cur.lastrowid
    except Exception:
        # Never leave an unreferenced audio file behind after a failed DB write.
        stored_path.unlink(missing_ok=True)
        raise

    return {
        "id": item_id,
        "status": "pending",
        "display_name": custom_name.strip() or original_name.strip(),
        "sha256": digest,
        "message": "Received for moderation; not yet publicly listed.",
    }


@app.post("/api/v1/admin/nongs/{nong_id}/moderate")
def moderate_nong(
    nong_id: int,
    payload: ModerationDecision,
    x_admin_token: Optional[str] = Header(default=None),
):
    require_admin(x_admin_token)
    new_status = "approved" if payload.decision == "approve" else "rejected"
    with db() as c:
        cur = c.execute(
            "UPDATE nongs SET status=? WHERE id=? AND status='pending'",
            (new_status, nong_id),
        )
        if cur.rowcount != 1:
            raise HTTPException(404, "Pending NONG not found")
    return {"id": nong_id, "status": new_status}


@app.get("/api/v1/nongs/{nong_id}/download")
def download_nong(nong_id: int):
    with db() as c:
        row = c.execute(
            "SELECT filename,format,custom_name,original_name FROM nongs "
            "WHERE id=? AND status='approved'",
            (nong_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Approved NONG not found")
    path = UPLOADS / row["filename"]
    if not path.is_file():
        raise HTTPException(410, "Audio file is no longer available")
    suffix = "." + row["format"]
    download_name = f"{row['custom_name'] or row['original_name']}{suffix}"
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(suffix, "application/octet-stream"),
        filename=Path(download_name).name,
    )


@app.post("/api/v1/selections/save")
def save_selection(payload: Selection):
    if not payload.gd_song_id or len(payload.gd_song_id) > 32:
        raise HTTPException(400, "Invalid song ID")
    if not payload.device_id or len(payload.device_id) > 128:
        raise HTTPException(400, "Invalid device ID")
    if payload.nong_id is not None:
        with db() as c:
            row = c.execute(
                "SELECT id FROM nongs WHERE id=? AND gd_song_id=? AND status='approved'",
                (payload.nong_id, payload.gd_song_id),
            ).fetchone()
        if row is None:
            raise HTTPException(404, "Approved NONG not found for this song")
    with db() as c:
        c.execute(
            "INSERT INTO selections(device_id,gd_song_id,nong_id) VALUES(?,?,?) "
            "ON CONFLICT(device_id,gd_song_id) DO UPDATE SET "
            "nong_id=excluded.nong_id,updated_at=CURRENT_TIMESTAMP",
            (payload.device_id, payload.gd_song_id, payload.nong_id),
        )
    return {
        "saved": True,
        "gd_song_id": payload.gd_song_id,
        "nong_id": payload.nong_id,
        "device_id": payload.device_id,
    }


@app.get("/api/v1/selections/{device_id}")
def get_selections(device_id: str):
    with db() as c:
        rows = c.execute(
            "SELECT gd_song_id,nong_id,updated_at FROM selections "
            "WHERE device_id=? ORDER BY gd_song_id",
            (device_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/v1/sync/{device_id}")
def sync_device(device_id: str):
    if not device_id or len(device_id) > 128:
        raise HTTPException(400, "Invalid device ID")
    with db() as c:
        rows = c.execute(
            "SELECT s.gd_song_id,s.nong_id,s.updated_at,n.custom_name,n.original_name,"
            "n.format,n.size,n.sha256 "
            "FROM selections s LEFT JOIN nongs n ON n.id=s.nong_id "
            "AND n.status='approved' WHERE s.device_id=? ORDER BY s.gd_song_id",
            (device_id,),
        ).fetchall()
    result = []
    for r in rows:
        if r["nong_id"] is not None and r["sha256"] is None:
            # The selected item was removed or is no longer approved.
            result.append({
                "gd_song_id": r["gd_song_id"],
                "nong_id": None,
                "status": "unavailable",
                "updated_at": r["updated_at"],
            })
            continue
        result.append({
            "gd_song_id": r["gd_song_id"],
            "nong_id": r["nong_id"],
            "is_original": r["nong_id"] is None,
            "display_name": r["custom_name"] or r["original_name"] if r["nong_id"] is not None else None,
            "format": r["format"],
            "size": r["size"],
            "sha256": r["sha256"],
            "download_path": f"/api/v1/nongs/{r['nong_id']}/download" if r["nong_id"] is not None else None,
            "updated_at": r["updated_at"],
            "status": "ready",
        })
    return {"device_id": device_id, "selections": result}
