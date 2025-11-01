// ==== Hjälpare ====
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const setStatus = (m, danger = false) => {
  statusEl.textContent = m;
  statusEl.classList.toggle("danger", danger);
  statusEl.classList.toggle("ok", !danger && m.toLowerCase().includes("redo") || m.toLowerCase().includes("klar"));
};

// ==== UI-element ====
const btnStart   = $("btnStart");
const btnStop    = $("btnStop");
const btnUpload  = $("btnUpload");
const fileInput  = $("fileInput");
const recTimeEl  = $("recTime");
const player     = $("player");
const resultEl   = $("result");
const historyEl  = $("history");
const refreshBtn = $("refreshBtn");

// ==== Global inspelnings-state ====
let mediaRecorder = null;
let chunks = [];
let lastBlob = null;
let tickTimer = null;
let startedAt = 0;

// Knappskydd
const enableButtons = () => {
  [btnStart, btnStop, btnUpload].forEach(b => b.removeAttribute("disabled"));
  btnStop.setAttribute("disabled",""); // stopp tills vi startat
  btnUpload.setAttribute("disabled",""); // uppladdning tills vi har blob
};
enableButtons();

// ==== Local "datastore" (demo) ====
const LS_KEY = "rr_demo_uploads";

function loadUploads(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveUpload(item){
  const arr = loadUploads();
  arr.unshift(item);
  localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0,20)));
}
function fmtDate(ts){
  return new Date(ts).toLocaleString();
}
function fmtKB(n){
  return Math.max(1, Math.round(n/1024));
}
function renderHistory(){
  const files = loadUploads();
  if (!files.length){
    historyEl.innerHTML = `<li class="muted">Ingen historik ännu.</li>`;
    return;
  }
  historyEl.innerHTML = files.map(f => `
    <li class="flex items-center justify-between gap-3 p-2 rounded-lg glass">
      <div>
        <div><strong>${f.name}</strong></div>
        <div class="muted text-xs">${fmtDate(f.ts)} · ${fmtKB(f.size)} KB</div>
      </div>
      <div class="flex items-center gap-2">
        <a class="tagchip text-xs" href="${f.url}" download="${f.name}">Ladda ner</a>
        <button class="tagchip text-xs" data-del="${f.id}">Radera</button>
      </div>
    </li>
  `).join("");
  // delete handlers
  historyEl.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute("data-del");
      const arr = loadUploads().filter(x=>x.id!==id);
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
      renderHistory();
    };
  });
}
refreshBtn.onclick = renderHistory;
renderHistory();

// ==== Record ====
btnStart.onclick = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      setStatus("Din webbläsare saknar getUserMedia", true);
      return;
    }
    setStatus("Startar inspelning...");
    chunks = [];
    lastBlob = null;

    const supportsOpus = window.MediaRecorder && MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus");
    const constraints = { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    const mime = supportsOpus ? "audio/webm;codecs=opus" : "audio/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      lastBlob = blob;
      player.src = URL.createObjectURL(blob);
      player.load();
      player.play().catch(()=>{});
      setStatus("Inspelning klar – redo att ladda upp", false);
      btnUpload.removeAttribute("disabled");
      clearInterval(tickTimer); recTimeEl.textContent = "00:00";
    };

    mediaRecorder.start(250);
    startedAt = Date.now();
    btnStop.removeAttribute("disabled");
    btnUpload.setAttribute("disabled","");
    btnStart.setAttribute("disabled","");

    tickTimer = setInterval(()=>{
      const s = Math.floor((Date.now()-startedAt)/1000);
      const mm = String(Math.floor(s/60)).padStart(2,"0");
      const ss = String(s%60).padStart(2,"0");
      recTimeEl.textContent = `${mm}:${ss}`;
    },500);

  } catch (err){
    console.error(err);
    setStatus("Kunde inte starta inspelning", true);
  }
};

btnStop.onclick = () => {
  try{
    if (mediaRecorder && mediaRecorder.state !== "inactive"){
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t=>t.stop());
    }
  } catch(e){}
  btnStart.removeAttribute("disabled");
  btnStop.setAttribute("disabled","");
};

// ==== “Upload” (lokalt demo) ====
btnUpload.onclick = async () => {
  try{
    if (!lastBlob){
      setStatus("Ingen inspelning att ladda upp", true);
      return;
    }
    const fileName = `audio_${new Date().toISOString().replace(/[:.]/g,"-")}.webm`;
    // spara blob-url i historik (demo)
    const url = URL.createObjectURL(lastBlob);
    saveUpload({ id: crypto.randomUUID(), name:fileName, size:lastBlob.size, url, ts: Date.now() });
    renderHistory();
    resultEl.textContent = `✅ Sparat (lokalt): ${fileName}`;
    setStatus("Uppladdad (lokalt demo). Backend kopplas in senare.");
    btnUpload.setAttribute("disabled","");
  } catch (err){
    console.error(err);
    setStatus("Fel vid uppladdning (demo)", true);
  }
};

// Filuppladdning (lokalt demo)
fileInput.onchange = async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  saveUpload({ id: crypto.randomUUID(), name:f.name, size:f.size, url, ts: Date.now() });
  renderHistory();
  resultEl.textContent = `✅ Sparat (lokalt): ${f.name}`;
  setStatus("Uppladdad (lokalt demo).");
};
