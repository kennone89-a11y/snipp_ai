// server.js — Kenai backend (stabil)
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

// -------- CORS (utan cors-paket) --------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Tillåt din app + lokalt + fallback (du kan strama åt senare)
  const allowlist = new Set([
    "https://app.kenai.technology",
    "https://kenai.technology",
    "http://localhost:3000",
    "http://localhost:5173",
  ]);

  // Om origin finns och är allowlisted, spegla den. Annars tillåt ändå (för debug).
  res.setHeader("Access-Control-Allow-Origin", allowlist.has(origin) ? origin : "*");
  res.setHeader("Vary", "Origin");

  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, apikey, x-upsert");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// -------- Body parsers --------
app.use(express.json({ limit: "2mb" })); // vi skickar URL + text (inte själva ljudfilen)
app.use(express.urlencoded({ extended: true }));

// -------- OpenAI client --------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------- Static hosting --------
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  // Om du vill: ändra till index.html, men recorder.html är fine
  res.redirect("/recorder.html");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

// -------- Helpers --------
async function downloadToTempFile(fileUrl) {
  const r = await fetch(fileUrl);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Kunde inte hämta ljudfil. status=${r.status} body=${txt.slice(0, 200)}`);
  }

  const contentType = r.headers.get("content-type") || "";
  // Gissa filändelse lite snällt
  let ext = ".bin";
  if (contentType.includes("audio/webm")) ext = ".webm";
  else if (contentType.includes("audio/wav")) ext = ".wav";
  else if (contentType.includes("audio/mpeg")) ext = ".mp3";
  else if (contentType.includes("audio/mp4")) ext = ".m4a";

  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);

  const tmpPath = path.join(os.tmpdir(), `kenai-audio-${Date.now()}${ext}`);
  await fs.promises.writeFile(tmpPath, buf);
  return tmpPath;
}

// -------- API: summarize --------
app.post("/api/summarize", async (req, res) => {
  try {
    const { audioUrl, url } = req.body || {};
    const targetUrl = audioUrl || url;

    console.log("[Kenai] summarize - body:", req.body);
    console.log("[Kenai] summarize - url:", targetUrl);

    if (!targetUrl) {
      return res.status(400).json({ error: "Ingen ljud-URL skickad." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY saknas på servern (Render Env Vars)." });
    }

    // 1) Hämta ljud från Supabase public URL → spara tempfil
    const tmpFile = await downloadToTempFile(targetUrl);

    // 2) Transkribera
    const transcriptResp = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      // språk-hint (valfritt)
      language: "sv",
    });

    const transcript = transcriptResp?.text || "";

    // 3) Sammanfatta
    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du är en svensk assistent som skriver tydliga, korta sammanfattningar. Returnera både: (1) en sammanfattning i punktform och (2) en superkort one-liner.",
        },
        {
          role: "user",
          content: `Här är transkriberingen:\n\n${transcript}\n\nSvara på svenska.`,
        },
      ],
      temperature: 0.2,
    });

    const summary = chat?.choices?.[0]?.message?.content?.trim() || "";

    // 4) Städa tempfil
    fs.promises.unlink(tmpFile).catch(() => {});

    return res.json({ transcript, summary });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({ error: err?.message || "Serverfel vid AI-sammanfattning." });
  }
});

// -------- API: export pdf --------
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { summary = "", transcript = "" } = req.body || {};

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="kenai-summary.pdf"');

    doc.pipe(res);

    doc.fontSize(18).text("Kenai – Sammanfattning", { underline: true });
    doc.moveDown();

    doc.fontSize(12).text("Sammanfattning:");
    doc.moveDown(0.5);
    doc.fontSize(11).text(summary || "(Ingen sammanfattning)");
    doc.moveDown();

    doc.fontSize(12).text("Transkript:");
    doc.moveDown(0.5);
    doc.fontSize(9).text(transcript || "(Inget transkript)");

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: err?.message || "Kunde inte skapa PDF." });
  }
});

// -------- API: send email (mock) --------
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { email, summary } = req.body || {};
    console.log("[Kenai] MOCK EMAIL:", { email, summaryLen: (summary || "").length });
    res.json({ ok: true, message: "Mock: email loggad på servern." });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Fel vid mail (mock)." });
  }
});

app.listen(PORT, () => {
  console.log("Kenai backend kör på port", PORT);
});
