// Ingen supabase-klient här – den finns redan på window.sb från index.html

// === Hjälpare ===
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const setStatus = (m, danger = false) => {
  if (!statusEl) return;
  statusEl.textContent = m || "";
  statusEl.classList.toggle("danger", !!danger);
};

// === UI-element (ID:n måste matcha index.html) ===
const recordBtn  = $("btnStart");
const stopBtn    = $("btnStop");
const uploadBtn  = $("btnUpload");
const refreshBtn = $("refreshBtn");
const player     = $("player");
const resultEl   = $("result");
const historyEl  = $("history");

// === Global inspelnings-state ===
let mediaRecorder = null;
let chunks = [];
let lastBlob = null;

// Gör knapparna klickbara
function enableButtons() {
  ["btnStart","btnStop","btnUpload"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.removeAttribute("disabled");
    el.style.pointerEvents = "auto";
  });
}
enableButtons();

// === RECORD ===
recordBtn.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("❌ Din webbläsare saknar getUserMedia", true);
      return;
    }
    setStatus("🎙️ Startar inspelning...");
    chunks = [];
    lastBlob = null;

    const supportsOpus = window.MediaRecorder &&
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus");

    const constraints = { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    const mime = supportsOpus ? "audio/webm;codecs=opus" : "audio/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      try {
        const blob = new Blob(chunks, { type: supportsOpus ? "audio/webm;codecs=opus" : "audio/webm" });
        lastBlob = blob;
        const url = URL.createObjectURL(blob);
        player.src = url;
        player.load();
        player.play().catch(() => {});
        setStatus("✅ Inspelning klar – redo att ladda upp");
        uploadBtn.removeAttribute("disabled");
      } catch (e) {
        console.error(e);
        setStatus("❌ Kunde inte skapa ljudfil", true);
      }
    };

    mediaRecorder.start();
    recordBtn.setAttribute("disabled", "disabled");
    stopBtn.removeAttribute("disabled");
    setStatus("⏺️ Spelar in...");
  } catch (err) {
    console.error(err);
    setStatus(`❌ Fel vid start: ${err.message || "okänt"}`, true);
  }
});

stopBtn.addEventListener("click", () => {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setStatus("⏹️ Stoppar...");
    }
    stopBtn.setAttribute("disabled", "disabled");
    recordBtn.removeAttribute("disabled");
  } catch (e) {
    console.error(e);
    setStatus(`❌ Fel vid stopp: ${e.message || "okänt"}`, true);
  }
});

// === UPLOAD till Supabase Storage (bucket: "audio/uploads/") ===
uploadBtn.onclick = async () => {
  try {
    if (!window.sb) {
      setStatus("❌ Supabase-klient saknas (window.sb)", true);
      return;
    }
    if (!lastBlob) {
      setStatus("❌ Ingen inspelning att ladda upp", true);
      return;
    }

    setStatus("⬆️ Laddar upp...");

    const folder = "uploads"; // mapp i bucket "audio"
    const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0,14);
    const mime = lastBlob.type || "audio/webm";
    const ext  = mime.includes("wav") ? "wav" : "webm";
    const filename = `audio_${ts}.${ext}`;
    const path = `${folder}/${filename}`;

    // Ladda upp
    const { error: upErr } = await window.sb
      .storage
      .from("audio")
      .upload(path, lastBlob, { contentType: mime });

    if (upErr) {
      setStatus(`❌ Upload fail: ${upErr.message}`, true);
      return;
    }

    // Hämta public URL
    const { data: pub } = await window.sb
      .storage
      .from("audio")
      .getPublicUrl(path);

    const publicUrl = pub?.publicUrl || "";
    setStatus(`✅ Sparat: ${filename}${publicUrl ? " → " + publicUrl : ""}`);
    resultEl.textContent = publicUrl ? publicUrl : "";

    await loadHistory();
  } catch (err) {
    console.error(err);
    setStatus(`❌ Fel: ${err.message || "okänt"}`, true);
  }
};

// === Historik: lista senaste filer i audio/uploads ===
async function loadHistory() {
  try {
    if (!window.sb) return;
    historyEl.innerHTML = "<li class='muted'>Hämtar...</li>";

    const { data, error } = await window.sb
      .storage
      .from("audio")
      .list("uploads", { limit: 20, sortBy: { column: "created_at", order: "desc" } });

    if (error) throw error;

    const files = Array.isArray(data) ? data : [];
    if (!files.length) {
      historyEl.innerHTML = "<li class='muted'>Ingen historik ännu.</li>";
      return;
    }

    const items = await Promise.all(files.map(async (f) => {
      const filePath = `uploads/${f.name}`;
      const { data: pu } = await window.sb.storage.from("audio").getPublicUrl(filePath);
      const publicUrl = pu?.publicUrl || "";
      const d = new Date(f.created_at || Date.now()).toLocaleString();
      const sizeKB = f?.metadata?.size ? Math.round(f.metadata.size / 1024) : "?";
      return `
        <li class="mt-2">
          <div><strong>${f.name}</strong></div>
          <div class="muted">${d} · ${sizeKB} KB</div>
          ${publicUrl ? `<div><a class="tagchip" href="${publicUrl}" target="_blank" rel="noopener">Öppna</a></div>` : ""}
        </li>
      `;
    }));

    historyEl.innerHTML = items.join("");
  } catch (e) {
    console.error(e);
    historyEl.innerHTML = "<li class='muted'>Kunde inte hämta historik.</li>";
  }
}

refreshBtn.onclick = loadHistory;
loadHistory();
