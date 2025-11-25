// server.js — Kenai backend (stable, ESM)
// Supports: /api/summarize (url/audioUrl), /api/export-pdf, /api/send-summary-email (mock), /api/health

import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import OpenAI from "openai";

dotenv.config();

const app = express();

// --- Paths (ESM-friendly __dirname) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Basic middleware ---
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Simple CORS (no extra package)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Serve static site
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  // If you want a start page, point to it here
  res.redirect("/recorder.html");
});

// --- OpenAI client (server-side only) ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helpers ---
function safeJson(res, status, payload) {
  return res.status(status).json(payload);
}

function pickAudioUrl(req) {
  // Accept both naming styles + query fallback
  const body = req.body || {};
  return body.url || body.audioUrl || body.audio_url || req.query.url || req.query.audioUrl || "";
}

function guessExtFromContentType(ct = "") {
  const c = ct.toLowerCase();
  if (c.includes("audio/wav") || c.includes("audio/wave")) return ".wav";
  if (c.includes("audio/mpeg") || c.includes("audio/mp3")) return ".mp3";
  if (c.includes("audio/mp4") || c.includes("audio/m4a")) return ".m4a";
  if (c.includes("audio/webm")) return ".webm";
  if (c.includes("audio/ogg")) return ".ogg";
  return "";
}

function guessExtFromUrl(url = "") {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    const hit = [".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg"].find((e) => p.endsWith(e));
    return hit || "";
  } catch {
    return "";
  }
}

async function downloadToTempFile(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Kunde inte hämta ljud. HTTP ${r.status}. ${t.slice(0, 200)}`);
  }

  const ct = r.headers.get("content-type") || "";
  const ext = guessExtFromUrl(url) || guessExtFromContentType(ct) || ".webm";

  const ab = await r.arrayBuffer(); // Node 18+ safe
  const buf = Buffer.from(ab);

  const tmpDir = path.join(__dirname, "tmp");
  await fsp.mkdir(tmpDir, { recursive: true });

  const tmpPath = path.join(tmpDir, `audio-${Date.now()}${ext}`);
  await fsp.writeFile(tmpPath, buf);

  return { tmpPath, contentType: ct, size: buf.length };
}

async function transcribeWithWhisper(filePath) {
  // Whisper expects a file stream
  const resp = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: fs.createReadStream(filePath),
    // language: "sv", // optional; whisper often detects well
  });

  // openai SDK returns { text: "..." }
  return (resp && resp.text) ? resp.text : "";
}

async function summarizeSwedish(transcript) {
  const prompt = `
Du är en svensk assistent.
Gör:
1) En kort sammanfattning (3-6 meningar).
2) Punktlista med 5-10 viktiga punkter.
3) Om det är en recension: en kort "omdöme" + "för vem passar det?".
Svara på svenska.

TRANSKRIPT:
${transcript}
`.trim();

  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  return chat.choices?.[0]?.message?.content?.trim() || "";
}

// --- Routes ---
app.get("/api/health", (req, res) => {
  return res.json({ ok: true, message: "Kenai backend är igång ✅" });
});

app.post("/api/summarize", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return safeJson(res, 500, { error: "OPENAI_API_KEY saknas på servern (Render env var)." });
    }

    const audioUrl = pickAudioUrl(req);

    console.log("[Kenai] /api/summarize body:", req.body);
    console.log("[Kenai] /api/summarize url:", audioUrl);

    if (!audioUrl) {
      return safeJson(res, 400, { error: "Ingen ljud-URL skickad. Skicka { url: 'https://...' } eller { audioUrl: 'https://...' }" });
    }

    const { tmpPath, contentType, size } = await downloadToTempFile(audioUrl);
    console.log(`[Kenai] Ljud hämtat: ${tmpPath} (${size} bytes, ${contentType || "okänd content-type"})`);

    let transcript = "";
    let summary = "";

    try {
      transcript = await transcribeWithWhisper(tmpPath);
      if (!transcript) {
        return safeJson(res, 500, { error: "Transkribering gav tomt resultat." });
      }
      summary = await summarizeSwedish(transcript);
    } finally {
      // cleanup temp file
      await fsp.unlink(tmpPath).catch(() => {});
    }

    return res.json({ ok: true, transcript, summary });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return safeJson(res, 500, { error: err?.message || "Serverfel vid AI-sammanfattning." });
  }
});

app.post("/api/export-pdf", async (req, res) => {
  try {
    const { summary = "", transcript = "" } = req.body || {};
    if (!summary.trim()) return safeJson(res, 400, { error: "Ingen sammanfattning att exportera." });

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("error", (e) => console.error("PDF error:", e));

    doc.fontSize(18).text("Kenai – Sammanfattning", { align: "left" });
    doc.moveDown();
    doc.fontSize(12).text(summary, { align: "left" });

    if (transcript && transcript.trim()) {
      doc.addPage();
      doc.fontSize(16).text("Transkript", { align: "left" });
      doc.moveDown();
      doc.fontSize(10).text(transcript, { align: "left" });
    }

    doc.end();

    await new Promise((resolve) => doc.on("end", resolve));

    const pdfBuffer = Buffer.concat(chunks);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="kenai-summary.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF export error:", err);
    return safeJson(res, 500, { error: "Kunde inte skapa PDF." });
  }
});

app.post("/api/send-summary-email", async (req, res) => {
  try {
    // Mock: log only
    const { email = "", content = "" } = req.body || {};
    console.log("[Kenai] Mock email:", { email, contentLen: (content || "").length });
    return res.json({ ok: true, message: "Sammanfattningen skickades (mock)." });
  } catch (err) {
    console.error("Email mock error:", err);
    return safeJson(res, 500, { error: "Mail-funktionen misslyckades (mock)." });
  }
});

// Catch-all error handler (always JSON)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  return safeJson(res, 500, { error: err?.message || "Okänt serverfel." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Kenai backend kör på port ${PORT}`);
});
