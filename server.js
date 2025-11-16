// server.js - Kenai backend: health + build-reel (plan + enkel video v1)

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// ----- Environment vars (Supabase) -----
// Vi accepterar både SB_* och SBL_* för säkerhets skull
const SB_URL = process.env.SB_URL || process.env.SBL_URL;
const SB_ANON = process.env.SB_ANON || process.env.SBL_ANON;
const BUCKET = "audio";

// Env-debug i loggarna
console.log("ENV DEBUG SB_URL:", SB_URL ? "SET" : "MISSING");
console.log("ENV DEBUG SB_ANON:", SB_ANON ? "SET" : "MISSING");

app.use(cors());
app.use(express.json());

// Statisk frontend (public-mappen)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ----- Hjälpfunktioner -----

// Läs JSON via fetch (Node 22 har global fetch)
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch JSON ${url} (${res.status})`);
  }
  return res.json();
}

// Ladda ned ett klipp till fil
async function downloadToFile(url, localPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (${res.status})`);
  }

  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(localPath);
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

// Ladda upp fil till Supabase-bucketen via HTTP
async function uploadToSupabase(pathRelative, buffer, contentType) {
  if (!SB_URL || !SB_ANON) {
    throw new Error("SB_URL / SB_ANON saknas – kan inte ladda upp till Supabase");
  }

  const url = `${SB_URL}/storage/v1/object/${encodeURIComponent(
    BUCKET
  )}/${encodeURIComponent(pathRelative)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SB_ANON,
      authorization: `Bearer ${SB_ANON}`,
      "content-type": contentType,
      "x-upsert": "true"
    },
    body: buffer
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase upload failed (${res.status}) ${text}`);
  }
}

// ----- Health-check -----
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Kenai backend env-debug ✅",
    SB_URL_present: !!SB_URL,
    SB_ANON_present: !!SB_ANON
  });
});

/**
 * POST /api/build-reel
 * Body: { sessionId: "..." }
 *
 * v2:
 *  1) Läser plan.json
 *  2) Bygger en enkel reel-video av FÖRSTA klippet i planen
 *  3) Laddar upp output.mp4 till Supabase och skickar outputUrl tillbaka
 */
app.post("/api/build-reel", async (req, res) => {
  try {
    const { sessionId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "sessionId saknas" });
    }

    if (!SB_URL) {
      return res.status(500).json({
        ok: false,
        error:
          "SB_URL/SBL_URL saknas på servern (kolla environment vars i Render)"
      });
    }

    // Bas-URL till public bucket: audio/reels/<sessionId>/...
    const basePublic = `${SB_URL}/storage/v1/object/public/${BUCKET}/reels/${sessionId}`;

    // 1. Hämta plan.json
    const planUrl = `${basePublic}/plan.json`;
    let plan;
    try {
      plan = await fetchJson(planUrl);
    } catch (err) {
      console.error("Kunde inte läsa plan.json:", err.message);
      return res.status(404).json({
        ok: false,
        error: "plan.json hittades inte eller gick inte att läsa",
        url: planUrl
      });
    }

    const clips = Array.isArray(plan.clips) ? plan.clips : [];
    if (!clips.length) {
      return res.status(400).json({
        ok: false,
        error: "Planen innehåller inga klipp."
      });
    }

    // Gör en lista med public URLs
    const files = clips.map((clip, index) => {
      const name =
        clip.file || clip.path || clip.name || clip.filename || `clip-${index}`;
      const url = `${basePublic}/${name}`;
      return {
        index,
        type: clip.type || "unknown",
        url,
        original: clip
      };
    });

    // ----- v1: bygg video av FÖRSTA klippet -----
    const first = files[0];
    const firstClip = first.original;

    const workDir = path.join("/tmp", `reel-${sessionId}-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    const extFromName =
      (firstClip.file && path.extname(firstClip.file)) ||
      (firstClip.name && path.extname(firstClip.name)) ||
      ".mp4";

    const localInput = path.join(workDir, `input${extFromName}`);
    const localOutput = path.join(workDir, "output.mp4");

    console.log("Laddar ned första klippet:", first.url);
    await downloadToFile(first.url, localInput);

    const durationSeconds =
      Number(firstClip.duration) ||
      Number(plan.targetDuration) ||
      15;

    console.log(
      `Bygger output.mp4 av första klippet (${extFromName}), duration ~${durationSeconds}s`
    );

    await new Promise((resolve, reject) => {
      let command = ffmpeg(localInput)
        .videoCodec("libx264")
        .outputOptions(["-pix_fmt", "yuv420p"]) // kompatibel mp4
        .duration(durationSeconds);

      if (first.type === "image") {
        // loopa bild
        command = command.loop(1);
      }

      command
        .on("start", (cmdLine) => {
          console.log("ffmpeg start:", cmdLine);
        })
        .on("error", (err) => {
          console.error("ffmpeg error:", err);
          reject(err);
        })
        .on("end", () => {
          console.log("ffmpeg klar, output.mp4 skapad");
          resolve();
        })
        .save(localOutput);
    });

    const fileBuffer = fs.readFileSync(localOutput);
    const outputPath = `reels/${sessionId}/output.mp4`;

    console.log("Laddar upp output.mp4 till Supabase:", outputPath);
    await uploadToSupabase(outputPath, fileBuffer, "video/mp4");

    const outputUrl = `${SB_URL}/storage/v1/object/public/${BUCKET}/${outputPath}`;

    return res.json({
      ok: true,
      sessionId,
      basePublic,
      plan,
      files,
      outputPath,
      outputUrl
    });
  } catch (err) {
    console.error("build-reel error:", err);
    return res.status(500).json({
      ok: false,
      error: "Något gick fel i /api/build-reel",
      details: err.message
    });
  }
});

// ----- Starta servern -----
app.listen(PORT, () => {
  console.log(`Kenai backend lyssnar på port ${PORT}`);
});
