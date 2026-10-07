import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'notely.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

export default db;

// ---------- Contextly v2 tables ----------
db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  brand_color TEXT NOT NULL DEFAULT '#4f46e5',
  plan TEXT NOT NULL DEFAULT 'free',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  feedback_ref TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','connected','error')),
  configuration TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS integration_events (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  feedback_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  payload TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

export const uuid = () => randomUUID();
export const newEmbedToken = () => randomBytes(16).toString('hex');
export const now = () => new Date().toISOString();

// Human-readable unique reference, e.g. CF-0042, sequential per project (legacy NB- refs counted too)
export function nextRef(projectId) {
  const row = db
    .prepare(
      `SELECT MAX(CAST(SUBSTR(ref, 4) AS INTEGER)) AS max FROM comments
       WHERE project_id = ? AND (ref LIKE 'NB-%' OR ref LIKE 'CF-%')`
    )
    .get(projectId);
  return 'CF-' + String((row?.max || 0) + 1).padStart(4, '0');
}

// --- lightweight migrations (safe to run on every boot) ---
function addColumnIfMissing(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
}
addColumnIfMissing('comments', 'ref', 'ref TEXT');
addColumnIfMissing('comments', 'title', 'title TEXT');
addColumnIfMissing('comments', 'category', 'category TEXT');
addColumnIfMissing('comments', 'assignee_id', 'assignee_id TEXT');
addColumnIfMissing('comments', 'tags', "tags TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('comments', 'region', 'region TEXT');
addColumnIfMissing('comments', 'round_id', 'round_id TEXT');
addColumnIfMissing('comments', 'version_id', 'version_id TEXT');
addColumnIfMissing('comments', 'screenshot_url', 'screenshot_url TEXT');
addColumnIfMissing('comments', 'tech_meta', "tech_meta TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing('comments', 'external_task_id', 'external_task_id TEXT');
addColumnIfMissing('projects', 'type', "type TEXT NOT NULL DEFAULT 'website'");
addColumnIfMissing('projects', 'client_name', 'client_name TEXT');

// Backfill refs for comments created before the ref column existed
const missingRefs = db
  .prepare(`SELECT DISTINCT project_id FROM comments WHERE ref IS NULL`)
  .all();
for (const { project_id } of missingRefs) {
  const rows = db
    .prepare(`SELECT id FROM comments WHERE project_id = ? AND ref IS NULL ORDER BY created_at ASC`)
    .all(project_id);
  for (const { id } of rows) {
    db.prepare(`UPDATE comments SET ref = ? WHERE id = ?`).run(nextRef(project_id), id);
  }
}

export function logActivity(projectId, userId, action, metadata = {}) {
  db.prepare(
    'INSERT INTO activity_log (id, project_id, user_id, action, metadata) VALUES (?, ?, ?, ?, ?)'
  ).run(uuid(), projectId, userId ?? null, action, JSON.stringify(metadata));
}

export function notifyUser(userId, projectId, type, message, feedbackRef = null) {
  if (!userId) return;
  db.prepare(
    'INSERT INTO notifications (id, user_id, project_id, feedback_ref, type, message) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuid(), userId, projectId ?? null, feedbackRef, type, message);
}
