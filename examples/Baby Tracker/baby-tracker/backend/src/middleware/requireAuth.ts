import type { RequestHandler } from "express";
import type { SqliteDb } from "../db.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AuthUser } from "../lib/jwt.js";

const AUTH_COOKIE_NAME = "baby_tracker_session";

function readAuthToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== AUTH_COOKIE_NAME) continue;
    const value = rawValue.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function requireAuth(db: SqliteDb, getSecret: () => string): RequestHandler {
  return (req, res, next) => {
    const cookieToken = readAuthToken(req.headers.cookie);
    const header = req.headers.authorization;
    const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const token = cookieToken || bearerToken;

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      req.user = verifyAccessToken(db, token, getSecret());
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}
