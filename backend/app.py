from __future__ import annotations
import hashlib, os, sqlite3, uuid
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv("GFN_DATA_DIR", ROOT / "data"))
UPLOADS = DATA / "audio"
DB = DATA / "gfn.sqlite3"
MAX_BYTES = 30 * 1024 * 1024
ALLOWED = {".mp3", ".ogg", ".wav", ".flac", ".m4a"}
DATA.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="GD Free NONGs API", version="0.1.0", description="Development API for the GD Free NONGs platform.")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("GFN_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,null").split(","), allow_credentials=False, allow_methods=["GET","POST","OPTIONS"], allow_headers=["*"])

def db():
    conn=sqlite3.connect(DB)
    conn.row_factory=sqlite3.Row
    return conn

def init():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS nongs(id INTEGER PRIMARY KEY AUTOINCREMENT, gd_song_id TEXT NOT NULL, ng_song_id TEXT, original_name TEXT NOT NULL, custom_name TEXT, description TEXT, filename TEXT NOT NULL, format TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, uploader TEXT NOT NULL DEFAULT 'Community', status TEXT NOT NULL DEFAULT 'pending');
        CREATE INDEX IF NOT EXISTS idx_nongs_song ON nongs(gd_song_id);
        CREATE TABLE IF NOT EXISTS selections(device_id TEXT NOT NULL, gd_song_id TEXT NOT NULL, nong_id INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(device_id,gd_song_id));
        """)
init()

class Selection(BaseModel):
    gd_song_id: str
    nong_id: Optional[int] = None
    device_id: str = "browser-local"

@app.get("/health")
def health(): return {"status":"ok","service":"GD Free NONGs API","version":"0.1.0"}

@app.get("/api/v1/songs")
def songs():
    with db() as c:
        rows=c.execute("SELECT gd_song_id, original_name, COUNT(*) AS nongs FROM nongs WHERE status='approved' GROUP BY gd_song_id,original_name ORDER BY original_name").fetchall()
    return [{"gd_song_id":r["gd_song_id"],"name":r["original_name"],"artist":"Community catalog","nongs":r["nongs"]} for r in rows]

@app.get("/api/v1/songs/{gd_song_id}/nongs")
def song_nongs(gd_song_id: str):
    with db() as c:
        rows=c.execute("SELECT id,gd_song_id,original_name,custom_name,description,format,size,uploader FROM nongs WHERE gd_song_id=? AND status='approved' ORDER BY id DESC",(gd_song_id,)).fetchall()
    return [{"id":r["id"],"gd_song_id":r["gd_song_id"],"original_name":r["original_name"],"custom_name":r["custom_name"],"display_name":r["custom_name"] or r["original_name"],"description":r["description"],"format":r["format"],"size":r["size"],"uploader":r["uploader"]} for r in rows]

@app.post("/api/v1/nongs/upload")
async def upload_nong(file: UploadFile=File(...), gd_song_id: str=Form(...), original_name: str=Form(...), ng_song_id: str=Form(""), custom_name: str=Form(""), description: str=Form("")):
    gd_song_id=gd_song_id.strip()
    if not gd_song_id or len(gd_song_id)>32 or not gd_song_id.replace("-","").isalnum(): raise HTTPException(400,"Invalid Geometry Dash song ID")
    if not original_name.strip() or len(original_name)>180: raise HTTPException(400,"Original song name is required (max 180 characters)")
    suffix=Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED: raise HTTPException(415,"Unsupported audio format")
    data=await file.read(MAX_BYTES+1)
    if not data or len(data)>MAX_BYTES: raise HTTPException(413,"Audio must be between 1 byte and 30 MiB")
    # Store under a random server-generated name; never trust an uploaded path.
    digest=hashlib.sha256(data).hexdigest()
    filename=f"{uuid.uuid4().hex}{suffix}"
    (UPLOADS/filename).write_bytes(data)
    with db() as c:
        cur=c.execute("INSERT INTO nongs(gd_song_id,ng_song_id,original_name,custom_name,description,filename,format,size,sha256,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')",(gd_song_id,ng_song_id.strip() or None,original_name.strip(),custom_name.strip() or None,description.strip()[:2000],filename,suffix[1:],len(data),digest))
        item_id=cur.lastrowid
    return {"id":item_id,"status":"pending","display_name":custom_name.strip() or original_name.strip(),"sha256":digest,"message":"Received for moderation; not yet publicly listed."}

@app.post("/api/v1/selections/save")
def save_selection(payload: Selection):
    if not payload.gd_song_id or len(payload.gd_song_id)>32: raise HTTPException(400,"Invalid song ID")
    if len(payload.device_id)>128: raise HTTPException(400,"Invalid device ID")
    if payload.nong_id is not None:
        with db() as c:
            row=c.execute("SELECT id FROM nongs WHERE id=? AND gd_song_id=? AND status='approved'",(payload.nong_id,payload.gd_song_id)).fetchone()
        if row is None: raise HTTPException(404,"Approved NONG not found for this song")
    with db() as c:
        c.execute("INSERT INTO selections(device_id,gd_song_id,nong_id) VALUES(?,?,?) ON CONFLICT(device_id,gd_song_id) DO UPDATE SET nong_id=excluded.nong_id,updated_at=CURRENT_TIMESTAMP",(payload.device_id,payload.gd_song_id,payload.nong_id))
    return {"saved":True,"gd_song_id":payload.gd_song_id,"nong_id":payload.nong_id,"device_id":payload.device_id}

@app.get("/api/v1/selections/{device_id}")
def get_selections(device_id: str):
    with db() as c:
        rows=c.execute("SELECT gd_song_id,nong_id,updated_at FROM selections WHERE device_id=? ORDER BY gd_song_id",(device_id,)).fetchall()
    return [dict(r) for r in rows]
