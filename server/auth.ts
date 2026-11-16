import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET } from "./config";
import { db } from "./db";

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const h = crypto.scryptSync(pw, salt, 64);
  return h.length === hash.length / 2 && crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
}
function sign(v: string) { return crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url"); }

export function setSession(res: Response, userId: number) {
  const body = `${userId}.${Date.now() + 30 * 864e5}`;
  res.cookie("sid", `${body}.${sign(body)}`, { httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5, secure: process.env.NODE_ENV === "production" });
}
export function clearSession(res: Response) { res.clearCookie("sid"); }

export interface User { id: number; email: string; name: string; role: string; xp: number; streak: number; last_active: string | null; daily_goal: number }
declare global { namespace Express { interface Request { user?: User } } }

export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const raw = req.cookies?.sid as string | undefined;
  if (raw) {
    const i = raw.lastIndexOf(".");
    const body = raw.slice(0, i), sig = raw.slice(i + 1);
    const [id, exp] = body.split(".");
    const good = sign(body);
    if (sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) && Number(exp) > Date.now()) {
      req.user = db.prepare("SELECT id,email,name,role,xp,streak,last_active,daily_goal FROM users WHERE id=?").get(Number(id)) as User | undefined;
    }
  }
  next();
}
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please sign in" });
  next();
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please sign in" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admins only" });
  next();
}
export function seedAdmin() {
  const exists = db.prepare("SELECT id FROM users WHERE role='admin'").get();
  if (!exists) db.prepare("INSERT OR IGNORE INTO users(email,name,password_hash,role) VALUES(?,?,?,'admin')").run(ADMIN_EMAIL.toLowerCase(), "Admin", hashPassword(ADMIN_PASSWORD));
}
