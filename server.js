// server.js (ESM) — Kenai backend: timestamps + reels + summarize + ffmpeg tests
import dotenv from "dotenv";
dotenv.config({ override: true });

import express from "express";
import multer from "multer";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";


ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const __dirname = path.resolve();
const RENDER_DIR = path.join(__dirname, "public", "renders");
fs.mkdirSync(RENDER_DIR, { recursive: true });
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);

// ---- ENV / helpers ----
const PORT = process.env.PORT || 3000;

function requireOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY saknas i environment variables");
  return key;
}

function getOpenAI() {
  const key = requireOpenAIKey();
  return new OpenAI({ apiKey: key });
}


// ---- Multer: spara filer i /tmp (Render-vänligt) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "/tmp"),
  filename: (req, file, cb) => {
    const safeName = (file.originalname || "file").replace(/\s+/g, "_");
    cb(null, "kenai-" + Date.now() + "-" + safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});


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

// ---- Body + static ----
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(express.static(path.join(__dirname, "public")));
fs.mkdirSync(RENDER_DIR, { recursive: true });


// ---- Reels output static (om du skriver filer dit senare) ----
const reelsOutputDir = path.join(process.cwd(), "reels-output");
app.use("/reels-output", express.static(reelsOutputDir));

/* =========================
   Kenai Timestamps
========================= */
app.post("/api/timestamps", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Ingen URL skickades in till /api/timestamps." });
  }

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
    const key = requireOpenAIKey();

    const body = {
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "Du är Kenai Timestamps, ett verktyg som hjälper creators att få " +
            "titel, sammanfattning, hashtags och kapitel. " +
            "Svara ALLTID med STRIKT JSON (ingen markdown) i detta schema: " +
            '{ "title": "...", "summary": "...", "hashtags": ["#..."], "chapters": [ { "time": "mm:ss", "label": "..." } ] }. ' +
            'Tiderna ska börja vid "00:00". Sammanfattning 3–6 meningar på svenska.',
        },
        {
          role: "user",
          content:
            "Video/podd-URL: " +
            url +
            "\n\nUtgå från vad titeln och URL:en antyder. Om du inte vet exakt innehåll, skapa en rimlig generell kapitelstruktur.",
        },
      ],
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.json(fallback);

    const raw = (data.choices?.[0]?.message?.content || "").trim();
    const cleaned = raw.replace("```json", "").replace("```", "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.json(fallback);
    }

    if (
      !parsed ||
      typeof parsed.title !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.hashtags) ||
      !Array.isArray(parsed.chapters)
    ) {
      return res.json(fallback);
    }

    return res.json(parsed);
  } catch (err) {
    console.error("Fel i /api/timestamps:", err);
    return res.json(fallback);
  }
});

/* =========================
   Reels: hooks/hashtags
========================= */
app.post("/api/reels/hooks", async (req, res) => {
  try {
    const { idea } = req.body || {};
    if (!idea || typeof idea !== "string") {
      return res.status(400).json({ error: "Missing idea" });
    }

    requireOpenAIKey();

    const userPrompt =
      "Du är en svensk expert på TikTok/Instagram Reels.\n\n" +
      "Användarens reel-idé:\n" +
      idea +
      "\n\n" +
      "1) Skriv 3–5 korta, klickbara hooks på svenska (en mening var).\n" +
      "2) Skriv 8–15 relevanta hashtags (utan förklaringar).\n\n" +
      "Svar MÅSTE vara JSON på formen:\n" +
      '{ "hooks": ["..."], "hashtags": ["#tag1"] }';

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Du hjälper creators att skriva hooks och hashtags på svenska." },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = (completion.choices?.[0]?.message?.content || "").trim();

    let hooks = [];
    let hashtags = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.hooks)) hooks = parsed.hooks;
      if (Array.isArray(parsed.hashtags)) hashtags = parsed.hashtags;
    } catch (e) {
      console.error("JSON-parse error /api/reels/hooks:", e);
    }

    if (!hooks.length && !hashtags.length) {
      return res.status(500).json({ error: "AI gav inget användbart svar" });
    }

    return res.json({ hooks, hashtags });
  } catch (err) {
    console.error("Error in /api/reels/hooks:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   Reels: render demo
========================= */
app.post("/api/reels/render", upload.array("clips", 50), async (req, res) => {
  try {
    const planRaw = req.body?.plan;
const plan =
  typeof planRaw === "string"
    ? JSON.parse(planRaw)
    : planRaw; // om det redan är ett objekt
    const files = req.files || [];

    if (!plan) return res.status(400).json({ ok: false, error: "Missing plan" });
    if (!files.length) return res.status(400).json({ ok: false, error: "No files uploaded" });

    const targetSeconds = Number(plan.targetSeconds || plan.target || 10);
    const n = files.length;
    const perClip = Math.max(1, Math.floor(targetSeconds / n));

    const sessionId = plan.sessionId || Date.now().toString();
    const outName = `reel_${sessionId}.mp4`;
    const outPath = path.join(RENDER_DIR, outName);

    // 1) bygg segment
    const segments = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const inPath = f.path;
      const segPath = path.join(os.tmpdir(), `seg_${sessionId}_${i}.mp4`);

      const isImg = (f.mimetype || "").startsWith("image/");
      const isVid = (f.mimetype || "").startsWith("video/");

      if (!isImg && !isVid) {
        return res.status(400).json({ ok: false, error: `Unsupported type: ${f.mimetype}` });
      }

      await new Promise((resolve, reject) => {
        let cmd = ffmpeg(inPath)
          .outputOptions([
            "-t", String(perClip),
            "-vf",
            "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
          ])
          .videoCodec("libx264");

        // image: loopa
        if (isImg) cmd = cmd.inputOptions(["-loop 1"]);

        // video: försök ha ljud
        if (isVid) cmd = cmd.audioCodec("aac").audioFrequency(48000).audioChannels(2);

        cmd
          .on("end", resolve)
          .on("error", reject)
          .save(segPath);
      });

      segments.push(segPath);
    }

    // 2) concat segment
    // concat demuxer kräver en list.txt
    const listPath = path.join("/tmp", `list_${sessionId}.txt`);
    fs.writeFileSync(listPath, segments.map(p => `file '${p}'`).join("\n"));

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"])
        .on("end", resolve)
        .on("error", reject)
        .save(outPath);
    });

    return res.json({
      ok: true,
      videoUrl: `/renders/${outName}`,
      debug: { targetSeconds, perClip, count: n },
    });
  } catch (e) {
    console.error("render error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   Reels: basic rendering (v1)
   - video-only: returnerar första videon (copy)
   - image-only: gör 3s mp4 av första bilden
   - mix: 400
========================= */
app.post("/api/reels/render-basic", upload.array("clips", 10), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ ok: false, message: "Inga filer uppladdade (clips)." });
    }

    const imageFiles = files.filter((f) => (f.mimetype || "").startsWith("image/"));
    const videoFiles = files.filter((f) => (f.mimetype || "").startsWith("video/"));

    const allImages = imageFiles.length === files.length;
    const allVideos = videoFiles.length === files.length;

    if (!allImages && !allVideos) {
      return res.status(400).json({
        ok: false,
        error: "Demo-läge: ladda antingen bara bilder eller bara videor (inte mixat).",
      });
    }

    const MAX_BYTES = 50 * 1024 * 1024;

    // ---- VIDEO ----
    if (allVideos) {
      for (const vf of videoFiles) {
        if (vf.size > MAX_BYTES) {
          return res.status(413).json({
            ok: false,
            error: "Ett videoklipp är för stort för demo-render (max ~50MB/klipp).",
          });
        }
      }

      const videoFile = videoFiles[0];
      const inputPath = videoFile.path;
      const outputPath = path.join("/tmp", "kenai-basic-" + Date.now() + "-single.mp4");

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions(["-c:v copy", "-c:a copy", "-movflags +faststart"])
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      const buf = await fs.promises.readFile(outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", buf.length);
      res.send(buf);

      // cleanup
      for (const f of files) await fs.promises.unlink(f.path).catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
      return;
    }

    // ---- IMAGES ----
    if (allImages) {
      const firstImg = imageFiles[0];
      const finalPath = path.join("/tmp", "kenai-basic-img-" + Date.now() + "-single.mp4");

      await new Promise((resolve, reject) => {
        ffmpeg(firstImg.path)
          .inputOptions(["-loop 1"])
          .outputOptions(["-t 3", "-r 30", "-movflags +faststart"])
          .size("1080x?")
          .output(finalPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      const buf = await fs.promises.readFile(finalPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", buf.length);
      res.send(buf);

      for (const f of files) await fs.promises.unlink(f.path).catch(() => {});
      await fs.promises.unlink(finalPath).catch(() => {});
      return;
    }

    return res.status(500).json({ ok: false, error: "Okänt läge i render-basic." });
  } catch (err) {
    console.error("Fel i /api/reels/render-basic:", err);
    return res.status(500).json({ ok: false, error: "Serverfel i render-basic." });
  }
});

/* =========================
   Reels: render-with-audio (video + audio -> mp4)
========================= */
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
        return res.status(400).json({ ok: false, error: "Både video och ljud måste skickas in." });
      }

      const inputVideoPath = videoFile.path;
      const inputAudioPath = audioFile.path;
      const outputPath = path.join("/tmp", "kenai-mix-" + Date.now() + ".mp4");

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(inputVideoPath)
          .input(inputAudioPath)
          .outputOptions(["-c:v copy", "-c:a aac", "-shortest", "-movflags +faststart"])
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      const buf = await fs.promises.readFile(outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", buf.length);
      res.send(buf);

      await fs.promises.unlink(inputVideoPath).catch(() => {});
      await fs.promises.unlink(inputAudioPath).catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
    } catch (err) {
      console.error("Fel i /api/reels/render-with-audio:", err);
      return res.status(500).json({ ok: false, error: "Serverfel i render-with-audio." });
    }
  }
);

// =========================
// Recorder: summarize (text OR publicUrl/url -> whisper -> summary)
// =========================
app.post("/api/summarize", async (req, res) => {
  try {
    const { publicUrl, url, text } = req.body || {};

    const openai = getOpenAI();

    // 1) Om text finns: sammanfatta direkt
    if (typeof text === "string" && text.trim()) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Du skriver en kort, tydlig svensk sammanfattning. Punktlista med 3–7 punkter. Inga onödiga ord.",
          },
          { role: "user", content: text.trim() },
        ],
      });

      const summary = completion?.choices?.[0]?.message?.content?.trim() || "";
      return res.json({ ok: true, summary, transcript: text.trim(), publicUrl: null });
    }

    // 2) Annars: måste ha en ljud-URL
    const audioUrl = (publicUrl || url || "").trim();
    if (!audioUrl) {
      return res.status(400).json({ ok: false, error: "Missing publicUrl/url or text" });
    }

    // 3) Hämta ljudfilen
    const r = await fetch(audioUrl);
    if (!r.ok) {
      return res.status(400).json({
        ok: false,
        error: `Could not fetch audioUrl (${r.status})`,
      });
    }

    const buf = Buffer.from(await r.arrayBuffer());

    // 4) Spara temporärt (Render-vänligt)
    const tmpFile = path.join(os.tmpdir(), `kenai-upload-${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, buf);

    // 5) Whisper -> transkript
    const transcriptResp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
    });

    // städa tempfil
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    const transcript = (transcriptResp?.text || "").trim();
    if (!transcript) {
      return res.status(500).json({ ok: false, error: "Tom transkription från AI" });
    }

    // 6) Sammanfatta transkript
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du skriver en kort, tydlig svensk sammanfattning. Punktlista med 3–7 punkter. Inga onödiga ord.",
        },
        { role: "user", content: transcript },
      ],
    });

    const summary = completion?.choices?.[0]?.message?.content?.trim() || "";

    return res.json({ ok: true, publicUrl: audioUrl, transcript, summary });
  } catch (err) {
    console.error("summarize error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error in /api/summarize",
      detail: String(err?.message || err),
    });
  }
});





/* =========================
   Test: render reel from fixed local clips
========================= */
app.post("/api/render-reel-test", async (req, res) => {
  try {
    const clipsDir = path.join(__dirname, "test_clips");
    const outputDir = path.join(__dirname, "test_output");
    const outputFile = path.join(outputDir, "reel-from-api.mp4");

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const clips = [path.join(clipsDir, "clip1.MOV"), path.join(clipsDir, "clip2.MOV")];

    for (const file of clips) {
      if (!fs.existsSync(file)) {
        console.error("Hittar inte klipp:", file);
        return res.status(400).json({ ok: false, error: "Hittar inte klipp: " + file });
      }
    }

    const command = ffmpeg();
    clips.forEach((file) => command.input(file));

    command
      .on("start", (cmd) => console.log("FFmpeg start:", cmd))
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        if (!res.headersSent) {
          return res.status(500).json({
            ok: false,
            message: "FFmpeg misslyckades.",
            details: String(err),
          });
        }
      })
      .on("end", () => {
        console.log("FFmpeg klar, skapade:", outputFile);
        if (!res.headersSent) {
          return res.json({
            ok: true,
            message: "Reel render klar.",
            outputPath: "/test_output/reel-from-api.mp4",
          });
        }
      })
      .mergeToFile(outputFile, outputDir);
  } catch (err) {
    console.error("Fel i /api/render-reel-test:", err);
    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        message: "Serverfel i /api/render-reel-test.",
        details: String(err),
      });
    }
  }
});
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    return res.status(400).json({ ok: false, error: err.code, message: err.message });
  }
  next(err);
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    node: process.version,
  });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log("Kenai backend kör på port " + PORT);
});
