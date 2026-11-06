(() => {
  "use strict";

  const API = window.GFN_API_BASE || "http://localhost:8000";
  const PAGE_SIZE = 18;
  const seed = [
    { gd_song_id: "467339", name: "At The Speed Of Light", artist: "Dimrain47", nongs: 0 },
    { gd_song_id: "613399", name: "Clubstep", artist: "DJ-Nate", nongs: 0 },
    { gd_song_id: "soundtrack", name: "Geometry Dash Soundtrack", artist: "Waterflame & various artists", nongs: 0 }
  ];

  let songs = [...seed];
  let selectedSong = null;
  let selectedVersion = "original";
  let currentPage = 1;
  let totalPages = 1;
  let totalSongs = songs.length;
  let searchTimer = null;
  let apiConnected = false;
  let moderationToken = "";

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));

  function localSelections() {
    try {
      return JSON.parse(localStorage.getItem("gfn-selections") || "{}");
    } catch {
      return {};
    }
  }

  function deviceId() {
    let id = localStorage.getItem("gfn-device-id");
    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : "gfn-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      localStorage.setItem("gfn-device-id", id);
    }
    return id;
  }

  function show(view) {
    ["library", "detail", "publish", "moderate"].forEach(name => {
      $(name + "View").classList.toggle("hidden", name !== view);
    });
    $("adminForm").addEventListener("submit", async event => {
    event.preventDefault();
    await loadModerationQueue($("adminToken").value.trim());
  });
  $("adminLogout").addEventListener("click", () => {
    moderationToken = "";
    $("adminToken").value = "";
    $("pendingList").innerHTML = "";
    $("moderationStatus").textContent = "Moderation token cleared from this page session.";
  });

  document.querySelectorAll(".nav-button").forEach(button => {
      button.classList.toggle("active", button.dataset.view === view);
    });
  }

  async function loadModerationQueue(token = moderationToken) {
    const status = $("moderationStatus");
    const list = $("pendingList");
    if (!token) {
      status.textContent = "Enter the moderation token to load the pending queue.";
      list.innerHTML = "";
      return;
    }

    status.textContent = "Loading moderation queue…";
    try {
      const response = await fetch(API + "/api/v1/admin/nongs/pending", {
        headers: { "X-Admin-Token": token }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Moderation access failed");
      if (!Array.isArray(data)) throw new Error("Invalid moderation queue response");

      moderationToken = token;
      status.textContent = data.length
        ? data.length + " upload(s) waiting for review."
        : "The moderation queue is empty.";
      list.innerHTML = data.map(item => `
        <article class="song-card moderation-card">
          <div class="song-id">PENDING · NONG #${esc(item.id)} · GD ID ${esc(item.gd_song_id)}</div>
          <h3>${esc(item.display_name || item.original_name)}</h3>
          <p>${esc(item.uploader || "Community")} · ${esc(item.format || "audio")} · ${Math.ceil((item.size || 0) / 1024)} KB</p>
          <div class="card-bottom">
            <button class="gd-button moderation-action" data-id="${esc(item.id)}" data-decision="approve">APPROVE</button>
            <button class="page-button moderation-action" data-id="${esc(item.id)}" data-decision="reject">REJECT</button>
          </div>
        </article>
      `).join("");

      list.querySelectorAll(".moderation-action").forEach(button => {
        button.addEventListener("click", () => moderateNong(button.dataset.id, button.dataset.decision));
      });
    } catch (error) {
      moderationToken = "";
      list.innerHTML = "";
      status.textContent = "Could not load moderation queue: " + error.message;
    }
  }

  async function moderateNong(id, decision) {
    if (!moderationToken) return;
    const status = $("moderationStatus");
    status.textContent = (decision === "approve" ? "Approving" : "Rejecting") + " NONG #" + id + "…";
    try {
      const response = await fetch(API + "/api/v1/admin/nongs/" + encodeURIComponent(id) + "/moderate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": moderationToken
        },
        body: JSON.stringify({ decision })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Moderation action failed");
      await loadModerationQueue();
    } catch (error) {
      status.textContent = "Moderation failed: " + error.message;
    }
  }

  function setConnection(connected) {
    apiConnected = connected;
    $("connection").classList.toggle("online", connected);
    $("connection").innerHTML = connected
      ? "<i></i> API CONNECTED"
      : "<i></i> LOCAL PREVIEW";
  }

  function renderSongs() {
    $("songCount").textContent = totalSongs + " SONGS";
    $("songGrid").innerHTML = songs.map(song => `
      <button class="song-card" data-id="${esc(song.gd_song_id)}">
        <div class="song-id">GD ID · ${esc(song.gd_song_id)}</div>
        <h3>${esc(song.name)}</h3>
        <p>${esc(song.artist || "Original track")}</p>
        <div class="card-bottom">
          <span>${song.nongs || 0} ALTERNATIVE VERSIONS</span><span>OPEN ↗</span>
        </div>
      </button>
    `).join("");

    $("emptyState").classList.toggle("hidden", songs.length !== 0);
    $("songPagination").classList.toggle("hidden", totalPages <= 1);
    $("previousPage").disabled = currentPage <= 1;
    $("nextPage").disabled = currentPage >= totalPages;
    $("pageInfo").textContent = "PAGE " + currentPage + " / " + Math.max(totalPages, 1);

    document.querySelectorAll(".song-card").forEach(button => {
      button.addEventListener("click", () => openSong(button.dataset.id));
    });
  }

  async function refresh(page = 1) {
    const query = $("search").value.trim();
    currentPage = Math.max(1, page);

    try {
      const url = new URL(API + "/api/v1/catalog/songs");
      url.searchParams.set("q", query);
      url.searchParams.set("page", String(currentPage));
      url.searchParams.set("limit", String(PAGE_SIZE));
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error("Catalogue request failed");
      const data = await response.json();
      if (!data || !Array.isArray(data.items) || !data.pagination) {
        throw new Error("Invalid catalogue response");
      }

      songs = data.items;
      currentPage = data.pagination.page;
      totalPages = data.pagination.pages;
      totalSongs = data.pagination.total;
      setConnection(true);
    } catch {
      const filtered = seed.filter(song =>
        (song.name + " " + song.gd_song_id + " " + song.artist).toLowerCase().includes(query.toLowerCase())
      );
      totalSongs = filtered.length;
      totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      currentPage = Math.min(currentPage, totalPages);
      const start = (currentPage - 1) * PAGE_SIZE;
      songs = filtered.slice(start, start + PAGE_SIZE);
      setConnection(false);
    }

    renderSongs();
  }

  async function openSong(id) {
    selectedSong = songs.find(song => String(song.gd_song_id) === String(id));
    if (!selectedSong) return;

    selectedVersion = "original";
    let versions = [];
    try {
      const response = await fetch(API + "/api/v1/songs/" + encodeURIComponent(id) + "/nongs");
      if (response.ok) versions = await response.json();
      if (!Array.isArray(versions)) versions = [];
    } catch {
      versions = [];
    }

    const detail = $("songDetail");
    detail.innerHTML = `
      <div class="detail-head">
        <div class="eyebrow">ORIGINAL SONG · GD ID ${esc(id)}</div>
        <h2>${esc(selectedSong.name)}</h2>
        <p>${esc(selectedSong.artist || "Original track")} · Select one version, then press SAVE.</p>
      </div>
      <div class="eyebrow">AVAILABLE VERSIONS</div>
      <div class="version-list">
        <label class="version">
          <input type="radio" name="version" value="original" checked>
          <span class="version-info"><b>Original song</b><small>Use the original Geometry Dash / Newgrounds audio</small></span>
          <span class="version-tag">ORIGINAL</span>
        </label>
        ${versions.map(version => `
          <label class="version">
            <input type="radio" name="version" value="${esc(version.id)}">
            <span class="version-info">
              <b>${esc(version.display_name || version.custom_name || version.original_name || selectedSong.name)}</b>
              <small>${esc(version.uploader || "Community")} · ${esc(version.format || "audio")} · ${Math.ceil((version.size || 0) / 1024)} KB</small>
            </span>
            <span class="version-tag">NONG</span>
          </label>
        `).join("")}
      </div>
      <div class="save-row"><button class="gd-button" id="saveSelection">SAVE <span>✓</span></button></div>
    `;

    $("saveSelection").addEventListener("click", saveSelection);
    detail.querySelectorAll('input[name="version"]').forEach(input => {
      input.addEventListener("change", () => { selectedVersion = input.value; });
    });
    show("detail");
  }

  async function saveSelection() {
    const choice = selectedVersion;
    const all = localSelections();
    all[selectedSong.gd_song_id] = choice;
    localStorage.setItem("gfn-selections", JSON.stringify(all));

    let synced = false;
    try {
      const response = await fetch(API + "/api/v1/selections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gd_song_id: selectedSong.gd_song_id,
          nong_id: choice === "original" ? null : Number(choice),
          device_id: deviceId()
        })
      });
      synced = response.ok;
    } catch {
      synced = false;
    }

    $("saveMessage").textContent = synced
      ? "Selection saved to the API."
      : "Selection saved in this browser. Connect the Geode mod and a deployed API to synchronize with the game.";
    $("saveDialog").showModal();
  }

  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => show(button.dataset.view));
  });
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refresh(1), 250);
  });
  $("previousPage").addEventListener("click", () => {
    if (currentPage > 1) refresh(currentPage - 1);
  });
  $("nextPage").addEventListener("click", () => {
    if (currentPage < totalPages) refresh(currentPage + 1);
  });
  $("backToLibrary").addEventListener("click", () => show("library"));

  $("infoOpen").addEventListener("click", () => $("infoDialog").showModal());
  $("infoClose").addEventListener("click", () => $("infoDialog").close());
  $("infoDone").addEventListener("click", () => $("infoDialog").close());
  $("saveClose").addEventListener("click", () => $("saveDialog").close());
  $("saveDone").addEventListener("click", () => $("saveDialog").close());

  $("uploadForm").addEventListener("submit", async event => {
    event.preventDefault();
    const status = $("uploadStatus");
    const form = new FormData(event.currentTarget);
    status.textContent = "Validating and uploading…";

    try {
      const response = await fetch(API + "/api/v1/nongs/upload", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed");
      status.textContent = "Upload received. NONG ID: " + data.id + " — pending moderation.";
      event.currentTarget.reset();
      await refresh(1);
    } catch (error) {
      status.textContent = "Upload unavailable: " + error.message + ". The API must be running; no file was published.";
    }
  });

  refresh(1);
})();
