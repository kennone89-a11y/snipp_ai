// ============================================================================
// app.js  —  Hela filen (ersätt allt innehåll med detta)
// ============================================================================

// Gör Supabase-klienten tolerant om init skulle faila (fylls i från index.html)
const sb = window.sb || null;

// Liten hjälpare för snabb DOM-hämtning
const $ = (id) => document.getElementById(id);

// Status-rad
const statusEl = $("status");
const setStatus = (m) => { if (statusEl) statusEl.textContent = m; };

// --- kopplingar mot elementen i index.html (måste matcha ID:n där) ---
const recordBtn   = $("btnStart");
const stopBtn     = $("btnStop");
const uploadBtn   = $("btnUpload");
const refreshBtn  = $("refreshBtn");
const fileInput   = $("fileInput");
const player      = $("player");
const resultEl    = $("result");
const historyEl   = $("history");

// Snabb sanity check (skriver varning i konsol om ett ID saknas)
[["btnStart", recordBtn], ["btnStop", stopBtn], ["btnUpload", uploadBtn], ["refreshBtn", refreshBtn],
 ["fileInput", fileInput], ["player", player], ["result", resultEl], ["history", historyEl]
].forEach(([id, el]) => { if (!el) console.warn(`Saknar element med id="${id}" (kolla index.html)`); });

// ---------------------------------------------------------------
// Globalt inspelnings-state
// ---------------------------------------------------------------
let mediaRecorder = null;
let chunks = [];

// ---------------------------------------------------------------
// Hjälpare: gör knappar klickbara (ifall något tidigare script gråat ut dem)
// ---------------------------------------------------------------
function enableButtons() {
  ["btnStart", "btnStop", "btnUpload"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.removeAttribute("disabled");
    el.classList.remove("opacity-50");
    el.style.pointerEvents = "auto";
  });
}

// ---------------------------------------------------------------
// Uppladdning till Supabase Storage  (bucket: "audio", prefix: "uploads")
// returnerar { filename, publicUrl }
// ---------------------------------------------------------------
async function transcribeFile(file) {
  if (!sb) throw new Error("Supabase-klient (sb) saknas — kunde inte initiera på index.html");
  const folder = "uploads";

  // Skapa filnamn: audio_YYYYMMDD_HHMMSS.ext
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const ext = file.type.includes("wav") ? "wav" : "webm";
  const filename = `audio_${ts}.${ext}`;
  const path = `${folder}/${filename}`;

  // 1) Ladda upp
  const { error: upErr } = await sb.storage
    .from("audio")
    .upload(path, file, {
      contentType: file.type || "audio/webm;codecs=opus",
      upsert: true,
    });
  if (upErr) throw upErr;

  // 2) Hämta public URL
  const { data: pub, error: pubErr } = await sb.storage
    .from("audio")
    .getPublicUrl(path);
  if (pubErr) throw pubErr;

  setStatus(`✅ Sparat: ${filename}${pub?.publicUrl ? " (public)" : ""}`);
  if (resultEl) resultEl.textContent = `Uppladdning klar: ${filename}`;
  return { filename, publicUrl: pub?.publicUrl || "" };
}

// ---------------------------------------------------------------
// Lista senaste uppladdningar i bucketen (enkelt UI)
// ---------------------------------------------------------------
async function loadHistory() {
  if (!sb || !historyEl) return;
  historyEl.innerHTML = '<li class="text-muted">Hämtar…</li>';

  try {
    const { data: items, error } = await sb.storage
      .from("audio")
      .list("uploads", {
        limit: 20,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) throw error;

    if (!items || items.length === 0) {
      historyEl.innerHTML = '<li class="text-muted">Ingen historik ännu.</li>';
      return;
    }

    const rows = await Promise.all(items.map(async (it) => {
      const name = it.name;
      const path = `uploads/${name}`;
      const { data: pub } = await sb.storage.from("audio").getPublicUrl(path);
      const dt = new Date(it.created_at || Date.now()).toLocaleString();
      const sizeKB = Math.max(1, Math.round((it.metadata?.size || it.size || 0) / 1024));
      const safeName = encodeURIComponent(name);

      return `
        <li class="py-1">
          <div><strong>${name}</strong></div>
          <div class="text-muted">${dt} · ${sizeKB} KB</div>
          <div class="mt-1">
            <a href="${pub?.publicUrl || "#"}" download class="secondary">⬇️ Ladda ner</a>
          </div>
        </li>
      `;
    }));

    historyEl.innerHTML = rows.join("");
  } catch (e) {
    console.error(e);
    historyEl.innerHTML = '<li class="text-muted">Kunde inte hämta historik.</li>';
  }
}

// ---------------------------------------------------------------
// Spela in (auto-spara efter stopp)
// ---------------------------------------------------------------
if (recordBtn) {
  recordBtn.addEventListener("click", async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("❌ Din webbläsare saknar getUserMedia"); 
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];

      // Välj MIME (webm/opus i första hand)
      const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mime });
        if (player) {
          player.src = URL.createObjectURL(blob);
          player.load();
          player.play().catch(() => {});
        }
        setStatus("✅ Inspelning klar — sparar…");

        // AUTO-UPPLADDNING DIREKT EFTER INSPELNING:
        try {
          await transcribeFile(blob);
          await loadHistory();
        } catch (err) {
          console.error(err);
          setStatus("❌ Fel vid autosparning: " + (err.message || "okänt"));
        }
      };

      mediaRecorder.start();
      setStatus("🎙️ Spelar in… klicka Stoppa när du är klar");
      if (uploadBtn) uploadBtn.setAttribute("disabled", "disabled");
    } catch (err) {
      console.error(err);
      setStatus("❌ Kunde inte starta inspelning");
    }
  });
}

// Stoppa
if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      setStatus("⏹️ Stoppad — bearbetar…");
    } catch (e) {
      console.error(e);
      setStatus("❌ Kunde inte stoppa");
    }
  });
}

// ---------------------------------------------------------------
// Manuell uppladdning av en fil (via filväljaren)
// ---------------------------------------------------------------
if (fileInput) {
  fileInput.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setStatus("⬆️ Laddar upp vald fil…");
      await transcribeFile(file);
      await loadHistory();
    } catch (err) {
      console.error(err);
      setStatus("❌ Fel vid filuppladdning: " + (err.message || "okänt"));
    } finally {
      fileInput.value = "";
    }
  };
}

// (valfritt) separat knapp för uppladdning — om du vill behålla den
if (uploadBtn) {
  uploadBtn.onclick = async () => {
    // Använd senaste ljudet från <audio> om det finns
    try {
      const src = player && player.src;
      if (!src) {
        setStatus("❕ Ingen inspelning att ladda upp.");
        return;
      }
      const data = await fetch(src);
      const blob = await data.blob();
      setStatus("⬆️ Laddar upp…");
      await transcribeFile(blob);
      await loadHistory();
    } catch (err) {
      console.error(err);
      setStatus("❌ Fel: " + (err.message || "okänt"));
    }
  };
}

// Uppdatera historik
if (refreshBtn) {
  refreshBtn.onclick = loadHistory;
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
enableButtons();
loadHistory();
setStatus("✅ Klart — redo!");
