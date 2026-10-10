import { Router } from 'express';
import db, { uuid, logActivity, notifyUser, nextRef } from '../db.js';
import { requireAuth, getWorkspaceId } from '../auth.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['bug', 'suggestion', 'question', 'other'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'in_progress', 'resolved', 'reopened'];

async function assertMember(projectId, userId) {
  return await db.prepare(
      `SELECT p.* FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.id = ? AND (p.owner_id = ? OR m.user_id IS NOT NULL)`
    )
    .get(userId, projectId, userId);
}

function withReplies(rows) {
  const roots = [];
  const byId = new Map();
  for (const r of rows) {
    const c = { ...r, is_internal: !!r.is_internal, replies: [] };
    byId.set(c.id, c);
  }
  for (const c of byId.values()) {
    if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
      byId.get(c.parent_comment_id).replies.push(c);
    } else {
      roots.push(c);
    }
  }
  return roots;
}

// List comments for a project, with filters
router.get('/:projectId/comments', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  const clauses = ['c.project_id = ?'];
  const params = [p.id];
  const { status, type, priority, page_url, q } = req.query;
  if (status && STATUSES.includes(status)) {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (type && TYPES.includes(type)) {
    clauses.push('c.type = ?');
    params.push(type);
  }
  if (priority && PRIORITIES.includes(priority)) {
    clauses.push('c.priority = ?');
    params.push(priority);
  }
  if (page_url) {
    clauses.push('c.page_path = ?');
    params.push(page_url);
  }
  if (q) {
    clauses.push('(c.content LIKE ? OR c.element_selector LIKE ? OR c.author_name LIKE ? OR c.ref LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = await db.prepare(
      `SELECT c.*, rb.name AS resolved_by_name, asg.name AS assignee_name, r.name AS round_name, v.name AS version_name
       FROM comments c
       LEFT JOIN users rb ON rb.id = c.resolved_by
       LEFT JOIN users asg ON asg.id = c.assignee_id
       LEFT JOIN review_rounds r ON r.id = c.round_id
       LEFT JOIN versions v ON v.id = c.version_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.created_at ASC`
    )
    .all(...params);
  const withMeta = rows.map((r) => ({ ...r, is_internal: !!r.is_internal, tags: JSON.parse(r.tags || '[]') }));
  res.json({ comments: withReplies(withMeta) });
});

// Workspace members (for assignee pickers)
router.get('/:projectId/assignees', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const wsId = await getWorkspaceId(req.user.id);
  const members = wsId
    ? await db.prepare(
          `SELECT DISTINCT u.id, u.email, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
           UNION SELECT u.id, u.email, u.name FROM users u WHERE u.id = (SELECT owner_id FROM workspaces WHERE id = ?)`
        )
        .all(wsId, wsId)
    : [req.user];
  res.json({ members });
});

// Machine-readable JSON export (AI-coding-agent ready)
router.get('/:projectId/export.json', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const rows = await db.prepare(
      `SELECT c.*, asg.name AS assignee_name, r.name AS round_name, v.name AS version_name
       FROM comments c
       LEFT JOIN users asg ON asg.id = c.assignee_id
       LEFT JOIN review_rounds r ON r.id = c.round_id
       LEFT JOIN versions v ON v.id = c.version_id
       WHERE c.project_id = ? ORDER BY c.created_at ASC`
    )
    .all(p.id);
  const roots = rows.filter((r) => !r.parent_comment_id);
  const exportItems = roots.map((f) => ({
    feedback_id: f.ref,
    project: p.name,
    review_round: f.round_name,
    version: f.version_name,
    title: f.title || f.ref,
    type: f.type,
    category: f.category,
    priority: f.priority,
    status: f.status,
    assignee: f.assignee_name,
    page_url: f.page_url,
    route: f.page_path,
    target: {
      selector: f.element_selector,
      region: f.region ? JSON.parse(f.region) : null,
      bounding_box: (JSON.parse(f.element_snapshot || '{}').boundingBox) ?? null,
    },
    description: f.content,
    comments: rows
      .filter((r) => r.parent_comment_id === f.id)
      .map((r) => ({ author: r.author_name, body: r.content, created_at: r.created_at })),
    tags: JSON.parse(f.tags || '[]'),
    external_task_id: f.external_task_id,
    technical_context: JSON.parse(f.tech_meta || '{}'),
    created_at: f.created_at,
    resolved_at: f.resolved_at,
  }));
  res.json({ project: p.name, generated_at: new Date().toISOString(), feedback: exportItems });
});

// Distinct pages for the page list sidebar
router.get('/:projectId/pages', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const pages = await db.prepare(
      `SELECT page_path, COUNT(*) AS count FROM comments WHERE project_id = ? GROUP BY page_path ORDER BY count DESC`
    )
    .all(p.id);
  res.json({ pages });
});

// Create a comment (top-level or reply) from the dashboard
router.post('/:projectId/comments', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const { content, parent_comment_id, element_selector, element_snapshot, page_url, type, priority, is_internal } =
    req.body ?? {};
  if (!content || !String(content).trim()) return res.status(400).json({ error: 'Comment text is required' });

  const id = uuid();
  await db.prepare(
    `INSERT INTO comments (id, project_id, parent_comment_id, author_id, author_name, author_email,
       element_selector, element_snapshot, page_url, page_path, content, is_internal, type, priority, ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    p.id,
    parent_comment_id ?? null,
    req.user.id,
    req.user.name,
    req.user.email,
    element_selector ?? '(dashboard)',
    JSON.stringify({ source: 'dashboard' }),
    page_url ?? p.prototype_url ?? '(dashboard)',
    safePath(page_url ?? '/'),
    String(content).trim(),
    is_internal ? 1 : 0,
    TYPES.includes(type) ? type : 'suggestion',
    PRIORITIES.includes(priority) ? priority : 'medium',
    parent_comment_id ? null : await nextRef(p.id)
  );
  await logActivity(p.id, req.user.id, 'comment.created', { id });
  const row = await db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  res.status(201).json({ comment: { ...row, is_internal: !!row.is_internal, replies: [] } });
});

// Update a comment (status, priority, type, content, internal flag)
router.patch('/comments/:id', async (req, res) => {
  const c = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  const p = await assertMember(c.project_id, req.user.id);
  if (!p) return res.status(403).json({ error: 'No access to this project' });

  const fields = [];
  const values = [];
  const body = req.body ?? {};
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
    fields.push('status = ?');
    values.push(body.status);
    if (body.status === 'resolved') {
      fields.push('resolved_by = ?', 'resolved_at = ?');
      values.push(req.user.id, new Date().toISOString());
    } else {
      fields.push('resolved_by = NULL', 'resolved_at = NULL');
    }
  }
  if ('priority' in body) {
    if (!PRIORITIES.includes(body.priority)) return res.status(400).json({ error: 'Invalid priority' });
    fields.push('priority = ?');
    values.push(body.priority);
  }
  if ('type' in body) {
    if (!TYPES.includes(body.type)) return res.status(400).json({ error: 'Invalid type' });
    fields.push('type = ?');
    values.push(body.type);
  }
  if ('content' in body && String(body.content).trim()) {
    fields.push('content = ?');
    values.push(String(body.content).trim());
  }
  if ('is_internal' in body) {
    fields.push('is_internal = ?');
    values.push(body.is_internal ? 1 : 0);
  }
  if ('title' in body) {
    fields.push('title = ?');
    values.push(body.title ? String(body.title).trim().slice(0, 200) : null);
  }
  if ('category' in body) {
    fields.push('category = ?');
    values.push(body.category ? String(body.category).slice(0, 40) : null);
  }
  if ('assignee_id' in body) {
    fields.push('assignee_id = ?');
    values.push(body.assignee_id || null);
    if (body.assignee_id && body.assignee_id !== req.user.id) {
      await notifyUser(body.assignee_id, c.project_id, 'assigned', `You were assigned ${c.ref || 'feedback'}`, c.ref);
    }
  }
  if ('tags' in body && Array.isArray(body.tags)) {
    fields.push('tags = ?');
    values.push(JSON.stringify(body.tags.slice(0, 10).map((t) => String(t).slice(0, 30))));
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  values.push(c.id);
  await db.prepare(`UPDATE comments SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  if ('status' in body) await logActivity(c.project_id, req.user.id, `comment.${body.status}`, { id: c.id });
  if ('status' in body && body.status === 'resolved' && c.author_id && c.author_id !== req.user.id) {
    await notifyUser(c.author_id, c.project_id, 'resolved', `${c.ref || 'Your feedback'} was marked resolved by ${req.user.name}`, c.ref);
  }
  const row = await db.prepare(
      `SELECT c.*, rb.name AS resolved_by_name FROM comments c LEFT JOIN users rb ON rb.id = c.resolved_by WHERE c.id = ?`
    )
    .get(c.id);
  res.json({ comment: { ...row, is_internal: !!row.is_internal } });
});

router.delete('/comments/:id', async (req, res) => {
  const c = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  const p = await assertMember(c.project_id, req.user.id);
  if (!p) return res.status(403).json({ error: 'No access to this project' });
  await db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  await logActivity(c.project_id, req.user.id, 'comment.deleted', { id: c.id });
  res.json({ ok: true });
});

function safePath(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

export default router;
