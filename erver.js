[1mdiff --git a/server.js b/server.js[m
[1mindex 1a59c37..a6daec4 100644[m
[1m--- a/server.js[m
[1m+++ b/server.js[m
[36m@@ -537,9 +537,12 @@[m [mapp.post("/api/summarize", async (req, res) => {[m
 ========================= */[m
 app.post("/api/render-reel-test", async (req, res) => {[m
   try {[m
[31m-    const clipsDir = path.join(__dirname, "test_clips");[m
[31m-    const outputDir = path.join(__dirname, "test_output");[m
[31m-    const outputFile = path.join(outputDir, "reel-from-api.mp4");[m
[32m+[m[32m   const clipsDir = path.join(__dirname, "public", "test_clips");[m
[32m+[m[32mconst clips = [[m
[32m+[m[32m  path.join(clipsDir, "clip1.MOV..MOV"),[m
[32m+[m[32m  path.join(clipsDir, "clip2.MOV..MOV"),[m
[32m+[m[32m];[m
[32m+[m
 [m
     if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });[m
 [m
