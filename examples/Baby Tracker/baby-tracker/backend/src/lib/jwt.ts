import jwt from "jsonwebtoken";
import type { SqliteDb } from "../db.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  tokenVersion: number;
}

interface TokenPayload extends jwt.JwtPayload {
  sub: string;
  v: number;
}

export function signAccessToken(
  user: { id: string; email: string; name: string; token_version: number },
  secret: string,
  expiresIn: jwt.SignOptions["expiresIn"] = "7d",
): string {
  return jwt.sign({ v: user.token_version }, secret, {
    subject: user.id,
    expiresIn,
  });
}

export function verifyAccessToken(db: SqliteDb, token: string, secret: string): AuthUser {
  const decoded = jwt.verify(token, secret) as TokenPayload;
  const userId = decoded.sub;
  if (!userId) {
    const err = new Error("Invalid token");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  const row = db
    .prepare(`SELECT id, email, name, token_version FROM users WHERE id = ?`)
    .get(userId) as
    | { id: string; email: string; name: string; token_version: number }
    | undefined;
  if (!row) {
    throw new Error("User not found");
  }
  if (row.token_version !== decoded.v) {
    const err = new Error("Token revoked");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    tokenVersion: row.token_version,
  };
}
