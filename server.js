// server.js – Kenai backend (stabil version)

// ===============================
// Imports & setup
// ===============================
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// __dirname / __filename för ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Statisk katalog: public/
app.use(express.static(path.join(__dirname, "public")));

// OpenAI-klient
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===============================
// 1. ROOT (index.html om du vill)
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
// 2. /api/summarize – ljud → text → sammanfattning
// ===============================
app.post("/api/summarize", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
    }

    console.log("[Kenai] Hämtar ljud från:", url);

    // Hämta ljudfilen från Supabase (eller annan publik URL)
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      throw new Error("Kunde inte hämta ljudfil från Supabase");
    }
    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("[Kenai] Fil hämtad, skickar till OpenAI...");

    // 1) Transkribera med Whisper
    const transcript = await client.audio.transcriptions.create({
      file: buffer,
      model: "gpt-4o-transcribe",
      response_format: "text",
    });

    console.log("[Kenai] Transkribering klar.");

    // 2) Sammanfatta texten på svenska
    const chat = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Du är en assistent som sammanfattar ljud på svenska. Skriv kortfattat, tydligt och enkelt.",
        },
        {
          role: "user",
          content: transcript,
        },
      ],
    });

    const summary = chat.choices[0].message.content;

    console.log("[Kenai] Sammanfattning genererad.");

    return res.json({
      transcript,
      summary,
    });
  } catch (err) {
    console.error("SUMMARY ERROR:", err);
    return res.status(500).json({ error: err.message || "Okänt fel" });
  }
});

// ===============================
// 3. /api/export-pdf – text → PDF
// ===============================
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { text } = req.body;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=summary.pdf");

    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(14).text(text || "");
    doc.end();
  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte generera PDF" });
  }
});

// ===============================
// 4. /api/send-summary-email – mock
// ===============================
app.post("/api/send-summary-email", async (req, res) => {
  const { email, text } = req.body;

  console.log("=== MAIL MOCK ===");
  console.log("Mottagare:", email);
  console.log("Text:", text);
  console.log("=================");

  return res.json({ ok: true });
});

// ===============================
// 5. START SERVERN
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kenai backend körs på port ${PORT}`);
});
