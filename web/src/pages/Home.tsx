import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../main";

interface Subj { code: string; name: string; level: string; icon: string; total: number; attempted: number; mastered: number }

export function Ring({ value, size = 56, children }: { value: number; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

export function Home() {
  const { me } = useMe();
  const [subjects, setSubjects] = useState<Subj[] | null>(null);
  const [err, setErr] = useState("");
  const [level, setLevel] = useState<"A" | "O">(() => (localStorage.getItem("level") as any) || "A");
  useEffect(() => { api("/subjects").then((d) => setSubjects(d.subjects)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { localStorage.setItem("level", level); }, [level]);
  if (err) return <div className="empty">{err}</div>;
  if (!subjects) return <div className="spinner" />;
  const list = subjects.filter((s) => s.level === level);
  const ready = list.filter((s) => s.total > 0), soon = list.filter((s) => !s.total);
  const goal = me!.dailyGoal, pct = Math.min(1, me!.xpToday / goal);
  return (
    <>
      <section className="goal-card">
        <div>
          <h2>{pct >= 1 ? "Daily goal smashed! 🎉" : me!.activeToday ? "Keep it going!" : "Ready for today's practice?"}</h2>
          <p>{me!.xpToday} / {goal} XP today · {me!.streak} day streak</p>
          <div className="bar light"><div style={{ width: `${pct * 100}%` }} /></div>
        </div>
        <div className="goal-emoji">{pct >= 1 ? "🏆" : "🎯"}</div>
      </section>

      <div className="seg">
        <button className={level === "A" ? "on" : ""} onClick={() => setLevel("A")}>AS & A Level</button>
        <button className={level === "O" ? "on" : ""} onClick={() => setLevel("O")}>O Level</button>
      </div>

      {!ready.length && <div className="empty">No {level === "A" ? "A Level" : "O Level"} questions have been published yet.{me!.role === "admin" && <> Import papers from the <Link to="/admin">admin dashboard</Link>.</>}</div>}
      <div className="grid">
        {ready.map((s) => (
          <Link key={s.code} to={`/subject/${s.code}`} className="card subject">
            <Ring value={s.total ? s.mastered / s.total : 0}><span className="subj-icon">{s.icon}</span></Ring>
            <div>
              <h3>{s.name}</h3>
              <p>{s.code} · {s.total} questions</p>
              <p className="muted">{s.mastered} mastered · {s.attempted} tried</p>
            </div>
          </Link>
        ))}
      </div>
      {soon.length > 0 && <>
        <h4 className="section-label">Coming soon</h4>
        <div className="chips">{soon.map((s) => <span key={s.code} className="chip ghost">{s.icon} {s.name} {s.code}</span>)}</div>
      </>}
    </>
  );
}
