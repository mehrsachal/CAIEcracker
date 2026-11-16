// Past-paper discovery and download with several independent mirrors.
import fs from "fs";
import path from "path";
import { PDF_DIR } from "../config";
import { db } from "../db";
import { looksLikePdf } from "./pdf";

export type Kind = "qp" | "ms";
export interface PaperRef { code: string; year: number; session: string; component: string }

export function fileName(p: PaperRef, kind: Kind) {
  return `${p.code}_${p.session}${String(p.year % 100).padStart(2, "0")}_${kind}_${p.component}.pdf`;
}
export function localPath(p: PaperRef, kind: Kind) { return path.join(PDF_DIR, fileName(p, kind)); }

const SESSION_DIR: Record<string, string> = { m: "March", s: "May-June", w: "Oct-Nov" };
function slug(s: string) { return s.replace(/\(.*?\)/g, "").trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

/** Ordered list of candidate URLs for a file. Flat mirrors first (no naming guesswork). */
export function candidateUrls(p: PaperRef, kind: Kind): { source: string; url: string }[] {
  const f = fileName(p, kind);
  const subj = db.prepare("SELECT name, level FROM subjects WHERE code=?").get(p.code) as { name: string; level: string } | undefined;
  const out = [
    { source: "papacambridge", url: `https://pastpapers.papacambridge.com/directories/CAIE/CAIE-pastpapers/upload/${f}` },
    { source: "dynamicpapers", url: `https://dynamicpapers.com/wp-content/uploads/2015/09/${f}` },
  ];
  if (subj) {
    const lvl = subj.level === "A" ? "cambridge-international-a-level" : "cambridge-o-level";
    out.push({ source: "bestexamhelp", url: `https://bestexamhelp.com/exam/${lvl}/${slug(subj.name).toLowerCase()}-${p.code}/${p.year}/${f}` });
    out.push({ source: "pastpapers.co", url: `https://pastpapers.co/cie/${subj.level === "A" ? "A-Level" : "O-Level"}/${slug(subj.name)}-${p.code}/${p.year}-${SESSION_DIR[p.session]}/${f}` });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Fetched = { ok: true; buf: Buffer } | { ok: false; missing: boolean; reason: string };

async function fetchPdf(url: string): Promise<Fetched> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow", signal: AbortSignal.timeout(45000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; past-paper-indexer)", Accept: "application/pdf,*/*" },
      });
      if (res.status === 404 || res.status === 410) return { ok: false, missing: true, reason: "404" };
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && looksLikePdf(buf)) return { ok: true, buf };
      // 200 with an HTML "not found" page, or 403: treat as missing on this mirror
      return { ok: false, missing: res.ok || (res.status >= 400 && res.status < 500), reason: `HTTP ${res.status}, not a PDF` };
    } catch (e: any) {
      if (attempt === 2) return { ok: false, missing: false, reason: e?.message || "network error" };
      await sleep(1500 * (attempt + 1));
    }
  }
  return { ok: false, missing: false, reason: "server kept failing" };
}

/** Download a paper file (cached on disk). Returns source name, or null if no mirror has it.
 *  Throws only when every mirror errored without a definitive "missing" (so the job retries). */
export async function ensureFile(p: PaperRef, kind: Kind, opts: { mirrors?: number } = {}): Promise<string | null> {
  const dest = localPath(p, kind);
  if (fs.existsSync(dest) && looksLikePdf(fs.readFileSync(dest))) return "cache";
  let transient = "";
  for (const c of candidateUrls(p, kind).slice(0, opts.mirrors ?? 99)) {
    const r = await fetchPdf(c.url);
    if (r.ok) {
      fs.writeFileSync(dest + ".tmp", r.buf);
      fs.renameSync(dest + ".tmp", dest);
      return c.source;
    }
    if (!r.missing) transient = `${c.source}: ${r.reason}`;
    await sleep(250);
  }
  if (transient && opts.mirrors === undefined) throw new Error(`Download failed (${fileName(p, kind)}): ${transient}`);
  return null;
}

/** All component codes worth probing for a session. */
export function candidateComponents(session: string): string[] {
  const out: string[] = [];
  for (let paper = 1; paper <= 6; paper++) {
    for (const v of session === "m" ? [2] : [1, 2, 3]) out.push(`${paper}${v}`);
  }
  for (let paper = 1; paper <= 6; paper++) out.push(String(paper)); // older single-variant papers
  return out;
}
