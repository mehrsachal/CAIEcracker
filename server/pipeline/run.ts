// Per-paper pipeline. Each stage is idempotent and checkpointed in papers.stage,
// so a crash or retry resumes where it stopped:
//   download -> segment -> enrich -> done
import fs from "fs";
import path from "path";
import { IMG_DIR } from "../config";
import { db, getSetting, logPaper } from "../db";
import { topicsFor } from "../catalog";
import { ensureFile, localPath, PaperRef } from "./sources";
import { buildSegments, findMarkSchemeStarts, findQuestionStarts, openPdf, parseAnswerKey, renderSegment } from "./pdf";
import { AiUnavailableError, BudgetError, enrichMcq, enrichStructured, McqIn, McqOut, readAnswerKey, aiReady } from "./ai";

export class SkipPaper extends Error {}
const AI_SCALE = 1.35;

interface PaperRow extends PaperRef { id: number; subject_code: string; stage: string; type: string | null }

function setPaper(id: number, fields: Record<string, any>) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE papers SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => fields[k]), id);
}

export async function processPaper(paperId: number) {
  const row = db.prepare("SELECT * FROM papers WHERE id=?").get(paperId) as any;
  if (!row) return;
  const paper: PaperRow = { ...row, code: row.subject_code };
  setPaper(paperId, { status: "processing", error: null });

  if (paper.stage === "download") {
    await stageDownload(paper);
    setPaper(paperId, { stage: (paper.stage = "segment") });
  }
  if (paper.stage === "segment") {
    await stageSegment(paper);
    setPaper(paperId, { stage: (paper.stage = "enrich") });
  }
  if (paper.stage === "enrich") {
    await stageEnrich(paper);
    setPaper(paperId, { stage: "done" });
  }
  finalize(paperId);
}

export function finalize(paperId: number) {
  const c = db.prepare(`SELECT COUNT(*) total,
    SUM(status='needs_review') review, SUM(status='pending') pending, SUM(status='image_only') image_only
    FROM questions WHERE paper_id=?`).get(paperId) as any;
  const status = c.pending ? "partial" : "done";
  const fields: Record<string, any> = { status, question_count: c.total, review_count: (c.review || 0) };
  if (getSetting("auto_publish") === "1") fields.published = 1;
  setPaper(paperId, fields);
  logPaper(paperId, "info", `Finished: ${c.total} questions, ${c.review || 0} need review, ${c.image_only || 0} image-only, ${c.pending || 0} awaiting AI`);
}

async function stageDownload(p: PaperRow) {
  const qp = await ensureFile(p, "qp");
  if (!qp) throw new SkipPaper("Question paper not found on any mirror");
  const ms = await ensureFile(p, "ms");
  if (!ms) throw new SkipPaper("Mark scheme not found on any mirror");
  setPaper(p.id, { qp_source: qp, ms_source: ms });
  logPaper(p.id, "info", `Downloaded QP (${qp}) and MS (${ms})`);
}

function saveImages(paperId: number, prefix: string, bufs: Buffer[]): string[] {
  const dir = path.join(IMG_DIR, String(paperId));
  fs.mkdirSync(dir, { recursive: true });
  return bufs.map((b, i) => {
    const name = `${prefix}_${i}.png`;
    fs.writeFileSync(path.join(dir, name), b);
    return `${paperId}/${name}`;
  });
}

async function stageSegment(p: PaperRow) {
  const qp = openPdf(localPath(p, "qp"));
  const ms = openPdf(localPath(p, "ms"));
  const starts = findQuestionStarts(qp);
  if (starts.length < 2) throw new SkipPaper("Could not find numbered questions in the question paper (scanned PDF or unsupported layout)");
  const segs = buildSegments(qp, starts);

  let key = parseAnswerKey(ms);
  const isMcq = segs.length >= 10 && key.size >= segs.length * 0.6;
  let type = isMcq ? "mcq" : "structured";
  if (isMcq && segs.some((s) => !key.has(s.number)) && aiReady().ok) {
    logPaper(p.id, "warn", `Answer key incomplete (${key.size}/${segs.length}) — asking AI to read the mark scheme`);
    try {
      const aiKey = await readAnswerKey(p.id, fs.readFileSync(localPath(p, "ms")));
      for (const [n, a] of aiKey) if (!key.has(n)) key.set(n, a);
    } catch (e: any) { logPaper(p.id, "warn", `AI answer-key fallback failed: ${e.message}`); }
  }

  const msSegs = new Map<number, ReturnType<typeof buildSegments>[number]>();
  if (!isMcq) for (const s of buildSegments(ms, findMarkSchemeStarts(ms))) msSegs.set(s.number, s);

  // Render outside the transaction, then swap rows in atomically.
  const rows = segs.map((seg) => {
    const images = saveImages(p.id, `q${seg.number}`, renderSegment(qp, seg, 2));
    saveImages(p.id, `ai_q${seg.number}`, renderSegment(qp, seg, AI_SCALE)); // smaller copies keep AI input cheap
    const msSeg = msSegs.get(seg.number);
    const msImages = msSeg ? saveImages(p.id, `ms${seg.number}`, renderSegment(ms, msSeg, 2)) : [];
    if (msSeg) saveImages(p.id, `ai_ms${seg.number}`, renderSegment(ms, msSeg, AI_SCALE));
    return { seg, images, msImages, msText: msSeg?.text || "" };
  });
  db.transaction(() => {
    db.prepare("DELETE FROM questions WHERE paper_id=?").run(p.id);
    const ins = db.prepare(`INSERT INTO questions(paper_id,number,type,display,text,answer,images,ms_images,status,review_note,explanation)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) {
      if (!r.images.length) continue;
      const answer = isMcq ? key.get(r.seg.number) ?? null : null;
      let status = "pending", note: string | null = null;
      if (isMcq && !answer) { status = "needs_review"; note = "No answer found in mark scheme"; }
      if (!isMcq && !r.msImages.length) { status = "needs_review"; note = "No mark scheme section found for this question"; }
      // explanation column temporarily carries the MS text layer for the enrich stage (structured only)
      ins.run(p.id, r.seg.number, type, "image", r.seg.text, answer, JSON.stringify(r.images), JSON.stringify(r.msImages), status, note, isMcq ? null : r.msText);
    }
  })();
  setPaper(p.id, { type });
  logPaper(p.id, "info", `Segmented ${rows.length} ${type} questions`);
}

function loadImgs(list: string, max = 6): Buffer[] {
  return (JSON.parse(list) as string[]).slice(0, max).map((f) => {
    const small = path.join(IMG_DIR, path.dirname(f), "ai_" + path.basename(f));
    return fs.readFileSync(fs.existsSync(small) ? small : path.join(IMG_DIR, f));
  });
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function clampDiff(d: number) { return Math.min(3, Math.max(1, Math.round(d) || 2)); }

function resolveTopic(subject: string, topics: string[], t: string): string {
  const hit = topics.find((x) => x.toLowerCase() === t.trim().toLowerCase());
  if (hit) return hit;
  const name = t.trim().slice(0, 80) || "General";
  db.prepare("INSERT OR IGNORE INTO topics(subject_code,name,position) VALUES(?,?,999)").run(subject, name);
  return name;
}

export async function stageEnrich(p: PaperRow) {
  const subj = db.prepare("SELECT * FROM subjects WHERE code=?").get(p.subject_code) as any;
  const subjectLabel = `Cambridge ${subj.level === "A" ? "International AS & A Level" : "O Level"} ${subj.name} (${subj.code})`;
  const topics = topicsFor(p.subject_code);
  const pending = db.prepare("SELECT * FROM questions WHERE paper_id=? AND status='pending' ORDER BY number").all(p.id) as any[];
  if (!pending.length) return;

  const ready = aiReady();
  if (!ready.ok) {
    logPaper(p.id, "warn", `AI enrichment skipped: ${ready.reason}. Questions stay usable as images; run "Enrich" later.`);
    return; // questions stay 'pending' -> paper 'partial', still served image-only
  }
  let aborted: string | null = null;

  if (pending[0].type === "mcq") {
    const save = db.prepare(`UPDATE questions SET text=?, options=?, display=?, topic=?, subtopic=?, difficulty=?, explanation=?, status=?, review_note=? WHERE id=?`);
    const apply = (q: any, o: McqOut) => {
      const opts = { A: o.option_a.trim(), B: o.option_b.trim(), C: o.option_c.trim(), D: o.option_d.trim() };
      const textual = !o.needs_image && Object.values(opts).every(Boolean) && o.stem.trim().length > 5;
      const flag = o.key_looks_wrong;
      save.run(o.stem.trim(), JSON.stringify(opts), textual ? "text" : "image", resolveTopic(p.subject_code, topics, o.topic), o.subtopic.trim(),
        clampDiff(o.difficulty), o.explanation.trim(), flag ? "needs_review" : "ok", flag ? "AI disagrees with the official answer key — check the crop and key" : null, q.id);
    };
    const run = async (chunk: any[], depth = 0): Promise<void> => {
      if (aborted) return;
      const input: McqIn[] = chunk.map((q) => ({ number: q.number, answer: q.answer, text: q.text || "", images: loadImgs(q.images, 3) }));
      try {
        const out = await enrichMcq(p.id, subjectLabel, topics, input);
        const byNum = new Map(out.map((o) => [o.number, o]));
        const missing: any[] = [];
        db.transaction(() => { for (const q of chunk) { const o = byNum.get(q.number); o ? apply(q, o) : missing.push(q); } })();
        if (missing.length && depth < 2) await run(missing, depth + 1);
        else for (const q of missing) markImageOnly(q.id, "AI did not return this question");
      } catch (e: any) {
        if (e instanceof BudgetError || e instanceof AiUnavailableError) { aborted = e.message; return; }
        if (chunk.length > 1 && depth < 3) {
          const mid = Math.ceil(chunk.length / 2);
          await run(chunk.slice(0, mid), depth + 1); await run(chunk.slice(mid), depth + 1);
        } else {
          logPaper(p.id, "warn", `Q${chunk.map((q) => q.number).join(",")}: AI failed (${e.message}) — kept as image-only`);
          for (const q of chunk) markImageOnly(q.id, `AI enrichment failed: ${String(e.message).slice(0, 200)}`);
        }
      }
    };
    const chunks: any[][] = [];
    for (let i = 0; i < pending.length; i += 8) chunks.push(pending.slice(i, i + 8));
    await pool(chunks, 3, (c) => run(c));
  } else {
    const save = db.prepare(`UPDATE questions SET text=?, parts=?, marks=?, display=?, topic=?, subtopic=?, difficulty=?, explanation=NULL, status='ok', review_note=NULL WHERE id=?`);
    await pool(pending, 3, async (q) => {
      if (aborted) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const o = await enrichStructured(p.id, subjectLabel, topics, { number: q.number, images: loadImgs(q.images, 6), msImages: loadImgs(q.ms_images, 5), text: q.text || "", msText: q.explanation || "" });
          if (!o.parts.length) throw new Error("no parts returned");
          const marks = o.parts.reduce((s, x) => s + Math.max(0, x.marks), 0) || 1;
          save.run(o.question_text.trim(), JSON.stringify(o.parts), marks, o.needs_image ? "image" : "text", resolveTopic(p.subject_code, topics, o.topic), o.subtopic.trim(), clampDiff(o.difficulty), q.id);
          return;
        } catch (e: any) {
          if (e instanceof BudgetError || e instanceof AiUnavailableError) { aborted = e.message; return; }
          if (attempt === 1) {
            logPaper(p.id, "warn", `Q${q.number}: AI failed (${e.message}) — kept as image-only`);
            markImageOnly(q.id, `AI enrichment failed: ${String(e.message).slice(0, 200)}`);
          }
        }
      }
    });
  }
  if (aborted) logPaper(p.id, "warn", `AI enrichment stopped: ${aborted}. Remaining questions stay image-only until re-enriched.`);
}

function markImageOnly(id: number, note: string) {
  db.prepare("UPDATE questions SET status='image_only', display='image', review_note=? WHERE id=?").run(note, id);
}
