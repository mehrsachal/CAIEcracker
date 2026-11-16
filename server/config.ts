import fs from "fs";
import path from "path";

// Minimal .env loader (no dependency needed).
const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
export const PDF_DIR = path.join(DATA_DIR, "pdf");
export const IMG_DIR = path.join(DATA_DIR, "img");
for (const d of [DATA_DIR, PDF_DIR, IMG_DIR]) fs.mkdirSync(d, { recursive: true });

export const PORT = Number(process.env.PORT || 3000);
export const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
