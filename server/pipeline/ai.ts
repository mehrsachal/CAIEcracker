// AI enrichment: transcribes already-segmented questions, classifies topic and
// writes solution reasoning. Output is schema-constrained; failures never lose
// a question (the caller falls back to the image-only version).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db, getSetting } from "../db";

const PRICES: Record<string, [number, number]> = { // USD per million tokens [input, output]
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-fable-5-2": [8, 40],
};
export const MODELS = Object.keys(PRICES);

export class BudgetError extends Error {}
export class AiUnavailableError extends Error {}

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiUnavailableError("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic({ maxRetries: 4, timeout: 240_000 }));
}

export function aiSpend(): number {
  return (db.prepare("SELECT COALESCE(SUM(cost_usd),0) c FROM ai_usage").get() as any).c;
}
export function aiReady(): { ok: boolean; reason?: string } {
  if (getSetting("ai_enabled") !== "1") return { ok: false, reason: "AI enrichment is switched off in settings" };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
  if (aiSpend() >= Number(getSetting("ai_budget_usd"))) return { ok: false, reason: `AI budget of $${getSetting("ai_budget_usd")} reached` };
  return { ok: true };
}

type Content = Anthropic.ContentBlockParam[];
const img = (png: Buffer): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
const txt = (text: string): Anthropic.TextBlockParam => ({ type: "text", text });

async function callJson<T>(paperId: number, purpose: string, schema: z.ZodType<T>, system: string, content: Content, maxTokens = 16000): Promise<T> {
  const ready = aiReady();
  if (!ready.ok) throw (ready.reason!.includes("budget") ? new BudgetError(ready.reason) : new AiUnavailableError(ready.reason));
  const model = getSetting("ai_model");
  const effort = (getSetting("ai_effort") || "low") as "low" | "medium" | "high";
  let res;
  try {
    res = await getClient().messages.parse({
      model, max_tokens: maxTokens, system,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(schema), effort },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiUnavailableError(`API key rejected: ${e.message}`);
    throw e;
  }
  const [pi, po] = PRICES[model] || [5, 25];
  const u = res.usage;
  const inTok = u.input_tokens + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  db.prepare("INSERT INTO ai_usage(paper_id,model,purpose,input_tokens,output_tokens,cost_usd) VALUES(?,?,?,?,?,?)")
    .run(paperId, model, purpose, inTok, u.output_tokens, (inTok * pi + u.output_tokens * po) / 1e6);
  if (res.stop_reason === "refusal") throw new Error("model declined the request");
  if (res.stop_reason === "max_tokens") throw new Error("response truncated (max_tokens)");
  if (!res.parsed_output) throw new Error("model returned unparseable output");
  return res.parsed_output;
}

const FORMAT_RULES = `Formatting rules for every text field:
- Plain text with light Markdown (**bold**, *italic*). Put ALL maths, symbols with sub/superscripts, units with powers and chemical formulae in LaTeX between single dollar signs, e.g. $4.2\\,\\text{m s}^{-1}$, $\\text{H}_2\\text{SO}_4$, $x^2+3x$.
- Transcribe faithfully; never paraphrase, never fix or "improve" the question. Do not include the question number.
- Use a blank line between paragraphs.`;

// ---------- MCQ ----------
const McqSchema = z.object({
  questions: z.array(z.object({
    number: z.number().int(),
    stem: z.string().describe("Question text without the options"),
    option_a: z.string(), option_b: z.string(), option_c: z.string(), option_d: z.string(),
    needs_image: z.boolean().describe("true if the question cannot be fully and faithfully understood from stem + option text alone: any diagram, graph, picture, circuit, structural formula, complex table, or options that are drawings/graphs/table rows"),
    topic: z.string(), subtopic: z.string().describe("2-5 word finer-grained topic"),
    difficulty: z.number().int().describe("1 easy, 2 medium, 3 hard"),
    explanation: z.string().describe("Step-by-step reasoning leading to the official answer, plus one short line on the most tempting wrong option"),
    key_looks_wrong: z.boolean().describe("true only if you are confident the official answer given cannot be right for this question"),
  })),
});
export type McqOut = z.infer<typeof McqSchema>["questions"][number];

export interface McqIn { number: number; answer: string | null; images: Buffer[]; text: string }

export async function enrichMcq(paperId: number, subject: string, topics: string[], qs: McqIn[]): Promise<McqOut[]> {
  const system = `You convert Cambridge International exam multiple-choice questions into structured data for a revision app. You are given, for each question, its image exactly as printed, the raw PDF text layer (may be garbled; the image is the source of truth) and the official answer from the published mark scheme.

${FORMAT_RULES}
- If options are drawings/graphs or rows of a table, set needs_image=true and put a short description in each option field (e.g. the row's values separated by " | "), or "" if not describable.
- The explanation must justify the official answer with correct subject reasoning a student can follow (working shown for calculations). Keep it under 120 words.
- topic must be copied exactly from the allowed topic list when one is provided.`;
  const content: Content = [txt(`Subject: ${subject}\nAllowed topics:\n${topics.length ? topics.map((t) => `- ${t}`).join("\n") : "(none provided: choose a concise syllabus topic name)"}\n\nReturn one entry per question below, same numbers, same order.`)];
  for (const q of qs) {
    content.push(txt(`\n=== Question ${q.number} — official answer: ${q.answer ?? "unknown"} ===\nText layer:\n${q.text.slice(0, 1500)}`));
    for (const b of q.images) content.push(img(b));
  }
  const out = await callJson(paperId, "mcq", McqSchema, system, content);
  return out.questions;
}

// ---------- Structured / theory ----------
const StructSchema = z.object({
  question_text: z.string().describe("Full question transcription including all parts, with part labels like (a), (b)(i) at the start of each part"),
  needs_image: z.boolean().describe("true if any diagram, graph, picture, table or answer grid is needed to answer"),
  topic: z.string(), subtopic: z.string(),
  difficulty: z.number().int().describe("1 easy, 2 medium, 3 hard"),
  parts: z.array(z.object({
    label: z.string().describe('e.g. "(a)", "(b)(ii)"; "" if the question has no parts'),
    prompt: z.string().describe("The text of this part only"),
    marks: z.number().int(),
    mark_scheme: z.string().describe("Marking points from the official mark scheme for this part, one per line, each ending with its mark in brackets e.g. [1]"),
    model_answer: z.string().describe("A full-mark worked answer written for a student, consistent with the mark scheme"),
  })),
});
export type StructOut = z.infer<typeof StructSchema>;

export async function enrichStructured(paperId: number, subject: string, topics: string[], q: { number: number; images: Buffer[]; msImages: Buffer[]; text: string; msText: string }): Promise<StructOut> {
  const system = `You convert a Cambridge International exam structured (written-answer) question and its official mark scheme into structured data for a revision app. Images are the source of truth; the PDF text layers are provided only as an aid and may be garbled.

${FORMAT_RULES}
- Split the question into its smallest answerable parts exactly as labelled on the paper; marks per part come from the [n] shown on the paper.
- mark_scheme must reflect the official mark scheme only (do not invent marking points). If the mark scheme for a part is missing, write "Not available".
- model_answer: concise worked solution a student could write to earn full marks.
- topic must be copied exactly from the allowed topic list when one is provided (pick the dominant one).`;
  const content: Content = [txt(`Subject: ${subject}\nAllowed topics:\n${topics.length ? topics.map((t) => `- ${t}`).join("\n") : "(none provided: choose a concise syllabus topic name)"}\n\n=== Question ${q.number} as printed ===`)];
  for (const b of q.images) content.push(img(b));
  content.push(txt(`Question text layer:\n${q.text.replace(/\.{6,}/g, "…").slice(0, 5000)}\n\n=== Official mark scheme for question ${q.number} ===`));
  for (const b of q.msImages) content.push(img(b));
  content.push(txt(`Mark scheme text layer:\n${q.msText.slice(0, 6000) || "(none)"}`));
  return callJson(paperId, "structured", StructSchema, system, content);
}

// ---------- Answer-key fallback ----------
const KeySchema = z.object({ answers: z.array(z.object({ number: z.number().int(), answer: z.string().describe("A, B, C or D") })) });

export async function readAnswerKey(paperId: number, msPdf: Buffer): Promise<Map<number, string>> {
  const out = await callJson(paperId, "answer-key", KeySchema, "Extract the multiple-choice answer key from this Cambridge mark scheme. One entry per question number.", [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: msPdf.toString("base64") } },
    txt("Return the answer key."),
  ], 4000);
  const m = new Map<number, string>();
  for (const a of out.answers) if (/^[A-D]$/.test(a.answer.trim().toUpperCase())) m.set(a.number, a.answer.trim().toUpperCase());
  return m;
}
