// Serverless mode for GitHub Pages: the question bank is static JSON exported by
// scripts/export-static.ts and all student progress lives in localStorage.
interface BankQ {
  id: string; type: "mcq" | "structured"; display: string; text: string | null; options: Record<string, string> | null;
  answer: string | null; explanation: string | null; parts: any[] | null; marks: number; msVisual: boolean;
  topic: string | null; subtopic: string | null; difficulty: number; year: number; session: string; paper: string;
  source: string; images: string[]; msImages: string[];
}
interface Attempt { q: string; s: string; topic: string; type: string; source: string; correct: boolean; score: number; max: number; at: number }
interface Profile { xp: number; streak: number; lastActive: string | null; attempts: Attempt[] }

const SESSION_NAMES: Record<string, string> = { m: "Feb/March", s: "May/June", w: "Oct/Nov" };
const base = import.meta.env.BASE_URL + "bank/";
const img = (f: string) => `${base}img/${f}`;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const cache = new Map<string, Promise<any>>();
function load(file: string) {
  if (!cache.has(file)) cache.set(file, fetch(base + file).then((r) => { if (!r.ok) throw new Error("Could not load the question bank"); return r.json(); }));
  return cache.get(file)!;
}
function profile(): Profile {
  try { return { xp: 0, streak: 0, lastActive: null, attempts: [], ...JSON.parse(localStorage.getItem("cc_profile") || "{}") }; }
  catch { return { xp: 0, streak: 0, lastActive: null, attempts: [] }; }
}
function save(p: Profile) { try { localStorage.setItem("cc_profile", JSON.stringify(p)); } catch { /* storage full or blocked */ } }

function record(q: BankQ, subject: string, correct: boolean, score: number, max: number, gained: number) {
  const p = profile(), today = day(), yesterday = day(Date.now() - 864e5);
  p.streak = p.lastActive === today ? Math.max(1, p.streak) : p.lastActive === yesterday ? p.streak + 1 : 1;
  p.lastActive = today; p.xp += gained;
  p.attempts.push({ q: q.id, s: subject, topic: q.topic || "Unclassified", type: q.type, source: q.source, correct, score, max, at: Date.now() });
  save(p);
  return { gained, xp: p.xp, streak: p.streak };
}

function stats(attempts: Attempt[]) {
  const tried = new Set<string>(), mastered = new Set<string>(), last = new Map<string, boolean>();
  for (const a of attempts) { tried.add(a.q); if (a.correct) mastered.add(a.q); last.set(a.q, a.correct); }
  return { tried, mastered, last };
}
const present = (q: BankQ) => ({
  id: q.id, type: q.type, display: q.display, text: q.text, options: q.options, images: q.images.map(img),
  parts: q.parts ? q.parts.map((p) => ({ label: p.label, prompt: p.prompt, marks: p.marks })) : null,
  marks: q.marks, topic: q.topic, subtopic: q.subtopic, difficulty: q.difficulty, source: q.source,
});
const facet = (qs: BankQ[], f: (q: BankQ) => string | number) => {
  const m = new Map<string | number, number>();
  for (const q of qs) m.set(f(q), (m.get(f(q)) || 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([v, n]) => ({ v, n }));
};
const has = (list: unknown, v: unknown) => !Array.isArray(list) || !list.length || list.map(String).includes(String(v));

async function findQ(id: string): Promise<{ q: BankQ; subject: string }> {
  const subject = id.split("_")[0];
  const q = ((await load(`${subject}.json`)).questions as BankQ[]).find((x) => x.id === id);
  if (!q) throw new Error("Question not found");
  return { q, subject };
}

export async function staticApi(path: string, body: any): Promise<any> {
  const p = profile();
  const st = stats(p.attempts);
  if (path === "/me") {
    const today = day(), active = p.lastActive === today || p.lastActive === day(Date.now() - 864e5);
    const xpToday = p.attempts.filter((a) => day(a.at) === today).reduce((s, a) => s + (a.correct ? 10 : 2), 0);
    return { user: { id: 1, email: "", name: "You", role: "student", xp: p.xp, streak: active ? p.streak : 0, dailyGoal: 50, xpToday, activeToday: p.lastActive === today } };
  }
  if (path === "/subjects") {
    const idx = await load("index.json");
    return { subjects: idx.subjects.map((s: any) => {
      const mine = p.attempts.filter((a) => a.s === s.code), x = stats(mine);
      return { ...s, attempted: x.tried.size, mastered: x.mastered.size };
    }).sort((a: any, b: any) => Number(!a.total) - Number(!b.total)) };
  }
  let m = path.match(/^\/subjects\/(\d+)$/);
  if (m) {
    const idx = await load("index.json");
    const subject = idx.subjects.find((s: any) => s.code === m![1]);
    if (!subject || !subject.total) throw new Error("No questions for this subject yet");
    const bank = await load(`${m[1]}.json`);
    const qs = bank.questions as BankQ[];
    const names = [...new Set(qs.map((q) => q.topic || "Unclassified"))].sort((a, b) => ((bank.topics.indexOf(a) + 1) || 999) - ((bank.topics.indexOf(b) + 1) || 999));
    const topics = names.map((name) => {
      const list = qs.filter((q) => (q.topic || "Unclassified") === name);
      return { name, total: list.length, attempted: list.filter((q) => st.tried.has(q.id)).length, mastered: list.filter((q) => st.mastered.has(q.id)).length };
    });
    return { subject, topics, years: facet(qs, (q) => q.year), sessions: facet(qs, (q) => q.session).map((s) => ({ ...s, label: SESSION_NAMES[s.v as string] })),
      papers: facet(qs, (q) => q.paper), types: facet(qs, (q) => q.type), difficulties: facet(qs, (q) => q.difficulty) };
  }
  if (path === "/practice/start") {
    const qs = ((await load(`${body.subject}.json`)).questions as BankQ[]).filter((q) =>
      has(body.topics, q.topic || "Unclassified") && has(body.years, q.year) && has(body.sessions, q.session) && has(body.papers, q.paper) &&
      has(body.types, q.type) && has(body.difficulties, q.difficulty) &&
      (body.mode === "unseen" ? !st.tried.has(q.id) : body.mode === "mistakes" ? st.last.get(q.id) === false : true));
    // unseen first, then last-wrong, then the rest; random within each group
    const rank = (q: BankQ) => (!st.tried.has(q.id) ? 0 : st.last.get(q.id) === false ? 1 : 2) + Math.random();
    const picked = qs.map((q) => ({ q, r: rank(q) })).sort((a, b) => a.r - b.r).slice(0, Math.min(40, Math.max(1, Number(body.count) || 10)));
    return { questions: picked.sort(() => Math.random() - 0.5).map((x) => present(x.q)) };
  }
  if (path === "/practice/answer") {
    const { q, subject } = await findQ(body.questionId);
    const correct = body.answer === q.answer;
    return { correct, answer: q.answer, explanation: q.explanation, ...record(q, subject, correct, correct ? 1 : 0, 1, correct ? 10 : 2) };
  }
  m = path.match(/^\/practice\/solution\/(.+)$/);
  if (m) {
    const { q } = await findQ(decodeURIComponent(m[1]));
    return { parts: q.parts, msImages: q.msImages.map(img), marks: q.marks, msVisual: q.msVisual };
  }
  if (path === "/practice/self-mark") {
    const { q, subject } = await findQ(body.questionId);
    const max = Math.max(1, q.marks), score = Math.min(max, Math.max(0, Number(body.score) || 0));
    const correct = score / max >= 0.7;
    return { correct, ...record(q, subject, correct, score, max, 2 + Math.round((score / max) * 13)) };
  }
  if (path === "/progress") {
    const idx = await load("index.json");
    const subj = new Map<string, any>(idx.subjects.map((s: any) => [s.code, s]));
    const days = new Map<string, { day: string; attempts: number; correct: number }>();
    const topics = new Map<string, any>();
    for (const a of p.attempts) {
      const d = days.get(day(a.at)) || { day: day(a.at), attempts: 0, correct: 0 };
      d.attempts++; d.correct += a.correct ? 1 : 0; days.set(d.day, d);
      const s = subj.get(a.s), k = `${a.s}|${a.topic}`;
      const t = topics.get(k) || { code: a.s, subject: s?.name || a.s, level: s?.level, icon: s?.icon || "📘", topic: a.topic, attempts: 0, correct: 0 };
      t.attempts++; t.correct += a.correct ? 1 : 0; topics.set(k, t);
    }
    return {
      totals: { attempts: p.attempts.length, correct: p.attempts.filter((a) => a.correct).length, questions: st.tried.size },
      days: [...days.values()], topics: [...topics.values()].sort((a, b) => a.subject.localeCompare(b.subject) || b.attempts - a.attempts),
      recent: p.attempts.slice(-20).reverse().map((a, k) => ({ id: k, correct: a.correct, score: a.score, max_score: a.max, type: a.type, topic: a.topic, label: a.source })),
      leaderboard: [],
    };
  }
  throw new Error("Not available in the static site");
}
