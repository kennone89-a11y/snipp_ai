// server.js - Minimal Kenai backend baseline

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Statisk frontend (public-mappen)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Enkel health-check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend (minimal) är igång ✅" });
});

// Starta servern
app.listen(PORT, () => {
  console.log(`Kenai minimal server lyssnar på port ${PORT}`);
});
