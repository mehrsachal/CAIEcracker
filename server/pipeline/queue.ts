// Durable job queue in SQLite: survives restarts, retries with backoff, and
// separates "this paper does not exist" (skipped) from real failures.
import { db, getSetting, logPaper } from "../db";
import { processPaper, SkipPaper } from "./run";
import { candidateComponents, ensureFile } from "./sources";

const MAX_ATTEMPTS = 5;
const CONCURRENCY = 2;
let running = 0;

export function enqueuePaper(paperId: number, opts: { fromStage?: string } = {}) {
  if (opts.fromStage) db.prepare("UPDATE papers SET stage=?, status='queued', error=NULL WHERE id=?").run(opts.fromStage, paperId);
  else db.prepare("UPDATE papers SET status='queued', error=NULL WHERE id=?").run(paperId);
  const existing = db.prepare("SELECT id FROM jobs WHERE paper_id=? AND kind='paper' AND status IN ('queued','running')").get(paperId);
  if (!existing) db.prepare("INSERT INTO jobs(paper_id,kind) VALUES(?, 'paper')").run(paperId);
}

export function enqueueDiscover(code: string, year: number, session: string) {
  const payload = JSON.stringify({ code, year, session });
  const dup = db.prepare("SELECT id FROM jobs WHERE kind='discover' AND payload=? AND status IN ('queued','running')").get(payload);
  if (!dup) db.prepare("INSERT INTO jobs(kind,payload) VALUES('discover',?)").run(payload);
}

export function upsertPaper(code: string, year: number, session: string, component: string): number {
  db.prepare("INSERT OR IGNORE INTO papers(subject_code,year,session,component) VALUES(?,?,?,?)").run(code, year, session, component);
  return (db.prepare("SELECT id FROM papers WHERE subject_code=? AND year=? AND session=? AND component=?").get(code, year, session, component) as any).id;
}

async function discover(payload: { code: string; year: number; session: string }) {
  let found = 0;
  for (const component of candidateComponents(payload.session)) {
    const ref = { ...payload, component };
    // Probe the two flat mirrors only; a full mirror sweep happens when the paper itself is processed.
    const src = await ensureFile(ref, "qp", { mirrors: 2 }).catch(() => null);
    if (!src) continue;
    found++;
    const existing = db.prepare("SELECT id,status FROM papers WHERE subject_code=? AND year=? AND session=? AND component=?").get(payload.code, payload.year, payload.session, component) as any;
    if (existing && existing.status !== "failed" && existing.status !== "skipped") continue;
    const id = upsertPaper(payload.code, payload.year, payload.session, component);
    enqueuePaper(id, { fromStage: "download" });
  }
  logPaper(null, "info", `Discovery ${payload.code} ${payload.session}${payload.year}: ${found} question papers found`);
}

async function runJob(job: any) {
  try {
    if (job.kind === "discover") await discover(JSON.parse(job.payload));
    else await processPaper(job.paper_id);
    db.prepare("UPDATE jobs SET status='done', error=NULL, updated_at=datetime('now') WHERE id=?").run(job.id);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 1000);
    if (e instanceof SkipPaper) {
      db.prepare("UPDATE jobs SET status='skipped', error=?, updated_at=datetime('now') WHERE id=?").run(msg, job.id);
      if (job.paper_id) { db.prepare("UPDATE papers SET status='skipped', error=?, updated_at=datetime('now') WHERE id=?").run(msg, job.paper_id); logPaper(job.paper_id, "warn", msg); }
      return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE jobs SET status='failed', attempts=?, error=?, updated_at=datetime('now') WHERE id=?").run(attempts, msg, job.id);
      if (job.paper_id) db.prepare("UPDATE papers SET status='failed', error=?, updated_at=datetime('now') WHERE id=?").run(msg, job.paper_id);
      logPaper(job.paper_id, "error", `Gave up after ${attempts} attempts: ${msg}`);
    } else {
      const delay = 20 * 2 ** attempts; // 40s, 80s, 160s, 320s
      db.prepare("UPDATE jobs SET status='queued', attempts=?, error=?, run_after=datetime('now', ?), updated_at=datetime('now') WHERE id=?").run(attempts, msg, `+${delay} seconds`, job.id);
      if (job.paper_id) db.prepare("UPDATE papers SET status='retrying', error=? WHERE id=?").run(msg, job.paper_id);
      logPaper(job.paper_id, "warn", `Attempt ${attempts} failed (${msg}); retrying in ${delay}s`);
    }
  }
}

function tick() {
  if (getSetting("worker_paused") === "1") return;
  while (running < CONCURRENCY) {
    const job = db.prepare("SELECT * FROM jobs WHERE status='queued' AND run_after <= datetime('now') ORDER BY kind='discover' DESC, id LIMIT 1").get() as any;
    if (!job) return;
    db.prepare("UPDATE jobs SET status='running', updated_at=datetime('now') WHERE id=?").run(job.id);
    running++;
    runJob(job).catch((e) => console.error("job runner crashed", e)).finally(() => { running--; });
  }
}

export function startWorker() {
  // Anything left "running" by a previous process is resumed from its checkpoint.
  db.prepare("UPDATE jobs SET status='queued' WHERE status='running'").run();
  setInterval(tick, 1500);
}
