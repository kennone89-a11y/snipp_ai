// server.js — Kenai backend (stable)
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---- CORS (utan cors-paket) ----
const ALLOWED_ORIGINS = new Set([
  "https://app.kenai.technology",
  "https://kenai.technology",
  "http://localhost:3000",
  "http://localhost:5173",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // tillåt även onrender-domäner (dev)
  const allow =
    !origin ||
    ALLOWED_ORIGINS.has(origin) ||
    (typeof origin === "string" && origin.endsWith(".onrender.com"));

  res.setHeader("Access-Control-Allow-Origin", allow && origin ? origin : "*");
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, x-upsert"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---- Static ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ---- OpenAI ----
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY saknas på servern (Render env).");
}
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Utils ----
async function downloadToTempFile(fileUrl) {
  const r = await fetch(fileUrl);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Kunde inte hämta ljud: ${r.status} ${t.slice(0, 200)}`);
  }

  const ct = (r.headers.get("content-type") || "").toLowerCase();
  let ext = "bin";
  if (ct.includes("wav")) ext = "wav";
  else if (ct.includes("webm")) ext = "webm";
  else if (ct.includes("mpeg")) ext = "mp3";
  else if (ct.includes("mp4")) ext = "m4a";

  const tmpFile = path.join(os.tmpdir(), `kenai-${Date.now()}.${ext}`);

  // Node fetch ger en WebStream -> konvertera till Node stream
  if (r.body) {
    const nodeStream = Readable.fromWeb(r.body);
    await pipeline(nodeStream, fs.createWriteStream(tmpFile));
  } else {
    const ab = await r.arrayBuffer();
    await fs.promises.writeFile(tmpFile, Buffer.from(ab));
  }

  return tmpFile;
}

// ---- Routes ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

app.post("/api/summarize", async (req, res) => {
  try {
    const audioUrl = req.body?.audioUrl || req.body?.url;
    if (!audioUrl) {
      return res.status(400).json({ error: "Ingen ljud-URL skickad." });
    }

    console.log("[Kenai] summarize - url:", audioUrl);

    const tmpFile = await downloadToTempFile(audioUrl);

    // 1) Transkribera
    const tr = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "gpt-4o-mini-transcribe",
      // language: "sv", // valfritt
    });

    const transcript = (tr.text || "").trim();

    // 2) Sammanfatta
    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Du är en snabb och tydlig svensk assistent. Svara på svenska.",
        },
        {
          role: "user",
          content:
            "Sammanfatta transkriptionen tydligt i punkter + en kort TL;DR.\n\nTRANSKRIPTION:\n" +
            transcript,
        },
      ],
    });

    const summary = (chat.choices?.[0]?.message?.content || "").trim();

    fs.promises.unlink(tmpFile).catch(() => {});
    return res.json({ transcript, summary });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({ error: "Serverfel vid AI-sammanfattning." });
  }
});

app.post("/api/export-pdf", (req, res) => {
  try {
    const summary = req.body?.summary || "";
    const transcript = req.body?.transcript || "";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kenai-summary.pdf"'
    );

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text("Kenai – Sammanfattning", { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(summary || "(ingen sammanfattning)");

    if (transcript.trim()) {
      doc.addPage();
      doc.fontSize(16).text("Transkription", { underline: true });
      doc.moveDown();
      doc.fontSize(10).text(transcript);
    }

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte skapa PDF." });
  }
});

app.post("/api/send-summary-email", (req, res) => {
  // mock
  console.log("[Kenai] send-summary-email (mock):", req.body?.to);
  res.json({ ok: true, mock: true });
});

// fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "recorder.html"));
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("[Kenai] Backend kör på port", port));
