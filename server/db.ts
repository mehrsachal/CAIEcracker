import Database from "better-sqlite3";
import path from "path";
import { DATA_DIR } from "./config";

export const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student',
  xp INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, last_active TEXT,
  daily_goal INTEGER NOT NULL DEFAULT 50, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subjects (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, level TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '📘'
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY, subject_code TEXT NOT NULL REFERENCES subjects(code) ON DELETE CASCADE,
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, UNIQUE(subject_code, name)
);
CREATE TABLE IF NOT EXISTS papers (
  id INTEGER PRIMARY KEY, subject_code TEXT NOT NULL REFERENCES subjects(code),
  year INTEGER NOT NULL, session TEXT NOT NULL, component TEXT NOT NULL,
  type TEXT, status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'download',
  error TEXT, qp_source TEXT, ms_source TEXT, question_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_code, year, session, component)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY, paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, type TEXT NOT NULL,            -- mcq | structured
  display TEXT NOT NULL DEFAULT 'image',                  -- text | image
  text TEXT, options TEXT, answer TEXT, explanation TEXT,
  parts TEXT, marks INTEGER NOT NULL DEFAULT 1,
  topic TEXT, subtopic TEXT, difficulty INTEGER NOT NULL DEFAULT 2,
  images TEXT NOT NULL DEFAULT '[]', ms_images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',                 -- pending | ok | image_only | needs_review | hidden
  review_note TEXT, UNIQUE(paper_id, number)
);
CREATE INDEX IF NOT EXISTS q_topic ON questions(topic);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer TEXT, correct INTEGER NOT NULL, score REAL NOT NULL, max_score REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS a_user ON attempts(user_id, question_id);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'paper', payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued',                  -- queued | running | done | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0, run_after TEXT NOT NULL DEFAULT (datetime('now')),
  error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY, paper_id INTEGER, level TEXT NOT NULL, message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY, paper_id INTEGER, model TEXT NOT NULL, purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

try { db.exec("ALTER TABLE questions ADD COLUMN ms_visual INTEGER NOT NULL DEFAULT 0"); } catch { /* already there */ }

const DEFAULTS: Record<string, string> = {
  ai_model: "claude-opus-5-5",
  ai_budget_usd: "5",
  ai_effort: "low",
  ai_enabled: "1",
  auto_publish: "1",
  worker_paused: "0",
};
export function getSetting(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? "";
}
export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export function allSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare("SELECT key,value FROM settings").all() as any[]) out[r.key] = r.value;
  return out;
}
export function logPaper(paperId: number | null, level: "info" | "warn" | "error", message: string) {
  db.prepare("INSERT INTO job_logs(paper_id,level,message) VALUES(?,?,?)").run(paperId, level, message.slice(0, 2000));
  if (level !== "info") console.log(`[paper ${paperId}] ${level}: ${message}`);
}
