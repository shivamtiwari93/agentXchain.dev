import express from "express";
import type { SqliteDb } from "./db.js";

export function createApp(_db: SqliteDb): express.Application {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
