import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, Question } from "../api";
import { Rich } from "../Rich";
import { useMe } from "../main";

interface McqResult { correct: boolean; answer: string; explanation: string | null; gained: number }
interface Solution { parts: { label: string; prompt: string; marks: number; mark_scheme: string; model_answer: string }[] | null; msImages: string[]; marks: number; msVisual?: boolean }

export function Practice() {
  const { state } = useLocation() as { state: any };
  const nav = useNavigate();
  const { refresh } = useMe();
  const [qs, setQs] = useState<Question[] | null>(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(0);
  const [tally, setTally] = useState({ right: 0, xp: 0, done: 0 });
  const back = state?.back || "/";

  useEffect(() => {
    if (!state?.subject) { nav("/", { replace: true }); return; }
    api("/practice/start", { body: state }).then((d) => setQs(d.questions)).catch((e) => setErr(e.message));
  }, []); // eslint-disable-line

  const quit = async () => { await refresh(); nav(back); };
  if (err) return <div className="center-screen"><div className="empty">{err}<br /><button className="btn" onClick={() => nav(back)}>Go back</button></div></div>;
  if (!qs) return <div className="center-screen"><div className="spinner" /></div>;
  if (!qs.length) return (
    <div className="center-screen"><div className="finish">
      <div className="big-emoji">🔍</div><h1>No questions match</h1>
      <p>Try removing a filter{state.mode === "mistakes" ? " — or you have no mistakes to review, nice!" : "."}</p>
      <button className="btn primary" onClick={() => nav(back)}>Back</button>
    </div></div>
  );
  if (i >= qs.length) {
    const acc = Math.round((tally.right / qs.length) * 100);
    return (
      <div className="center-screen"><div className="finish">
        <div className="big-emoji">{acc >= 80 ? "🏆" : acc >= 50 ? "💪" : "📚"}</div>
        <h1>{acc >= 80 ? "Brilliant!" : acc >= 50 ? "Good work!" : "Practice makes perfect"}</h1>
        <div className="finish-stats">
          <div className="fs xp"><small>Total XP</small><b>⚡ {tally.xp}</b></div>
          <div className="fs acc"><small>Accuracy</small><b>🎯 {acc}%</b></div>
          <div className="fs"><small>Questions</small><b>{qs.length}</b></div>
        </div>
        <button className="btn primary block" onClick={quit}>Continue</button>
      </div></div>
    );
  }
  const q = qs[i];
  const next = (right: boolean, xp: number) => { setTally((t) => ({ right: t.right + (right ? 1 : 0), xp: t.xp + xp, done: t.done + 1 })); setI(i + 1); window.scrollTo(0, 0); };
  return (
    <div className="lesson">
      <header className="lesson-top">
        <button className="x" onClick={quit} aria-label="Quit practice">✕</button>
        <div className="bar"><div style={{ width: `${(i / qs.length) * 100}%` }} /></div>
        <span className="count">{i + 1}/{qs.length}</span>
      </header>
      {q.type === "mcq" ? <Mcq key={q.id} q={q} onNext={next} /> : <Structured key={q.id} q={q} onNext={next} />}
    </div>
  );
}

function Meta({ q }: { q: Question }) {
  return (
    <div className="q-meta">
      {q.topic && <span className="tag">{q.topic}</span>}
      <span className="tag soft">{"●".repeat(q.difficulty)}{"○".repeat(3 - q.difficulty)}</span>
      <span className="tag soft">{q.source}</span>
    </div>
  );
}

function Images({ srcs, alt }: { srcs: string[]; alt: string }) {
  return <div className="q-images">{srcs.map((s) => <img key={s} src={s} alt={alt} loading="lazy" />)}</div>;
}

function Mcq({ q, onNext }: { q: Question; onNext: (right: boolean, xp: number) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [res, setRes] = useState<McqResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const textMode = q.display === "text" && q.text && q.options;
  const check = async () => {
    if (!sel || busy) return;
    setBusy(true); setErr("");
    try { setRes(await api("/practice/answer", { body: { questionId: q.id, answer: sel } })); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      if (!res && /^[A-D]$/.test(k)) setSel(k);
      if (!res && /^[1-4]$/.test(k)) setSel("ABCD"[Number(k) - 1]);
      if (e.key === "Enter") res ? onNext(res.correct, res.gained) : check();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  const cls = (L: string) => `${sel === L ? "sel" : ""} ${res ? (L === res.answer ? "right" : sel === L ? "wrong" : "") : ""}`;
  return (
    <>
      <div className="lesson-body">
        <Meta q={q} />
        <h2 className="q-title">Choose the correct answer</h2>
        {textMode ? (
          <>
            <Rich text={q.text!} className="stem" />
            <div className="options">
              {"ABCD".split("").map((L) => (
                <button key={L} className={`option ${cls(L)}`} disabled={!!res} onClick={() => setSel(L)}>
                  <span className="letter">{L}</span><Rich text={q.options![L]} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <Images srcs={q.images} alt={q.text || "Exam question"} />
            <div className="options letters">
              {"ABCD".split("").map((L) => <button key={L} className={`option ${cls(L)}`} disabled={!!res} onClick={() => setSel(L)}><span className="letter">{L}</span></button>)}
            </div>
          </>
        )}
      </div>
      <footer className={`lesson-foot ${res ? (res.correct ? "good" : "bad") : ""}`}>
        <div className="foot-in">
          {res ? (
            <>
              <div className="feedback">
                <h3>{res.correct ? "✅ Correct!" : `❌ Correct answer: ${res.answer}`} <small>+{res.gained} XP</small></h3>
                {res.explanation && <Rich text={res.explanation} />}
              </div>
              <button className={`btn ${res.correct ? "success" : "danger"}`} onClick={() => onNext(res.correct, res.gained)}>Continue</button>
            </>
          ) : (
            <>
              <div className="feedback">{err && <span className="form-error">{err}</span>}</div>
              <button className="btn primary" disabled={!sel || busy} onClick={check}>Check</button>
            </>
          )}
        </div>
      </footer>
    </>
  );
}

function Structured({ q, onNext }: { q: Question; onNext: (right: boolean, xp: number) => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [sol, setSol] = useState<Solution | null>(null);
  const [scores, setScores] = useState<Record<number, number>>({});
  const [rate, setRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const showImages = true; // the printed question keeps shared stems, figures and tables that part prompts alone would lose
  const reveal = async () => {
    setBusy(true); setErr("");
    try { const r = await api<Solution>(`/practice/solution/${q.id}`); setSol(r); if (r.msVisual) setShowOriginal(true); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const parts = sol?.parts;
  const total = useMemo(() => (parts ? parts.reduce((s, _p, k) => s + (scores[k] ?? 0), 0) : 0), [parts, scores]);
  const allMarked = parts ? parts.every((_p, k) => scores[k] !== undefined) : rate !== null;
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const score = parts ? total : (rate ?? 0) * q.marks;
      const r = await api("/practice/self-mark", { body: { questionId: q.id, score, responses: answers } });
      onNext(r.correct, r.gained);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <>
      <div className="lesson-body wide">
        <Meta q={q} />
        <h2 className="q-title">Answer, then mark yourself against the mark scheme {q.parts && <small>[{q.marks} marks]</small>}</h2>
        {showImages ? <Images srcs={q.images} alt={q.text || "Exam question"} /> : null}
        {q.parts ? q.parts.map((p, k) => (
          <div className="part" key={k}>
            <div className="part-head"><b>{p.label || "Answer"}</b><span className="marks">[{p.marks}]</span></div>
            {!showImages && <Rich text={p.prompt} />}
            <textarea placeholder="Type your answer or working here (optional)…" value={answers[k] || ""} disabled={!!sol} onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })} rows={2} />
            {parts && parts[k] && (
              <div className="ms">
                <div className="ms-title">Mark scheme</div>
                <Rich text={parts[k].mark_scheme} />
                <details><summary>Model answer</summary><Rich text={parts[k].model_answer} /></details>
                <div className="award">
                  <span>Marks you earned:</span>
                  {Array.from({ length: p.marks + 1 }, (_x, m) => <button key={m} className={`pill ${scores[k] === m ? "on" : ""}`} onClick={() => setScores({ ...scores, [k]: m })}>{m}</button>)}
                </div>
              </div>
            )}
          </div>
        )) : (
          <div className="part">
            <textarea placeholder="Type your answer or working here (optional)…" value={answers[0] || ""} disabled={!!sol} onChange={(e) => setAnswers({ 0: e.target.value })} rows={4} />
          </div>
        )}
        {sol && parts && sol.msImages.length > 0 && <button className="link" onClick={() => setShowOriginal(!showOriginal)}>{showOriginal ? "Hide" : "Show"} original mark scheme{sol.msVisual ? " (includes drawn answers)" : ""}</button>}
        {sol && (!parts || showOriginal) && <div className="ms"><div className="ms-title">Official mark scheme</div><Images srcs={sol.msImages} alt="Official mark scheme" /></div>}
        {sol && !parts && (
          <div className="award big">
            <span>How did you do?</span>
            {[["Missed it", 0], ["Partly right", 0.5], ["Got it", 1]].map(([l, v]) => <button key={l} className={`pill ${rate === v ? "on" : ""}`} onClick={() => setRate(v as number)}>{l}</button>)}
          </div>
        )}
      </div>
      <footer className={`lesson-foot ${sol ? "info" : ""}`}>
        <div className="foot-in">
          <div className="feedback">
            {err && <span className="form-error">{err}</span>}
            {sol && parts && <h3>Your score: {total} / {q.marks}</h3>}
          </div>
          {sol ? <button className="btn primary" disabled={!allMarked || busy} onClick={submit}>{allMarked ? "Continue" : parts ? "Mark each part" : "Rate yourself"}</button>
            : <button className="btn primary" disabled={busy} onClick={reveal}>Reveal mark scheme</button>}
        </div>
      </footer>
    </>
  );
}
