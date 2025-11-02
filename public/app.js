'use strict';

/** ===== FYLL DINA TVÅ VÄRDEN HÄR ===== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co;   // <- BYT (utan slash)
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z;       // <- BYT (publishable)
/** ==================================== */

const BUCKET = 'audio';   // bucketnamn
const FOLDER = 'clips';   // undermapp i bucketen

// små hjälpare
const $  = sel => document.querySelector(sel);
const fmt = s => String(s).padStart(2, '0');

// state
let mediaRecorder = null;
let chunks = [];
let timerInt = null;
let startedAt = 0;
let lastBlob = null; // används för förhandslyssning/återuppladdning

// init supabase (via CDN – global "supabase" finns)
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb; // för konsoltest

// sanity UI
document.getElementById('u').textContent = SUPABASE_URL;
document.getElementById('k').textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

// UI-element
const recBtn  = $('#recBtn');
const saveBtn = $('#saveBtn');
const player  = $('#player');
const out     = $('#out');
const listEl  = $('#list');
const timerEl = $('#timer');
const titleEl = $('#title');
$('#ping').addEventListener('click', listOne);

// timer
function startTimer() {
  startedAt = Date.now();
  timerInt = setInterval(() => {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
  }, 500);
}
function stopTimer() {
  clearInterval(timerInt); timerInt = null;
}

// bind knappar
recBtn.addEventListener('click', toggleRec);
saveBtn.addEventListener('click', uploadCurrent);

async function toggleRec() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    await startRec();
  } else {
    mediaRecorder.stop();
  }
}

async function startRec() {
  // begär mic
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // välj bästa mime
  let mime = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';

  mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
  chunks = [];

  mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  mediaRecorder.onstart = () => {
    recBtn.textContent = '⏹ Stoppa inspelning';
    saveBtn.disabled = true;
    startTimer();
  };

  mediaRecorder.onstop = () => {
    stopTimer();
    recBtn.textContent = '▶️ Starta inspelning';

    // bygga blob
    const blob = new Blob(chunks, { type: 'audio/webm' });
    lastBlob = blob;

    // lokal förhandslyssning
    try {
      const localUrl = URL.createObjectURL(blob);
      player.src = localUrl;
      player.play().catch(() => {}); // autoplay kan blockas
    } catch (e) {
      console.error('Preview error:', e);
    }

    saveBtn.disabled = false;
  };

  mediaRecorder.start(200); // samla chunks var 200ms
}

async function uploadCurrent() {
  try {
    if (!lastBlob) {
      alert('Ingen inspelning att ladda upp.');
      return;
    }
    const stamp = Date.now();
    const rawTitle = (titleEl.value || 'untitled').trim().replace(/[^\w\- ]/g,'').replace(/\s+/g,'_');
    const fileName = `${stamp}_${rawTitle || 'clip'}.webm`;
    const path = `${FOLDER}/${fileName}`;

    // 1) ladda upp
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, lastBlob, {
      contentType: 'audio/webm',
      upsert: true,
    });
    if (upErr) { alert('Upload fail: ' + upErr.message); return; }

    // 2) public URL
    const pub = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // 3) lägg in i listan
    prependItem(fileName, pub);

    // reset knappar
    saveBtn.disabled = true;
  } catch (e) {
    console.error(e);
    alert('Ett fel uppstod vid uppladdning.');
  }
}

function prependItem(name, url) {
  const row = document.createElement('div');
  row.className = 'item';
  row.innerHTML = `<div>${name}</div>`;
  const right = document.createElement('div');
  right.className = 'right';
  const open = document.createElement('a');
  open.href = url; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Öppna URL';
  right.appendChild(open);
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '1fr auto';
  wrap.style.gap = '10px';
  wrap.appendChild(row);
  wrap.appendChild(right);
  // överst i listan
  listEl.prepend(wrap);
}

// Sanity: lista 1 fil från bucketen (om finns)
async function listOne() {
  try {
    const { data, error } = await sb.storage.from(BUCKET).list(FOLDER, { limit: 1 });
    out.textContent = JSON.stringify({ data, error }, null, 2);
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}
