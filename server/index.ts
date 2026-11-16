import express from "express";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import { IMG_DIR, PORT } from "./config";
import "./db";
import { loadUser, requireUser, seedAdmin } from "./auth";
import { seedCatalog } from "./catalog";
import { startWorker } from "./pipeline/queue";
import { student } from "./routes/student";
import { admin } from "./routes/admin";

seedCatalog();
seedAdmin();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(loadUser);

app.use("/media", requireUser, express.static(IMG_DIR, { maxAge: "7d", immutable: true }));
app.use("/api/admin", admin);
app.use("/api", student);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err?.status || 500).json({ error: err?.code === "LIMIT_FILE_SIZE" ? "File too large (40 MB max)" : "Something went wrong on the server" });
});

startWorker();
app.listen(PORT, () => console.log(`CAIEcracker running on http://localhost:${PORT}`));
