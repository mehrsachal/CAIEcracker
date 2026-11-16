import { Router } from "express";
import { db } from "../db";
import { clearSession, hashPassword, requireUser, setSession, verifyPassword, User } from "../auth";

export const student = Router();
const SESSION_NAMES: Record<string, string> = { m: "Feb/March", s: "May/June", w: "Oct/Nov" };
// A question is practisable once it has an image and an official answer / mark scheme.
const VISIBLE = `p.published=1 AND q.status IN ('ok','image_only','pending')
  AND ((q.type='mcq' AND q.answer IS NOT NULL) OR (q.type='structured' AND (q.ms_images!='[]' OR q.parts IS NOT NULL)))`;

function publicUser(u: User) {
  const today = new Date().toISOString().slice(0, 10);
  const xpToday = (db.prepare("SELECT COALESCE(SUM(CASE WHEN correct=1 THEN 10 ELSE 2 END),0) x FROM attempts WHERE user_id=? AND date(created_at)=?").get(u.id, today) as any).x;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const streak = u.last_active === today || u.last_active === yesterday ? u.streak : 0;
  return { id: u.id, email: u.email, name: u.name, role: u.role, xp: u.xp, streak, dailyGoal: u.daily_goal, xpToday, activeToday: u.last_active === today };
}

// ---------- auth ----------
student.post("/auth/signup", (req, res) => {
  const { email, password, name } = req.body || {};
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (typeof password !== "string" || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Enter your name" });
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email.toLowerCase())) return res.status(409).json({ error: "An account with this email already exists" });
  const r = db.prepare("INSERT INTO users(email,name,password_hash) VALUES(?,?,?)").run(email.toLowerCase(), name.trim().slice(0, 60), hashPassword(password));
  setSession(res, Number(r.lastInsertRowid));
  res.json({ ok: true });
});
student.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").toLowerCase()) as any;
  if (!u || !verifyPassword(String(password || ""), u.password_hash)) return res.status(401).json({ error: "Wrong email or password" });
  setSession(res, u.id);
  res.json({ ok: true });
});
student.post("/auth/logout", (_req, res) => { clearSession(res); res.json({ ok: true }); });
student.get("/me", (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

// ---------- catalogue ----------
student.get("/subjects", requireUser, (req, res) => {
  const rows = db.prepare(`
    SELECT s.code, s.name, s.level, s.icon,
      COUNT(q.id) total,
      COUNT(DISTINCT a.question_id) attempted,
      COUNT(DISTINCT CASE WHEN a.correct=1 THEN a.question_id END) mastered
    FROM subjects s
    LEFT JOIN papers p ON p.subject_code=s.code
    LEFT JOIN questions q ON q.paper_id=p.id AND ${VISIBLE}
    LEFT JOIN attempts a ON a.question_id=q.id AND a.user_id=?
    GROUP BY s.code ORDER BY total=0, s.level DESC, s.name`).all(req.user!.id);
  res.json({ subjects: rows });
});

student.get("/subjects/:code", requireUser, (req, res) => {
  const code = req.params.code;
  const subject = db.prepare("SELECT * FROM subjects WHERE code=?").get(code);
  if (!subject) return res.status(404).json({ error: "Unknown subject" });
  const uid = req.user!.id;
  const topics = db.prepare(`
    SELECT COALESCE(q.topic,'Unclassified') name, COUNT(DISTINCT q.id) total,
      COUNT(DISTINCT a.question_id) attempted,
      COUNT(DISTINCT CASE WHEN a.correct=1 THEN a.question_id END) mastered
    FROM questions q JOIN papers p ON p.id=q.paper_id
    LEFT JOIN attempts a ON a.question_id=q.id AND a.user_id=?
    WHERE p.subject_code=? AND ${VISIBLE} GROUP BY 1`).all(uid, code) as any[];
  const order = new Map((db.prepare("SELECT name, position FROM topics WHERE subject_code=? ORDER BY position,id").all(code) as any[]).map((t, i) => [t.name, i]));
  topics.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));
  const facet = (expr: string) => db.prepare(`SELECT ${expr} v, COUNT(*) n FROM questions q JOIN papers p ON p.id=q.paper_id WHERE p.subject_code=? AND ${VISIBLE} GROUP BY 1 ORDER BY 1`).all(code);
  res.json({
    subject, topics,
    years: facet("p.year"), sessions: (facet("p.session") as any[]).map((s) => ({ ...s, label: SESSION_NAMES[s.v] })),
    papers: facet("substr(p.component,1,1)"), types: facet("q.type"), difficulties: facet("q.difficulty"),
  });
});

// ---------- practice ----------
function presentQuestion(q: any) {
  const parts = q.parts ? (JSON.parse(q.parts) as any[]).map((p) => ({ label: p.label, prompt: p.prompt, marks: p.marks })) : null;
  return {
    id: q.id, type: q.type, display: q.status === "ok" ? q.display : "image",
    text: q.status === "ok" ? q.text : null,
    options: q.status === "ok" && q.options ? JSON.parse(q.options) : null,
    images: (JSON.parse(q.images) as string[]).map((f) => `/media/${f}`),
    parts, marks: q.type === "mcq" ? 1 : q.marks, topic: q.topic, subtopic: q.subtopic, difficulty: q.difficulty,
    source: `${q.subject_code}/${q.component} · ${SESSION_NAMES[q.session]} ${q.year} · Q${q.number}`,
  };
}

const inList = (col: string, vals: unknown, params: any[]) => {
  if (!Array.isArray(vals) || !vals.length) return "";
  params.push(...vals.map(String));
  return ` AND ${col} IN (${vals.map(() => "?").join(",")})`;
};

student.post("/practice/start", requireUser, (req, res) => {
  const b = req.body || {};
  const uid = req.user!.id;
  const params: any[] = [uid, String(b.subject)];
  let where = `p.subject_code=? AND ${VISIBLE}`;
  where += inList("COALESCE(q.topic,'Unclassified')", b.topics, params);
  where += inList("p.year", b.years, params);
  where += inList("p.session", b.sessions, params);
  where += inList("substr(p.component,1,1)", b.papers, params);
  where += inList("q.type", b.types, params);
  where += inList("q.difficulty", b.difficulties, params);
  let having = "";
  if (b.mode === "unseen") having = "HAVING tries=0";
  if (b.mode === "mistakes") having = "HAVING tries>0 AND last_correct=0";
  const count = Math.min(40, Math.max(1, Number(b.count) || 10));
  const rows = db.prepare(`
    WITH me(uid) AS (SELECT ?)
    SELECT q.*, p.subject_code, p.year, p.session, p.component,
      (SELECT COUNT(*) FROM attempts a, me WHERE a.question_id=q.id AND a.user_id=me.uid) tries,
      (SELECT a.correct FROM attempts a, me WHERE a.question_id=q.id AND a.user_id=me.uid ORDER BY a.id DESC LIMIT 1) last_correct
    FROM questions q JOIN papers p ON p.id=q.paper_id
    WHERE ${where}
    GROUP BY q.id ${having}
    ORDER BY (tries=0) DESC, COALESCE(last_correct,0) ASC, RANDOM() LIMIT ${count}`).all(...params);
  res.json({ questions: (rows as any[]).sort(() => Math.random() - 0.5).map(presentQuestion) });
});

function touchStreak(u: User, xp: number) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const streak = u.last_active === today ? Math.max(1, u.streak) : u.last_active === yesterday ? u.streak + 1 : 1;
  db.prepare("UPDATE users SET xp=xp+?, streak=?, last_active=? WHERE id=?").run(xp, streak, today, u.id);
  return { xp: u.xp + xp, streak };
}

function getVisible(id: number) {
  return db.prepare(`SELECT q.* FROM questions q JOIN papers p ON p.id=q.paper_id WHERE q.id=? AND ${VISIBLE}`).get(id) as any;
}

student.post("/practice/answer", requireUser, (req, res) => {
  const q = getVisible(Number(req.body?.questionId));
  if (!q || q.type !== "mcq") return res.status(404).json({ error: "Question not found" });
  const answer = String(req.body?.answer || "").toUpperCase();
  if (!/^[A-D]$/.test(answer)) return res.status(400).json({ error: "Pick A, B, C or D" });
  const correct = answer === q.answer;
  db.prepare("INSERT INTO attempts(user_id,question_id,answer,correct,score,max_score) VALUES(?,?,?,?,?,1)").run(req.user!.id, q.id, answer, correct ? 1 : 0, correct ? 1 : 0);
  const gained = correct ? 10 : 2;
  res.json({ correct, answer: q.answer, explanation: q.status === "ok" ? q.explanation : null, gained, ...touchStreak(req.user!, gained) });
});

student.get("/practice/solution/:id", requireUser, (req, res) => {
  const q = getVisible(Number(req.params.id));
  if (!q || q.type !== "structured") return res.status(404).json({ error: "Question not found" });
  res.json({
    parts: q.status === "ok" && q.parts ? JSON.parse(q.parts) : null,
    msImages: (JSON.parse(q.ms_images) as string[]).map((f) => `/media/${f}`), marks: q.marks,
  });
});

student.post("/practice/self-mark", requireUser, (req, res) => {
  const q = getVisible(Number(req.body?.questionId));
  if (!q || q.type !== "structured") return res.status(404).json({ error: "Question not found" });
  const max = Math.max(1, q.marks);
  const score = Math.min(max, Math.max(0, Number(req.body?.score) || 0));
  const correct = score / max >= 0.7;
  db.prepare("INSERT INTO attempts(user_id,question_id,answer,correct,score,max_score) VALUES(?,?,?,?,?,?)")
    .run(req.user!.id, q.id, JSON.stringify(req.body?.responses ?? null).slice(0, 8000), correct ? 1 : 0, score, max);
  const gained = 2 + Math.round((score / max) * 13);
  res.json({ correct, gained, ...touchStreak(req.user!, gained) });
});

// ---------- progress ----------
student.get("/progress", requireUser, (req, res) => {
  const uid = req.user!.id;
  const totals = db.prepare("SELECT COUNT(*) attempts, COALESCE(SUM(correct),0) correct, COUNT(DISTINCT question_id) questions FROM attempts WHERE user_id=?").get(uid);
  const days = db.prepare(`SELECT date(created_at) day, COUNT(*) attempts, SUM(correct) correct FROM attempts
    WHERE user_id=? AND created_at >= datetime('now','-13 days') GROUP BY 1 ORDER BY 1`).all(uid);
  const topics = db.prepare(`
    SELECT s.code, s.name subject, s.level, s.icon, COALESCE(q.topic,'Unclassified') topic,
      COUNT(*) attempts, SUM(a.correct) correct, COUNT(DISTINCT a.question_id) questions
    FROM attempts a JOIN questions q ON q.id=a.question_id JOIN papers p ON p.id=q.paper_id JOIN subjects s ON s.code=p.subject_code
    WHERE a.user_id=? GROUP BY s.code, topic ORDER BY s.name, attempts DESC`).all(uid);
  const recent = db.prepare(`
    SELECT a.id, a.correct, a.score, a.max_score, a.created_at, q.type, q.topic, q.number, p.subject_code, p.year, p.session, p.component
    FROM attempts a JOIN questions q ON q.id=a.question_id JOIN papers p ON p.id=q.paper_id
    WHERE a.user_id=? ORDER BY a.id DESC LIMIT 20`).all(uid);
  const leaderboard = db.prepare("SELECT name, xp, id=? me FROM users WHERE role='student' OR id=? ORDER BY xp DESC LIMIT 10").all(uid, uid);
  res.json({ totals, days, topics, recent, leaderboard });
});
