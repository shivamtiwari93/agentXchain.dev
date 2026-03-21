import type { RequestHandler } from "express";
import type { SqliteDb } from "../db.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AuthUser } from "../lib/jwt.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function requireAuth(db: SqliteDb, getSecret: () => string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = header.slice("Bearer ".length);
    try {
      req.user = verifyAccessToken(db, token, getSecret());
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}
