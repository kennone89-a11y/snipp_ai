// server.js — minimal och robust
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Dela ut /public på rot-URL (så /surf.jpg funkar)
app.use(express.static(path.join(__dirname, "public")));

// Startsidan
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Hjälprutt för snabb koll
app.get("/health", (_req, res) => res.type("text").send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
