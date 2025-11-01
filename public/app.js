// Ingen const sb här – klienten ligger på window.sb från index.html

// Hjälpare
const $ = (id) => document.getElementById(id);
const statusEl = $('#status');
const setStatus = (m, danger = false) => {
  if (!statusEl) return;
  statusEl.textContent = m;
  statusEl.classList.toggle('danger', !!danger);
};

// UI-element (måste matcha index.html)
const recordBtn   = $('#btnStart');
const stopBtn     = $('#btnStop');
const uploadBtn   = $('#btnUpload');
const refreshBtn  = $('#refreshBtn');
const fileInput   = $('#fileInput');
const player      = $('#player');
const resultEl    = $('#result');
const historyEl   = $('#history');

// …resten av din kod (event-lyssnare, inspelning, uppladdning osv)
// Viktigt: Använd window.sb överallt där du anropar Supabase:
/// ex: const { error } = await window.sb.storage.from('audio').upload(path, file, { contentType: mime });



// Status-helper
const setStatus = (m, danger = false) => {
  if (!statusEl) return;
  statusEl.textContent = m;
  statusEl.classList.toggle("danger", !!danger);
};

// Force-enable knappar (om de är grå)
function enableButtons() {
  ["btnStart","btnStop","btnUpload"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.removeAttribute("disabled");
    el.style.pointerEvents = "auto";
  });
}

// Global inspelnings-state
let mediaRecorder = null;
let chunks = [];

// ---------------------------------------------------------------
// Uppladdning till Supabase Storage (bucket: audio/uploads)
// ---------------------------------------------------------------
async function uploadToSupabase(file) {
  if (!sb) throw new Error("Supabase-klient saknas (sb == null)");
  const bucket = "audio";
  const folder = "uploads";
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const ext = (file.type && file.type.includes("wav")) ? "wav" : "webm";
  const filename = `audio_${ts}.${ext}`;
  const path = `${folder}/${filename}`;

  // 1) Ladda upp
  const { error: upErr } = await sb.storage
    .from(bucket)
    .upload(path, file, { upsert: false, contentType: file.type || "audio/webm" });
  if (upErr) throw upErr;

  // 2) Public URL (kräver Public bucket eller SELECT-policy för anon)
  const { data: pub, error: pubErr } = await sb.storage.from(bucket).getPublicUrl(path);
  if (pubErr) throw pubErr;

  return { filename, publicUrl: pub?.publicUrl || "" };
}

// ---------------------------------------------------------------
// Historik (lista filer i audio/uploads, 20 senaste)
// ---------------------------------------------------------------
async function loadHistory() {
  if (!sb || !historyEl) return;
  historyEl.innerHTML = '<li class="muted">Hämtar…</li>';

  try {
    const { data: items, error } = await sb.storage
      .from("audio")
      .list("uploads", { limit: 20, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw error;

    if (!items || !items.length) {
      historyEl.innerHTML = '<li class="muted">Ingen historik ännu.</li>';
      return;
    }

    const rows = await Promise.all(items.map(async (it) => {
      const name = it.name;
      const path = `uploads/${name}`;
      const { data: pub } = await sb.storage.from("audio").getPublicUrl(path);
      const sizeKB = Math.max(1, Math.round((it?.metadata?.size || it?.size || 0)/1024));
      return `
        <li>
          <div><strong>${name}</strong></div>
          <div class="muted">${new Date(it.created_at || Date.now()).toLocaleString()} · ${sizeKB} KB</div>
          <div class="mt-1">
            <a class="secondary" href="${pub?.publicUrl || '#'}" download>⬇️ Ladda ner</a>
          </div>
        </li>`;
    }));
    historyEl.innerHTML = rows.join("");
  } catch (e) {
    console.error(e);
    historyEl.innerHTML = '<li class="muted">Kunde inte hämta historik.</li>';
  }
}

// ---------------------------------------------------------------
// Spela in → Stoppa → Auto-ladda upp
// ---------------------------------------------------------------
recordBtn?.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("❌ Din webbläsare saknar getUserMedia", true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];

    const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mime });
        if (player) {
          player.src = URL.createObjectURL(blob);
          player.load();
          player.play().catch(() => {});
        }
        setStatus("⏫ Laddar upp…");
        const { filename, publicUrl } = await uploadToSupabase(blob);
        setStatus(`✅ Sparat: ${filename}${publicUrl ? " · " + publicUrl : ""}`);
        await loadHistory();
      } catch (err) {
        console.error(err);
        setStatus("❌ Fel vid uppladdning: " + (err.message || "okänt"), true);
      }
    };

    mediaRecorder.start();
    setStatus("🎙️ Spelar in… (tryck Stoppa när du är klar)");
    enableButtons();
  } catch (err) {
    console.error(err);
    setStatus("❌ Kunde inte starta inspelning: " + (err.message || ""), true);
  }
});

stopBtn?.addEventListener("click", () => {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setStatus("⏹️ Stoppar…");
    } else {
      setStatus("ℹ️ Ingen aktiv inspelning");
    }
  } catch (e) {
    console.error(e);
    setStatus("❌ Kunde inte stoppa", true);
  }
});

// ---------------------------------------------------------------
// Välj fil manuellt → ladda upp
// ---------------------------------------------------------------
uploadBtn?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    setStatus("⏫ Laddar upp fil…");
    const { filename, publicUrl } = await uploadToSupabase(f);
    setStatus(`✅ Sparat: ${filename}${publicUrl ? " · " + publicUrl : ""}`);
    await loadHistory();
  } catch (err) {
    console.error(err);
    setStatus("❌ Fel vid filuppladdning: " + (err.message || "okänt"), true);
  } finally {
    e.target.value = "";
  }
});

refreshBtn?.addEventListener("click", loadHistory);

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
enableButtons();
loadHistory();
setStatus("✅ Klar – redo!");
