// ===============================
// Kenai Recorder – SERVER.JS
// Fullstack backend (Render)
// ===============================

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import { OpenAI } from "openai";


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
        // Frontenden skickar "audioUrl", äldre version kanske skickar "url".
        const { audioUrl, url } = req.body || {};
        const finalUrl = audioUrl || url;

        if (!finalUrl) {
            return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
        }

        console.log("[Kenai] Hämtar ljud från:", finalUrl);

        // 1) Hämta ljudfilen (supabase public URL)
        const audioRes = await fetch(finalUrl);
        if (!audioRes.ok) {
            console.error("Supabase fetch fel:", audioRes.status, await audioRes.text());
            throw new Error("Kunde inte hämta ljudfil från Supabase");
        }

        const arrayBuffer = await audioRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log("[Kenai] Fil hämtad, skickar till OpenAI...");

        // 2) Gör om Buffer -> "File" för OpenAI (annars: 'Could not parse multipart form')
        const fileForOpenAI = await OpenAI.toFile(buffer, "audio.webm", {
    contentType: "audio/webm",
});


        // 3) Transkribera med Whisper / gpt-4o-transcribe
        const transcriptText = await client.audio.transcriptions.create({
            file: fileForOpenAI,
            model: "gpt-4o-transcribe",
            response_format: "text",
        });

        console.log("[Kenai] Transkribering klar.");

        // 4) Sammanfatta transkriptet
        const chat = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content:
                        "Du är en assistent som sammanfattar ljudinspelningar på svenska. Gör en kort, tydlig och lättläst sammanfattning.",
                },
                {
                    role: "user",
                    content: transcriptText,
                },
            ],
        });

        const summary = chat.choices?.[0]?.message?.content ?? "";

        console.log("[Kenai] Sammanfattning genererad.");

        return res.json({
            transcript: transcriptText,
            summary,
        });
    } catch (err) {
        console.error("SUMMARY ERROR:", err);
        return res
            .status(500)
            .json({ error: err?.message || "Okänt fel från OpenAI/servern" });
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

// 3. MOCK MAIL ENDPOINT
// ==========================
app.post("/api/send-summary-email", async (req, res) => {
    const { email, html } = req.body;

    console.log("MOCK EMAIL SEND >>>", email);
    console.log("HTML length:", html?.length || 0);

    return res.json({ ok: true });
});

// === NY ROUTE: enkel /api/trends-test för Kenai Reels ===
app.get("/api/trends", (req, res) => {
    const mockTrends = {
        platform: "mock",
        country: "SE",
        items: [
            {
                title: "Gym motivation 2025 – före/efter-träning",
                idea: "Visa klipp från när du är trött innan gymmet och klipp till energi efter passet.",
                hashtags: [
                    "#gymtok",
                    "#svensktiktok",
                    "#träning",
                    "#motivation",
                    "#kenai",
                    "#beforeafter"
                ]
            },
            {
                title: "Pengatips – 1 sak att ändra 2025",
                idea: "Kort klipp där du säger EN konkret sak som förbättrar ekonomin (t.ex. sluta med dyra småköp).",
                hashtags: [
                    "#ekonomi",
                    "#pengar",
                    "#sparande",
                    "#investera",
                    "#aktier",
                    "#kenai"
                ]
            },
            {
                title: "POV: Du börjar ta ditt liv seriöst",
                idea: "Snabba klipp: gym, jobba vid dator, laga mat, läsa bok – tempo och energi.",
                hashtags: [
                    "#glowup",
                    "#selfimprovement",
                    "#2025",
                    "#svensktiktok",
                    "#mindset",
                    "#kenai"
                ]
            }
        ]
    };

    res.json(mockTrends);
});

// 4. SERVER STATUS
// ==========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Kenai backend listens on port ${PORT}`);
});
