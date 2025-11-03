'use strict';
// iOS/Safari detektor
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);


/* ====== BYT ENDAST DESSA TVÅ ====== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co;  // utan slash på slutet
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';                   // börjar med sbp_ eller sb_publishable_
/* ================================== */
// === Kenai audio patch — BLOCK 1/6 ===
// Läggs längst NEDERST i filen, under din befintliga kod.

let mediaRecorder;
let recStream;
let chunks = [];
let currentFmt = { mime: "", ext: "", contentType: "" };

// Välj bästa MIME per enhet (Safari kräver ofta audio/mp4 → .m4a)
async function startRec() {
  try {
    currentFmt = pickAudioFormat();

    const audioConstraints = isIOS
      ? { echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 48000 };

    recStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

    document.getElementById("codec")?.replaceChildren(
      document.createTextNode(`Codec: ${currentFmt.mime}`)
    );
    document.getElementById("codec")?.append(
      document.createTextNode(` | iOS:${isIOS} Safari:${isSafari}`)
    );

    chunks = [];

    if (currentFmt.mime !== "wav-fallback" && window.MediaRecorder) {
      mediaRecorder = new MediaRecorder(recStream, { mimeType: currentFmt.mime });

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

      mediaRecorder.start(isIOS ? 500 : 1000);
    } else {
      await wavFallbackStart(recStream);
    }

    document.getElementById("recordBtn")?.setAttribute("disabled", "true");
    document.getElementById("stopBtn")?.removeAttribute("disabled");
  } catch (err) {
    console.error(err);
    alert("Kunde inte starta inspelning. Kolla iOS: Inställningar → Safari → Mikrofon (Tillåt).");
  
}

window.addEventListener('DOMContentLoaded', () => {
  // 0) CDN måste finnas
  if (!window.supabase) {
    const out = document.getElementById('out');
    if (out) out.textContent = 'ERROR: Supabase CDN not loaded';
    console.error('Supabase CDN not loaded');
    return;
    
    }
  });

// === Kenai audio patch — BLOCK 4/6 ===
// Laddar upp via din redan initierade klient "sb"

async function uploadToSupabase(blob, filename, contentType) {
  const path = `audio/reviews/${filename}`;
  const { data, error } = await sb.storage
    .from("audio")                 // byt namn om din bucket heter något annat
    .upload(path, blob, {
      upsert: true,
      contentType: contentType
    });

  if (error) {
    console.error(error);
    throw error;
  }
  return data;
}// === Kenai audio patch — BLOCK 5/6 ===
// Enkel WAV-fallback om MediaRecorder inte stöds

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

// === Kenai audio patch — BLOCK 6/6 ===
window.startRec = startRec;
window.stopRec = stopRec;

   
