'use strict';

/* ===== BYT ENDAST DESSA TVÅ RADER ===== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co';  // utan slash på slutet
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';          // publishable key (börjar med sbp_ eller sb_publishable_)
/* ====================================== */

const BUCKET = 'audio';

// — små hjälpare —
const s   = (sel) => document.querySelector(sel);
const fmt = (n)   => String(n).padStart(2,'0');

// — state —
let mediaRecorder = null;
let chunks   = [];
let startedAt= 0;
let timerInt = null;
let waveInt  = null;
let uploads  = [];
const outEl  = s('#out');

// — init supabase (UMD global) —
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb; // för konsol-debug

// — sanity UI —
s('#u').textContent = SUPABASE_URL;
s('#k').textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

// — waveform —
function startWave() {
  const el = s('#wave'); el.innerHTML = '';
  waveInt = setInterval(() => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = (Math.floor(Math.random()*34)+6) + 'px';
    bar.style.marginLeft = '3px';
    bar.style.display = 'inline-block';
    el.appendChild(bar);
    if (el.children.length>160) el.removeChild(el.firstChild);
  }, 60);
}
function stopWave() {
  const el = s('#wave'); el.innerHTML = '';
  if (waveInt) clearInterval(waveInt); waveInt = null;
}

// — timer —
function setTimer(sec) {
  s('#timer').textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
}

// — render lista —
function renderList() {
  const list = s('#list'); list.innerHTML = '';
  uploads.slice().reverse().forEach((row, i) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div>
        <div style="font-weight:600">${row.title || '(utan titel)'}</div>
        <div class="muted">${(row.sizeKb ?? '?')} KB • ${row.durationSec ?? '?'}s</div>
      </div>
      <div>
        ${row.publicUrl ? `<a href="${row.publicUrl}" target="_blank" rel="noopener">Öppna URL</a>` : ''}
      </div>
    `;
    list.appendChild(div);
  });
}

// — inspelning —
s('#recBtn').onclick = async () => {
  try {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      mediaRecorder.onstart = () => {
        startedAt = Date.now();
        s('#saveBtn').disabled = true;
        startWave();
        timerInt = setInterval(() => setTimer(Math.floor((Date.now()-startedAt)/1000)), 1000);
        s('#recBtn').textContent = '⏹️ Stoppa';
      };
      mediaRecorder.onstop = () => {
        stopWave();
        clearInterval(timerInt); timerInt = null;
        s('#saveBtn').disabled = chunks.length === 0;
        s('#recBtn').textContent = '▶️ Starta inspelning';
      };
      mediaRecorder.start();
    } else {
      mediaRecorder.stop();
    }
  } catch (e) {
    alert('Mikrofonfel: ' + e.message);
  }
};

// — uppladdning —
s('#saveBtn').onclick = async () => {
  if (!chunks.length) return alert('Ingen inspelning än.');

  const blob = new Blob(chunks, { type: 'audio/webm' });
  const title = (s('#title').value || 'clip').trim();
  const slug  = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'clip';
  const ts    = new Date();
  const name  = `${ts.getFullYear()}${fmt(ts.getMonth()+1)}${fmt(ts.getDate())}_${fmt(ts.getHours())}${fmt(ts.getMinutes())}${fmt(ts.getSeconds())}_${slug}.webm`;
  const path  = name;

  try {
    const { data, error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'audio/webm',
      upsert: false
    });
    if (error) throw error;

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    uploads.push({
      title,
      sizeKb: Math.round(blob.size/1024),
      durationSec: Math.round((Date.now()-startedAt)/1000),
      publicUrl: pub?.publicUrl || ''
    });
    renderList();
    chunks = [];
    s('#saveBtn').disabled = true;
    s('#title').value = '';
  } catch (e) {
    alert('Upload error: ' + e.message);
  }
};

// — sanity: lista 1 fil från 'audio' —
s('#ping').onclick = async () => {
  outEl.textContent = '...';
  try {
    const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 1 });
    outEl.textContent = JSON.stringify({ data, error }, null, 2);
  } catch (e) {
    outEl.textContent = e.message;
  }
};

// första render
renderList();
