import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../db.js";
import { signAccessToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { assertPassword, isValidEmail } from "../lib/validation.js";
import { requireAuth } from "../middleware/requireAuth.js";

function sendError(res: Response, err: unknown): void {
  const raw =
    typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : NaN;
  const status = Number.isFinite(raw) && raw >= 400 && raw < 600 ? raw : 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
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
      res.status(200).json({
        token,
        user: { id: row.id, email: row.email, name: row.name },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/auth/logout", auth, (req: Request, res: Response) => {
    try {
      db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(req.user!.id);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/auth/forgot-password", (req: Request, res: Response) => {
    try {
      const body = req.body as { email?: string };
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (!email) {
        res.status(400).json({ error: "email is required" });
        return;
      }
      const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      console.log(`[forgot-password] email=${email} reset_token=${token}`);
      res.status(200).json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}
