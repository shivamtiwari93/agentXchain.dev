-- Invalidate JWTs on logout by bumping per-user version (payload must match DB).

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
