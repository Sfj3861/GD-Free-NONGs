const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const AUDIO_TYPES = new Set(["mp3", "ogg", "wav", "flac", "m4a"]);
const MIME_TYPES = {
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
  flac: "audio/flac", m4a: "audio/mp4"
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
function error(message, status = 400) { return json({ detail: message }, status); }
function cleanText(value, max) { return String(value ?? "").trim().slice(0, max); }
function isValidSongId(value) { return /^[A-Za-z0-9-]{1,32}$/.test(value); }
function isValidDeviceId(value) { return typeof value === "string" && value.length > 0 && value.length <= 128; }
function hex(bytes) { return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, "0")).join(""); }
async function sha256(bytes) { return hex(await crypto.subtle.digest("SHA-256", bytes)); }
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function validAudio(format, bytes) {
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return false;
  const starts = (s, at = 0) => s.every((v, i) => bytes[at + i] === v);
  if (format === "mp3") return starts([0x49, 0x44, 0x33]) ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (format === "ogg") return starts([0x4f, 0x67, 0x67, 0x53]);
  if (format === "wav") return bytes.length >= 12 && starts([0x52,0x49,0x46,0x46]) && starts([0x57,0x41,0x56,0x45], 8);
  if (format === "flac") return starts([0x66,0x4c,0x61,0x43]);
  if (format === "m4a") return bytes.length >= 12 && starts([0x66,0x74,0x79,0x70], 4);
  return false;
}
function publicNong(row) {
  return {
    id: row.id, gd_song_id: row.gd_song_id, original_name: row.original_name,
    custom_name: row.custom_name, display_name: row.custom_name || row.original_name,
    description: row.description, format: row.format, size: row.size,
    sha256: row.sha256, uploader: row.uploader
  };
}
async function rateLimit(db, key, limit) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    "SELECT window_started_at, attempts FROM pairing_rate_limits WHERE client_key=?"
  ).bind(key).first();
  if (!row || now - row.window_started_at >= 600) {
    await db.prepare(
      "INSERT INTO pairing_rate_limits(client_key,window_started_at,attempts) VALUES(?,?,1) " +
      "ON CONFLICT(client_key) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=1"
    ).bind(key, now).run();
    return true;
  }
  if (row.attempts >= limit) return false;
  await db.prepare("UPDATE pairing_rate_limits SET attempts=attempts+1 WHERE client_key=?")
    .bind(key).run();
  return true;
}
function clientIp(request) { return request.headers.get("CF-Connecting-IP") || "unknown"; }
async function requireAdmin(request, env) {
  const expected = env.GFN_ADMIN_TOKEN;
  const supplied = request.headers.get("X-Admin-Token") || "";
  if (!expected) return { ok: false, response: error("Moderation is not configured on this server", 503) };
  if (!supplied || supplied.length !== expected.length) return { ok: false, response: error("Invalid admin token", 401) };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (diff !== 0) return { ok: false, response: error("Invalid admin token", 401) };
  return { ok: true };
}
async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;
  const audio = env.AUDIO;

  if (request.method === "GET" && path === "/health") {
    const check = await db.prepare("SELECT 1 AS ok").first();
    return json({ status: check?.ok === 1 ? "ok" : "degraded", service: "GD Free NONGs API", version: "1.0.0-cloudflare" });
  }

  if (request.method === "GET" && path === "/api/v1/songs") {
    const rows = await db.prepare(
      "SELECT s.gd_song_id,s.original_name,SUM(CASE WHEN n.status='approved' THEN 1 ELSE 0 END) AS nongs " +
      "FROM songs s LEFT JOIN nongs n ON n.gd_song_id=s.gd_song_id GROUP BY s.gd_song_id,s.original_name ORDER BY s.original_name"
    ).all();
    return json((rows.results || []).map(r => ({
      gd_song_id: r.gd_song_id, name: r.original_name, artist: "Community catalog", nongs: r.nongs || 0
    })));
  }

  if (request.method === "GET" && path === "/api/v1/catalog/songs") {
    const q = cleanText(url.searchParams.get("q"), 100);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20));
    const where = q ? " WHERE instr(lower(s.original_name),lower(?))>0 OR instr(s.gd_song_id,?)>0" : "";
    const params = q ? [q, q] : [];
    const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM songs s" + where).bind(...params).first();
    const total = totalRow?.total || 0;
    const pages = Math.ceil(total / limit);
    const currentPage = pages ? Math.min(page, pages) : 1;
    const rows = await db.prepare(
      "SELECT s.gd_song_id,s.original_name,SUM(CASE WHEN n.status='approved' THEN 1 ELSE 0 END) AS nongs " +
      "FROM songs s LEFT JOIN nongs n ON n.gd_song_id=s.gd_song_id" + where +
      " GROUP BY s.gd_song_id,s.original_name ORDER BY s.original_name COLLATE NOCASE,s.gd_song_id LIMIT ? OFFSET ?"
    ).bind(...params, limit, (currentPage - 1) * limit).all();
    return json({
      items: (rows.results || []).map(r => ({
        gd_song_id: r.gd_song_id, name: r.original_name, artist: "Community catalog", nongs: r.nongs || 0
      })),
      pagination: {
        page: currentPage, limit, total, pages,
        has_previous: currentPage > 1, has_next: currentPage < pages
      }
    });
  }

  const songNongs = path.match(/^\/api\/v1\/songs\/([^/]+)\/nongs$/);
  if (request.method === "GET" && songNongs) {
    const songId = decodeURIComponent(songNongs[1]);
    const rows = await db.prepare(
      "SELECT * FROM nongs WHERE gd_song_id=? AND status='approved' ORDER BY id DESC"
    ).bind(songId).all();
    return json((rows.results || []).map(publicNong));
  }

  if (request.method === "POST" && path === "/api/v1/nongs/upload") {
    let form;
    try { form = await request.formData(); } catch { return error("Invalid multipart upload", 400); }
    const file = form.get("file");
    const songId = cleanText(form.get("gd_song_id"), 32);
    const originalName = cleanText(form.get("original_name"), 180);
    const ngSongId = cleanText(form.get("ng_song_id"), 32);
    const customName = cleanText(form.get("custom_name"), 180);
    const description = cleanText(form.get("description"), 2000);
    if (!(file instanceof File)) return error("Audio file is required", 422);
    if (!isValidSongId(songId)) return error("Invalid Geometry Dash song ID");
    if (!originalName) return error("Original song name is required (max 180 characters)");
    if (form.get("rights_confirmed") !== "true") return error("You must confirm that you have permission to redistribute this audio");
    const suffix = (file.name.split(".").pop() || "").toLowerCase();
    if (!AUDIO_TYPES.has(suffix)) return error("Unsupported audio format", 415);
    if (!file.size || file.size > MAX_AUDIO_BYTES) return error("Audio must be between 1 byte and 30 MiB", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validAudio(suffix, bytes)) return error("The file contents do not match the selected audio format", 415);
    const digest = await sha256(bytes);
    const duplicate = await db.prepare("SELECT id FROM nongs WHERE gd_song_id=? AND sha256=?")
      .bind(songId, digest).first();
    if (duplicate) return error("This exact audio file is already registered for this song (NONG " + duplicate.id + ")", 409);
    const song = await db.prepare("SELECT original_name,ng_song_id FROM songs WHERE gd_song_id=?")
      .bind(songId).first();
    const canonicalName = song?.original_name || originalName;
    const canonicalNgId = ngSongId || song?.ng_song_id || null;
    const objectKey = crypto.randomUUID() + "." + suffix;
    await audio.put(objectKey, bytes, {
      httpMetadata: { contentType: MIME_TYPES[suffix], cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { sha256: digest, gd_song_id: songId }
    });
    try {
      const statements = [];
      statements.push(db.prepare(
        "INSERT INTO songs(gd_song_id,ng_song_id,original_name) VALUES(?,?,?) ON CONFLICT(gd_song_id) DO NOTHING"
      ).bind(songId, canonicalNgId, canonicalName));
      statements.push(db.prepare(
        "INSERT INTO nongs(gd_song_id,ng_song_id,original_name,custom_name,description,object_key,format,size,sha256,status) " +
        "VALUES(?,?,?,?,?,?,?,?,?,'pending')"
      ).bind(songId, canonicalNgId, canonicalName, customName || null, description, objectKey, suffix, bytes.length, digest));
      await db.batch(statements);
    } catch (e) {
      await audio.delete(objectKey);
      throw e;
    }
    const created = await db.prepare("SELECT id FROM nongs WHERE object_key=?").bind(objectKey).first();
    return json({
      id: created.id, status: "pending", display_name: customName || originalName,
      sha256: digest, message: "Received for moderation; not yet publicly listed."
    }, 201);
  }

  if (request.method === "GET" && path === "/api/v1/admin/nongs/pending") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth.response;
    const rows = await db.prepare("SELECT * FROM nongs WHERE status='pending' ORDER BY id ASC").all();
    return json((rows.results || []).map(publicNong));
  }

  const moderation = path.match(/^\/api\/v1\/admin\/nongs\/(\d+)\/moderate$/);
  if (request.method === "POST" && moderation) {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth.response;
    let payload;
    try { payload = await request.json(); } catch { return error("Invalid JSON body"); }
    if (!["approve", "reject"].includes(payload.decision)) return error("Decision must be approve or reject");
    const id = Number(moderation[1]);
    const row = await db.prepare("SELECT object_key FROM nongs WHERE id=? AND status='pending'").bind(id).first();
    if (!row) return error("Pending NONG not found", 404);
    const status = payload.decision === "approve" ? "approved" : "rejected";
    const changed = await db.prepare("UPDATE nongs SET status=? WHERE id=? AND status='pending'")
      .bind(status, id).run();
    if (!changed.meta?.changes) return error("Pending NONG not found", 404);
    if (status === "rejected") await audio.delete(row.object_key);
    return json({ id, status });
  }

  const download = path.match(/^\/api\/v1\/nongs\/(\d+)\/download$/);
  if (request.method === "GET" && download) {
    const row = await db.prepare(
      "SELECT object_key,format,custom_name,original_name FROM nongs WHERE id=? AND status='approved'"
    ).bind(Number(download[1])).first();
    if (!row) return error("Approved NONG not found", 404);
    const object = await audio.get(row.object_key);
    if (!object) return error("Audio file is no longer available", 410);
    const name = (row.custom_name || row.original_name).replace(/[\\/\r\n"]/g, "_") + "." + row.format;
    return new Response(object.body, {
      headers: {
        "content-type": MIME_TYPES[row.format] || "application/octet-stream",
        "content-length": String(object.size),
        "content-disposition": 'attachment; filename="' + name + '"',
        "cache-control": "public, max-age=86400"
      }
    });
  }

  if (request.method === "POST" && path === "/api/v1/pairing/request") {
    let payload;
    try { payload = await request.json(); } catch { return error("Invalid JSON body"); }
    const gameDeviceId = cleanText(payload.device_id, 128);
    if (!isValidDeviceId(gameDeviceId)) return error("Invalid game device ID");
    const ip = clientIp(request);
    const allowed = await rateLimit(db, "request:" + ip, 5);
    if (!allowed) return error("Too many pairing codes requested. Try again in 10 minutes.", 429);
    const code = randomCode();
    const codeHash = await sha256(new TextEncoder().encode(code));
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    await db.prepare(
      "INSERT INTO pairing_codes(game_device_id,code_hash,expires_at) VALUES(?,?,?) " +
      "ON CONFLICT(game_device_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=CURRENT_TIMESTAMP"
    ).bind(gameDeviceId, codeHash, expiresAt).run();
    return json({ code, expires_in_seconds: 600, expires_at: expiresAt });
  }

  if (request.method === "POST" && path === "/api/v1/pairing/claim") {
    let payload;
    try { payload = await request.json(); } catch { return error("Invalid JSON body"); }
    const browserDeviceId = cleanText(payload.browser_device_id, 128);
    const code = cleanText(payload.code, 16).toUpperCase();
    if (!isValidDeviceId(browserDeviceId)) return error("Invalid browser device ID");
    if (!/^[A-F0-9]{16}$/.test(code)) return error("Invalid or expired pairing code");
    const ip = clientIp(request);
    if (!await rateLimit(db, "claim:" + ip, 8)) return error("Too many pairing attempts. Try again in 10 minutes.", 429);
    const codeHash = await sha256(new TextEncoder().encode(code));
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare(
      "SELECT game_device_id FROM pairing_codes WHERE code_hash=? AND expires_at>?"
    ).bind(codeHash, now).first();
    if (!row) return error("Invalid or expired pairing code");
    await db.batch([
      db.prepare(
        "INSERT INTO device_pairs(browser_device_id,game_device_id) VALUES(?,?) " +
        "ON CONFLICT(browser_device_id) DO UPDATE SET game_device_id=excluded.game_device_id,created_at=CURRENT_TIMESTAMP"
      ).bind(browserDeviceId, row.game_device_id),
      db.prepare("DELETE FROM pairing_codes WHERE game_device_id=?").bind(row.game_device_id)
    ]);
    return json({ paired: true, browser_device_id: browserDeviceId });
  }

  if (request.method === "POST" && path === "/api/v1/selections/save") {
    let payload;
    try { payload = await request.json(); } catch { return error("Invalid JSON body"); }
    const songId = cleanText(payload.gd_song_id, 32);
    const deviceId = cleanText(payload.device_id, 128);
    const nongId = payload.nong_id === null || payload.nong_id === undefined ? null : Number(payload.nong_id);
    if (!isValidSongId(songId)) return error("Invalid song ID");
    if (!isValidDeviceId(deviceId)) return error("Invalid device ID");
    if (nongId !== null) {
      if (!Number.isSafeInteger(nongId) || nongId <= 0) return error("Invalid NONG ID");
      const valid = await db.prepare(
        "SELECT id FROM nongs WHERE id=? AND gd_song_id=? AND status='approved'"
      ).bind(nongId, songId).first();
      if (!valid) return error("Approved NONG not found for this song", 404);
    }
    const pair = await db.prepare("SELECT game_device_id FROM device_pairs WHERE browser_device_id=?")
      .bind(deviceId).first();
    const targetDeviceId = pair?.game_device_id || deviceId;
    await db.prepare(
      "INSERT INTO selections(device_id,gd_song_id,nong_id) VALUES(?,?,?) " +
      "ON CONFLICT(device_id,gd_song_id) DO UPDATE SET nong_id=excluded.nong_id,updated_at=CURRENT_TIMESTAMP"
    ).bind(targetDeviceId, songId, nongId).run();
    return json({
      saved: true, gd_song_id: songId, nong_id: nongId, device_id: targetDeviceId,
      browser_device_id: deviceId, paired: targetDeviceId !== deviceId
    });
  }

  const selections = path.match(/^\/api\/v1\/selections\/([^/]+)$/);
  if (request.method === "GET" && selections) {
    const deviceId = decodeURIComponent(selections[1]);
    const rows = await db.prepare(
      "SELECT gd_song_id,nong_id,updated_at FROM selections WHERE device_id=? ORDER BY gd_song_id"
    ).bind(deviceId).all();
    return json(rows.results || []);
  }

  const sync = path.match(/^\/api\/v1\/sync\/([^/]+)$/);
  if (request.method === "GET" && sync) {
    const deviceId = decodeURIComponent(sync[1]);
    if (!isValidDeviceId(deviceId)) return error("Invalid device ID");
    const rows = await db.prepare(
      "SELECT s.gd_song_id,s.nong_id,s.updated_at,n.custom_name,n.original_name,n.format,n.size,n.sha256,n.status " +
      "FROM selections s LEFT JOIN nongs n ON n.id=s.nong_id AND n.status='approved' " +
      "WHERE s.device_id=? ORDER BY s.gd_song_id"
    ).bind(deviceId).all();
    const result = (rows.results || []).map(r => {
      if (r.nong_id !== null && r.sha256 === null) return {
        gd_song_id: r.gd_song_id, nong_id: null, status: "unavailable", updated_at: r.updated_at
      };
      return {
        gd_song_id: r.gd_song_id, nong_id: r.nong_id, is_original: r.nong_id === null,
        display_name: r.nong_id !== null ? (r.custom_name || r.original_name) : null,
        format: r.format, size: r.size, sha256: r.sha256,
        download_path: r.nong_id !== null ? "/api/v1/nongs/" + r.nong_id + "/download" : null,
        updated_at: r.updated_at, status: "ready"
      };
    });
    return json({ device_id: deviceId, selections: result });
  }

  return error("API endpoint not found", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": url.origin,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "Content-Type,X-Admin-Token",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }
    try {
      if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
        const response = await handleApi(request, env, ctx);
        const headers = new Headers(response.headers);
        headers.set("access-control-allow-origin", url.origin);
        headers.set("vary", "Origin");
        return new Response(response.body, { status: response.status, headers });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("GD Free NONGs request failed", err);
      return error("Internal server error", 500);
    }
  }
};
