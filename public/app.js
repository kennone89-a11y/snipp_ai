// Gör Supabase-klienten tolerant om init skulle faila
const sb = window.sb || null; // <-- ENDA deklarationen

// --- Gör knapparna klickbara och synliga ---
function enableButtons() {
  ['btnStart','btnStop','btnUpload'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('disabled');
    el.classList.remove('opacity-50');
    el.style.pointerEvents = 'auto';
  });
}

// --- Enkel status-helper ---
function ok(msg){ setStatus(`✅ ${msg}`); }
function info(msg){ setStatus(`ℹ️ ${msg}`); }
function fail(msg){ setStatus(`❌ Fel: ${msg}`); }

// --- Supabase upload + public URL ---
async function uploadToSupabase(file){
  if (!window.sb) throw new Error('Supabase-klient saknas (sb=null).');
  const bucket = 'audio';
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const ext = (file.type.includes('webm') ? 'webm' : (file.type.includes('wav') ? 'wav' : 'webm'));
  const path = `uploads/audio_${ts}.${ext}`;

  // ladda upp
  const { error: upErr } = await sb.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type || 'audio/webm' });
  if (upErr) throw upErr;

  // public url
  const { data, error: pubErr } = await sb.storage
    .from(bucket)
    .getPublicUrl(path);
  if (pubErr) throw pubErr;

  return { path, publicUrl: data.publicUrl || (data.publicUrl ?? '') };
}

// --- Transcribe/upload knappen kör denna ---
async function transcribeFile(file){
  try{
    info('Laddar upp & transkriberar...');
    const { publicUrl } = await uploadToSupabase(file);
    ok('Uppladdad! ' + publicUrl);
    await loadHistory();
    return true;
  }catch(e){
    console.error(e);
    fail(e.message || 'okänt');
    return false;
  }
}

// --- Recording-state ---
let lastBlob = null;

// --- Starta inspelning ---
recordBtn.onclick = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      fail('Din webbläsare saknar getUserMedia');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });

    mediaRecorder.ondataavailable = (e)=>{ if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      lastBlob = new Blob(chunks, { type: 'audio/webm' });
      player.src = URL.createObjectURL(lastBlob);
      player.load();
      ok('Inspelning klar – klicka "Ladda upp"');
    };

    mediaRecorder.start();
    info('Spelar in...');
  } catch (e){
    console.error(e);
    fail(e.message || 'Kunde inte starta inspelning');
  }
};

// --- Stoppa inspelning ---
stopBtn.onclick = () => {
  try{
    if (mediaRecorder && mediaRecorder.state !== 'inactive'){
      mediaRecorder.stop();
      info('Stoppar...');
    } else {
      info('Ingen aktiv inspelning');
    }
  }catch(e){
    console.error(e);
    fail(e.message || 'Kunde inte stoppa');
  }
};

// --- Ladda upp (sen transkribera) ---
uploadBtn.onclick = async () => {
  if (!lastBlob){
    info('Ingen inspelning att ladda upp.');
    return;
  }
  await transcribeFile(lastBlob);
};

// --- Dummy historik så sidan inte klagar (du kan ersätta med din riktiga) ---
async function loadHistory(){
  try{
    historyEl.innerHTML = '<li class="text-muted">Ingen uppladdning gjord än.</li>';
  }catch(e){
    console.error(e);
  }
}

// --- Backend health bypass (tyst) för att inte blocka UI ---
(async () => {
  try { await fetch('/api/health').catch(()=>{}); } catch {}
  // efter “health”, säkerställ att knapparna är aktiva
  enableButtons();
})();

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
