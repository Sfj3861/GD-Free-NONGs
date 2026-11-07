# GD Free NONGs — Local Edition

GD Free NONGs is a **local-first, offline** library for managing alternative audio files for Geometry Dash. The normal workflow does not use accounts, Cloudflare, FastAPI, a database server, a remote API, or any cloud service.

## Components

- `web/`: standalone browser interface. NONG audio and metadata are stored in the browser's IndexedDB.
- `GD-Free-NONGs-GEODE/`: Geode mod. It detects local audio files in its own save directory and redirects Geometry Dash's song resolver to them.
- No server process or Internet connection is required to manage files already stored on the device.

## Browser workflow

1. Open `web/index.html` in a modern browser.
2. Open **IMPORT**, choose an audio file, enter its Geometry Dash song ID and song name, and confirm you are authorized to use the audio.
3. Open the song in **LIBRARY**, select a version and choose **EXPORT FOR GEODE**.
4. The browser downloads the file with the exact name `song-<GD_ID>.<extension>`.
5. Copy that file into the GD Free NONGs mod save directory on the device running Geometry Dash.

Supported formats: MP3, OGG, WAV, FLAC and M4A. Maximum imported file size: 30 MiB. The browser checks the file signature and computes SHA-256 locally. Nothing is uploaded.

## Geometry Dash / Geode workflow

1. Install the GD Free NONGs Geode mod.
2. Find the mod's save directory using Geode's mod data tools/file manager.
3. Copy files named `song-<GD_ID>.mp3`, `.ogg`, `.wav`, `.flac` or `.m4a` into that directory.
4. Open Geometry Dash and press the configured Jukebox key or the NONGs main-menu button.
5. The mod scans the directory, registers matching files and applies them locally.
6. Use **Delete** in My NONGs to remove a managed file and restore the original Geometry Dash audio.

The browser and the game do not share browser storage. Exporting and copying the audio file is the deliberate offline bridge between them.

## Backups and privacy

Browser IndexedDB is local to that browser profile. Clearing browser data can remove the library. Export audio files you want to preserve. The Geode mod stores its own managed files and index in its local save directory.

## Rights

Only import and use audio you own or are authorized to use. A Geometry Dash or Newgrounds ID is an identifier, not permission to redistribute a track.

## Compatibility target

- Geometry Dash 2.2091
- Geode SDK 6.0.0-alpha.1

Build and in-game compatibility still require validation on the corresponding Windows and Android64 targets.
