'use strict';

window.addEventListener('DOMContentLoaded', () => {
  console.log('app.js loaded');

  /** ====== BYT ENDAST DESSA TVÅ ====== */
  const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co; // <-- BYT (utan slash på slutet)
  const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';  // <-- BYT
  /** ================================== */

  const BUCKET = 'audio';
  const FOLDER = 'clips';

  // --- element
  const $ = s => document.querySelector(s);
  const recBtn  = $('#recBtn');
  const saveBtn = $('#saveBtn');
  const player  = $('#player');
  const titleEl = $('#title');
  const timerEl = $('#timer');
  const listEl  = $('#list');
  const out     = $('#out');
  const pingBtn = $('#ping');

  // sanity-rutor om de finns
  const u = $('#u'), k = $('#k');
  if (u) u.textContent = SUPABASE_URL;
  if (k) k.textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

  // --- init supabase (skydda om CDN saknas)
  let sb = null;
  try {
    if (window.supabase) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      window.sb = sb; // för konsoltest
      console.log('supabase client ok');
    } else {
      console.warn('Supabase CDN hittas inte (window.supabase saknas).');
    }
  } catch (e) {
    console.error('Supabase init error:', e);
  }

  // --- inspelning state
  let mediaRecorder = null;
  let chunks = [];
  let lastBlob = null;
  let timerInt = null;
  const fmt = s => String(s).padStart(2,'0');

  function startTimer() {
    const t0 = Date.now();
    stopTimer();
    timerInt = setInterval(() => {
      const s = Math.floor((Date.now()-t0)/1000);
      timerEl.textContent = `${fmt(Math.floor(s/60))}:${fmt(s%60)}`;
    }, 500);
  }
  function stopTimer(){ if (timerInt) { clearInterval(timerInt); timerInt=null; } }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // välj bästa MIME som stöds
      let mime = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';

      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      chunks = [];

      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

      mediaRecorder.onstart = () => {
        recBtn.textContent = '⏹ Stoppa inspelning';
        saveBtn.disabled = true;
        startTimer();
      };

      mediaRecorder.onstop = () => {
        stopTimer();
        recBtn.textContent = '▶️ Starta inspelning';

        // bygg blob + lokal förhandslyssning
        lastBlob = new Blob(chunks, { type: 'audio/webm' });
        try {
          const url = URL.createObjectURL(lastBlob);
          player.src = url;
          player.play().catch(()=>{});
        } catch(e) { console.error('Preview error:', e); }

        saveBtn.disabled = false;
      };

      mediaRecorder.start(200);
    } catch (e) {
      console.error('startRec error:', e);
      alert('Kunde inte starta mikrofonen.');
    }
  }

  function stopRec() {
    try { mediaRecorder && mediaRecorder.state === 'recording' && mediaRecorder.stop(); }
    catch(e){ console.error('stopRec error:', e); }
  }

  async function uploadCurrent() {
    if (!lastBlob) return alert('Ingen inspelning att ladda upp.');

    // om supabase inte finns: bara spara lokalt i listan
    if (!sb) {
      addToList('(lokal) clip.webm', null);
      alert('Supabase ej init – kolla CDN/taggar. Uppladdning hoppades över.');
      return;
    }

    const safeTitle = (titleEl.value || 'untitled').trim()
      .replace(/[^\w\- ]/g,'').replace(/\s+/g,'_') || 'clip';
    const name = `${Date.now()}_${safeTitle}.webm`;
    const path = `${FOLDER}/${name}`;

    try {
      const up = await sb.storage.from(BUCKET).upload(path, lastBlob, {
        contentType: 'audio/webm',
        upsert: true,
      });
      if (up.error) throw up.error;

      const pub = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      addToList(name, pub);
      saveBtn.disabled = true;
    } catch (e) {
      console.error('upload error:', e);
      alert('Upload fail: ' + e.message);
    }
  }

  function addToList(name, url) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div>${name}</div>`;
    const right = document.createElement('div');
    right.className = 'right';
    if (url) {
      const a = document.createElement('a');
      a.textContent = 'Öppna URL';
      a.href = url; a.target = '_blank'; a.rel='noopener';
      right.appendChild(a);
    }
    const wrap = document.createElement('div');
    wrap.style.display='grid';
    wrap.style.gridTemplateColumns='1fr auto';
    wrap.style.gap='10px';
    wrap.appendChild(row); wrap.appendChild(right);
    listEl.prepend(wrap);
  }

  async function listOne() {
    if (!sb) { out.textContent = 'Supabase ej init.'; return; }
    try {
      const { data, error } = await sb.storage.from(BUCKET).list(FOLDER, { limit: 1 });
      out.textContent = JSON.stringify({ data, error }, null, 2);
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    }
  }

  // --- bind knappar (ALLTID binds; om tidigare JS kraschade syntes inget klick)
  recBtn?.addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') startRec();
    else stopRec();
  });
  saveBtn?.addEventListener('click', uploadCurrent);
  pingBtn?.addEventListener('click', listOne);
});
