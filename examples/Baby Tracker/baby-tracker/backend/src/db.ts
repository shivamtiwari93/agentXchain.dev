import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SqliteDb = InstanceType<typeof Database>;

function ensureMigrationsTable(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Existing SQLite files from before schema_migrations existed may already have
 * applied 001/002. Infer applied steps so we do not re-run ALTER TABLE.
 */
function backfillMigrationState(db: SqliteDb, migrationFiles: string[]): void {
  const appliedCount = (db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get() as { c: number }).c;
  if (appliedCount > 0) {
    return;
  }

  const hasUsers = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`)
    .get() as { name: string } | undefined;
  if (!hasUsers) {
    return;
  }

  const insert = db.prepare(`INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)`);

  if (migrationFiles.includes("001_init.sql")) {
    insert.run("001_init.sql");
  }

  if (migrationFiles.includes("002_token_version.sql")) {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
    if (cols.some((c) => c.name === "token_version")) {
      insert.run("002_token_version.sql");
    }
  }
}

/**
 * Open SQLite and apply pending migrations (SQL files in order, each once).
 */
export function openDatabase(dbPath: string): SqliteDb {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureMigrationsTable(db);

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  backfillMigrationState(db, files);

  const isApplied = db.prepare(`SELECT 1 FROM schema_migrations WHERE filename = ?`);
  const markApplied = db.prepare(`INSERT INTO schema_migrations (filename) VALUES (?)`);

  for (const file of files) {
    if (isApplied.get(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const run = db.transaction(() => {
      db.exec(sql);
      markApplied.run(file);
    });
    run();
  }

  return db;
}
