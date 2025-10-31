import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

app.get("/__health", (_, res) => res.type("text").send("OK"));

app.get("*", (_, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
