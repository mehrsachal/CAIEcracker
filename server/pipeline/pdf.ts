// Deterministic PDF segmentation: finds where each question starts using the
// text layer, then renders each question as cropped page images. No AI here,
// so every question always has a faithful image even if AI enrichment fails.
import * as mupdf from "mupdf";
import fs from "fs";

export interface Line { page: number; x: number; y: number; w: number; h: number; text: string; bold: boolean; }
export interface Slice { page: number; y0: number; y1: number; }
export interface Segment { number: number; slices: Slice[]; text: string; }
export interface PdfDoc { doc: mupdf.Document; pages: { w: number; h: number; lines: Line[] }[]; }

export function openPdf(file: string): PdfDoc {
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
  const pages: PdfDoc["pages"] = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const [x0, y0, x1, y1] = page.getBounds();
    const lines: Line[] = [];
    try {
      const st = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
      for (const b of st.blocks || [])
        for (const l of b.lines || []) {
          const text = String(l.text || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          lines.push({ page: p, x: l.bbox.x - x0, y: l.bbox.y - y0, w: l.bbox.w, h: l.bbox.h, text, bold: l.font?.weight === "bold" || /bold/i.test(l.font?.name || "") });
        }
    } catch { /* page without a usable text layer */ }
    lines.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ w: x1 - x0, h: y1 - y0, lines });
  }
  return { doc, pages };
}

const HEADER = 48; // page number / paper header zone (pt)
function footerY(h: number) { return h - 58; }

function bodyLines(pdf: PdfDoc, p: number) {
  const pg = pdf.pages[p];
  return pg.lines.filter((l) => l.y > HEADER && l.y + l.h < footerY(pg.h) + 6);
}

/** Content boundaries (pt) that should end a question on a page: copyright boilerplate etc. */
function pageBottom(pdf: PdfDoc, p: number): number {
  const pg = pdf.pages[p];
  let bottom = footerY(pg.h);
  for (const l of pg.lines) {
    if (/^(Permission to reproduce items|To avoid the issue of disclosure|Cambridge Assessment International Education is part of)/i.test(l.text)) bottom = Math.min(bottom, l.y - 4);
  }
  return bottom;
}

function isSkippablePage(pdf: PdfDoc, p: number): boolean {
  const lines = bodyLines(pdf, p);
  const txt = lines.map((l) => l.text).join(" ");
  if (/BLANK PAGE/.test(txt) && txt.length < 400) return true;
  return false;
}

type Start = { number: number; page: number; y: number };

/** Question paper: a number alone at the left margin, strictly sequential. */
export function findQuestionStarts(pdf: PdfDoc): Start[] {
  const cands: (Line & { n: number })[] = [];
  for (let p = 0; p < pdf.pages.length; p++) {
    for (const l of bodyLines(pdf, p)) {
      const m = l.text.match(/^(\d{1,2})(?:\s*$|\s*\(a\)|\s*\(i\))/) || l.text.match(/^(\d{1,2})\s+\S/);
      if (m && l.x < pdf.pages[p].w * 0.16) cands.push({ ...l, n: Number(m[1]) });
    }
  }
  if (!cands.length) return [];
  // Left margin = most common x among lone-number candidates.
  const hist = new Map<number, number>();
  for (const c of cands) if (/^\d{1,2}$/.test(c.text)) hist.set(Math.round(c.x / 4), (hist.get(Math.round(c.x / 4)) || 0) + 1);
  const best = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  const margin = best ? best[0] * 4 : Math.min(...cands.map((c) => c.x));
  const starts: Start[] = [];
  let expect = 1;
  for (const c of cands) {
    if (Math.abs(c.x - margin) > 9) continue;
    if (c.n !== expect) continue;
    // "5 N of force" style body text: only accept merged lines if they are bold or the number is alone
    if (!/^\d{1,2}$/.test(c.text) && !c.bold && !/^\d{1,2}\s*\(/.test(c.text)) continue;
    starts.push({ number: c.n, page: c.page, y: c.y });
    expect++;
  }
  return starts;
}

/** Mark scheme (structured): first-column cells like "3", "3(a)", "3(b)(ii)". */
export function findMarkSchemeStarts(pdf: PdfDoc): Start[] {
  const starts: Start[] = [];
  let cur = 0;
  for (let p = 0; p < pdf.pages.length; p++) {
    const lines = bodyLines(pdf, p).concat(pdf.pages[p].lines.filter((l) => l.y <= HEADER));
    const hdr = lines.find((l) => /^Question\b/.test(l.text));
    if (!hdr) continue;
    const colMax = Math.max(pdf.pages[p].w * 0.2, hdr.x + hdr.w + 25);
    for (const l of bodyLines(pdf, p)) {
      if (l.x > colMax) continue;
      const m = l.text.match(/^(\d{1,2})\s*((\(\s*[a-z]+\s*\)\s*)*)$/i);
      if (!m) continue;
      const n = Number(m[1]);
      if (n === cur + 1) { starts.push({ number: n, page: p, y: l.y }); cur = n; }
    }
  }
  return starts;
}

/** Turn ordered starts into per-question page slices. */
export function buildSegments(pdf: PdfDoc, starts: Start[], opts: { headerRepeat?: boolean } = {}): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], next = starts[i + 1];
    const lastPage = next ? next.page : pdf.pages.length - 1;
    const slices: Slice[] = [];
    let text = "";
    for (let p = s.page; p <= lastPage; p++) {
      if (p !== s.page && isSkippablePage(pdf, p)) continue;
      const y0 = p === s.page ? s.y - 5 : HEADER + 2;
      const y1 = next && p === next.page ? next.y - 5 : pageBottom(pdf, p);
      if (y1 - y0 < 8) continue;
      slices.push({ page: p, y0, y1 });
      text += bodyLines(pdf, p).filter((l) => l.y >= y0 - 1 && l.y < y1).map((l) => l.text).join("\n") + "\n";
    }
    segs.push({ number: s.number, slices, text: text.trim() });
  }
  return segs;
}

// ---------- rendering ----------
const inkCache = new WeakMap<PdfDoc, Map<number, { scale: number; rows: Uint8Array; left: number; right: number }>>();

/** Per-row "has ink" profile of a page so we can trim blank space around crops. */
function inkProfile(pdf: PdfDoc, p: number) {
  let m = inkCache.get(pdf);
  if (!m) inkCache.set(pdf, (m = new Map()));
  const hit = m.get(p);
  if (hit) return hit;
  const scale = 1;
  const page = pdf.doc.loadPage(p);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false);
  const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride(), px = pix.getPixels();
  const rows = new Uint8Array(h);
  let left = w, right = 0;
  const mx = Math.round(w * 0.04);
  for (let y = 0; y < h; y++) {
    const off = y * stride;
    for (let x = mx; x < w - mx; x++) {
      if (px[off + x] < 200) { rows[y] = 1; if (x < left) left = x; if (x > right) right = x; }
    }
  }
  pix.destroy();
  const prof = { scale, rows, left, right };
  m.set(p, prof);
  return prof;
}

/** Shrink a slice to its inked area. Returns null if the slice is blank. */
export function trimSlice(pdf: PdfDoc, s: Slice): Slice | null {
  const prof = inkProfile(pdf, s.page);
  let a = Math.max(0, Math.floor(s.y0 * prof.scale)), b = Math.min(prof.rows.length - 1, Math.ceil(s.y1 * prof.scale));
  while (a <= b && !prof.rows[a]) a++;
  while (b >= a && !prof.rows[b]) b--;
  if (b - a < 4) return null;
  return { page: s.page, y0: Math.max(s.y0, a / prof.scale - 6), y1: Math.min(s.y1, b / prof.scale + 6) };
}

export function renderSlice(pdf: PdfDoc, s: Slice, scale = 2): Buffer {
  const pg = pdf.pages[s.page];
  const page = pdf.doc.loadPage(s.page);
  const [bx0, by0] = page.getBounds();
  const mx = pg.w * 0.045;
  const bbox: [number, number, number, number] = [
    Math.floor((bx0 + mx) * scale), Math.floor((by0 + s.y0) * scale),
    Math.ceil((bx0 + pg.w - mx) * scale), Math.ceil((by0 + s.y1) * scale),
  ];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  const png = Buffer.from(pix.asPNG());
  pix.destroy();
  return png;
}

const NOISE = /^(BLANK PAGE|Question|Answer|Marks?|Guidance|Partial Marks|\[?Turn over\]?|Space for working\.?|Additional page.*|PMT)$/i;

/** Render every slice of a segment, dropping blank / boilerplate-only ones. */
export function renderSegment(pdf: PdfDoc, seg: Segment, scale = 2): Buffer[] {
  const out: Buffer[] = [];
  for (const s of seg.slices) {
    const t = trimSlice(pdf, s);
    if (!t) continue;
    const lines = pdf.pages[s.page].lines.filter((l) => l.y >= s.y0 - 1 && l.y < s.y1);
    const real = lines.filter((l) => !l.text.split(/\s{2,}| (?=Answer|Marks|Guidance)/).every((x) => NOISE.test(x.trim())));
    const blankPage = lines.some((l) => /BLANK PAGE/.test(l.text));
    if (!real.length && (blankPage || t.y1 - t.y0 < 45)) continue;
    if (t.y1 - t.y0 < 14) continue;
    out.push(renderSlice(pdf, t, scale));
  }
  return out;
}

// ---------- MCQ answer key ----------
/** Parse an MCQ mark scheme table into { questionNumber: 'A'..'D' }. Works for
 *  both the modern one-per-row layout and older multi-column key grids. */
export function parseAnswerKey(pdf: PdfDoc): Map<number, string> {
  const key = new Map<number, string>();
  for (let p = 0; p < pdf.pages.length; p++) {
    const rows = new Map<number, Line[]>();
    for (const l of pdf.pages[p].lines) {
      const k = Math.round((l.y + l.h / 2) / 5);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k)!.push(l);
    }
    for (const row of rows.values()) {
      const toks = row.sort((a, b) => a.x - b.x).flatMap((l) => l.text.split(/\s+/));
      for (let i = 0; i + 1 < toks.length; i++) {
        if (/^\d{1,2}$/.test(toks[i]) && /^[A-D]$/.test(toks[i + 1])) {
          const n = Number(toks[i]);
          if (n >= 1 && n <= 60 && !key.has(n)) key.set(n, toks[i + 1]);
          i++;
        }
      }
    }
  }
  return key;
}

export function looksLikePdf(buf: Buffer) {
  return buf.length > 8000 && buf.subarray(0, 5).toString() === "%PDF-";
}
