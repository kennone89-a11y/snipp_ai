// Gör Supabase-klienten tolerant om init skulle faila
const sb = window.sb || null; // <-- ENDA deklarationen

(function () {
  // --- helpers
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const setStatus = (m) => statusEl.textContent = m;

  // --- el
  const recordBtn     = $('recordBtn');
  const stopBtn       = $('stopBtn');
  const saveLocalBtn  = $('savelocalBtn');
  const player        = $('player');
  const resultEl      = $('result');
  const historyEl     = $('history');
  const refreshBtn    = $('refreshBtn');
  const fileInput     = $('fileInput');
  const uploadBtn     = $('uploadBtn');

  // --- state
  let mediaRecorder = null;
  let chunks = [];

  // Gör knapparna klickbara oavsett läge
  function enableButtons() {
    ['btnStart','btnStop','btnUpload'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.removeAttribute('disabled');          // ta bort disabled
      el.classList.remove('opacity-50');       // ta bort gråning
      el.style.pointerEvents = 'auto';         // säkerställ klick
    });
  }

  // --- backend health (TEMP BYPASS) ---
  (async () => {
    try {
      // Försök väcka backend tyst (om Render sover)
      fetch('/api/health').catch(() => {});
    } catch (e) {}
    // Tvinga “OK” så UI låses upp direkt
    setStatus('✅ Backend check bypass (tillfälligt)');

    // Om du tidigare aktiverade knappar efter health, gör det nu:
    try {
      document.getElementById('btnStart')?.removeAttribute('disabled');
      document.getElementById('btnStop')?.removeAttribute('disabled');
      document.getElementById('btnUpload')?.removeAttribute('disabled');
    } catch (e) {}
  })();

  // --- upload till Supabase ---
  async function transcribeFile(file) {
    if (!sb) { setStatus('❌ Supabase-klient saknas (sb är null).'); return; }

    try {
      const bucket = 'audio';        // ditt bucket-namn
      const folder = 'uploads';      // valfritt “mapp”-prefix

      // Skapa filnamn: audio_YYYYMMDD_HHMMSS.ext
      const ts  = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0,14);
      const ext = (file.type && file.type.includes('wav')) ? 'wav' : 'webm';
      const filename = `audio_${ts}.${ext}`;
      const path = `${folder}/${filename}`;

      // Ladda upp till Supabase Storage
      const { error: upErr } = await sb.storage
        .from(bucket)
        .upload(path, file, { upsert: true, contentType: file.type || 'audio/webm' });

      if (upErr) throw upErr;

      // Public URL (om bucketen är Public)
      const { data: pub } = sb.storage.from(bucket).getPublicUrl(path);

      setStatus(`✅ Sparat: ${filename}${pub?.publicUrl ? ' · ' + pub.publicUrl : ''}`);
      await loadHistory();
    } catch (err) {
      console.error(err);
      setStatus('❌ Fel: ' + (err.message || 'okänt'));
    }
  }

  // --- recording
  recordBtn.onclick = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('❌ Din webbläsare saknar getUserMedia'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        player.src = URL.createObjectURL(blob);
        player.load();
        // ladda upp
        await transcribeFile(new File([blob], `inspelnig.webm`, { type: 'audio/webm' }));
      };
      mediaRecorder.start();
      setStatus('🎙️ Spelar in...');
    } catch (e) {
      console.error(e);
      setStatus('❌ Kunde inte starta inspelning');
    }
  };

  stopBtn.onclick = () => {
    try { mediaRecorder && mediaRecorder.stop(); setStatus('⏹️ Stoppad'); } catch {}
  };

  // “Ladda upp fil” öppnar filväljaren
  uploadBtn.onclick = () => fileInput.click();

  // När man väljer fil, ladda upp
  fileInput.onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await transcribeFile(f);
    fileInput.value = '';
  };

  // --- history (hämtas från ditt backend som listar filer)
  async function loadHistory() {
    try {
      const r = await fetch('/api/history');
      const data = await r.json();
      const files = Array.isArray(data.files) ? data.files : [];
      if (!files.length) {
        historyEl.innerHTML = '<li class="muted">Ingen historik ännu.</li>'; return;
      }
      historyEl.innerHTML = files.map(f => {
        const dt   = new Date(f.mtime).toLocaleString();
        const sizeKB = (f.size/1024).toFixed(1);
        const name = encodeURIComponent(f.name);
        return `<li>
          <div><strong>${f.name}</strong></div>
          <div class="muted">${dt} · ${sizeKB} KB</div>
          <div>
            <a href="/api/text/${name}" download><button class="secondary">⬇️ Ladda ner</button></a>
            <button class="secondary" onclick="delFile('${name}')">🗑️ Radera</button>
          </div>
        </li>`;
      }).join('');
    } catch (e) {
      console.error(e);
      historyEl.innerHTML = '<li class="muted">Kunde inte hämta historik.</li>';
    }
  }

  window.delFile = async (name) => {
    if (!confirm('Radera filen permanent?')) return;
    await fetch('/api/text/' + name, { method: 'DELETE' });
    await loadHistory();
  };

  refreshBtn.onclick = loadHistory;

  // --- init
  loadHistory();
  enableButtons();
})();
