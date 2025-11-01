'use strict';

/** ===== BYT ENDAST DESSA TVÅ RADER ===== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co';       // ex: https://abcxyzcompany.supabase.co  (utan slash på slutet)
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';               // publishable key (börjar med sbp_ eller sb_publishable_)
/** ====================================== */

const BUCKET = 'audio';

// små hjälpare
const $  = sel => document.querySelector(sel);
const fmt = s => String(s).padStart(2,'0');

// state
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let timerInt = null;
let waveInt  = null;
let uploads = [];
const out = $('#out');

// init supabase
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb; // för konsol-test

// sanity UI
document.getElementById('u').textContent = SUPABASE_URL;
document.getElementById('k').textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

// waveform
function startWave(){
  const el = $('#wave'); el.innerHTML = '';
  waveInt = setInterval(()=>{
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = (Math.floor(Math.random()*34)+6)+'px';
    bar.style.width  = '6px';
    bar.style.marginRight = '3px';
    el.appendChild(bar);
    if(el.children.length>160) el.removeChild(el.firstChild);
  }, 60);
}
function stopWave(){ clearInterval(waveInt); waveInt = null; $('#wave').innerHTML=''; }

function renderList(){
  const wrap = $('#list'); wrap.innerHTML = '';
  uploads.slice().reverse().forEach((row)=>{
    const div = document.createElement('div'); div.className = 'grid';
    div.innerHTML = `
      <div style="overflow:hidden;text-overflow:ellipsis">${row.name}</div>
      <div class="right">
        <a class="ok" href="${row.url}" target="_blank" rel="noopener">Öppna URL</a>
      </div>`;
    wrap.appendChild(div);
  });
}

// media-hantering
async function startRec(){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  chunks = [];
  $('#recBtn').textContent = '■ Stoppa';
  $('#saveBtn').disabled = true;
  startedAt = Date.now();
  startWave();

  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    stopWave();
    $('#recBtn').textContent = '● Starta inspelning';
    $('#saveBtn').disabled = false;
  };

  mediaRecorder.start();
  // timer
  clearInterval(timerInt);
  timerInt = setInterval(()=>{
    const sec = Math.floor((Date.now()-startedAt)/1000);
    $('#timer').textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
  }, 200);
}

function stopRec(){
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    clearInterval(timerInt);
  }
}

async function saveClip(){
  if (!chunks.length) return;
  const title = ($('#title').value || 'untitled').trim().replace(/[^\w\d\- _]+/g,'').slice(0,64);
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm   = fmt(date.getMonth()+1);
  const dd   = fmt(date.getDate());
  const hh   = fmt(date.getHours());
  const mi   = fmt(date.getMinutes());
  const ss   = fmt(date.getSeconds());
  const uuid = Math.random().toString(36).slice(2,9);
  const fname = `${yyyy}/${mm}/${dd}/${yyyy}${mm}${dd}_${hh}${mi}${ss}_${uuid}__${title || 'clip'}.webm`;

  const blob = new Blob(chunks, { type:'audio/webm' });
  const { error } = await sb.storage.from(BUCKET).upload(fname, blob, {
    upsert:false,
    contentType:'audio/webm'
  });

  if (error) {
    out.textContent = `Error: ${error.message}`;
    return;
  }

  const { data:pub } = sb.storage.from(BUCKET).getPublicUrl(fname);
  uploads.push({ name: fname, url: pub.publicUrl });
  renderList();
  // reset
  chunks = [];
  $('#saveBtn').disabled = true;
}

// sanity-knapp
async function pingList(){
  try{
    const { data, error } = await sb.storage.from(BUCKET).list('', { limit:1 });
    out.textContent = JSON.stringify({ data, error }, null, 2);
  }catch(err){
    out.textContent = `Error * ${err.message}`;
  }
}

// bind UI
$('#recBtn').addEventListener('click', () => {
  if (!mediaRecorder || mediaRecorder.state==='inactive') startRec(); else stopRec();
});
$('#saveBtn').addEventListener('click', saveClip);
$('#ping').addEventListener('click', pingList);
