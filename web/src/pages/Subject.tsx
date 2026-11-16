import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Ring } from "./Home";

interface Facet { v: string | number; n: number; label?: string }
interface Data {
  subject: { code: string; name: string; level: string; icon: string };
  topics: { name: string; total: number; attempted: number; mastered: number }[];
  years: Facet[]; sessions: Facet[]; papers: Facet[]; types: Facet[]; difficulties: Facet[];
}
const TYPE_LABEL: Record<string, string> = { mcq: "Multiple choice", structured: "Written answer" };
const DIFF_LABEL: Record<string, string> = { 1: "Easy", 2: "Medium", 3: "Hard" };

function Chips({ title, items, sel, set, label }: { title: string; items: Facet[]; sel: string[]; set: (v: string[]) => void; label?: (f: Facet) => string }) {
  if (items.length < 2) return null;
  const toggle = (v: string) => set(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
  return (
    <div className="filter">
      <div className="filter-title">{title}</div>
      <div className="chips">
        <button className={`chip ${!sel.length ? "on" : ""}`} onClick={() => set([])}>All</button>
        {items.map((f) => <button key={f.v} className={`chip ${sel.includes(String(f.v)) ? "on" : ""}`} onClick={() => toggle(String(f.v))}>{label ? label(f) : f.label || f.v} <small>{f.n}</small></button>)}
      </div>
    </div>
  );
}

export function Subject() {
  const { code } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [papers, setPapers] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [difficulties, setDiffs] = useState<string[]>([]);
  const [mode, setMode] = useState("mixed");
  const [count, setCount] = useState(10);
  useEffect(() => { api(`/subjects/${code}`).then(setD).catch((e) => setErr(e.message)); }, [code]);
  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spinner" />;
  const start = (extra: Record<string, unknown> = {}) =>
    nav("/practice", { state: { subject: code, topics, years, sessions, papers, types, difficulties, mode, count, ...extra, back: `/subject/${code}` } });
  const total = d.topics.reduce((s, t) => s + t.total, 0), mastered = d.topics.reduce((s, t) => s + t.mastered, 0);
  return (
    <>
      <Link to="/" className="back">← All subjects</Link>
      <section className="subject-head">
        <Ring value={total ? mastered / total : 0} size={84}><span className="subj-icon lg">{d.subject.icon}</span></Ring>
        <div>
          <h1>{d.subject.name}</h1>
          <p>{d.subject.level === "A" ? "AS & A Level" : "O Level"} · {d.subject.code} · {mastered}/{total} mastered</p>
        </div>
        <button className="btn primary" disabled={!total} onClick={() => nav("/practice", { state: { subject: code, count: 10, mode: "mixed", back: `/subject/${code}` } })}>Quick practice</button>
      </section>

      <h4 className="section-label">Topics</h4>
      <div className="topics">
        {d.topics.map((t) => {
          const p = t.total ? t.mastered / t.total : 0;
          return (
            <button key={t.name} className="topic" onClick={() => nav("/practice", { state: { subject: code, topics: [t.name], count: 10, mode: "mixed", back: `/subject/${code}` } })}>
              <Ring value={p} size={48}><b>{Math.round(p * 100)}</b></Ring>
              <div><h3>{t.name}</h3><p>{t.mastered}/{t.total} mastered</p></div>
              <span className="go">▶</span>
            </button>
          );
        })}
      </div>

      <h4 className="section-label">Custom practice</h4>
      <section className="card pad">
        <Chips title="Topic" items={d.topics.map((t) => ({ v: t.name, n: t.total }))} sel={topics} set={setTopics} />
        <Chips title="Year" items={d.years} sel={years} set={setYears} />
        <Chips title="Session" items={d.sessions} sel={sessions} set={setSessions} />
        <Chips title="Paper" items={d.papers} sel={papers} set={setPapers} label={(f) => `Paper ${f.v}`} />
        <Chips title="Question type" items={d.types} sel={types} set={setTypes} label={(f) => TYPE_LABEL[f.v as string] || String(f.v)} />
        <Chips title="Difficulty" items={d.difficulties} sel={difficulties} set={setDiffs} label={(f) => DIFF_LABEL[f.v as number]} />
        <div className="filter">
          <div className="filter-title">Show me</div>
          <div className="chips">
            {[["mixed", "Smart mix"], ["unseen", "New questions"], ["mistakes", "My mistakes"]].map(([v, l]) => <button key={v} className={`chip ${mode === v ? "on" : ""}`} onClick={() => setMode(v)}>{l}</button>)}
          </div>
        </div>
        <div className="filter">
          <div className="filter-title">How many</div>
          <div className="chips">{[5, 10, 20, 40].map((n) => <button key={n} className={`chip ${count === n ? "on" : ""}`} onClick={() => setCount(n)}>{n}</button>)}</div>
        </div>
        <button className="btn primary block" disabled={!total} onClick={() => start()}>Start practice</button>
      </section>
    </>
  );
}
