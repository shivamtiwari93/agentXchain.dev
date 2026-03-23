import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../db.js";
import { parseISODateOnly } from "../lib/validation.js";
import { requireAuth } from "../middleware/requireAuth.js";

function sendError(res: Response, err: unknown): void {
  const raw =
    typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : NaN;
  const status = Number.isFinite(raw) && raw >= 400 && raw < 600 ? raw : 500;
  const message = status >= 500 ? "Internal server error" : err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
}

function optionalStringField(
  body: Record<string, unknown>,
  key: string,
): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (!(key in body)) {
    return { ok: true, value: undefined };
  }
  const v = body[key];
  if (v === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof v !== "string") {
    return { ok: false, message: `${key} must be a string` };
  }
  return { ok: true, value: v.trim() };
}

function mapBaby(row: {
  id: string;
  name: string;
  date_of_birth: string;
  gender: string;
  created_by_user_id: string;
  created_at: string;
}) {
  return {
    id: row.id,
    name: row.name,
    date_of_birth: row.date_of_birth,
    gender: row.gender,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
  };
}

export function registerBabyRoutes(app: Express, db: SqliteDb, getSecret: () => string): void {
  const auth = requireAuth(db, getSecret);

  app.get("/babies", auth, (req: Request, res: Response) => {
    try {
      const rows = db
        .prepare(
          `SELECT b.id, b.name, b.date_of_birth, b.gender, b.created_by_user_id, b.created_at
           FROM babies b
           INNER JOIN baby_caregivers bc ON bc.baby_id = b.id
           WHERE bc.user_id = ?
           ORDER BY b.created_at DESC`,
        )
        .all(req.user!.id) as Array<{
          id: string;
          name: string;
          date_of_birth: string;
          gender: string;
          created_by_user_id: string;
          created_at: string;
        }>;
      res.json({ babies: rows.map(mapBaby) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/babies", auth, (req: Request, res: Response) => {
    try {
      const body = req.body as { name?: string; date_of_birth?: string; gender?: string };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const dateOfBirth = typeof body.date_of_birth === "string" ? body.date_of_birth.trim() : "";
      const gender = typeof body.gender === "string" ? body.gender.trim() : "";
      if (!name || !dateOfBirth || !gender) {
        res.status(400).json({ error: "name, date_of_birth, and gender are required" });
        return;
      }
      const dob = parseISODateOnly(dateOfBirth);
      if (gender.length > 32) {
        res.status(400).json({ error: "gender is too long" });
        return;
      }

      const babyId = randomUUID();
      const userId = req.user!.id;
      const insertBaby = db.prepare(
        `INSERT INTO babies (id, name, date_of_birth, gender, created_by_user_id)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertCg = db.prepare(
        `INSERT INTO baby_caregivers (baby_id, user_id, role) VALUES (?, ?, 'primary')`,
      );
      const tx = db.transaction(() => {
        insertBaby.run(babyId, name, dob, gender, userId);
        insertCg.run(babyId, userId);
      });
      tx();

      const row = db
        .prepare(
          `SELECT id, name, date_of_birth, gender, created_by_user_id, created_at FROM babies WHERE id = ?`,
        )
        .get(babyId) as {
        id: string;
        name: string;
        date_of_birth: string;
        gender: string;
        created_by_user_id: string;
        created_at: string;
      };
      res.status(201).json(mapBaby(row));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put("/babies/:id", auth, (req: Request, res: Response) => {
    try {
      const babyId = req.params.id;
      const access = db
        .prepare(`SELECT 1 FROM baby_caregivers WHERE baby_id = ? AND user_id = ?`)
        .get(babyId, req.user!.id) as { 1: number } | undefined;
      if (!access) {
        res.status(404).json({ error: "Baby not found" });
        return;
      }

      if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Request body must be a JSON object" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const current = db
        .prepare(
          `SELECT id, name, date_of_birth, gender, created_by_user_id, created_at FROM babies WHERE id = ?`,
        )
        .get(babyId) as
        | {
            id: string;
            name: string;
            date_of_birth: string;
            gender: string;
            created_by_user_id: string;
            created_at: string;
          }
        | undefined;
      if (!current) {
        res.status(404).json({ error: "Baby not found" });
        return;
      }

      const nameField = optionalStringField(body, "name");
      if (!nameField.ok) {
        res.status(400).json({ error: nameField.message });
        return;
      }
      const dobField = optionalStringField(body, "date_of_birth");
      if (!dobField.ok) {
        res.status(400).json({ error: dobField.message });
        return;
      }
      const genderField = optionalStringField(body, "gender");
      if (!genderField.ok) {
        res.status(400).json({ error: genderField.message });
        return;
      }

      const name = nameField.value !== undefined ? nameField.value : current.name;
      const dateOfBirth =
        dobField.value !== undefined ? parseISODateOnly(dobField.value) : current.date_of_birth;
      const gender = genderField.value !== undefined ? genderField.value : current.gender;
      if (!name || !gender) {
        res.status(400).json({ error: "name and gender cannot be empty" });
        return;
      }
      if (gender.length > 32) {
        res.status(400).json({ error: "gender is too long" });
        return;
      }

      db.prepare(
        `UPDATE babies SET name = ?, date_of_birth = ?, gender = ? WHERE id = ?`,
      ).run(name, dateOfBirth, gender, babyId);

      const row = db
        .prepare(
          `SELECT id, name, date_of_birth, gender, created_by_user_id, created_at FROM babies WHERE id = ?`,
        )
        .get(babyId) as {
        id: string;
        name: string;
        date_of_birth: string;
        gender: string;
        created_by_user_id: string;
        created_at: string;
      };
      res.json(mapBaby(row));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/babies/:id", auth, (req: Request, res: Response) => {
    try {
      const babyId = req.params.id;
      const result = db
        .prepare(`DELETE FROM babies WHERE id = ? AND created_by_user_id = ?`)
        .run(babyId, req.user!.id);
      if (result.changes === 0) {
        const exists = db.prepare(`SELECT created_by_user_id FROM babies WHERE id = ?`).get(babyId) as
          | { created_by_user_id: string }
          | undefined;
        if (!exists) {
          res.status(404).json({ error: "Baby not found" });
          return;
        }
        res.status(403).json({ error: "Only the creator can delete this baby" });
        return;
      }
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });
}
