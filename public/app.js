'use strict';

window.addEventListener('DOMContentLoaded', () => {
  console.log('app.js loaded');

  /** ====== BYT ENDAST DESSA TVÅ ====== */
  const SUPABASE_URL  = 'https://hyywzzzzgxaghkhooezk.supabase.co';   // utan slash på slutet
  const SUPABASE_ANON = 'sb_publishable_fLQc4d675JKhsc-QXj20w_BGf1f8Z7'; // publ nyckel (börjar med sbp_ eller sb_publishable_)
  /** ================================== */

  const BUCKET = 'audio';
  const FOLDER = 'clips';

  const $ = (sel) => document.querySelector(sel);

  // UI refs (måste finnas i HTML)
  const recBtn  = $('#recBtn');
  const saveBtn = $('#saveBtn');
  const player  = $('#player');
  const timerEl = $('#timer');
  const listEl  = $('#list');
  const out     = $('#out');
  const uLabel  = $('#u');   // sanity: visar URL
  const kLabel  = $('#k');   // sanity: visar key-format
  const pingBtn = $('#ping');
  const titleEl = $('#title');

  // Init supabase via CDN (window.supabase sätts av scriptet i index.html)
  let sb = null;
  if (window.supabase) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    window.sb = sb; // för konsoltest
  } else {
    console.error('Supabase CDN saknas – kontrollera <script> i index.html');
  }

  // Sanity UI (visa att konstanterna finns)
  if (uLabel) uLabel.textContent = SUPABASE_URL;
  if (kLabel) kLabel.textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

  // resten av din kod kan ligga kvar nedanför detta…
});
;

// ---- Recording state ----
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let timerInt = null;

// Hjälp: mime som stöds
function pickMime() {
  let mime = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
  return mime;
}

// Timer
function startTimer() {
  const fmt = (n) => String(n).padStart(2, '0');
  timerInt = setInterval(() => {
    const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    timerEl.textContent = `${fmt(Math.floor(sec / 60))}:${fmt(sec % 60)}`;
  }, 250);
}
function stopTimer() {
  clearInterval(timerInt);
  timerInt = null;
  timerEl.textContent = '00:00';
}

// Renderrad i listan
function addListItem(name, publicUrl) {
  const row = document.createElement('div');
  row.className = 'item';
  row.innerHTML = `
    <div class="left"><strong>${name}</strong></div>
    <div class="right">${publicUrl ? `<a href="${publicUrl}" target="_blank" rel="noopener">Öppna URL</a>` : ''}</div>
  `;
  listEl.prepend(row);
}

// ---- Handlers ----
recBtn?.addEventListener('click', async () => {
  if (!mediaRecorder) {
    // START
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      chunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data) chunks.push(e.data); };
      mediaRecorder.start();
      startedAt = Date.now();
      startTimer();

      recBtn.textContent = 'Stoppa';
      saveBtn.disabled = true;
    } catch (e) {
      console.error('Mic error:', e);
      alert('Kunde inte starta mikrofon: ' + e.message);
    }
  } else {
    // STOP
    try {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    mediaRecorder = null;
    stopTimer();

    // Lokal förhandslyssning
    try {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const localUrl = URL.createObjectURL(blob);
      player.src = localUrl;
      player.play().catch(() => {}); // autoplay kan blockas
      saveBtn.disabled = false;
    } catch (e) {
      console.error('Preview error:', e);
    }

    recBtn.textContent = 'Starta inspelning';
  }
});

saveBtn?.addEventListener('click', async () => {
  try {
    if (!sb) return alert('Supabase-klient saknas');
    if (!chunks.length) return alert('Ingen inspelning att spara');

    saveBtn.disabled = true;

    const clean = (s) => (s || '').trim().replace(/[^\w\- ]/g,'').replace(/\s+/g,'_');
    const title = clean(titleEl?.value || 'untitled');
    const stamp = Date.now();
    const fileName = `${stamp}_${title || 'clip'}.webm`;
    const path = `${FOLDER}/${fileName}`;

    const blob = new Blob(chunks, { type: 'audio/webm' });

    // 1) upload
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'audio/webm',
      upsert: false
    });
    if (upErr) {
      alert('Upload fail: ' + upErr.message);
      saveBtn.disabled = false;
      return;
    }

    // 2) public URL
    const { data: pub, error: pErr } = sb.storage.from(BUCKET).getPublicUrl(path);
    if (pErr) {
      alert('Public URL fail: ' + pErr.message);
      saveBtn.disabled = false;
      return;
    }

    addListItem(fileName, pub.publicUrl);
    chunks = [];
    saveBtn.disabled = true;
  } catch (e) {
    console.error(e);
    alert('Fel vid uppladdning: ' + e.message);
    saveBtn.disabled = false;
  }
});

// Sanity: lista 1 fil
pingBtn?.addEventListener('click', async () => {
  if (!sb) return;
  const { data, error } = await sb.storage.from(BUCKET).list(FOLDER, { limit: 1 });
  out.textContent = JSON.stringify({ data, error }, null, 2);
});

console.log('app.js loaded');
