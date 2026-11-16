import { useState } from "react";
import { api } from "../api";
import { useMe } from "../main";

export function AuthPage() {
  const { refresh } = useMe();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await api(`/auth/${mode}`, { body: f }); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="brand big"><span className="logo">C</span><span className="brand-name">CAIEcracker</span></div>
        <h1>Crack your O & A Levels,<br />one past paper question at a time.</h1>
        <ul>
          <li>🎯 Real Cambridge past paper questions, sorted by topic and year</li>
          <li>💡 Worked reasoning for every answer</li>
          <li>🔥 Streaks, XP and progress tracking that keep you going</li>
        </ul>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
        {mode === "signup" && <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required /></label>}
        <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" required /></label>
        <label>Password<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : undefined} required /></label>
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}>
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
