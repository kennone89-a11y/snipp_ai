// server.js — Kenai backend (stable rewind)
// ESM (package.json: "type": "module")

import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------
// Basic middleware
// ----------------------------
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (enkel och tydlig)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Static frontend (public)
app.use(express.static(path.join(__dirname, "public")));

// ----------------------------
// OpenAI client
// ----------------------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ----------------------------
// Helpers
// ----------------------------
function safeExtFromUrl(url) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname);
    const ext = path.extname(base);
    return ext && ext.length <= 6 ? ext : "";
  } catch {
    return "";
  }
}

async function downloadToTempFile(fileUrl) {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Kunde inte hämta ljud: ${res.status} ${txt.slice(0, 200)}`);
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  const ext = safeExtFromUrl(fileUrl) || ".webm";
  const tmpPath = path.join(os.tmpdir(), `kenai-audio-${Date.now()}${ext}`);

  await fs.promises.writeFile(tmpPath, buf);
  return tmpPath;
}

// ----------------------------
// Routes
// ----------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

/**
 * POST /api/summarize
 * Body: { url: "https://...supabase.../object/public/..." }
 * or    { audioUrl: "..." }
 */
app.post("/api/summarize", async (req, res) => {
  try {
    const { url, audioUrl } = req.body || {};
    const targetUrl = url || audioUrl;

    console.log("[Kenai] summarize - body:", req.body);

    if (!targetUrl) {
      return res.status(400).json({ error: "Ingen ljud-URL skickad." });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY saknas på servern." });
    }

    console.log("[Kenai] summarize - startar med URL:", targetUrl);

    // 1) Ladda ner ljudet till temp-fil
    const tmpPath = await downloadToTempFile(targetUrl);
    console.log("[Kenai] tempfil skapad:", tmpPath);

    try {
      // 2) Transkribera (Whisper)
      const tr = await client.audio.transcriptions.create({
        model: "whisper-1",
        file: fs.createReadStream(tmpPath),
      });

      const transcript =
        (typeof tr === "string" ? tr : tr?.text) || "";

      // 3) Sammanfatta på svenska
      const chat = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "Du är en svensk assistent. Skapa en tydlig sammanfattning med rubriker och punktlista. Håll det kort men informativt.",
          },
          {
            role: "user",
            content:
              `Här är transkriberingen:\n\n${transcript}\n\n` +
              `Gör: 1) kort sammanfattning, 2) viktiga punkter, 3) eventuella uppgifter/next steps.`,
          },
        ],
        temperature: 0.2,
      });

      const summary = chat?.choices?.[0]?.message?.content || "";

      console.log("[Kenai] summarize - klart");
      return res.json({ transcript, summary });
    } finally {
      // Städa tempfil
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({
      error: "Serverfel vid AI-sammanfattning.",
      detail: err?.message || String(err),
    });
  }
});

// PDF-export (PDFKit)
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { summary = "", transcript = "" } = req.body || {};

    if (!summary.trim() && !transcript.trim()) {
      return res.status(400).json({ error: "Inget innehåll att exportera." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="kenai-sammanfattning.pdf"');

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text("Kenai – Sammanfattning", { underline: true });
    doc.moveDown();

    if (summary.trim()) {
      doc.fontSize(14).text("Sammanfattning", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).text(summary);
      doc.moveDown();
    }

    if (transcript.trim()) {
      doc.fontSize(14).text("Transkribering", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(9).text(transcript);
    }

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte skapa PDF.", detail: err?.message || String(err) });
  }
});

// Mock mail (loggar bara)
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { email, summary, transcript } = req.body || {};
    console.log("[Kenai] MOCK EMAIL:", { email, summaryLen: summary?.length, transcriptLen: transcript?.length });
    res.json({ ok: true, message: "Mock-mail skickat (loggat på servern)." });
  } catch (err) {
    res.status(500).json({ error: "Mail-fel (mock).", detail: err?.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Kenai backend kör på port ${PORT}`);
});
