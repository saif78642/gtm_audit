-- GTM Auditor – Full Schema
-- Run via: npx wrangler d1 execute gtm-chat-history --file=./schema.sql --remote

-- ── Enforce foreign key constraints (SQLite has them OFF by default) ──────────

PRAGMA foreign_keys = ON;

-- ── Authentication ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id         TEXT    PRIMARY KEY,
  username   TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL UNIQUE
                     CHECK(email LIKE '%_@_%.__%'),
  password   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS invite_keys (
  invite_key TEXT    PRIMARY KEY,
  created_by TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_by    TEXT             REFERENCES users(id) ON DELETE SET NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

-- ── Auth indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user
  ON auth_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires
  ON auth_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_invite_keys_created_by
  ON invite_keys(created_by);

-- ── Chat History ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT 'New Chat',
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user', 'model')),
  text       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- ── Chat indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_id, created_at);

-- ── Maintenance ───────────────────────────────────────────────────────────────
-- Purge expired auth tokens periodically (run manually or via a CRON trigger):
--   DELETE FROM auth_tokens WHERE expires_at < (strftime('%s','now') * 1000);
