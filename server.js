// server.js – Kenai backend (statisk frontend + /api/build-reel)

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// fetch-helper: använd global fetch om den finns, annars node-fetch
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
}

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ----- Statisk frontend (public) -----
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Enkel health-check (bra för test)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång ✅" });
});

// ----- Supabase-klient -----
const SB_URL = process.env.SB_URL;
const SB_ANON = process.env.SB_ANON;

if (!SB_URL || !SB_ANON) {
  console.warn("⚠️ SB_URL eller SB_ANON saknas i environment variables!");
}

const supabase = createClient(SB_URL, SB_ANON);

// Hjälp-funktion för att hämta JSON (plan.json)
async function fetchJson(url) {
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch JSON ${url} (${res.status})`);
  }
  return res.json();
}

// ----- /api/build-reel -----
app.post("/api/build-reel", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId saknas" });
    }

    if (!SB_URL || !SB_ANON) {
      return res
        .status(500)
        .json({ error: "Supabase-konfiguration saknas (SB_URL/SB_ANON)" });
    }

    // Bas-URL till din public bucket:
    // audio/reels/<sessionId>/...
    const basePublic = `${SB_URL}/storage/v1/object/public/audio/reels/${sessionId}`;

    // 1. Hämta plan.json
    const planUrl = `${basePublic}/plan.json`;
    const plan = await fetchJson(planUrl);

    // 2. Skapa temporär arbetsmapp på servern
    const workDir = path.join("/tmp", `reel-${sessionId}`);
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    // 3. Ladda ner alla klipp lokalt
    const localFiles = [];

    for (let i = 0; i < plan.clips.length; i++) {
      const clip = plan.clips[i];

      // Antingen har plan.json en publicUrl, annars bygger vi på filnamnet
      const srcUrl = clip.publicUrl || `${basePublic}/${clip.file}`;
      const ext = path.extname(clip.file) || ".mp4";
      const localPath = path.join(workDir, `clip-${i}${ext}`);

      const resp = await fetchFn(srcUrl);
      if (!resp.ok) {
        throw new Error(`Failed to download clip ${srcUrl} (${resp.status})`);
      }

      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(localPath);
        resp.body.pipe(fileStream);
        resp.body.on("error", reject);
        fileStream.on("finish", resolve);
      });

      localFiles.push({ ...clip, localPath });
    }

    if (!localFiles.length) {
      return res.status(400).json({ error: "Inga klipp hittades i plan.json" });
    }

    // 4. Bygg reel med ffmpeg (enkel concat, första versionen)
    const outputPath = path.join(workDir, "output.mp4");
    let command = ffmpeg();

    localFiles.forEach((item) => {
      command = command.input(item.localPath);
    });

    command
      .on("start", (cmdLine) => {
        console.log("ffmpeg start:", cmdLine);
      })
      .on("error", (err) => {
        console.error("ffmpeg error:", err);
        if (!res.headersSent) {
          res.status(500).json({
            error: "ffmpeg misslyckades (första versionen är enkel concat)",
            details: err.message
          });
        }
      })
      .on("end", async () => {
        try {
          // 5. Ladda upp output.mp4 till Supabase
          const fileBuffer = fs.readFileSync(outputPath);

          const { error } = await supabase.storage
            .from("audio")
            .upload(`reels/${sessionId}/output.mp4`, fileBuffer, {
              contentType: "video/mp4",
              upsert: true
            });

          if (error) {
            console.error("Supabase upload error:", error);
            return res
              .status(500)
              .json({ error: "Kunde inte ladda upp video till Supabase" });
          }

          const publicUrl = `${SB_URL}/storage/v1/object/public/audio/reels/${sessionId}/output.mp4`;

          // 6. Skicka tillbaka länk till färdiga reelen
          res.json({
            ok: true,
            sessionId,
            outputUrl: publicUrl
          });
        } catch (uploadErr) {
          console.error("Upload exception:", uploadErr);
          if (!res.headersSent) {
            res.status(500).json({
              error: "Exception vid upload",
              details: uploadErr.message
            });
          }
        }
      })
      .videoCodec("libx264") // standard-codec
      .format("mp4")
      .save(outputPath); // startar ffmpeg-processen

  } catch (err) {
    console.error("build-reel exception:", err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Något gick fel i /api/build-reel", details: err.message });
    }
  }
});

// ----- Starta servern -----
app.listen(PORT, () => {
  console.log(`Kenai server lyssnar på port ${PORT}`);
});
