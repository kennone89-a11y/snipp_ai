// server.js (ESM) – Kenai backend: summarize + pdf + reels + trends
import dotenv from "dotenv";
dotenv.config({ override: true });

import express from "express";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- OpenAI-klient + helper ----
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function requireOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY saknas i environment variables");
  }
  return key;
}

const app = express();

// ---- Multer: spara filer i /tmp (Render-vänligt) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Render har en skrivbar /tmp-katalog
    cb(null, "/tmp");
  },
  
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, `kenai-${Date.now()}-${safeName}`);
  },
});

// Multer för att ta emot klipp (video eller bild)
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per klipp
});
const uploadReelsTmp = upload;

// Koppla fluent-ffmpeg till ffmpeg-static binären
ffmpeg.setFfmpegPath(ffmpegPath);

app.set("trust proxy", 1);

// ---- CORS (ingen cors-dependency) ----
const ALLOWED_ORIGINS = new Set([
  "https://app.kenai.technology",
  "https://kenai.technology",
  "http://localhost:3000",
  "http://localhost:5173",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- Body-parsing + statiska filer ----
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Servera alla statiska filer i /public (html, bilder, js)
app.use(express.static(path.join(__dirname, "public")));

// --- Kenai Timestamps: AI + fallback via fetch ---
app.post("/api/timestamps", async (req, res) => {
  const { url } = req.body;

  // 1) Basvalidering
  if (!url || typeof url !== "string") {
    return res.status(400).json({
      error: "Ingen URL skickades in till /api/timestamps.",
    });
  }

  console.log("Kenai Timestamps: tog emot URL:", url);

  // 2) Fejkdata som fallback om OpenAI strular
  const fallback = {
    title: "Exempel-titel från Kenai Timestamps (fejk)",
    summary:
      "Detta är en fejk-sammanfattning från Kenai Timestamps-prototypen. " +
      "Allt fungerar tekniskt – om AI:n inte kan svara använder vi denna fallback.",
    hashtags: ["#kenai", "#timestamps", "#ai", "#podd", "#youtube"],
    chapters: [
      { time: "00:00", label: "Intro" },
      { time: "03:15", label: "Viktig punkt / Hook" },
      { time: "10:42", label: "Huvudämne / Story" },
      { time: "18:30", label: "Avslutning & CTA" },
    ],
  };

  try {
    // 3) Hämta API-nyckel
    const key = requireOpenAIKey();

    // 4) Anropa OpenAI Chat Completions via fetch
    const body = {
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "Du är Kenai Timestamps, ett verktyg som hjälper creators att få " +
            "titel, sammanfattning, hashtags och kapitel till YouTube-videor och poddar. " +
            "Du får OFTA bara en URL och kan ibland inte se själva innehållet. " +
            "Gör då en smart, rimlig gissning baserat på titel/slug/kontext. " +
            "Svara ALLTID med STRIKT JSON (ingen text runtom, ingen markdown, inga kommentarer) " +
            'i EXAKT detta schema: { "title": "...", "summary": "...", "hashtags": ["#..."], "chapters": [ { "time": "mm:ss", "label": "..." }, ... ] }. ' +
            'Tiderna ska alltid börja vid "00:00" och ökas i rimliga steg (t.ex. 00:00, 02:30, 05:00, 08:30 osv). ' +
            "Sammanfattningen ska vara 3–6 meningar på svenska. Hashtags ska vara 5–10 st, relevanta och populära.",
        },
        {
          role: "user",
          content:
            `Video/podd-URL: ${url}\n\n` +
            "Utgå från vad titeln och URL:en antyder. Om du inte vet exakt innehåll, " +
            "skapa en rimlig generell kapitelstruktur som skulle passa en sådan video/podd.",
        },
      ],
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("Kenai Timestamps: OpenAI-svar inte OK:", r.status, data);
      return res.json(fallback);
    }

    const raw = (data.choices?.[0]?.message?.content || "").trim();
    console.log("Kenai Timestamps: rå OpenAI-svar:", raw);

    // 5) Försök parsa JSON från modellen
    let parsed;
    try {
      const cleaned = raw
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(
        "Kenai Timestamps: kunde inte parsa JSON, använder fallback.",
        parseErr
      );
      return res.json(fallback);
    }

    // 6) Minimal sanity-check på resultatet
    if (
      !parsed ||
      typeof parsed.title !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.hashtags) ||
      !Array.isArray(parsed.chapters)
    ) {
      console.error(
        "Kenai Timestamps: ogiltig struktur i AI-svar, använder fallback."
      );
      return res.json(fallback);
    }

    console.log("Kenai Timestamps: AI-svar OK, skickar vidare till frontend.");
    return res.json(parsed);
  } catch (err) {
    console.error("Fel i /api/timestamps (yttersta catch):", err);
    // Viktigt: vi skickar inte 500 här, utan vår fallback så UI alltid funkar
    return res.json(fallback);
  }
});

// --- Reels: hooks/hashtags ---
app.post("/api/reels/hooks", async (req, res) => {
  try {
    const { idea } = req.body || {};
    if (!idea || typeof idea !== "string") {
      return res.status(400).json({ error: "Missing idea" });
    }

    const userPrompt = `
Du är en svensk expert på TikTok/Instagram Reels.

Användarens reel-idé:
"${idea}"

1) Skriv 3–5 korta, klickbara hooks på svenska (en mening var).
2) Skriv 8–15 relevanta hashtags (utan förklaringar).

Svar MÅSTE vara JSON på formen:
{
  "hooks": ["...", "..."],
  "hashtags": ["#tag1", "#tag2"]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Du hjälper creators att skriva hooks och hashtags på svenska.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    let hooks = [];
    let hashtags = [];

    try {
      const raw = completion.choices[0].message.content.trim();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.hooks)) hooks = parsed.hooks;
      if (Array.isArray(parsed.hashtags)) hashtags = parsed.hashtags;
    } catch (e) {
      console.error("JSON-parse error for /api/reels/hooks", e);
    }

    if (!hooks.length && !hashtags.length) {
      return res.status(500).json({ error: "AI gav inget användbart svar" });
    }

    res.json({ hooks, hashtags });
  } catch (err) {
    console.error("Error in /api/reels/hooks:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Reels: render demo-endpoint (ingen riktig video ännu) ---
app.post("/api/reels/render-demo", async (req, res) => {
  try {
    const { style, clips, targetSeconds } = req.body || {};

    console.log("Reels render-demo hit:", {
      style,
      clipCount: Array.isArray(clips) ? clips.length : 0,
      targetSeconds,
    });

    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Inga klipp skickades till render-demo.",
      });
    }

    if (!targetSeconds || targetSeconds <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Ogiltig mållängd.",
      });
    }

    // Här kommer vi i nästa steg koppla in riktig FFmpeg-rendering.
    // Just nu låtsas vi bara att allting gick bra.
    return res.json({
      ok: true,
      message:
        "Render-demo mottagen. FFmpeg-rendering kopplas på i nästa steg.",
      debug: {
        style: style || "Basic",
        clips: clips.map((c) => ({
          name: c.name || "okänt namn",
          plannedSeconds: c.duration || null,
        })),
        targetSeconds,
      },
    });
  } catch (err) {
    console.error("Fel i /api/reels/render-demo:", err);
    return res.status(500).json({
      ok: false,
      error: "Serverfel i render-demo.",
    });
  }
});

/// --- Reels: basic rendering (v1 – enkel) ---
// Video-only: använd första videon.
// Image-only: gör 3 sek video av första bilden.
// Mix (bild + video): ger 400 med tydligt felmeddelande.
app.post(
  "/api/reels/render-basic",
  upload.array("clips", 10),
  async (req, res) => {
    try {
      const files = req.files || [];

      if (!files.length) {
        return res.status(400).json({
          ok: false,
          error: "Inga klipp skickades till render-basic.",
        });
      }

      const imageFiles = files.filter((f) =>
        (f.mimetype || "").startsWith("image/")
      );
      const videoFiles = files.filter((f) =>
        (f.mimetype || "").startsWith("video/")
      );

      const allImages = imageFiles.length === files.length;
      const allVideos = videoFiles.length === files.length;

      // Demo: antingen bara bilder ELLER bara videor
      if (!allImages && !allVideos) {
        return res.status(400).json({
          ok: false,
          error:
            "Demo-läge: ladda antingen bara bilder eller bara videor (inte mixat) i samma render.",
        });
      }

      const MAX_BYTES = 50 * 1024 * 1024; // ca 50 MB per videoklipp

      // ----------------- FALL 1: ENDAST VIDEO -----------------
      if (allVideos) {
        for (const vf of videoFiles) {
          if (vf.size > MAX_BYTES) {
            console.warn("Video för stor för basic-render:", {
              name: vf.originalname,
              size: vf.size,
              max: MAX_BYTES,
            });
            return res.status(413).json({
              ok: false,
              error:
                "Ett av videoklippen är för stort för demo-render (max ca 50 MB per klipp). Testa kortare/komprimerade klipp.",
            });
          }
        }

        if (videoFiles.length > 1) {
          console.log(
            "Render-basic: demo-läge – flera videor skickade, använder bara första i v1:",
            videoFiles.map((f) => f.originalname)
          );
        }

        const videoFile = videoFiles[0];
        const inputPath = videoFile.path;
        const outputPath = path.join(
          "/tmp",
          `kenai-basic-${Date.now()}-single.mp4`
        );

        console.log("Render-basic: single video:", {
          originalName: videoFile.originalname,
          mimetype: videoFile.mimetype,
          size: videoFile.size,
          inputPath,
          outputPath,
        });

        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions(["-c:v copy", "-c:a copy", "-movflags +faststart"])
            .output(outputPath)
            .on("end", () => {
              console.log("FFmpeg render-basic (single video) klar:", {
                outputPath,
              });
              resolve();
            })
            .on("error", (err) => {
              console.error("Fel i FFmpeg render-basic (single video):", err);
              reject(err);
            })
            .run();
        });

        let videoBuffer;
        try {
          videoBuffer = await fs.promises.readFile(outputPath);
        } catch (err) {
          console.error("Kunde inte läsa videon (single video):", err);
          return res
            .status(500)
            .json({ ok: false, error: "Kunde inte läsa videon." });
        }

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", videoBuffer.length);
        res.send(videoBuffer);

        try {
          for (const f of files) {
            await fs.promises.unlink(f.path).catch(() => {});
          }
          await fs.promises.unlink(outputPath).catch(() => {});
        } catch (cleanupErr) {
          console.warn(
            "Kunde inte radera tmp-filer (render-basic single video):",
            cleanupErr
          );
        }

        return;
      }

      // ----------------- FALL 2: ENDAST BILDER -----------------
      if (allImages) {
        console.log(
          "Render-basic: image-only reel (first image only i v1):",
          imageFiles.map((f) => f.originalname)
        );

        const firstImg = imageFiles[0];

        const finalPath = path.join(
          "/tmp",
          `kenai-basic-img-${Date.now()}-single.mp4`
        );

        // Gör första bilden till ett kort videoklipp (ca 3 sek)
        await new Promise((resolve, reject) => {
          ffmpeg(firstImg.path)
            .inputOptions(["-loop 1"])
            .outputOptions([
              "-t 3", // längd ≈ 3 sek
              "-r 30",
              "-movflags +faststart",
            ])
            .size("1080x?")
            .output(finalPath)
            .on("end", () => {
              console.log("Bild → enkel image-reel klar:", {
                src: firstImg.path,
                out: finalPath,
              });
              resolve();
            })
            .on("error", (err) => {
              console.error("Fel när bild gjordes till enkel image-reel:", err);
              reject(err);
            })
            .run();
        });

        let videoBuffer;
        try {
          videoBuffer = await fs.promises.readFile(finalPath);
        } catch (err) {
          console.error("Kunde inte läsa image-reel-videon:", err);
          return res
            .status(500)
            .json({ ok: false, error: "Kunde inte läsa image-reelen." });
        }

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", videoBuffer.length);
        res.send(videoBuffer);

        try {
          for (const f of files) {
            await fs.promises.unlink(f.path).catch(() => {});
          }
          // om du vill: ta bort finalPath också
          // await fs.promises.unlink(finalPath).catch(() => {});
        } catch (cleanupErr) {
          console.warn("Kunde inte radera tmp-filer (image-only):", cleanupErr);
        }

        return;
      }

      // Failsafe
      return res.status(500).json({
        ok: false,
        error: "Okänt läge i render-basic.",
      });
    } catch (err) {
      console.error("Fel i /api/reels/render-basic:", err);
      return res.status(500).json({
        ok: false,
        error: "Serverfel i render-basic.",
      });
    }
  }
);
// --- Reels: lägg på musik (video + audio → mp4) ---
app.post(
  "/api/reels/render-with-audio",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const videoFile = req.files?.video?.[0];
      const audioFile = req.files?.audio?.[0];

      if (!videoFile || !audioFile) {
        return res.status(400).json({
          ok: false,
          error: "Både video och ljud måste skickas in.",
        });
      }

      console.log("Render-with-audio:", {
        video: videoFile.originalname,
        audio: audioFile.originalname,
      });

      const inputVideoPath = videoFile.path;
      const inputAudioPath = audioFile.path;
      const outputPath = path.join(
        "/tmp",
        `kenai-mix-${Date.now()}.mp4`
      );

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(inputVideoPath)
          .input(inputAudioPath)
          .outputOptions([
            "-c:v copy",   // behåll video som den är
            "-c:a aac",
            "-shortest",   // klipp till den som är kortast (oftast video)
            "-movflags +faststart",
          ])
          .output(outputPath)
          .on("end", () => {
            console.log("FFmpeg mix (video+audio) klar:", { outputPath });
            resolve();
          })
          .on("error", (err) => {
            console.error("Fel i FFmpeg mix (video+audio):", err);
            reject(err);
          })
          .run();
      });

      let mixedBuffer;
      try {
        mixedBuffer = await fs.promises.readFile(outputPath);
      } catch (err) {
        console.error("Kunde inte läsa mixad video:", err);
        return res
          .status(500)
          .json({ ok: false, error: "Kunde inte läsa mixad video." });
      }

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", mixedBuffer.length);
      res.send(mixedBuffer);

      // Städning
      try {
        await fs.promises.unlink(inputVideoPath).catch(() => {});
        await fs.promises.unlink(inputAudioPath).catch(() => {});
        await fs.promises.unlink(outputPath).catch(() => {});
      } catch (cleanupErr) {
        console.warn("Kunde inte radera tmp-filer (render-with-audio):", cleanupErr);
      }
    } catch (err) {
      console.error("Fel i /api/reels/render-with-audio:", err);
      return res.status(500).json({
        ok: false,
        error: "Serverfel i render-with-audio.",
      });
    }
  }
);
// -------------------------------------------------------------
// API: Build Reel (v1 demo backend) 
// Tar emot plan.json + filer och kör basic FFmpeg-klippning
// -------------------------------------------------------------

app.post("/api/build-reel", async (req, res) => {
  try {
    console.log("⏳ /api/build-reel HIT");

    // 1) Läs plan-data från request body
    const { targetSeconds, files } = req.body || {};

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Inga filer mottagna i plan.json",
      });
    }

    console.log("📄 Mottagen plan:", files);

    // 2) Demo–Endast: skapa en FUSK-”reel” genom att returnera text
    //    (senare kopplar vi riktig ffmpeg-klippning här)
    return res.json({
      ok: true,
      message: "Reels Engine demo — backend mottog plan.json korrekt",
      receivedFiles: files,
      targetSeconds,
    });

  } catch (err) {
    console.error("❌ FEL i /api/build-reel:", err);
    return res.status(500).json({
      ok: false,
      error: "Serverfel i /api/build-reel",
    });
  } 
});

// ---- Starta servern ----
// -------------------------------------------------------------
// API: Upload Reel Clips (v1 demo)
// Tar emot videoklipp, sparar i /tmp och svarar med paths
// -------------------------------------------------------------
app.post(
  "/api/upload-reel-clips",
  uploadReelsTmp.array("clips", 20),
  async (req, res) => {
    try {
      console.log("⏳ /api/upload-reel-clips HIT");

      const files = req.files || [];
      const targetSeconds = parseInt(req.body?.targetSeconds || "10", 10);

      if (!files.length) {
        return res.status(400).json({
          ok: false,
          error: "Inga klipp uppladdade.",
        });
      }

      const sessionId = Date.now().toString();

      console.log(
        "📥 Mottagna klipp:",
        files.map((f) => ({
          path: f.path,
          size: f.size,
          originalname: f.originalname,
        }))
      );

      return res.json({
        ok: true,
        message: "Klippen är uppladdade (demo).",
        sessionId,
        targetSeconds,
        files: files.map((f) => ({
          path: f.path,
          size: f.size,
          originalname: f.originalname,
        })),
      });
    } catch (err) {
      console.error("❌ FEL i /api/upload-reel-clips:", err);
      return res.status(500).json({
        ok: false,
        error: "Serverfel i /api/upload-reel-clips",
      });
    }
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Kenai backend kör på port ${PORT}`);
});

