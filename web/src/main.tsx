import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { api, Me } from "./api";
import "./styles.css";
import { AuthPage } from "./pages/Auth";
import { Home } from "./pages/Home";
import { Subject } from "./pages/Subject";
import { Practice } from "./pages/Practice";
import { Progress } from "./pages/Progress";
import { Admin } from "./pages/Admin";

const Ctx = createContext<{ me: Me | null; refresh: () => Promise<void> }>({ me: null, refresh: async () => {} });
export const useMe = () => useContext(Ctx);

function Shell() {
  const { me, refresh } = useMe();
  const nav = useNavigate();
  if (!me) return <Navigate to="/login" replace />;
  const logout = async () => { await api("/auth/logout", { method: "POST" }); await refresh(); nav("/login"); };
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand"><span className="logo">C</span><span className="brand-name">CAIEcracker</span></div>
        <NavLink to="/" end className="navlink"><span>🏠</span><b>Learn</b></NavLink>
        <NavLink to="/progress" className="navlink"><span>📊</span><b>Progress</b></NavLink>
        {me.role === "admin" && <NavLink to="/admin" className="navlink"><span>⚙️</span><b>Admin</b></NavLink>}
        <div className="side-spacer" />
        <button className="navlink as-btn" onClick={logout}><span>👋</span><b>Sign out</b></button>
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="hello">Hi, {me.name.split(" ")[0]}</div>
          <div className="stats">
            <span className={`stat ${me.streak && me.activeToday ? "on" : ""}`} title="Day streak">🔥 {me.streak}</span>
            <span className="stat xp" title="Total XP">⚡ {me.xp}</span>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try { setMe((await api<{ user: Me | null }>("/me")).user); } catch { /* keep current */ }
    setReady(true);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!ready) return <div className="center-screen"><div className="spinner" /></div>;
  return (
    <Ctx.Provider value={{ me, refresh }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={me ? <Navigate to="/" replace /> : <AuthPage />} />
          <Route path="/practice" element={me ? <Practice /> : <Navigate to="/login" replace />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/subject/:code" element={<Subject />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/admin/*" element={me?.role === "admin" ? <Admin /> : <Navigate to="/" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Ctx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
