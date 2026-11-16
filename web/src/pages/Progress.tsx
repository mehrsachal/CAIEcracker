import { useEffect, useState } from "react";
import { api, SESSIONS } from "../api";
import { useMe } from "../main";

export function Progress() {
  const { me } = useMe();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/progress").then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spinner" />;
  const acc = d.totals.attempts ? Math.round((d.totals.correct / d.totals.attempts) * 100) : 0;
  const days = Array.from({ length: 14 }, (_x, k) => {
    const day = new Date(Date.now() - (13 - k) * 864e5).toISOString().slice(0, 10);
    return { day, ...(d.days.find((x: any) => x.day === day) || { attempts: 0, correct: 0 }) };
  });
  const max = Math.max(1, ...days.map((x) => x.attempts));
  const bySubject = new Map<string, any[]>();
  for (const t of d.topics) { const k = `${t.icon} ${t.subject} (${t.code})`; bySubject.set(k, [...(bySubject.get(k) || []), t]); }
  return (
    <>
      <h1 className="page-title">Your progress</h1>
      <div className="tiles">
        <div className="tile"><small>Day streak</small><b>🔥 {me!.streak}</b></div>
        <div className="tile"><small>Total XP</small><b>⚡ {me!.xp}</b></div>
        <div className="tile"><small>Questions tried</small><b>{d.totals.questions}</b></div>
        <div className="tile"><small>Accuracy</small><b>{acc}%</b></div>
      </div>

      <h4 className="section-label">Last 14 days</h4>
      <section className="card pad">
        <div className="days" role="img" aria-label="Questions answered per day over the last 14 days">
          {days.map((x) => (
            <div key={x.day} className="day" title={`${x.day}: ${x.attempts} answered, ${x.correct} correct`}>
              <span className="day-n">{x.attempts || ""}</span>
              <div className="day-bar" style={{ height: `${(x.attempts / max) * 100}%` }}><div style={{ height: x.attempts ? `${(x.correct / x.attempts) * 100}%` : 0 }} /></div>
              <span className="day-l">{new Date(x.day).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
            </div>
          ))}
        </div>
        <p className="muted legend"><i className="k dark" /> correct <i className="k light" /> answered</p>
      </section>

      <h4 className="section-label">Accuracy by topic</h4>
      {!d.topics.length && <div className="empty">Answer a few questions and your strengths and weak spots will show up here.</div>}
      {[...bySubject.entries()].map(([name, topics]) => (
        <section className="card pad" key={name}>
          <h3>{name}</h3>
          {topics.map((t: any) => {
            const p = Math.round((t.correct / t.attempts) * 100);
            return (
              <div className="trow" key={t.topic}>
                <span className="tname">{t.topic}</span>
                <div className={`bar ${p < 50 ? "weak" : p < 75 ? "mid" : ""}`}><div style={{ width: `${p}%` }} /></div>
                <span className="tpct">{p}% <small>({t.attempts})</small></span>
              </div>
            );
          })}
        </section>
      ))}

      <div className="two">
        <div>
          <h4 className="section-label">Recent answers</h4>
          <section className="card pad">
            {!d.recent.length && <p className="muted">Nothing yet.</p>}
            {d.recent.map((r: any) => (
              <div className="rrow" key={r.id}>
                <span>{r.correct ? "✅" : "❌"}</span>
                <span className="grow">{r.topic || "Question"} <small className="muted">{r.subject_code}/{r.component} {SESSIONS[r.session]} {r.year} Q{r.number}</small></span>
                <span className="muted">{r.type === "structured" ? `${r.score}/${r.max_score}` : ""}</span>
              </div>
            ))}
          </section>
        </div>
        <div>
          <h4 className="section-label">Leaderboard</h4>
          <section className="card pad">
            {d.leaderboard.map((u: any, k: number) => (
              <div className={`rrow ${u.me ? "me" : ""}`} key={k}><span className="rank">{["🥇", "🥈", "🥉"][k] || k + 1}</span><span className="grow">{u.name}</span><b>⚡ {u.xp}</b></div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
