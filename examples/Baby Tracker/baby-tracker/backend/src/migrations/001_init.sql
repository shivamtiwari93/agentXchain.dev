-- Phase 1 core schema: users, babies, caregiver join (R1, R2)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  gender TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS baby_caregivers (
  baby_id TEXT NOT NULL REFERENCES babies (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (baby_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_babies_created_by ON babies (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_baby_caregivers_user ON baby_caregivers (user_id);
