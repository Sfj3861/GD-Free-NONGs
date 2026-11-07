# GD Free NONGs — Local Edition

GD Free NONGs is a **local-first, offline** library for managing alternative audio files for Geometry Dash. The normal workflow does not use accounts, Cloudflare, FastAPI, a database server, a remote API, or any cloud service.

## Components

- `web/`: standalone browser interface. NONG audio and metadata are stored in the browser's IndexedDB.
- [Geode mod repository](https://github.com/Sfj3861/GD-Free-NONGs-GEODE): imports local audio through the system file picker, stores it in the mod's save directory and redirects Geometry Dash's song resolver.
- No server process or Internet connection is required to manage files already stored on the device.

## Browser workflow

1. Open `web/index.html` in a modern browser.
2. Open **IMPORT**, choose an audio file, enter its Geometry Dash song ID and song name, and confirm you are authorized to use the audio.
3. Open the song in **LIBRARY**, select a version and choose **EXPORT FOR GEODE**.
4. The browser downloads the file with the exact name `song-<GD_ID>.<extension>`.
5. Open the Geode Jukebox, choose **Import audio**, and select the downloaded file using the system file picker. The mod copies it into its private save directory.

Supported formats: MP3, OGG, WAV, FLAC and M4A. Maximum imported file size: 30 MiB. The browser checks the file signature and computes SHA-256 locally. Nothing is uploaded.

## Geometry Dash / Geode workflow

1. Install the GD Free NONGs Geode mod.
2. Open Geometry Dash and press the configured Jukebox key or the NONGs main-menu button.
3. Choose **Import audio** and select the exported `song-<GD_ID>.<extension>` file from the system file picker.
4. The mod validates the audio, copies it into its private save directory, registers it and applies it locally.
5. Use **Delete** in My NONGs to remove a managed file and restore the original Geometry Dash audio.

The browser and the game do not share storage. Exporting the audio file and importing it through Geode's system file picker is the deliberate offline bridge between them.

## Backups and privacy

Browser IndexedDB is local to that browser profile. Clearing browser data can remove the library. Export audio files you want to preserve. The Geode mod stores its own managed files and index in its local save directory.

## Rights

Only import and use audio you own or are authorized to use. A Geometry Dash or Newgrounds ID is an identifier, not permission to redistribute a track.

## Compatibility target

- Geometry Dash 2.2091
- Geode SDK 6.0.0-alpha.1

Build and in-game compatibility still require validation on the corresponding Windows and Android64 targets.
