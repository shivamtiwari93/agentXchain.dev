import type { Express, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import type { SqliteDb } from "../db.js";
import { signAccessToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { assertPassword, isValidEmail } from "../lib/validation.js";
import { requireAuth } from "../middleware/requireAuth.js";

const AUTH_COOKIE_NAME = "baby_tracker_session";
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 10;
const authRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function sendError(res: Response, err: unknown): void {
  const raw =
    typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : NaN;
  const status = Number.isFinite(raw) && raw >= 400 && raw < 600 ? raw : 500;
  const message = status >= 500 ? "Internal server error" : err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

function getRateLimitKey(req: Request, scope: string, extra = ""): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${scope}:${ip}:${extra}`;
}

function isRateLimited(req: Request, res: Response, scope: string, extra = ""): boolean {
  const key = getRateLimitKey(req, scope, extra);
  const now = Date.now();
  const current = authRateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    authRateLimitBuckets.set(key, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (current.count >= AUTH_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return true;
  }
  current.count += 1;
  return false;
}

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12);
}

export function registerAuthRoutes(
  app: Express,
  db: SqliteDb,
  getSecret: () => string,
): void {
  const auth = requireAuth(db, getSecret);

  app.post("/auth/register", async (req: Request, res: Response) => {
    try {
      const body = req.body as { email?: string; password?: string; name?: string };
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (isRateLimited(req, res, "register", hashEmail(email || "missing"))) {
        return;
      }
      if (!email || !password || !name) {
        res.status(400).json({ error: "email, password, and name are required" });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: "Invalid email format" });
        return;
      }
      assertPassword(password);

      const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: string } | undefined;
      if (existing) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      const id = randomUUID();
      const passwordHash = await hashPassword(password);
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
      ).run(id, email.toLowerCase(), passwordHash, name);

      const row = db
        .prepare(`SELECT id, email, name, token_version FROM users WHERE id = ?`)
        .get(id) as { id: string; email: string; name: string; token_version: number };

      const token = signAccessToken(row, getSecret());
      setAuthCookie(res, token);
      res.status(201).json({
        token,
        user: { id: row.id, email: row.email, name: row.name },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/auth/login", async (req: Request, res: Response) => {
    try {
      const body = req.body as { email?: string; password?: string };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (isRateLimited(req, res, "login", hashEmail(email || "missing"))) {
        return;
      }
      if (!email || !password) {
        res.status(400).json({ error: "email and password are required" });
        return;
      }

      const row = db
        .prepare(`SELECT id, email, name, password_hash, token_version FROM users WHERE email = ?`)
        .get(email) as
        | { id: string; email: string; name: string; password_hash: string; token_version: number }
        | undefined;

      const invalid = { error: "Invalid credentials" };

      if (!row || !(await verifyPassword(password, row.password_hash))) {
        res.status(401).json(invalid);
        return;
      }

      const token = signAccessToken(
        {
          id: row.id,
          email: row.email,
          name: row.name,
          token_version: row.token_version,
        },
        getSecret(),
      );
      setAuthCookie(res, token);
      res.status(200).json({
        token,
        user: { id: row.id, email: row.email, name: row.name },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/auth/session", auth, (req: Request, res: Response) => {
    res.status(200).json({
      user: {
        id: req.user!.id,
        email: req.user!.email,
        name: req.user!.name,
      },
    });
  });

  app.post("/auth/logout", auth, (req: Request, res: Response) => {
    try {
      db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(req.user!.id);
      clearAuthCookie(res);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/auth/forgot-password", (req: Request, res: Response) => {
    try {
      const body = req.body as { email?: string };
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (isRateLimited(req, res, "forgot-password", hashEmail(email || "missing"))) {
        return;
      }
      if (!email) {
        res.status(400).json({ error: "email is required" });
        return;
      }
      res.status(200).json({
        ok: true,
        message: "Password reset email delivery is not configured in this demo.",
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
