// server.js — Kenai backend (stable)
// ESM ("type":"module")

import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------
// CORS (utan cors-paket)
// -------------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Static frontend
app.use(express.static(path.join(__dirname, "public")));

// Root -> recorder
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "recorder.html"));
});

// Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

// -------------------------
// OpenAI client
// -------------------------
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY saknas i environment variables på Render.");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

// -------------------------
// Helpers
// -------------------------
function pickAudioUrl(req) {
  const body = req.body || {};
  const q = req.query || {};

  // Stöd flera fältnamn för att frontend ibland glider:
  return (
    body.audioUrl ||
    body.url ||
    body.audio_url ||
    body.publicUrl ||
    body.public_url ||
    body.fileUrl ||
    body.file_url ||
    q.audioUrl ||
    q.url ||
    q.publicUrl ||
    null
  );
}

function extFromUrlOrType(url, contentType = "") {
  const u = String(url || "").toLowerCase();
  const ct = String(contentType || "").toLowerCase();

  // url först
  if (u.includes(".webm")) return ".webm";
  if (u.includes(".wav")) return ".wav";
  if (u.includes(".m4a")) return ".m4a";
  if (u.includes(".mp3")) return ".mp3";
  if (u.includes(".mp4")) return ".mp4";

  // content-type fallback
  if (ct.includes("audio/webm")) return ".webm";
  if (ct.includes("audio/wav") || ct.includes("audio/x-wav")) return ".wav";
  if (ct.includes("audio/mp4") || ct.includes("audio/m4a")) return ".m4a";
  if (ct.includes("audio/mpeg")) return ".mp3";

  // default
  return ".webm";
}

async function downloadToTmp(audioUrl) {
  const r = await fetch(audioUrl);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Kunde inte hämta ljudfil. HTTP ${r.status}. ${txt.slice(0, 120)}`);
  }

  const contentType = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer()); // <-- ingen .pipe (fixar "response.body.pipe...")
  const ext = extFromUrlOrType(audioUrl, contentType);

  const tmpPath = path.join("/tmp", `kenai-audio-${Date.now()}${ext}`);
  await fsp.writeFile(tmpPath, buf);

  return { tmpPath, contentType, size: buf.length };
}

async function transcribeFile(tmpPath) {
  const fileStream = fs.createReadStream(tmpPath);

  const result = await openai.audio.transcriptions.create({
    file: fileStream,
    model: TRANSCRIBE_MODEL,
  });

  return (result && result.text ? result.text : "").trim();
}

async function summarizeSv(transcript) {
  const prompt = `Här är en transkribering. Skapa en svensk sammanfattning.

Krav:
- Börja med 5–10 bullet points med viktigaste punkterna.
- Lägg sedan "TL;DR:" med 1–2 meningar.
- Inga hallucinationer. Om något är oklart, skriv det.

TRANSKRIBERING:
${transcript}`;

  const r = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: "Du är en svensk, tydlig assistent som skriver korta, korrekta sammanfattningar." },
      { role: "user", content: prompt },
    ],
  });

  return (r.choices?.[0]?.message?.content || "").trim();
}

// -------------------------
// API: summarize
// -------------------------
app.post("/api/summarize", async (req, res) => {
  try {
    const audioUrl = pickAudioUrl(req);

    console.log("[Kenai] /api/summarize body:", req.body);
    console.log("[Kenai] /api/summarize url:", audioUrl);

    if (!audioUrl) {
      return res.status(400).json({ error: "Ingen ljud-URL skickad." });
    }

    const { tmpPath, size, contentType } = await downloadToTmp(audioUrl);
    console.log("[Kenai] Ljud nedladdat:", { tmpPath, size, contentType });

    const transcript = await transcribeFile(tmpPath);
    if (!transcript) {
      await fsp.unlink(tmpPath).catch(() => {});
      return res.status(500).json({ error: "Transkribering blev tom. Kontrollera ljudformat/URL." });
    }

    const summary = await summarizeSv(transcript);

    await fsp.unlink(tmpPath).catch(() => {});
    return res.json({ ok: true, audioUrl, transcript, summary });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({ error: err?.message || "Okänt serverfel" });
  }
});

// -------------------------
// API: export pdf
// -------------------------
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { summary = "", transcript = "" } = req.body || {};
    if (!summary.trim() && !transcript.trim()) {
      return res.status(400).json({ error: "Inget innehåll att exportera." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="kenai-summary.pdf"');

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text("Kenai – Sammanfattning", { underline: true });
    doc.moveDown();

    if (summary.trim()) {
      doc.fontSize(14).text("Sammanfattning");
      doc.moveDown(0.5);
      doc.fontSize(11).text(summary);
      doc.moveDown();
    }

    if (transcript.trim()) {
      doc.fontSize(14).text("Transkribering");
      doc.moveDown(0.5);
      doc.fontSize(10).text(transcript);
      doc.moveDown();
    }

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: err?.message || "PDF-fel" });
  }
});

// -------------------------
// API: send email (mock)
// -------------------------
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { to, summary = "", transcript = "" } = req.body || {};
    if (!to) return res.status(400).json({ error: "E-post saknas." });

    console.log("[Kenai] MOCK EMAIL ->", { to, summaryLen: summary.length, transcriptLen: transcript.length });
    return res.json({ ok: true, message: "Mock: mail loggat på servern." });
  } catch (err) {
    console.error("[Kenai] EMAIL ERROR:", err);
    return res.status(500).json({ error: err?.message || "Mail-fel" });
  }
});

app.listen(PORT, () => {
  console.log(`Kenai backend kör på port ${PORT}`);
});
