// server.js — Kenai backend (stable)
// ESM (package.json har "type":"module")

import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Basic middleware ----------
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

// ---------- CORS (enkelt & robust) ----------
const ALLOWED = new Set([
  "https://app.kenai.technology",
  "https://kenai.technology",
  "http://localhost:3000",
  "http://localhost:5173",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    // för felsökning: tillåt allt
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, apikey, x-upsert"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---------- Static ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- OpenAI client ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function requireEnv() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY saknas i Render Environment.");
  }
}

function extFromContentType(ct = "") {
  const t = ct.toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("mpeg")) return "mp3";
  if (t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "m4a";
  if (t.includes("ogg")) return "ogg";
  return "bin";
}

async function downloadToTempFile(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Kunde inte hämta ljudfil. HTTP ${r.status}. ${txt.slice(0, 200)}`);
  }

  const ct = r.headers.get("content-type") || "";
  const ab = await r.arrayBuffer(); // <-- fixar "response.body.pipe is not a function"
  const buf = Buffer.from(ab);

  const ext = extFromContentType(ct) || "bin";
  const name = `kenai_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const tmpPath = path.join(os.tmpdir(), name);

  fs.writeFileSync(tmpPath, buf);
  return { tmpPath, contentType: ct, size: buf.length };
}

async function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

// ---------- Routes ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

app.post("/api/summarize", async (req, res) => {
  try {
    requireEnv();

    // Frontend kan skicka olika fält – vi accepterar alla:
    const { audioUrl, url, publicUrl } = req.body || {};
    const targetUrl = audioUrl || url || publicUrl;

    if (!targetUrl) {
      return res.status(400).json({ error: "Ingen ljud-URL skickad." });
    }

    console.log("[Kenai] summarize - startar med URL:", targetUrl);

    const { tmpPath, contentType, size } = await downloadToTempFile(targetUrl);
    console.log("[Kenai] Ljud hämtat:", { tmpPath, contentType, size });

    // 1) Transkribera
    const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
    const tr = await client.audio.transcriptions.create({
      model: transcribeModel,
      file: fs.createReadStream(tmpPath),
    });
    const transcript = (tr?.text || "").trim();

    // 2) Sammanfatta
    const chatModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
    const completion = await client.chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Du är en svensk assistent som gör tydliga sammanfattningar. " +
            "Svara på svenska. Ge: 1) Kort sammanfattning (3-6 rader) 2) Punkter med nyckelpunkter 3) Eventuella actions.",
        },
        { role: "user", content: `Transkript:\n${transcript || "(tomt transkript)"}` },
      ],
    });

    const summary =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Ingen sammanfattning returnerades.";

    await safeUnlink(tmpPath);

    return res.json({ transcript, summary });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({
      error: "Serverfel vid AI-sammanfattning.",
      detail: String(err?.message || err),
    });
  }
});

app.post("/api/export-pdf", async (req, res) => {
  try {
    const { summary = "", transcript = "" } = req.body || {};
    const safeSummary = String(summary);
    const safeTranscript = String(transcript);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="kenai-summary.pdf"');

    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);

    doc.fontSize(18).text("Kenai — Sammanfattning", { underline: true });
    doc.moveDown();

    doc.fontSize(12).text("Sammanfattning:", { continued: false });
    doc.moveDown(0.5);
    doc.fontSize(11).text(safeSummary || "(Ingen sammanfattning)");
    doc.moveDown();

    doc.fontSize(12).text("Transkript:", { continued: false });
    doc.moveDown(0.5);
    doc.fontSize(9).text(safeTranscript || "(Inget transkript)");

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte skapa PDF." });
  }
});

app.post("/api/send-summary-email", async (req, res) => {
  // Mock: loggar bara (som vi hade)
  const { email, summary, transcript } = req.body || {};
  console.log("[Kenai] send-summary-email (MOCK)", {
    email,
    summaryLen: String(summary || "").length,
    transcriptLen: String(transcript || "").length,
  });
  res.json({ ok: true, message: "Mock: mail loggat på servern." });
});

// Fallback: om någon går in på /, servera recorder
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "recorder.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[Kenai] Backend kör på port ${PORT}`);
});
