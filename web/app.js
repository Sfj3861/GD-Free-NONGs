(() => {
  "use strict";

  const DB_NAME = "gfn-local-library";
  const DB_VERSION = 1;
  const STORE = "nongs";
  const MAX_BYTES = 30 * 1024 * 1024;
  const EXTENSIONS = new Set(["mp3", "ogg", "wav", "flac", "m4a"]);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  let db;
  let songs = [];
  let selectedSong = null;
  let selectedVersion = "original";
  let currentVersions = [];

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("songId", "gd_song_id", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento local."));
    });
  }

  function transaction(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try { result = operation(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      tx.onerror = () => reject(tx.error || new Error("Error de almacenamiento local."));
      tx.onabort = () => reject(tx.error || new Error("Operación local cancelada."));
    });
  }

  function getAll() {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function getSongNongs(songId) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).index("songId").getAll(String(songId));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function selections() {
    try { return JSON.parse(localStorage.getItem("gfn-local-selections") || "{}"); }
    catch { return {}; }
  }

  function show(view) {
    ["library", "detail", "import"].forEach(name => $(name + "View").classList.toggle("hidden", name !== view));
    $("hero").classList.toggle("hidden", view !== "library");
    document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  }

  function groupSongs(entries) {
    const grouped = new Map();
    for (const entry of entries) {
      const id = String(entry.gd_song_id);
      if (!grouped.has(id)) grouped.set(id, {
        gd_song_id: id, name: entry.original_name, artist: entry.ng_song_id ? "Newgrounds ID " + entry.ng_song_id : "Local audio",
        versions: 0, newest: entry.created_at || 0
      });
      const song = grouped.get(id);
      song.versions++;
      if (!song.name && entry.original_name) song.name = entry.original_name;
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function refresh() {
    const entries = await getAll();
    const query = $("search").value.trim().toLocaleLowerCase();
    songs = groupSongs(entries).filter(song =>
      (song.name + " " + song.gd_song_id + " " + song.artist).toLocaleLowerCase().includes(query)
    );
    $("songCount").textContent = songs.length + " SONGS";
    $("songGrid").innerHTML = songs.map(song => `
      <button class="song-card" data-id="${esc(song.gd_song_id)}">
        <div class="song-id">GD ID · ${esc(song.gd_song_id)}</div>
        <h3>${esc(song.name)}</h3>
        <p>${esc(song.artist)}</p>
        <div class="card-bottom"><span>${song.versions} LOCAL VERSION(S)</span><span>OPEN ↗</span></div>
      </button>`).join("");
    $("emptyState").classList.toggle("hidden", songs.length !== 0);
    $("songGrid").querySelectorAll(".song-card").forEach(button => button.addEventListener("click", () => openSong(button.dataset.id)));
  }

  async function openSong(id) {
    selectedSong = songs.find(song => song.gd_song_id === String(id));
    if (!selectedSong) return;
    currentVersions = await getSongNongs(id);
    const saved = selections()[id];
    selectedVersion = saved && currentVersions.some(item => item.id === saved) ? String(saved) : "original";
    $("songDetail").innerHTML = `
      <div class="detail-head">
        <div class="eyebrow">LOCAL SONG · GD ID ${esc(id)}</div>
        <h2>${esc(selectedSong.name)}</h2>
        <p>${esc(selectedSong.artist)} · ${currentVersions.length} version(s) stored on this device.</p>
      </div>
      <div class="eyebrow">CHOOSE A VERSION</div>
      <div class="version-list">
        <label class="version"><input type="radio" name="version" value="original" ${selectedVersion === "original" ? "checked" : ""}>
          <span class="version-info"><b>Original song</b><small>Use the original Geometry Dash audio.</small></span><span class="version-tag">ORIGINAL</span></label>
        ${currentVersions.map(item => `
          <label class="version"><input type="radio" name="version" value="${item.id}" ${selectedVersion === String(item.id) ? "checked" : ""}>
            <span class="version-info"><b>${esc(item.custom_name || item.original_name)}</b><small>${esc(item.format.toUpperCase())} · ${formatSize(item.size)}</small></span>
            <span class="version-tag">LOCAL</span></label>`).join("")}
      </div>
      <div class="save-row"><button class="gd-button" id="saveSelection">SAVE SELECTION <span>✓</span></button>
      <button class="page-button" id="exportSelection">EXPORT FOR GEODE <span>↓</span></button></div>
      <div class="form-status" id="detailStatus" role="status"></div>
      <div class="eyebrow">MANAGE LOCAL VERSIONS</div>
      <div class="version-list" id="manageVersions">${currentVersions.map(item => `
        <div class="version"><span class="version-info"><b>${esc(item.custom_name || item.original_name)}</b><small>${esc(item.file_name)} · ${formatSize(item.size)}</small></span>
        <button class="page-button delete-version" data-id="${item.id}" type="button">DELETE</button></div>`).join("")}</div>`;
    $("songDetail").querySelectorAll('input[name="version"]').forEach(input => input.addEventListener("change", () => { selectedVersion = input.value; }));
    $("saveSelection").addEventListener("click", saveSelection);
    $("exportSelection").addEventListener("click", exportSelection);
    $("songDetail").querySelectorAll(".delete-version").forEach(button => button.addEventListener("click", () => deleteVersion(Number(button.dataset.id))));
    show("detail");
  }

  function saveSelection() {
    const all = selections();
    all[selectedSong.gd_song_id] = selectedVersion === "original" ? "original" : Number(selectedVersion);
    localStorage.setItem("gfn-local-selections", JSON.stringify(all));
    $("saveMessage").textContent = selectedVersion === "original"
      ? "El juego utilizará la canción original. Para retirar un NONG ya aplicado, elimina o mueve su archivo de la carpeta del mod."
      : "Selección guardada localmente. Exporta el archivo para Geode y cópialo a la carpeta de datos del mod.";
    $("saveDialog").showModal();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportSelection() {
    if (selectedVersion === "original") {
      $("detailStatus").textContent = "Has seleccionado la canción original; no hay ningún NONG que exportar.";
      return;
    }
    const item = currentVersions.find(version => String(version.id) === String(selectedVersion));
    if (!item) return;
    downloadBlob(item.audio, "song-" + item.gd_song_id + "." + item.format);
    $("detailStatus").textContent = "Exportado como song-" + item.gd_song_id + "." + item.format + ". Copia el archivo a la carpeta de datos del mod GD Free NONGs.";
  }

  async function deleteVersion(id) {
    const item = currentVersions.find(version => version.id === id);
    if (!item || !confirm("¿Eliminar esta versión local? Esta acción no se puede deshacer.")) return;
    await transaction("readwrite", store => store.delete(id));
    const all = selections();
    if (all[item.gd_song_id] === id) { delete all[item.gd_song_id]; localStorage.setItem("gfn-local-selections", JSON.stringify(all)); }
    await refresh();
    await openSong(item.gd_song_id);
  }

  function validAudio(extension, bytes) {
    if (!EXTENSIONS.has(extension) || !bytes.length || bytes.length > MAX_BYTES) return false;
    if (extension === "mp3") return (bytes.length >= 3 && String.fromCharCode(...bytes.slice(0, 3)) === "ID3") ||
      (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 224) === 224);
    if (extension === "ogg") return String.fromCharCode(...bytes.slice(0, 4)) === "OggS";
    if (extension === "wav") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE";
    if (extension === "flac") return String.fromCharCode(...bytes.slice(0, 4)) === "fLaC";
    if (extension === "m4a") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
    return false;
  }

  async function importNong(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("importStatus");
    const data = new FormData(form);
    const file = data.get("file");
    const songId = String(data.get("gd_song_id") || "").trim();
    const originalName = String(data.get("original_name") || "").trim();
    const customName = String(data.get("custom_name") || "").trim();
    const extension = file.name.split(".").pop().toLowerCase();
    if (!(file instanceof File) || !file.size) { status.textContent = "Selecciona un archivo de audio."; return; }
    if (!/^[0-9]{1,12}$/.test(songId)) { status.textContent = "El ID de Geometry Dash debe ser numérico."; return; }
    if (!originalName) { status.textContent = "Escribe el nombre de la canción."; return; }
    if (file.size > MAX_BYTES) { status.textContent = "El archivo supera el límite de 30 MiB."; return; }
    status.textContent = "Validando el audio y guardándolo localmente…";
    try {
      const buffer = await file.arrayBuffer();
      if (!validAudio(extension, new Uint8Array(buffer))) throw new Error("El formato o la firma interna del archivo no es válida.");
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
      const record = {
        gd_song_id: songId,
        ng_song_id: String(data.get("ng_song_id") || "").trim(),
        original_name: originalName,
        custom_name: customName,
        file_name: file.name,
        format: extension,
        size: file.size,
        sha256,
        audio: file,
        created_at: Date.now()
      };
      await transaction("readwrite", store => store.add(record));
      form.reset();
      status.textContent = "Guardado en IndexedDB. No se ha enviado ningún dato a Internet.";
      await refresh();
    } catch (error) {
      status.textContent = "No se pudo importar: " + error.message;
    }
  }

  document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => show(button.dataset.view)));
  $("importForm").addEventListener("submit", importNong);
  $("search").addEventListener("input", refresh);
  $("backToLibrary").addEventListener("click", () => show("library"));
  $("infoOpen").addEventListener("click", () => $("infoDialog").showModal());
  $("infoClose").addEventListener("click", () => $("infoDialog").close());
  $("infoDone").addEventListener("click", () => $("infoDialog").close());
  $("saveClose").addEventListener("click", () => $("saveDialog").close());
  $("saveDone").addEventListener("click", () => $("saveDialog").close());

  openDatabase().then(async database => {
    db = database;
    await refresh();
  }).catch(error => {
    $("emptyState").classList.remove("hidden");
    $("emptyState").textContent = "El almacenamiento local no está disponible en este navegador: " + error.message;
  });
})();