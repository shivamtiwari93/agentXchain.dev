import express from "express";
import type { SqliteDb } from "./db.js";
import { getJwtSecret } from "./config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBabyRoutes } from "./routes/babies.js";

export function createApp(db: SqliteDb): express.Application {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  const getSecret = (): string => getJwtSecret();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerAuthRoutes(app, db, getSecret);
  registerBabyRoutes(app, db, getSecret);

  return app;
}
