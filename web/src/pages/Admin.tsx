import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, SESSIONS } from "../api";
import { Rich } from "../Rich";

function useLoad<T>(path: string, pollMs = 0): [T | null, () => void, string] {
  const [d, setD] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<T>(path).then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)); }, [path]);
  useEffect(() => { load(); if (pollMs) { const t = setInterval(load, pollMs); return () => clearInterval(t); } }, [load, pollMs]);
  return [d, load, err];
}
const sum = (rows: any[], f: (r: any) => boolean = () => true) => rows.filter(f).reduce((s, r) => s + r.n, 0);
const Status = ({ s }: { s: string }) => <span className={`status s-${s}`}>{s.replace("_", " ")}</span>;
const paperName = (p: any) => `${p.subject_code}/${p.component} ${SESSIONS[p.session]} ${p.year}`;

export function Admin() {
  return (
    <>
      <h1 className="page-title">Question engine</h1>
      <div className="tabs">
        <NavLink end to="/admin">Overview</NavLink>
        <NavLink to="/admin/import">Import</NavLink>
        <NavLink to="/admin/papers">Papers</NavLink>
        <NavLink to="/admin/questions">Questions</NavLink>
        <NavLink to="/admin/subjects">Subjects</NavLink>
      </div>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="import" element={<Import />} />
        <Route path="papers" element={<Papers />} />
        <Route path="papers/:id" element={<PaperDetail />} />
        <Route path="questions" element={<Questions />} />
        <Route path="subjects" element={<Subjects />} />
      </Routes>
    </>
  );
}

function Overview() {
  const [d, reload, err] = useLoad<any>("/admin/overview", 4000);
  const [msg, setMsg] = useState("");
  if (err && !d) return <div className="empty">{err}</div>;
  if (!d) return <div className="spinner" />;
  const save = async (body: Record<string, string>) => { await api("/admin/settings", { method: "PUT", body }); reload(); };
  const s = d.settings, budget = Number(s.ai_budget_usd);
  const active = sum(d.jobs, (j) => j.status === "queued" || j.status === "running");
  return (
    <>
      <div className="tiles">
        <div className="tile"><small>Papers processed</small><b>{sum(d.papers, (p) => p.status === "done" || p.status === "partial")}</b></div>
        <div className="tile"><small>Questions</small><b>{sum(d.questions)}</b></div>
        <div className="tile"><small>Need review</small><b>{sum(d.questions, (q) => q.status === "needs_review")}</b></div>
        <div className="tile"><small>Jobs in queue</small><b>{active}</b></div>
        <div className="tile"><small>Failed papers</small><b>{sum(d.papers, (p) => p.status === "failed")}</b></div>
        <div className="tile"><small>Students</small><b>{d.users}</b></div>
      </div>
      <div className="two">
        <section className="card pad">
          <h3>AI spend</h3>
          <p className="bignum">${d.ai.spend.toFixed(2)} <small>of ${budget.toFixed(2)} budget</small></p>
          <div className={`bar ${d.ai.spend / budget > 0.9 ? "weak" : ""}`}><div style={{ width: `${Math.min(100, (d.ai.spend / budget) * 100)}%` }} /></div>
          {!d.ai.ready.ok && <p className="form-error">{d.ai.ready.reason}. New papers are still imported as image-only questions.</p>}
          <p className="muted">{d.ai.calls} API calls. Average per paper: {d.ai.perPaper.map((x: any) => `${x.type} $${x.avg}`).join(", ") || "n/a"}</p>
          <div className="form-grid">
            <label>Model<select value={s.ai_model} onChange={(e) => save({ ai_model: e.target.value })}>{d.models.map((m: string) => <option key={m}>{m}</option>)}</select></label>
            <label>Effort<select value={s.ai_effort} onChange={(e) => save({ ai_effort: e.target.value })}>{["low", "medium", "high"].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label>Budget cap (USD)<input type="number" min="0" step="1" defaultValue={s.ai_budget_usd} onBlur={(e) => e.target.value !== s.ai_budget_usd && save({ ai_budget_usd: e.target.value })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={s.ai_enabled === "1"} onChange={(e) => save({ ai_enabled: e.target.checked ? "1" : "0" })} /> AI enrichment on</label>
          <label className="check"><input type="checkbox" checked={s.auto_publish === "1"} onChange={(e) => save({ auto_publish: e.target.checked ? "1" : "0" })} /> Publish papers to students automatically</label>
          <label className="check"><input type="checkbox" checked={s.worker_paused === "1"} onChange={(e) => save({ worker_paused: e.target.checked ? "1" : "0" })} /> Pause the job queue</label>
          <button className="btn small" onClick={async () => { const r = await api("/admin/retry-failed", { method: "POST" }); setMsg(`${r.queued} papers re-queued`); reload(); }}>Retry failed / finish image-only papers</button> {msg && <span className="muted">{msg}</span>}
        </section>
        <section className="card pad">
          <h3>Activity log</h3>
          <div className="log">
            {!d.logs.length && <p className="muted">No activity yet. Import some papers to get started.</p>}
            {d.logs.map((l: any) => <div key={l.id} className={`logline l-${l.level}`}><small>{l.created_at.slice(5, 16)}</small> {l.subject_code && <b>{paperName(l)}</b>} {l.message}</div>)}
          </div>
        </section>
      </div>
    </>
  );
}

function Import() {
  const [subs] = useLoad<any>("/admin/subjects");
  const yr = new Date().getFullYear();
  const [f, setF] = useState({ subject: "", yearFrom: yr - 2, yearTo: yr - 1, components: "" });
  const [sessions, setSessions] = useState<string[]>(["s", "w"]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [up, setUp] = useState({ subject: "", year: String(yr - 1), session: "s", component: "" });
  const [files, setFiles] = useState<{ qp?: File; ms?: File }>({});
  const nav = useNavigate();
  if (!subs) return <div className="spinner" />;
  const opts = subs.subjects.map((s: any) => <option key={s.code} value={s.code}>{s.code} {s.name} ({s.level} Level)</option>);
  const run = async () => {
    setErr(""); setMsg("");
    try { const r = await api("/admin/import", { body: { ...f, sessions } }); setMsg(`${r.queued} job(s) queued. Watch progress on the Overview and Papers tabs.`); }
    catch (e: any) { setErr(e.message); }
  };
  const upload = async () => {
    setErr(""); setMsg("");
    const form = new FormData();
    Object.entries(up).forEach(([k, v]) => form.append(k, v));
    if (files.qp) form.append("qp", files.qp); if (files.ms) form.append("ms", files.ms);
    try { const r = await api("/admin/upload", { form }); nav(`/admin/papers/${r.id}`); } catch (e: any) { setErr(e.message); }
  };
  const sessionCount = (f.yearTo - f.yearFrom + 1) * sessions.length;
  return (
    <div className="two">
      <section className="card pad">
        <h3>Scrape past papers automatically</h3>
        <p className="muted">Finds every question paper and mark scheme for the chosen sessions, downloads them from public mirrors and runs them through the pipeline.</p>
        <label>Subject<select value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })}><option value="">Choose…</option>{opts}</select></label>
        <div className="form-grid">
          <label>From year<input type="number" value={f.yearFrom} onChange={(e) => setF({ ...f, yearFrom: Number(e.target.value) })} /></label>
          <label>To year<input type="number" value={f.yearTo} onChange={(e) => setF({ ...f, yearTo: Number(e.target.value) })} /></label>
        </div>
        <div className="filter-title">Sessions</div>
        <div className="chips">{Object.entries(SESSIONS).map(([k, l]) => <button key={k} className={`chip ${sessions.includes(k) ? "on" : ""}`} onClick={() => setSessions(sessions.includes(k) ? sessions.filter((x) => x !== k) : [...sessions, k])}>{l}</button>)}</div>
        <label>Components (optional)<input placeholder="e.g. 11, 12, 22 — leave blank to discover all" value={f.components} onChange={(e) => setF({ ...f, components: e.target.value })} /></label>
        {!f.components && sessionCount > 0 && <p className="muted">This covers {sessionCount} exam session(s); each usually has 6–15 papers. AI cost so far has averaged about $0.35–0.40 per paper on the default model.</p>}
        <button className="btn primary" disabled={!f.subject || !sessions.length} onClick={run}>Start import</button>
      </section>
      <section className="card pad">
        <h3>Upload a paper manually</h3>
        <p className="muted">Use this when a paper isn't on any mirror.</p>
        <label>Subject<select value={up.subject} onChange={(e) => setUp({ ...up, subject: e.target.value })}><option value="">Choose…</option>{opts}</select></label>
        <div className="form-grid">
          <label>Year<input value={up.year} onChange={(e) => setUp({ ...up, year: e.target.value })} /></label>
          <label>Session<select value={up.session} onChange={(e) => setUp({ ...up, session: e.target.value })}>{Object.entries(SESSIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Component<input placeholder="12" value={up.component} onChange={(e) => setUp({ ...up, component: e.target.value })} /></label>
        </div>
        <label>Question paper (PDF)<input type="file" accept="application/pdf" onChange={(e) => setFiles({ ...files, qp: e.target.files?.[0] })} /></label>
        <label>Mark scheme (PDF)<input type="file" accept="application/pdf" onChange={(e) => setFiles({ ...files, ms: e.target.files?.[0] })} /></label>
        <button className="btn primary" disabled={!up.subject || !up.component || !files.qp || !files.ms} onClick={upload}>Upload and process</button>
      </section>
      {(msg || err) && <p className={err ? "form-error" : "form-ok"} role="status">{err || msg}</p>}
    </div>
  );
}

function Papers() {
  const [status, setStatus] = useState("");
  const [d, reload] = useLoad<any>(`/admin/papers${status ? `?status=${status}` : ""}`, 4000);
  const nav = useNavigate();
  const act = async (id: number, a: string) => { await api(`/admin/papers/${id}/${a}`, { method: "POST" }); reload(); };
  return (
    <>
      <div className="chips">{["", "queued", "processing", "retrying", "done", "partial", "skipped", "failed"].map((s) => <button key={s} className={`chip ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>{s || "All"}</button>)}</div>
      {!d ? <div className="spinner" /> : !d.papers.length ? <div className="empty">No papers here yet.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Paper</th><th>Type</th><th>Status</th><th>Questions</th><th>Review</th><th>AI cost</th><th>Live</th><th></th></tr></thead>
          <tbody>{d.papers.map((p: any) => (
            <tr key={p.id} onClick={() => nav(`/admin/papers/${p.id}`)} className="clickable">
              <td><b>{paperName(p)}</b><br /><small className="muted">{p.subject_name}</small></td>
              <td>{p.type || "—"}</td>
              <td><Status s={p.status} />{p.error && <><br /><small className="muted">{p.error.slice(0, 80)}</small></>}</td>
              <td>{p.question_count}{p.image_only ? <small className="muted"> ({p.image_only} image-only)</small> : null}</td>
              <td>{p.review_count || ""}</td><td>{p.cost ? `$${p.cost}` : ""}</td><td>{p.published ? "✅" : "—"}</td>
              <td onClick={(e) => e.stopPropagation()}>{["failed", "skipped", "retrying"].includes(p.status) && <button className="btn small" onClick={() => act(p.id, "reprocess")}>Retry</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function PaperDetail() {
  const { id } = useParams();
  const [d, reload] = useLoad<any>(`/admin/papers/${id}`, 5000);
  const nav = useNavigate();
  if (!d) return <div className="spinner" />;
  const p = d.paper;
  const act = async (a: string) => {
    if (a === "delete" && !confirm(`Delete ${paperName(p)} and all its questions? Student attempts on them are removed too.`)) return;
    await api(`/admin/papers/${id}/${a}`, { method: "POST" });
    a === "delete" ? nav("/admin/papers") : reload();
  };
  return (
    <>
      <button className="back as-btn" onClick={() => nav("/admin/papers")}>← Papers</button>
      <section className="card pad">
        <h3>{paperName(p)} · {p.subject_name} <Status s={p.status} /></h3>
        <p className="muted">{p.type || "unknown type"} · stage: {p.stage} · sources: {p.qp_source || "?"} / {p.ms_source || "?"} {p.error && <span className="form-error"> · {p.error}</span>}</p>
        <div className="chips">
          <button className="btn small" onClick={() => act(p.published ? "unpublish" : "publish")}>{p.published ? "Unpublish" : "Publish"}</button>
          <button className="btn small" onClick={() => act("enrich")}>Re-run AI on image-only</button>
          <button className="btn small" onClick={() => act("reprocess")}>Reprocess from scratch</button>
          <button className="btn small danger-outline" onClick={() => act("delete")}>Delete</button>
        </div>
        <details><summary>Pipeline log</summary><div className="log">{d.logs.map((l: any) => <div key={l.id} className={`logline l-${l.level}`}><small>{l.created_at.slice(5, 16)}</small> {l.message}</div>)}</div></details>
      </section>
      {d.questions.map((q: any) => <QuestionEditor key={q.id} q={q} onSaved={reload} />)}
    </>
  );
}

function QuestionEditor({ q, onSaved, label }: { q: any; onSaved: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState("");
  const edit = () => { setF({ text: q.text || "", answer: q.answer || "", explanation: q.explanation || "", topic: q.topic || "", display: q.display, status: q.status, difficulty: q.difficulty, options: q.options || { A: "", B: "", C: "", D: "" } }); setOpen(true); };
  const save = async (patch?: any) => {
    setErr("");
    try {
      const body = patch || (q.type === "mcq" ? f : { text: f.text, topic: f.topic, display: f.display, status: f.status, difficulty: f.difficulty });
      await api(`/admin/questions/${q.id}`, { method: "PUT", body }); setOpen(false); onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <section className="card pad qcard">
      <div className="qhead">
        <b>{label ? `${label} · ` : ""}Q{q.number}</b> <Status s={q.status} /> <span className="tag soft">{q.type}</span> <span className="tag soft">{q.display}</span>
        {q.topic && <span className="tag">{q.topic}</span>} {q.answer && <span className="tag">Answer {q.answer}</span>}
        <span className="grow" />
        {q.status === "needs_review" && <button className="btn small" onClick={() => save({ status: "ok", review_note: null })}>Approve</button>}
        {q.status !== "hidden" ? <button className="btn small" onClick={() => save({ status: "hidden" })}>Hide</button> : <button className="btn small" onClick={() => save({ status: "ok" })}>Unhide</button>}
        <button className="btn small" onClick={() => (open ? setOpen(false) : edit())}>{open ? "Close" : "Edit"}</button>
      </div>
      {q.review_note && <p className="form-error">{q.review_note}</p>}
      <div className="qcols">
        <div>{q.images.map((s: string) => <img key={s} src={s} alt={`Question ${q.number} as printed`} loading="lazy" />)}</div>
        <div>
          {q.text && q.type === "mcq" && <Rich text={q.text} />}
          {q.options && <ul className="optlist">{Object.entries(q.options).map(([k, v]) => <li key={k} className={k === q.answer ? "right" : ""}><b>{k}</b> <Rich text={String(v)} /></li>)}</ul>}
          {q.type === "mcq" && q.explanation && <div className="ms"><div className="ms-title">Explanation</div><Rich text={q.explanation} /></div>}
          {q.parts && q.parts.map((p: any, k: number) => <div className="ms" key={k}><div className="ms-title">{p.label} [{p.marks}]</div><Rich text={p.prompt} /><Rich text={p.mark_scheme} /></div>)}
          {!q.parts && q.ms_images.map((s: string) => <img key={s} src={s} alt="Mark scheme" loading="lazy" />)}
        </div>
      </div>
      {open && f && (
        <div className="editor">
          <label>Question text<textarea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
          {q.type === "mcq" && <>
            <div className="form-grid">{"ABCD".split("").map((L) => <label key={L}>Option {L}<input value={f.options[L] || ""} onChange={(e) => setF({ ...f, options: { ...f.options, [L]: e.target.value } })} /></label>)}</div>
            <label>Explanation<textarea rows={3} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} /></label>
          </>}
          <div className="form-grid">
            {q.type === "mcq" && <label>Answer<select value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })}><option value="">—</option>{"ABCD".split("").map((L) => <option key={L}>{L}</option>)}</select></label>}
            <label>Topic<input value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} /></label>
            <label>Show as<select value={f.display} onChange={(e) => setF({ ...f, display: e.target.value })}><option>text</option><option>image</option></select></label>
            <label>Difficulty<select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: Number(e.target.value) })}><option value={1}>Easy</option><option value={2}>Medium</option><option value={3}>Hard</option></select></label>
            <label>Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{["ok", "image_only", "needs_review", "hidden"].map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          {err && <p className="form-error">{err}</p>}
          <button className="btn primary small" onClick={() => save()}>Save changes</button>
        </div>
      )}
    </section>
  );
}

function Questions() {
  const [status, setStatus] = useState("needs_review");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const qs = new URLSearchParams({ ...(status && { status }), ...(type && { type }), ...(search && { q: search }), page: String(page) }).toString();
  const [d, reload] = useLoad<any>(`/admin/questions?${qs}`);
  return (
    <>
      <div className="chips">
        {[["needs_review", "Needs review"], ["image_only", "Image-only"], ["ok", "OK"], ["hidden", "Hidden"], ["", "All"]].map(([s, l]) => <button key={s} className={`chip ${status === s ? "on" : ""}`} onClick={() => { setStatus(s); setPage(0); }}>{l}</button>)}
        <span className="sep" />
        {[["", "Any type"], ["mcq", "MCQ"], ["structured", "Written"]].map(([s, l]) => <button key={s} className={`chip ${type === s ? "on" : ""}`} onClick={() => { setType(s); setPage(0); }}>{l}</button>)}
        <input className="search" placeholder="Search question text…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      </div>
      {!d ? <div className="spinner" /> : !d.questions.length ? <div className="empty">{status === "needs_review" ? "Nothing needs review. 🎉" : "No questions match."}</div> : <>
        <p className="muted">{d.total} question(s)</p>
        {d.questions.map((q: any) => <QuestionEditor key={q.id} q={q} onSaved={reload} label={paperName(q)} />)}
        <div className="chips"><button className="btn small" disabled={!page} onClick={() => setPage(page - 1)}>← Prev</button><button className="btn small" disabled={(page + 1) * 20 >= d.total} onClick={() => setPage(page + 1)}>Next →</button></div>
      </>}
    </>
  );
}

function Subjects() {
  const [d, reload] = useLoad<any>("/admin/subjects");
  const blank = { code: "", name: "", level: "O", icon: "📘", topics: "" };
  const [f, setF] = useState<any>(blank);
  const [err, setErr] = useState("");
  if (!d) return <div className="spinner" />;
  const save = async () => { setErr(""); try { await api("/admin/subjects", { body: f }); setF(blank); reload(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="two">
      <section className="card pad">
        <h3>{d.subjects.some((s: any) => s.code === f.code) ? "Edit subject" : "Add a subject"}</h3>
        <div className="form-grid">
          <label>Syllabus code<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="5054" /></label>
          <label>Level<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="O">O Level</option><option value="A">AS & A Level</option></select></label>
          <label>Icon<input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></label>
        </div>
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Topics (one per line — the AI classifies every question into one of these)<textarea rows={10} value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} /></label>
        {err && <p className="form-error">{err}</p>}
        <button className="btn primary" onClick={save}>Save subject</button>
      </section>
      <section className="card pad">
        <h3>Subjects</h3>
        {d.subjects.map((s: any) => (
          <div className="rrow clickable" key={s.code} onClick={() => setF({ code: s.code, name: s.name, level: s.level, icon: s.icon, topics: s.topics || "" })}>
            <span>{s.icon}</span><span className="grow"><b>{s.name}</b> <small className="muted">{s.code} · {s.level} Level</small></span>
            <small className="muted">{s.papers} papers · {s.questions} questions</small>
          </div>
        ))}
      </section>
    </div>
  );
}
