export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
    });
  } catch { throw new ApiError("Can't reach the server. Check your connection and try again.", 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Me { id: number; email: string; name: string; role: string; xp: number; streak: number; dailyGoal: number; xpToday: number; activeToday: boolean }
export interface Question {
  id: number; type: "mcq" | "structured"; display: "text" | "image"; text: string | null;
  options: Record<string, string> | null; images: string[]; parts: { label: string; prompt: string; marks: number }[] | null;
  marks: number; topic: string | null; subtopic: string | null; difficulty: number; source: string;
}
export const SESSIONS: Record<string, string> = { m: "Feb/March", s: "May/June", w: "Oct/Nov" };
