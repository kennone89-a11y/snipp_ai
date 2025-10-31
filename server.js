import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public"); // serva mappen "public"
app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

// Health-check så vi vet att rätt server kör
app.get("/__health", (_, res) => res.type("text").send("OK"));

// Fallback till index.html
app.get("*", (_, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
