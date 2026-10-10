import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';

// PostgreSQL (Supabase) connection — SQLite-compatible API shim.
// Routes keep using db.prepare(sql).get/.all/.run(...), executed against Postgres.
// POSTGRES_URL is provided by the Supabase ↔ Vercel integration.

let pool = null;

function getPool() {
  if (pool) return pool;
  const cs =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (!cs) throw new Error('Database not configured: set POSTGRES_URL');
  const isLocal = /localhost|127\.0\.0\.1/.test(cs);
  if (!isLocal) {
    // Supabase poolers present a self-signed certificate chain that Node's
    // default TLS validation rejects. The lambda only talks to Supabase, so
    // skip chain verification for this process.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  // Pass discrete params (NOT connectionString) so pg-connection-string cannot
  // re-parse ssl params from the URL and override our ssl settings.
  let cfg;
  try {
    const u = new URL(cs);
    cfg = {
      host: u.hostname,
      port: Number(u.port) || 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') || 'postgres',
    };
  } catch {
    cfg = { connectionString: cs };
  }
  pool = new pg.Pool({
    ...cfg,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (e) => console.error('[db] pool error:', e.message));
  return pool;
}

// Translate SQLite-isms to Postgres. Parameters are inlined as SQL literals
// (simple protocol) so Postgres type-infers each literal — e.g. a uuid string
// compared against a uuid column just works, no "uuid = text" errors.
let legacyTimestamps = false;

function inline(sql, params = []) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === undefined || v === null) return 'NULL';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

function translate(sql) {
  let s = sql;
  s = s.replace(
    /strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/g,
    legacyTimestamps ? 'now()' : `to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  );
  s = s.replace(/COUNT\s*\(\s*\*\s*\)/g, 'COUNT(*)::int');
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    s = s + ' ON CONFLICT DO NOTHING';
  }
  return s;
}

export const db = {
  prepare(sql) {
    return {
      async get(...params) {
        const r = await getPool().query(translate(inline(sql, params)));
        return r.rows[0];
      },
      async all(...params) {
        const r = await getPool().query(translate(inline(sql, params)));
        return r.rows;
      },
      async run(...params) {
        const r = await getPool().query(translate(inline(sql, params)));
        return { changes: r.rowCount ?? 0, lastInsertRowid: null };
      },
    };
  },
  async exec() {
    /* schema is ensured by initSchema() */
  },
};

// ---------- idempotent schema bootstrapping (runs once per instance) ----------
let schemaReady = false;

export async function initSchema() {
  if (schemaReady) return;
  const cs =
    process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
  if (!cs) return; // nothing to do (e.g. local boot without DB)
  const p = getPool();
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT, embed_token TEXT UNIQUE NOT NULL, prototype_url TEXT,
      is_public INTEGER NOT NULL DEFAULT 1, allowed_domains TEXT NOT NULL DEFAULT '*',
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      type TEXT NOT NULL DEFAULT 'website', client_name TEXT)`,
    `CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
      UNIQUE (project_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL, author_email TEXT,
      element_selector TEXT NOT NULL, element_snapshot TEXT NOT NULL,
      page_url TEXT NOT NULL, page_path TEXT NOT NULL DEFAULT '/', content TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'suggestion' CHECK (type IN ('bug','suggestion','question','other','design_change','ux','content','accessibility','performance','feature')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','reopened')),
      resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL, resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT, action TEXT NOT NULL, metadata TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      brand_color TEXT NOT NULL DEFAULT '#4f46e5', plan TEXT NOT NULL DEFAULT 'free',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
      UNIQUE (workspace_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS review_rounds (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
      deadline TEXT, requires_approval INTEGER NOT NULL DEFAULT 0, instructions TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
      name TEXT NOT NULL, source_url TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
      version_id TEXT REFERENCES versions(id) ON DELETE SET NULL,
      reviewer_name TEXT NOT NULL, reviewer_email TEXT,
      status TEXT NOT NULL CHECK (status IN ('approved','changes_requested')),
      note TEXT, signed_name TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT, feedback_ref TEXT, type TEXT NOT NULL, message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','connected','error')),
      configuration TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    `CREATE TABLE IF NOT EXISTS integration_events (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      feedback_id TEXT, event_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'success',
      payload TEXT, error_message TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    // migration columns (original SQLite addColumnIfMissing set)
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS ref TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS title TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS category TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS assignee_id TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS region TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS round_id TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS version_id TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS screenshot_url TEXT`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS tech_meta TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS external_task_id TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'website'`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id)`,
    `CREATE OR REPLACE FUNCTION set_comment_ref() RETURNS trigger AS $$
     BEGIN
       IF NEW.ref IS NULL AND NEW.parent_comment_id IS NULL THEN
         SELECT 'CF-' || lpad(((COALESCE(MAX(NULLIF(regexp_replace(c.ref, '\\D', '', 'g'), '')::int), 0)) + 1)::text, 4, '0')
           INTO NEW.ref FROM comments c
          WHERE c.project_id = NEW.project_id AND (c.ref LIKE 'CF-%' OR c.ref LIKE 'NB-%');
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS trg_comments_ref ON comments`,
    `CREATE TRIGGER trg_comments_ref BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION set_comment_ref()`,
  ];
  for (const stmt of statements) {
    try {
      await p.query(stmt);
    } catch (e) {
      console.error('[db] schema statement failed:', e.message);
    }
  }
  // Align join-column types with parent id columns: databases created from the
  // older UUID schema need comments.assignee_id/round_id/version_id as uuid so
  // joins like `users.id = comments.assignee_id` don't fail with uuid = text.
  try {
    const t = await p.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'review_rounds' AND column_name = 'id'`
    );
    const idType = t.rows[0]?.data_type;
    if (idType === 'uuid') {
      for (const col of ['assignee_id', 'round_id', 'version_id']) {
        await p.query(
          `UPDATE comments SET ${col} = NULL WHERE ${col} IS NOT NULL AND ${col} !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
        );
        await p.query(`ALTER TABLE comments ALTER COLUMN ${col} TYPE uuid USING NULLIF(${col}, '')::uuid`);
      }
      console.log('[db] aligned comment join columns to uuid');
    }
  } catch (e) {
    console.error('[db] join column alignment failed:', e.message);
  }
  // Normalize legacy JSONB columns to TEXT: the app stores/handles JSON as
  // strings (JSON.parse/stringify at the edges) and expects text back.
  const jsonbCols = [
    ['comments', 'element_snapshot'],
    ['comments', 'tech_meta'],
    ['activity_log', 'metadata'],
    ['integrations', 'configuration'],
    ['integration_events', 'payload'],
  ];
  for (const [tbl, col] of jsonbCols) {
    try {
      const t = await p.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name = '${tbl}' AND column_name = '${col}'`
      );
      if (t.rows[0]?.data_type === 'jsonb') {
        await p.query(`ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE TEXT USING COALESCE(${col}::text, '{}')`);
      }
    } catch (e) {
      console.error(`[db] jsonb normalization failed for ${tbl}.${col}:`, e.message);
    }
  }
  // Detect legacy timestamptz timestamps: strftime replacement must then use
  // now() (timestamptz) instead of to_char(...) (text).
  try {
    const t = await p.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'comments' AND column_name = 'updated_at'`
    );
    legacyTimestamps = t.rows[0]?.data_type === 'timestamp with time zone';
  } catch {
    /* keep false */
  }
  schemaReady = true;
  console.log('[db] schema ready');
}

export default db;

// ---------- helpers (same API as the original SQLite db.js) ----------

export const uuid = () => randomUUID();
export const newEmbedToken = () => randomBytes(16).toString('hex');
export const now = () => new Date().toISOString();

// Human-readable unique reference, e.g. CF-0042, sequential per project
export async function nextRef(projectId) {
  const row = await db
    .prepare(
      `SELECT MAX(CAST(SUBSTR(ref, 4) AS INTEGER)) AS max FROM comments
       WHERE project_id = ? AND (ref LIKE 'NB-%' OR ref LIKE 'CF-%')`
    )
    .get(projectId);
  return 'CF-' + String((row?.max || 0) + 1).padStart(4, '0');
}

export async function logActivity(projectId, userId, action, metadata = {}) {
  try {
    await db
      .prepare(
        'INSERT INTO activity_log (id, project_id, user_id, action, metadata) VALUES (?, ?, ?, ?, ?)'
      )
      .run(uuid(), projectId, userId ?? null, action, JSON.stringify(metadata));
  } catch (e) {
    console.error('[db] logActivity failed:', e.message);
  }
}

export async function notifyUser(userId, projectId, type, message, feedbackRef = null) {
  if (!userId) return;
  try {
    await db
      .prepare(
        'INSERT INTO notifications (id, user_id, project_id, feedback_ref, type, message) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(uuid(), userId, projectId ?? null, feedbackRef, type, message);
  } catch (e) {
    console.error('[db] notifyUser failed:', e.message);
  }
}
