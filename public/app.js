'use strict';

// Enhetsdetektion
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// === FYLL I DINA SUPABASE-VÄRDEN ===
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co;
;
const SUPABASE_ANON = '<sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';

// Init Supabase-klient (via CDN i index.html)
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON) : null;
window.sb = sb;

// Globala inspelningsvariabler
let mediaRecorder, recStream;
let chunks = [];
let currentFmt = { mime: '', ext: '', contentType: '' };

// Välj bästa format per enhet (Safari → m4a först)
function pickAudioFormat() {
  const safariPrefs = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm"
  ];
  const defaultPrefs = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4"
  ];
  const prefs = isSafari ? safariPrefs : defaultPrefs;

  for (const m of prefs) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
      if (m.startsWith("audio/webm")) return { mime: m, ext: "webm", contentType: "audio/webm" };
      if (m.startsWith("audio/mp4"))  return { mime: m, ext: "m4a",  contentType: "audio/mp4"  };
    }
  }
  return { mime: "wav-fallback", ext: "wav", contentType: "audio/wav" };
}

// Starta inspelning
async function startRec() {
  try {
    if (!window.supabase || !sb) {
      alert('Supabase saknas – ladda om sidan.');
      return;
    }

    currentFmt = pickAudioFormat();

    const audioConstraints = isIOS
      ? { echoCancellation: true, noiseSuppression: true } // iOS får välja rate/kanaler själv
      : { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 48000 };

    recStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

    const codecEl = document.getElementById('codec');
    if (codecEl) codecEl.textContent = `Codec: ${currentFmt.mime} | iOS:${isIOS} Safari:${isSafari}`;

    chunks = [];

    if (currentFmt.mime !== "wav-fallback" && window.MediaRecorder) {
      let ok = true;
      try { mediaRecorder = new MediaRecorder(recStream, { mimeType: currentFmt.mime }); }
      catch { ok = false; }

      if (ok) {
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onerror = (e) => alert('MediaRecorder error: ' + (e.name || e));
        mediaRecorder.onstop = () => { try { recStream.getTracks().forEach(t => t.stop()); } catch {} };
        mediaRecorder.start(isIOS ? 500 : 1000); // iOS behöver kortare slice
      } else {
        currentFmt = { mime: "wav-fallback", ext: "wav", contentType: "audio/wav" };
        await wavFallbackStart(recStream);
      }
    } else {
      await wavFallbackStart(recStream);
    }

    document.getElementById("recordBtn")?.setAttribute("disabled", "true");
    document.getElementById("stopBtn")?.removeAttribute("disabled");
  } catch (err) {
    console.error(err);
    alert("Kunde inte starta inspelning. Kolla mikrofon-behörighet.");
  }
}

// Stoppa & ladda upp
async function stopRec() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      await new Promise(res => {
        mediaRecorder.onstop = () => { try { recStream.getTracks().forEach(t => t.stop()); } catch {}; res(); };
        mediaRecorder.stop();
      });
    } else {
      await wavFallbackStop();
      try { recStream.getTracks().forEach(t => t.stop()); } catch {}
    }

    const blob = (currentFmt.mime === "wav-fallback")
      ? wavFallbackGetBlob()
      : new Blob(chunks, { type: currentFmt.contentType });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `review-${ts}.${currentFmt.ext}`;

    await uploadToSupabase(blob, filename, currentFmt.contentType);

    document.getElementById("recordBtn")?.removeAttribute("disabled");
    document.getElementById("stopBtn")?.setAttribute("disabled", "true");
    chunks = [];
    alert("Uppladdad ✅");
  } catch (err) {
    console.error(err);
    alert("Kunde inte stoppa/lagra inspelningen.");
  }
}

// Ladda upp till Supabase Storage (bucket: audio, path: audio/reviews/filename)
async function uploadToSupabase(blob, filename, contentType) {
  const path = `audio/reviews/${filename}`;
  const { error } = await sb.storage.from("audio").upload(path, blob, { upsert: true, contentType });
  if (error) throw error;
}

// WAV-fallback via WebAudio
let wavCtx, wavSource, wavProcessor;
let wavBuffers = [];
let wavSampleRate = 48000;

async function wavFallbackStart(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  wavCtx = new Ctx({ sampleRate: wavSampleRate });
  wavSource = wavCtx.createMediaStreamSource(stream);
  wavProcessor = wavCtx.createScriptProcessor(4096, 1, 1);
  wavBuffers = [];
  wavProcessor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    wavBuffers.push(new Float32Array(input));
  };
  wavSource.connect(wavProcessor);
  wavProcessor.connect(wavCtx.destination);
}
async function wavFallbackStop() {
  if (!wavCtx) return;
  wavProcessor.disconnect(); wavSource.disconnect();
  await wavCtx.close();
}
function wavFallbackGetBlob() {
  const length = wavBuffers.reduce((a, c) => a + c.length, 0);
  const pcm = new Float32Array(length);
  let off = 0; for (const b of wavBuffers) { pcm.set(b, off); off += b.length; }
  const buf = encodeWAV(pcm, wavSampleRate);
  return new Blob([buf], { type: "audio/wav" });
}
function encodeWAV(samples, sampleRate) {
  const bytesPerSample = 2, blockAlign = 1 * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  floatTo16BitPCM(view, 44, samples);
  return view;
}
function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}

// Exponera till HTML-knapparna
window.startRec = startRec;
window.stopRec  = stopRec;
