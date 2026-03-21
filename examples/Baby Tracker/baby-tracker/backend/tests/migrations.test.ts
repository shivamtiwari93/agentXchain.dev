import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";

describe("Database migrations", () => {
  it("does not re-apply ALTER migrations on second open (BUG-006)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-mig-"));
    const dbPath = path.join(dir, "app.db");

    const db1 = openDatabase(dbPath);
    const count1 = db1.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get() as { c: number };
    expect(count1.c).toBeGreaterThanOrEqual(2);
    db1.close();

    const db2 = openDatabase(dbPath);
    const count2 = db2.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get() as { c: number };
    expect(count2.c).toBe(count1.c);
    db2.close();
  });
});
