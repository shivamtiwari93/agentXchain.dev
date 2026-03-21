import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SqliteDb = InstanceType<typeof Database>;

/**
 * Open SQLite and apply schema migrations (SQL files in order).
 * Use `:memory:` for tests; set DATABASE_PATH for persistent storage.
 */
export function openDatabase(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
  }
  return db;
}
