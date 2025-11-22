// ===============================
// Kenai Recorder – SERVER.JS
// Fullstack backend (Render)
// ===============================

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "200mb" }));
app.use(express.static(path.join(__dirname, "public")));


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
// === /api/trends – YouTube-baserade trender med AI + fallback ===
app.get("/api/trends", async (req, res) => {
    // 1. Mock-data som backup om YouTube/AI failar
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
                    "#beforeafter",
                    "#glowup"
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
                    "#moneytips"
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
                    "#grind"
                ]
            }
        ]
    };

    const YT_API_KEY = process.env.YT_API_KEY;

    // Om ingen YouTube-nyckel finns ännu → kör bara mock-data
    if (!YT_API_KEY) {
        console.warn("YT_API_KEY saknas – returnerar mockTrends.");
        return res.json(mockTrends);
    }

    try {
        // 2. Hämta "most popular" videos på YouTube i Sverige
        const ytUrl =
            "https://www.googleapis.com/youtube/v3/videos" +
            "?part=snippet,statistics" +
            "&chart=mostPopular" +
            "&regionCode=SE" +
            "&maxResults=10" +
            `&key=${YT_API_KEY}`;

        const ytRes = await fetch(ytUrl);
        if (!ytRes.ok) {
            console.error("YouTube API svarade med felstatus:", ytRes.status, await ytRes.text());
            return res.json(mockTrends);
        }

        const ytData = await ytRes.json();
        const items = Array.isArray(ytData.items) ? ytData.items : [];

        if (!items.length) {
            console.warn("YouTube API gav inga items – kör mockTrends.");
            return res.json(mockTrends);
        }

        const videos = items.map((item) => ({
            title: item?.snippet?.title || "",
            channel: item?.snippet?.channelTitle || "",
            tags: item?.snippet?.tags || [],
            viewCount: item?.statistics?.viewCount || null,
            likeCount: item?.statistics?.likeCount || null
        }));

        // 3. Låt OpenAI forma trender → kortklipps-idéer + hashtags
        const aiResponse = await client.responses.create({
            model: "gpt-4.1-mini",
            input: [
                {
                    role: "system",
                    content:
                        "Du är en svensk social media-expert som hjälper skapare att göra korta TikTok/Instagram Reels/YouTube Shorts-klipp. " +
                        "Du gillar tydliga hooks, enkelt språk och blandar svenska/engelska hashtags."
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text:
                                "Här är en lista med populära YouTube-videos (titel, kanal, tags, views, likes) från Sverige just nu.\n\n" +
                                "Skapa 3–5 förslag på korta klipp-idéer baserat på dessa trender. För varje förslag, returnera:\n" +
                                '- "title": kort titel på idén\n' +
                                '- "idea": 1–2 meningar om hur klippet ska se ut\n' +
                                '- "hashtags": en array med 8–15 hashtags (utan #kenai), blandat svenska/engelska, relevanta för idén\n\n' +
                                "Returnera svaret som REN JSON i formatet:\n" +
                                '{ "platform": "youtube_se", "country": "SE", "items": [ { "title": "...", "idea": "...", "hashtags": ["...", ...] }, ... ] }\n\n' +
                                "Här är videodata:\n" +
                                JSON.stringify(videos)
                        }
                    ]
                }
            ],
            response_format: { type: "json_object" }
        });

        const rawText = aiResponse.output[0].content[0].text;
        let parsed;

        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            console.error("Kunde inte parsa AI JSON:", e, rawText);
            parsed = null;
        }

        if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
            console.warn("AI gav inget användbart svar – kör mockTrends.");
            return res.json(mockTrends);
        }

        return res.json(parsed);
    } catch (err) {
        console.error("Fel i /api/trends:", err);
        return res.json(mockTrends);
    }
});

// 4. SERVER STATUS
// ==========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Kenai backend listens on port ${PORT}`);
});
