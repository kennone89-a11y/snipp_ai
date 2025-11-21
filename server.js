// ===============================
// Kenai Recorder – SERVER.JS
// Fullstack backend (Render)
// ===============================

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "200mb" }));

// ===============================
// OPENAI CLIENT
// ===============================

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY   // <-- BYT i Render ENV
});

// ===============================
// 1. SUMMARIZE ENDPOINT
// ===============================
// Tar emot Supabase-public URL → laddar ner → skickar till OpenAI
// ===============================

app.post("/api/summarize", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
        }

        console.log("[Kenai] Hämtar ljud från:", url);

        // Hämta ljudfilen från Supabase
        const audioRes = await fetch(url);
        if (!audioRes.ok) {
            throw new Error("Kunde inte hämta ljudfil från Supabase");
        }
        const arrayBuffer = await audioRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log("[Kenai] Fil hämtad, skickar till OpenAI...");

        // Skicka till OpenAI Whisper
        const transcript = await client.audio.transcriptions.create({
            file: buffer,
            model: "gpt-4o-transcribe",     // bästa modellen för ljud
            response_format: "text"
        });

        console.log("[Kenai] Transkribering klar.");

        // Sammanfatta transkriptet
        const chat = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content: "Sammanfatta detta ljud på svenska. Gör det kortfattat, tydligt och enkelt."
                },
                {
                    role: "user",
                    content: transcript
                }
            ]
        });

        const summary = chat.choices[0].message.content;

        console.log("[Kenai] Sammanfattning genererad.");

        return res.json({
            transcript,
            summary
        });

    } catch (err) {
        console.error("SUMMARY ERROR:", err);
        return res.status(500).json({ error: err.message || "Okänt fel" });
    }
});

// ===============================
// 2. EXPORT TO PDF
// ===============================

app.post("/api/export-pdf", async (req, res) => {
    try {
        const { text } = req.body;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=summary.pdf");

        const doc = new PDFDocument();
        doc.pipe(res);
        doc.fontSize(14).text(text);
        doc.end();

    } catch (err) {
        console.error("PDF ERROR:", err);
        res.status(500).json({ error: "Kunde inte generera PDF" });
    }
});

// ===============================
// 3. MOCK MAIL ENDPOINT
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
// 4. START SERVER
// ===============================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Kenai backend körs på port ${PORT}`);
});
