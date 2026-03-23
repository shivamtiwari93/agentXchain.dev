import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "production") {
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  console.warn("JWT_SECRET was not set. Using an ephemeral development secret for this process only.");
}

const dbPath = process.env.DATABASE_PATH ?? "./data/baby-tracker.db";
if (dbPath !== ":memory:") {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

const db = openDatabase(dbPath);
const app = createApp(db);
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";

app.listen(port, host, () => {
  console.log(`Baby Tracker API listening on http://${host}:${port}`);
});
