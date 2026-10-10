-- ============================================================
-- Notely — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL Editor (one time).
-- Mirrors the original SQLite schema exactly (TEXT ids/timestamps)
-- so the server's SQL works unchanged through the pg shim.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  embed_token TEXT UNIQUE NOT NULL,
  prototype_url TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  allowed_domains TEXT NOT NULL DEFAULT '*',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  type TEXT NOT NULL DEFAULT 'website',
  client_name TEXT
);

CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  element_selector TEXT NOT NULL,
  element_snapshot TEXT NOT NULL,
  page_url TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '/',
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'suggestion' CHECK (type IN ('bug','suggestion','question','other','design_change','ux','content','accessibility','performance','feature')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','reopened')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  ref TEXT,
  title TEXT,
  category TEXT,
  assignee_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  region TEXT,
  round_id TEXT,
  version_id TEXT,
  screenshot_url TEXT,
  tech_meta TEXT NOT NULL DEFAULT '{}',
  external_task_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  brand_color TEXT NOT NULL DEFAULT '#4f46e5',
  plan TEXT NOT NULL DEFAULT 'free',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_rounds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  deadline TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  instructions TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES versions(id) ON DELETE SET NULL,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('approved','changes_requested')),
  note TEXT,
  signed_name TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  feedback_ref TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','connected','error')),
  configuration TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS integration_events (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  feedback_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  payload TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- ------------------------------------------------------------
-- Auto-generate human-readable refs (CF-0001, CF-0002, …) for
-- top-level comments when `ref` is not provided by the app.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_comment_ref() RETURNS trigger AS $$
BEGIN
  IF NEW.ref IS NULL AND NEW.parent_comment_id IS NULL THEN
    SELECT 'CF-' || lpad(((COALESCE(MAX(NULLIF(regexp_replace(c.ref, '\D', '', 'g'), '')::int), 0)) + 1)::text, 4, '0')
      INTO NEW.ref
      FROM comments c
     WHERE c.project_id = NEW.project_id AND (c.ref LIKE 'CF-%' OR c.ref LIKE 'NB-%');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comments_ref ON comments;
CREATE TRIGGER trg_comments_ref
  BEFORE INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION set_comment_ref();
