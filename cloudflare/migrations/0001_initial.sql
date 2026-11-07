-- GD Free NONGs Cloudflare D1 schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  gd_song_id TEXT PRIMARY KEY,
  ng_song_id TEXT,
  original_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nongs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gd_song_id TEXT NOT NULL,
  ng_song_id TEXT,
  original_name TEXT NOT NULL,
  custom_name TEXT,
  description TEXT,
  object_key TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploader TEXT NOT NULL DEFAULT 'Community',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gd_song_id) REFERENCES songs(gd_song_id)
);

CREATE INDEX IF NOT EXISTS idx_nongs_song_status ON nongs(gd_song_id, status);
CREATE INDEX IF NOT EXISTS idx_nongs_hash ON nongs(gd_song_id, sha256);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nongs_unique_audio ON nongs(gd_song_id, sha256);

CREATE TABLE IF NOT EXISTS selections (
  device_id TEXT NOT NULL,
  gd_song_id TEXT NOT NULL,
  nong_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, gd_song_id)
);
CREATE INDEX IF NOT EXISTS idx_selections_nong ON selections(nong_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  game_device_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_pairs (
  browser_device_id TEXT PRIMARY KEY,
  game_device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_device_pairs_game ON device_pairs(game_device_id);

CREATE TABLE IF NOT EXISTS pairing_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
