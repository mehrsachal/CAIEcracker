import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { IMG_DIR } from "../config";
import { allSettings, db, setSetting } from "../db";
import { requireAdmin } from "../auth";
import { aiReady, aiSpend, MODELS } from "../pipeline/ai";
import { enqueueDiscover, enqueuePaper, upsertPaper } from "../pipeline/queue";
import { localPath } from "../pipeline/sources";
import { looksLikePdf } from "../pipeline/pdf";

export const admin = Router();
admin.use(requireAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

admin.get("/overview", (_req, res) => {
  const one = (sql: string) => db.prepare(sql).get() as any;
  res.json({
    papers: db.prepare("SELECT status, COUNT(*) n FROM papers GROUP BY 1").all(),
    questions: db.prepare("SELECT type, status, COUNT(*) n FROM questions GROUP BY 1,2").all(),
    jobs: db.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY 1").all(),
    users: one("SELECT COUNT(*) n FROM users WHERE role='student'").n,
    attempts: one("SELECT COUNT(*) n FROM attempts").n,
    ai: { spend: aiSpend(), ready: aiReady(), calls: one("SELECT COUNT(*) n FROM ai_usage").n, keySet: !!process.env.ANTHROPIC_API_KEY,
      perPaper: db.prepare("SELECT p.type, ROUND(AVG(c),3) avg FROM (SELECT paper_id, SUM(cost_usd) c FROM ai_usage GROUP BY 1) u JOIN papers p ON p.id=u.paper_id GROUP BY 1").all() },
    settings: allSettings(), models: MODELS,
    logs: db.prepare(`SELECT l.*, p.subject_code, p.year, p.session, p.component FROM job_logs l LEFT JOIN papers p ON p.id=l.paper_id ORDER BY l.id DESC LIMIT 40`).all(),
  });
});

admin.put("/settings", (req, res) => {
  const allowed = ["ai_model", "ai_budget_usd", "ai_enabled", "auto_publish", "worker_paused", "ai_effort"];
  for (const [k, v] of Object.entries(req.body || {})) if (allowed.includes(k)) setSetting(k, String(v));
  res.json({ settings: allSettings() });
});

// ---------- subjects ----------
admin.get("/subjects", (_req, res) => {
  res.json({ subjects: db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM papers p WHERE p.subject_code=s.code) papers,
    (SELECT COUNT(*) FROM questions q JOIN papers p ON p.id=q.paper_id WHERE p.subject_code=s.code) questions,
    (SELECT GROUP_CONCAT(name, '\n') FROM (SELECT name FROM topics t WHERE t.subject_code=s.code ORDER BY position,id)) topics
    FROM subjects s ORDER BY level DESC, name`).all() });
});
admin.post("/subjects", (req, res) => {
  const { code, name, level, icon, topics } = req.body || {};
  if (!/^\d{4}$/.test(String(code)) || !name || !["O", "A"].includes(level)) return res.status(400).json({ error: "Need a 4-digit syllabus code, a name and level O or A" });
  db.prepare("INSERT INTO subjects(code,name,level,icon) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, level=excluded.level, icon=excluded.icon").run(code, name, level, icon || "📘");
  if (typeof topics === "string") {
    const list = topics.split("\n").map((t: string) => t.trim()).filter(Boolean);
    db.transaction(() => {
      db.prepare("DELETE FROM topics WHERE subject_code=?").run(code);
      list.forEach((t: string, i: number) => db.prepare("INSERT OR IGNORE INTO topics(subject_code,name,position) VALUES(?,?,?)").run(code, t, i));
    })();
  }
  res.json({ ok: true });
});

// ---------- import ----------
admin.post("/import", (req, res) => {
  const { subject, yearFrom, yearTo, sessions, components } = req.body || {};
  if (!db.prepare("SELECT 1 FROM subjects WHERE code=?").get(subject)) return res.status(400).json({ error: "Unknown subject" });
  const a = Number(yearFrom), b = Number(yearTo);
  const thisYear = new Date().getFullYear();
  if (!(a >= 2002 && b >= a && b <= thisYear)) return res.status(400).json({ error: `Years must be between 2002 and ${thisYear}` });
  const sess = (Array.isArray(sessions) && sessions.length ? sessions : ["m", "s", "w"]).filter((s: string) => ["m", "s", "w"].includes(s));
  const comps = String(components || "").split(/[,\s]+/).filter((c) => /^\d{1,2}$/.test(c));
  let n = 0;
  for (let y = a; y <= b; y++) for (const s of sess) {
    if (comps.length) for (const c of comps) { enqueuePaper(upsertPaper(subject, y, s, c), { fromStage: "download" }); n++; }
    else { enqueueDiscover(subject, y, s); n++; }
  }
  res.json({ ok: true, queued: n });
});

admin.post("/upload", upload.fields([{ name: "qp", maxCount: 1 }, { name: "ms", maxCount: 1 }]), (req, res) => {
  const { subject, year, session, component } = req.body || {};
  const files = req.files as Record<string, Express.Multer.File[]>;
  const qp = files?.qp?.[0]?.buffer, ms = files?.ms?.[0]?.buffer;
  if (!db.prepare("SELECT 1 FROM subjects WHERE code=?").get(subject)) return res.status(400).json({ error: "Unknown subject" });
  if (!/^\d{4}$/.test(year) || !["m", "s", "w"].includes(session) || !/^\d{1,2}$/.test(component)) return res.status(400).json({ error: "Check year, session and component" });
  if (!qp || !ms || !looksLikePdf(qp) || !looksLikePdf(ms)) return res.status(400).json({ error: "Upload both the question paper and mark scheme as PDF files" });
  const ref = { code: subject, year: Number(year), session, component };
  fs.writeFileSync(localPath(ref, "qp"), qp);
  fs.writeFileSync(localPath(ref, "ms"), ms);
  const id = upsertPaper(subject, Number(year), session, component);
  enqueuePaper(id, { fromStage: "download" });
  res.json({ ok: true, id });
});

// ---------- papers ----------
admin.get("/papers", (req, res) => {
  const params: any[] = [];
  let where = "1=1";
  if (req.query.subject) { where += " AND p.subject_code=?"; params.push(req.query.subject); }
  if (req.query.status) { where += " AND p.status=?"; params.push(req.query.status); }
  res.json({ papers: db.prepare(`SELECT p.*, s.name subject_name,
    (SELECT ROUND(SUM(cost_usd),3) FROM ai_usage u WHERE u.paper_id=p.id) cost,
    (SELECT COUNT(*) FROM questions q WHERE q.paper_id=p.id AND q.status IN ('pending','image_only')) image_only
    FROM papers p JOIN subjects s ON s.code=p.subject_code WHERE ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT 300`).all(...params) });
});
admin.get("/papers/:id", (req, res) => {
  const paper = db.prepare("SELECT p.*, s.name subject_name FROM papers p JOIN subjects s ON s.code=p.subject_code WHERE p.id=?").get(req.params.id);
  if (!paper) return res.status(404).json({ error: "Not found" });
  res.json({
    paper,
    questions: (db.prepare("SELECT * FROM questions WHERE paper_id=? ORDER BY number").all(req.params.id) as any[]).map(adminQuestion),
    logs: db.prepare("SELECT * FROM job_logs WHERE paper_id=? ORDER BY id DESC LIMIT 60").all(req.params.id),
  });
});
admin.post("/papers/:id/:action", (req, res) => {
  const id = Number(req.params.id);
  const paper = db.prepare("SELECT * FROM papers WHERE id=?").get(id) as any;
  if (!paper) return res.status(404).json({ error: "Not found" });
  switch (req.params.action) {
    case "retry": enqueuePaper(id); break;
    case "reprocess": enqueuePaper(id, { fromStage: "download" }); break;
    case "enrich":
      db.prepare("UPDATE questions SET status='pending' WHERE paper_id=? AND status='image_only'").run(id);
      enqueuePaper(id, { fromStage: "enrich" }); break;
    case "publish": db.prepare("UPDATE papers SET published=1 WHERE id=?").run(id); break;
    case "unpublish": db.prepare("UPDATE papers SET published=0 WHERE id=?").run(id); break;
    case "delete":
      db.prepare("DELETE FROM papers WHERE id=?").run(id);
      fs.rmSync(path.join(IMG_DIR, String(id)), { recursive: true, force: true }); break;
    default: return res.status(400).json({ error: "Unknown action" });
  }
  res.json({ ok: true });
});
admin.post("/retry-failed", (_req, res) => {
  const rows = db.prepare("SELECT id FROM papers WHERE status IN ('failed','partial')").all() as any[];
  for (const r of rows) {
    db.prepare("UPDATE questions SET status='pending' WHERE paper_id=? AND status='image_only'").run(r.id);
    enqueuePaper(r.id);
  }
  res.json({ ok: true, queued: rows.length });
});

// ---------- questions ----------
function adminQuestion(q: any) {
  return { ...q, options: q.options ? JSON.parse(q.options) : null, parts: q.parts ? JSON.parse(q.parts) : null,
    images: JSON.parse(q.images).map((f: string) => `/media/${f}`), ms_images: JSON.parse(q.ms_images).map((f: string) => `/media/${f}`) };
}
admin.get("/questions", (req, res) => {
  const params: any[] = [];
  let where = "1=1";
  if (req.query.status) { where += " AND q.status=?"; params.push(req.query.status); }
  if (req.query.subject) { where += " AND p.subject_code=?"; params.push(req.query.subject); }
  if (req.query.type) { where += " AND q.type=?"; params.push(req.query.type); }
  if (req.query.q) { where += " AND q.text LIKE ?"; params.push(`%${req.query.q}%`); }
  const page = Math.max(0, Number(req.query.page) || 0);
  const total = (db.prepare(`SELECT COUNT(*) n FROM questions q JOIN papers p ON p.id=q.paper_id WHERE ${where}`).get(...params) as any).n;
  const rows = db.prepare(`SELECT q.*, p.subject_code, p.year, p.session, p.component FROM questions q JOIN papers p ON p.id=q.paper_id
    WHERE ${where} ORDER BY q.status='needs_review' DESC, p.id DESC, q.number LIMIT 20 OFFSET ?`).all(...params, page * 20) as any[];
  res.json({ total, questions: rows.map(adminQuestion) });
});
admin.put("/questions/:id", (req, res) => {
  const q = db.prepare("SELECT * FROM questions WHERE id=?").get(req.params.id) as any;
  if (!q) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const f: Record<string, any> = {};
  for (const k of ["text", "answer", "explanation", "topic", "subtopic", "display", "status", "review_note"]) if (k in b) f[k] = b[k] === "" ? null : b[k];
  if ("difficulty" in b) f.difficulty = Math.min(3, Math.max(1, Number(b.difficulty) || 2));
  if ("options" in b) f.options = b.options ? JSON.stringify(b.options) : null;
  if ("parts" in b) { f.parts = b.parts ? JSON.stringify(b.parts) : null; if (b.parts) f.marks = b.parts.reduce((s: number, p: any) => s + (Number(p.marks) || 0), 0) || 1; }
  if (f.answer && !/^[A-D]$/.test(f.answer)) return res.status(400).json({ error: "Answer must be A, B, C or D" });
  if (f.status && !["ok", "image_only", "needs_review", "hidden", "pending"].includes(f.status)) return res.status(400).json({ error: "Bad status" });
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE questions SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`).run(...keys.map((k) => f[k]), q.id);
  db.prepare("UPDATE papers SET review_count=(SELECT COUNT(*) FROM questions WHERE paper_id=? AND status='needs_review') WHERE id=?").run(q.paper_id, q.paper_id);
  res.json({ question: adminQuestion(db.prepare("SELECT * FROM questions WHERE id=?").get(q.id)) });
});
