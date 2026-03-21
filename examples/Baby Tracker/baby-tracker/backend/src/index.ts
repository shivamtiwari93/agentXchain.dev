import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";

const dbPath = process.env.DATABASE_PATH ?? "./data/baby-tracker.db";
if (dbPath !== ":memory:") {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

const db = openDatabase(dbPath);
const app = createApp(db);
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Baby Tracker API listening on http://127.0.0.1:${port}`);
});
