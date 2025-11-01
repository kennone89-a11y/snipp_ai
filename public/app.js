// Gör Supabase-klienten tolerant om init skulle faila
const sb = window.sb || null; // lämna – fylls i från index.html

(function () {
  // --- helpers
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const setStatus = (m) => (statusEl.textContent = m);

  // --- el (IDs matchar index.html)
  const recordBtn = $("btnStart");
  const stopBtn = $("btnStop");
  const saveLocalBtn = $("saveLocalBtn"); // kvar om du vill spara lokalt
  const player = $("player");
  const result = $("result");
  const historyEl = $("history");
  const refreshBtn = $("refreshBtn");
  const fileInput = $("fileInput");
  const uploadBtn = $("btnUpload");

  // sanity check
  [["btnStart", recordBtn], ["btnStop", stopBtn], ["btnUpload", uploadBtn]].forEach(([id, el]) => {
    if (!el) console.warn("Saknar element med id", id, "(kolla index.html)");
  });

  // gör knappar klickbara även om css råkar sätta disabled/grått
  function forceEnableButtons() {
    ["btnStart", "btnStop", "btnUpload"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.removeAttribute("disabled");
      el.classList.remove("opacity-50");
      el.style.pointerEvents = "auto";
    });
  }

  let mediaRecorder = null;
  let chunks = [];

  // väck ev backend tyst + enable
  (async () => {
    try { fetch("/api/health").catch(() => {}); } catch {}
    setStatus("✅ Backend check bypass (tillfälligt)");
    forceEnableButtons();
  })();

  // ---- Upload till Supabase Storage
  async function uploadToSupabase(file) {
    if (!window.sb) throw new Error("Supabase init saknas");
    const ext = (file.type || "").includes("wav") ? "wav" : "webm";
    const stamp = new Date().toISOString().replace(/[:.TZ\-]/g, "").slice(0, 14);
    const filename = `audio_${stamp}.${ext}`;
    const folder = "uploads";
    const path = `${folder}/${filename}`;

    // 1) ladda upp
    const { error: upErr } = await window.sb.storage.from("audio").upload(path, file, {
      upsert: true,
      contentType: file.type || "audio/webm",
    });
    if (upErr) throw upErr;

    // 2) hämta public URL
    const { data: pub, error: pubErr } = await window.sb.storage.from("audio").getPublicUrl(path);
    if (pubErr) throw pubErr;

    return { filename, publicUrl: pub.publicUrl || "" };
  }

  // --- Spela in
  recordBtn?.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("❌ Din webbläsare saknar getUserMedia"); return;
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
        const blob = new Blob(chunks, { type: mime });
        player.src = URL.createObjectURL(blob);
        player.load();
        player.play().catch(() => {});
        setStatus("✅ Inspelning klar – redo att ladda upp");
        uploadBtn.removeAttribute("disabled");
        uploadBtn.onclick = async () => {
          try {
            setStatus("⏫ Laddar upp…");
            const { filename, publicUrl } = await uploadToSupabase(new File([blob], "insp.webm", { type: mime }));
            setStatus(`✅ Sparat: ${filename}${publicUrl ? " · " + publicUrl : ""}`);
            await loadHistory();
          } catch (err) {
            console.error(err);
            setStatus("❌ Fel: " + (err.message || "okänt"));
          }
        };
      };
      mediaRecorder.start();
      setStatus("⏺️ Spelar in…");
      forceEnableButtons();
    } catch (err) {
      console.error(err);
      setStatus("❌ Kunde inte starta inspelning");
    }
  });

  stopBtn?.addEventListener("click", () => {
    try { mediaRecorder?.stop(); setStatus("⏹️ Stoppat"); } catch {}
  });

  // --- Ladda upp vald fil
  uploadBtn?.addEventListener("click", async () => {
    const f = fileInput?.files?.[0];
    if (!f) { setStatus("❗ Välj en fil först"); return; }
    try {
      setStatus("⏫ Laddar upp fil…");
      const { filename, publicUrl } = await uploadToSupabase(f);
      setStatus(`✅ Sparat: ${filename}${publicUrl ? " · " + publicUrl : ""}`);
      await loadHistory();
    } catch (err) {
      console.error(err);
      setStatus("❌ Fel: " + (err.message || "okänt"));
    }
  });

  // --- Lista senaste (dummy – funkar även utan backend)
  async function loadHistory() {
    try {
      // Om du inte har backendlistning ännu – skriv 0
      historyEl.innerHTML = '<li class="muted">Ingen uppladdning gjord än.</li>';
    } catch (e) {
      historyEl.innerHTML = '<li class="muted">Kunde inte hämta historik.</li>';
    }
  }

  refreshBtn?.addEventListener("click", loadHistory);

  // init
  loadHistory();
  forceEnableButtons();
})();
