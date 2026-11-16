// Export the published question bank as static files for GitHub Pages:
//   web/public/bank/index.json, web/public/bank/<code>.json, web/public/bank/img/...
//   npx tsx scripts/export-static.ts
import fs from "fs";
import path from "path";
import { IMG_DIR } from "../server/config";
import { db } from "../server/db";

const OUT = path.resolve("web/public/bank");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
const SESSION_NAMES: Record<string, string> = { m: "Feb/March", s: "May/June", w: "Oct/Nov" };

function copyImgs(list: string, prefix: string): string[] {
  return (JSON.parse(list) as string[]).map((f) => {
    const name = `${prefix}_${path.basename(f)}`;
    fs.copyFileSync(path.join(IMG_DIR, f), path.join(OUT, "img", name));
    return name;
  });
}

const index: any[] = [];
for (const s of db.prepare("SELECT * FROM subjects ORDER BY level DESC, name").all() as any[]) {
  const rows = db.prepare(`SELECT q.*, p.year, p.session, p.component FROM questions q JOIN papers p ON p.id=q.paper_id
    WHERE p.subject_code=? AND p.published=1 AND q.status IN ('ok','image_only','pending')
      AND ((q.type='mcq' AND q.answer IS NOT NULL) OR (q.type='structured' AND (q.ms_images!='[]' OR q.parts IS NOT NULL)))
    ORDER BY p.year, p.session, p.component, q.number`).all(s.code) as any[];
  const questions = rows.map((q) => {
    const ok = q.status === "ok";
    const key = `${s.code}_${q.session}${String(q.year % 100).padStart(2, "0")}_${q.component}`;
    return {
      id: `${key}_${q.number}`, type: q.type, display: ok ? q.display : "image",
      text: ok ? q.text : null, options: ok && q.options ? JSON.parse(q.options) : null,
      answer: q.answer, explanation: ok && q.type === "mcq" ? q.explanation : null,
      parts: ok && q.parts ? JSON.parse(q.parts) : null, marks: q.type === "mcq" ? 1 : q.marks,
      msVisual: !!q.ms_visual,
      topic: q.topic, subtopic: q.subtopic, difficulty: q.difficulty,
      year: q.year, session: q.session, paper: String(q.component)[0],
      source: `${s.code}/${q.component} · ${SESSION_NAMES[q.session]} ${q.year} · Q${q.number}`,
      images: copyImgs(q.images, key), msImages: copyImgs(q.ms_images, key),
    };
  });
  const topics = (db.prepare("SELECT name FROM topics WHERE subject_code=? ORDER BY position,id").all(s.code) as any[]).map((t) => t.name);
  index.push({ code: s.code, name: s.name, level: s.level, icon: s.icon, total: questions.length });
  if (questions.length) fs.writeFileSync(path.join(OUT, `${s.code}.json`), JSON.stringify({ topics, questions }));
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ subjects: index, exportedAt: new Date().toISOString() }));
console.log(index.filter((s) => s.total).map((s) => `${s.code} ${s.name}: ${s.total}`).join("\n"));
