'use strict';

window.addEventListener('DOMContentLoaded', () => {
  console.log('app.js loaded');

  // ===== byt enbart dessa två =====
  const SUPABASE_URL  = 'https://hyywzzzzgxaghkhooezk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_fLQc4d675JKhsc-QXj20w_BGf1f8Z7';
  // =================================

  const BUCKET = 'audio';
  const FOLDER = 'clips';

  const $ = (sel) => document.querySelector(sel);

  // UI
  const recBtn  = $('#recBtn');
  const saveBtn = $('#saveBtn');
  const player  = $('#player');
  const timerEl = $('#timer');
  const listEl  = $('#list');
  const out     = $('#out');
  const uLabel  = $('#u');
  const kLabel  = $('#k');
  const pingBtn = $('#ping');
  const titleEl = $('#title');

  // Supabase via CDN
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  window.sb = sb;

  if (uLabel) uLabel.textContent = SUPABASE_URL;
  if (kLabel) kLabel.textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

  // ====== Recorder ======
  let mediaRecorder = null;
  let chunks = [];
  let startedAt = 0;
  let timerInt = null;

  const prefer = ['audio/webm;codecs=opus', 'audio/webm'];
  let mime = prefer.find(m => MediaRecorder.isTypeSupported(m)) || 'audio/webm';

  function fmt(n){return String(n).padStart(2,'0')}
  function startTimer(){
    const t0 = Date.now();
    timerInt = setInterval(()=>{
      const sec = Math.floor((Date.now()-t0)/1000);
      timerEl.textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
    },250);
  }
  function stopTimer(){
    clearInterval(timerInt);
    timerInt = null;
  }

  recBtn?.addEventListener('click', async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      chunks = [];
      mediaRecorder.ondataavailable = (e)=>{ if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = ()=>{ saveBtn.disabled = false; };
      mediaRecorder.start(100);
      startedAt = Date.now();
      saveBtn.disabled = true;
      startTimer();
      recBtn.textContent = 'Stoppa inspelning';
    } else {
      mediaRecorder.stop();
      stopTimer();
      recBtn.textContent = 'Starta inspelning';
    }
  });

  saveBtn?.addEventListener('click', async () => {
    if (!chunks.length) return;
    const title = (titleEl?.value || 'untitled').trim().replace(/[^\w\- ]/g,'').replace(/\s+/g,'_');
    const stamp = Date.now();
    const fileName = `${stamp}_${title || 'clip'}.webm`;
    const blob = new Blob(chunks, { type: 'audio/webm' });

    // Lokal förhandslyssning
    if (player) {
      try {
        const localUrl = URL.createObjectURL(blob);
        player.src = localUrl;
        player.play().catch(()=>{});
      } catch(e){ console.error('Preview error:', e); }
    }

    const path = `${FOLDER}/${fileName}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'audio/webm', upsert: false
    });
    if (upErr) { alert('Upload fail: ' + upErr.message); return; }

    const pub = await sb.storage.from(BUCKET).getPublicUrl(path);
    addItem({ name: fileName, url: pub.data.publicUrl });

    chunks = [];
    saveBtn.disabled = true;
  });

  function addItem({ name, url }){
    const row = document.createElement('div');
    row.className = 'item';
    const left = document.createElement('div');
    left.className = 'left';
    left.textContent = name;
    const right = document.createElement('div');
    right.className = 'right';
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel='noopener';
    a.textContent = 'Öppna URL →';
    right.appendChild(a);
    row.appendChild(left);
    row.appendChild(right);
    listEl.prepend(row);
  }

  pingBtn?.addEventListener('click', async ()=>{
    const res = await sb.storage.from(BUCKET).list(FOLDER, { limit: 1 });
    out.textContent = JSON.stringify(res, null, 2);
  });
});
