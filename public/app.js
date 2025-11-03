'use strict';

/* ====== iOS/Safari detektor ====== */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/* ====== BYT ENDAST DESSA TVÅ om de inte redan är rätt ====== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co; // utan slash på slutet
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';

/* ====== init Supabase-klienten ====== */
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON) : null;
window.sb = sb; // exponera globalt

/* ====== Globala inspelningsvariabler ====== */
let mediaRecorder;
let recStream;
let chunks = [];
let currentFmt = { mime: '', ext: '', contentType: '' };

/* ====== Välj bästa MIME per enhet (Safari → m4a först) ====== */
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
  // Fallback → WAV via WebAudio
  return { mime: "wav-fallback", ext: "wav", contentType: "audio/wav" };
}

/* ====== Starta inspelning ====== */
async function startRec() {
  try {
    if (!window.supabase || !sb) {
      console.error('Supabase CDN not loaded');
      alert('Supabase saknas – ladda om sidan.');
      return;
    }

    currentFmt = pickAudioFormat();

    // iOS: låt systemet välja kanal/rate (mindre bråk)
    const audioConstraints = isIOS
      ? { echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 48000 };

    recStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

    // visa codec/detektion i UI
    const codecEl = document.getElementById('codec');
    if (codecEl) {
      codecEl.textContent = `Codec: ${currentFmt.mime} | iOS:${isIOS} Safari:${isSafari}`;
    }

    chunks = [];

    if (currentFmt.mime !== "wav-fallback" && window.MediaRecorder) {
      // prova MediaRecorder med vald mime
      let ok = true;
      try {
        mediaRecorder = new MediaRecorder(recStream, { mimeType: currentFmt.mime });
      } catch (e) {
        ok = false;
      }

      if (ok) {
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        mediaRecorder.onerror = (e) => {
          console.error('MediaRecorder error', e);
          alert('MediaRecorder error: ' + (e.name || e));
        };
        mediaRecorder.onstop = () => {
          try { recStream.getTracks().forEach(t => t.stop()); } catch {}
        };
        mediaRecorder.start(isIOS ? 500 : 1000); // iOS behöver kortare slice
      } else {
        // kunde inte skapa – kör WAV
        currentFmt = { mime: "wav-fallback", ext: "wav", contentType: "audio/wav" };
        await wavFallbackStart(recStream);
      }
    } else {
      // ingen MediaRecorder – kör WAV
      await wavFallbackStart(recStream);
    }

    // UI toggles
    document.getElementById("recordBtn")?.setAttribute("disabled", "true");
    document.getElementById("stopBtn")?.removeAttribute("disabled");
  } catch (err) {
    console.error(err);
    alert("Kunde inte starta inspelning. Kolla behörighet till mikrofon i webbläsaren.");
  }
}

/* ====== Stoppa inspelning och ladda upp ====== */
async function stopRec() {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      await new Promise(res => {
        mediaRecorder.onstop = () => {
          try { recStream.getTracks().forEach(t => t.stop()); } catch {}
          res();
        };
        mediaRecorder.stop();
      });
    } else {
      await wavFallbackStop();
      try { recStream.getTracks().forEach(t => t.stop()); } catch {}
    }

    let blob;
    if (currentFmt.mime === "wav-fallback") {
      blob = wavFallbackGetBlob();
    } else {
      blob = new Blob(chunks, { type: currentFmt.contentType });
    }

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

/* ====== Upload helper (byt bucket-namn om din heter annat) ====== */
async function uploadToSupabase(blob, filename, contentType) {
  const path = `audio/reviews/${filename}`;
  const { data, error } = await sb.storage
    .from("audio") // <-- byt om din bucket inte heter "audio"
    .upload(path, blob, {
      upsert: true,
      contentType: contentType
    });

  if (error) {
    console.error(error);
    throw error;
  }
  return data;
}

/* ====== WAV-fallback via WebAudio ====== */
let wavCtx, wavSource, wavProcessor;
let wavBuffers = [];
let wavSampleRate = 48000;

async function wavFallbackStart(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  wavCtx = new Ctx({ sampleRate: wavSampleRate });
  wavSource = wavCtx.createMediaStreamSource(stream);
  const bufferSize = 4096;
  wavProcessor = wavCtx.createScriptProcessor(bufferSize, 1, 1);
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
  wavProcessor.disconnect();
  wavSource.disconnect();
  await wavCtx.close();
}

function wavFallbackGetBlob() {
  const length = wavBuffers.reduce((acc, cur) => acc + cur.length, 0);
  const pcm = new Float32Array(length);
  let offset = 0;
  for (const buf of wavBuffers) {
    pcm.set(buf, offset);
    offset += buf.length;
  }
  const wavBuffer = encodeWAV(pcm, wavSampleRate);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

function encodeWAV(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = 1 * bytesPerSample;
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
    let s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/* ====== Liten sanity-check vid laddning (valfritt) ====== */
window.addEventListener('DOMContentLoaded', () => {
  if (!window.supabase) {
    const out = document.getElementById('out');
    if (out) out.textContent = 'ERROR: Supabase CDN not loaded';
    console.error('Supabase CDN not loaded');
    return;
  }
});

/* ====== Exponera till HTML-knappar ====== */
window.startRec = startRec;
window.stopRec  = stopRec;
