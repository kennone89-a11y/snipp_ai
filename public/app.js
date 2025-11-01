// Ingen supabase-klient här – den skapas i index.html och läggs på window.sb

// === Hjälpare ===
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const setStatus = (m, danger = false) => {
  if (!statusEl) return;
  statusEl.textContent = m ?? "";
  statusEl.classList.toggle("danger", !!danger);
};

// === UI-element (ID:n måste matcha index.html) ===
const recordBtn   = $("btnStart");
const stopBtn     = $("btnStop");
const uploadBtn   = $("btnUpload");
const refreshBtn  = $("refreshBtn");
const fileInput   = $("fileInput");
const player      = $("player");
const resultEl    = $("result");
const historyEl   = $("history");

// === global inspelnings-state ===
let mediaRecorder = null;
let chunks = [];
let lastBlob = null;

// Gör knapparna klickbara (om de är grå)
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

    const supportsOpus = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus");
    const constraints = { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const mime = supportsOpus ? "audio/webm;codecs=opus" : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      lastBlob = new Blob(chunks, { type: mime });
      player.src = URL.createObjectURL(lastBlob);
      player.load();
      player.play().catch(() => {});
      setStatus("✅ Inspelning klar – redo att ladda upp");
      uploadBtn.removeAttribute("disabled");
    };

    mediaRecorder.start();
  } catch (err) {
    console.error(err);
    setStatus("❌ Kunde inte starta inspelning", true);
  }
});

stopBtn.addEventListener("click", () => {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setStatus("⏹️ Stoppad");
    }
  } catch (e) {
    console.error(e);
  }
});

// === UPLOAD till Supabase Storage ===
uploadBtn.onclick = async () => {
  try {
    if (!lastBlob) {
      setStatus("❌ Ingen inspelning att ladda upp", true);
      return;
    }
    if (!window.sb) {
      setStatus("❌ Supabase-klienten saknas", true);
      return;
    }

    // Filnamn: audio_YYYYMMDD_HHMMSS.webm
    const ts = new Date().toISOString().replace(/[T:\.Z]/g, "").slice(0, 14);
    const filename = `audio_${ts}.webm`;
    const folder = "uploads";
    const path = `${folder}/${filename}`;

    setStatus("⬆️ Laddar upp...");

    // 1) Ladda upp
    const { error: upErr } = await window.sb
      .storage
      .from("audio")
      .upload(path, lastBlob, { contentType: lastBlob.type });

    if (upErr) throw upErr;

    // 2) Hämta public URL
    const { data: pub } = window.sb.storage.from("audio").getPublicUrl(path);
    const publicUrl = pub?.publicUrl || "";

    setStatus(`✅ Sparat: ${filename}`);
    resultEl.textContent = publicUrl ? publicUrl : "Sparat (ingen public URL)";

    await loadHistory();
  } catch (err) {
    console.error(err);
    setStatus(`❌ Fel vid uppladdning: ${err.message || "okänt"}`, true);
  }
};

// === Ladda upp via fil-input (om användaren väljer en fil) ===
fileInput.onchange = async (e) => {
  try {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!window.sb) {
      setStatus("❌ Supabase-klienten saknas", true);
      return;
    }

    setStatus("⬆️ Laddar upp vald fil...");
    const folder = "uploads";
    const path = `${folder}/${file.name}`;

    const { error: upErr } = await window.sb
      .storage
      .from("audio")
      .upload(path, file, { contentType: file.type });

    if (upErr) throw upErr;

    const { data: pub } = window.sb.storage.from("audio").getPublicUrl(path);
    const publicUrl = pub?.publicUrl || "";
    setStatus("✅ Fil uppladdad");
    resultEl.textContent = publicUrl || "Sparat (ingen public URL)";

    await loadHistory();
  } catch (err) {
    console.error(err);
    setStatus(`❌ Fel vid uppladdning: ${err.message || "okänt"}`, true);
  } finally {
    fileInput.value = "";
  }
};

// === Historia (listar senaste) ===
async function loadHistory() {
  try {
    if (!window.sb) return;
    const { data, error } = await window.sb
      .storage
      .from("audio")
      .list("uploads", { limit: 20, sortBy: { column: "created_at", order: "desc" } });

    if (error) throw error;

    const files = Array.isArray(data) ? data : [];
    if (!files.length) {
      historyEl.innerHTML = `<li class="muted">Ingen historik ännu.</li>`;
      return;
    }

    historyEl.innerHTML = files.map(f => {
      const dt = new Date(f.created_at).toLocaleString();
      const sizeKB = (f.size / 1024).toFixed(1);
      const url = window.sb.storage.from("audio").getPublicUrl(`uploads/${f.name}`).data.publicUrl;
      const safeName = encodeURIComponent(f.name);
      return `
        <li>
          <div><strong>${f.name}</strong></div>
          <div class="muted">${dt} · ${sizeKB} KB</div>
          <div><a href="${url}" download>⬇️ Ladda ner</a></div>
        </li>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
    historyEl.innerHTML = `<li class="muted">Kunde inte hämta historik.</li>`;
  }
}

refreshBtn.onclick = loadHistory;

// Init
loadHistory();
