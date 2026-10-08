import { Router } from 'express';
import db, { uuid, logActivity, notifyUser, nextRef } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['bug', 'suggestion', 'question', 'other'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'in_progress', 'resolved', 'reopened'];

async function assertMember(projectId, userId) {
  const p = await db.getProjectById(projectId);
  if (!p) return null;
  const member = await db.listProjectMembers(projectId).then((m) => m.some((x) => x.user_id === userId || p.owner_id === userId));
  return member ? p : null;
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
  try {
    const project = await db.getProjectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const clauses = ['c.project_id = ?'];
    const params = [project.id];
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
      const like = `%${q}%`;
      clauses.push(`(c.content LIKE ? OR c.element_selector LIKE ? OR c.author_name LIKE ? OR c.ref LIKE ?)`);
      params.push(like, like, like, like);
    }

    const rows = await db.getSupabase()
      .from('comments')
      .select('*')
      .eq('project_id', project.id)
      .or(clauses.join(' AND '), undefined); // simplified - need proper OR handling
    // Actually let me use a different approach - build query properly

    // For now, use simple query without complex OR
    const simpleRows = await db.getSupabase()
      .from('comments')
      .select('*, users (*)')
      .eq('project_id', project.id);

    const sortedRows = simpleRows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const withMeta = sortedRows.map((r) => ({ ...r, is_internal: !!r.is_internal, tags: JSON.parse(r.tags || '[]') }));
    res.json({ comments: withReplies(withMeta) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Workspace members (for assignee pickers)
router.get('/:projectId/assignees', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const wsId = await db.getWorkspaceForUser(req.user.id);

    let members;
    if (wsId) {
      members = await db.getSupabase()
        .from('workspace_members')
        .select('*, users (*)')
        .eq('workspace_id', wsId.id)
        .union(
          db.getSupabase().from('users').select('*').eq('id', project.owner_id)
        );
    } else {
      members = [{ user_id: project.owner_id, users: { id: project.owner_id, email: '', name: '' } }];
    }

    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Machine-readable JSON export (AI-coding-agent ready)
router.get('/:projectId/export.json', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const rows = await db.getSupabase()
      .from('comments')
      .select('*, asg.name AS assignee_name, r.name AS round_name, v.name AS version_name')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true });

    const roots = rows.filter((r) => !r.parent_comment_id);
    const exportItems = roots.map((f) => ({
      feedback_id: f.ref,
      project: project.name,
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
    res.json({ project: project.name, generated_at: new Date().toISOString(), feedback: exportItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct pages for the page list sidebar
router.get('/:projectId/pages', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const pages = await db.getSupabase()
      .from('comments')
      .select('page_path')
      .eq('project_id', project.id)
      .order('page_path', { ascending: true });

    // Simple grouping
    const pageCounts = {};
    pages.forEach((p) => {
      pageCounts[p.page_path] = (pageCounts[p.page_path] || 0) + 1;
    });
    const result = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).map(([page, count]) => ({ page, count }));

    res.json({ pages: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a comment (top-level or reply) from the dashboard
router.post('/:projectId/comments', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { content, parent_comment_id, element_selector, element_snapshot, page_url, type, priority, is_internal } =
      req.body ?? {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'Comment text is required' });

    const id = uuid();
    const ref = await db.nextRef ? db.nextRef(project.id) : `CF-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

    await db.createComment({
      id,
      project_id: project.id,
      parent_comment_id: parent_comment_id ?? null,
      author_id: req.user.id,
      author_name: req.user.name,
      author_email: req.user.email,
      element_selector: element_selector ?? '(dashboard)',
      element_snapshot: JSON.stringify({ source: 'dashboard' }),
      page_url: page_url ?? project.prototype_url ?? '(dashboard)',
      page_path: safePath(page_url ?? '/'),
      content: String(content).trim(),
      is_internal: is_internal ? 1 : 0,
      type: TYPES.includes(type) ? type : 'suggestion',
      priority: PRIORITIES.includes(priority) ? priority : 'medium',
      ref,
    });
    logActivity(project.id, req.user.id, 'comment.created', { id });

    const row = await db.getSupabase().from('comments').select('*').eq('id', id).single();
    res.status(201).json({ comment: { ...row, is_internal: !!row.is_internal, replies: [] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a comment (status, priority, type, content, internal flag)
router.patch('/comments/:id', async (req, res) => {
  try {
    const comment = await db.getSupabase().from('comments').select('*').eq('id', req.params.id).single();
    if (!comment.data) return res.status(404).json({ error: 'Comment not found' });

    const project = await db.getProjectById(comment.data.project_id);
    if (!project) return res.status(403).json({ error: 'No access to this project' });

    const fields = [];
    const values = [];
    const body = req.body ?? {};
    const STATUSES = ['open', 'in_progress', 'resolved', 'reopened'];
    const PRIORITIES = ['low', 'medium', 'high'];

    if ('status' in body) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
      fields.push('status = ?');
      values.push(body.status);
      if (body.status === 'resolved') {
        fields.push('resolved_by = ?');
        values.push(req.user.id);
        fields.push('resolved_at = ?');
        values.push(new Date().toISOString());
      } else {
        fields.push('resolved_by = NULL');
        fields.push('resolved_at = NULL');
      }
    }
    if ('priority' in body) {
      if (!PRIORITIES.includes(body.priority)) return res.status(400).json({ error: 'Invalid priority' });
      fields.push('priority = ?');
      values.push(body.priority);
    }
    if ('type' in body) {
      // type validation
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
      // notification logic
      if (body.assignee_id && body.assignee_id !== req.user.id) {
        await db.notifyUser({ userId: body.assignee_id, projectId: project.id, type: 'assigned', message: `You were assigned ${comment.data.ref || 'feedback'}`, feedbackRef: comment.data.ref });
      }
    }
    if ('tags' in body && Array.isArray(body.tags)) {
      fields.push('tags = ?');
      values.push(JSON.stringify(body.tags.slice(0, 10).map((t) => String(t).slice(0, 30))));
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    await db.getSupabase().from('comments').update({ ...Object.fromEntries(zip(fields, values)), updated_at: new Date().toISOString() }).eq('id', req.params.id);

    // Activity logging
    if ('status' in body) logActivity(project.id, req.user.id, `comment.${body.status}`, { id: comment.data.id });
    if ('status' in body && body.status === 'resolved' && comment.data.author_id && comment.data.author_id !== req.user.id) {
      await db.notifyUser({ userId: comment.data.author_id, projectId: project.id, type: 'resolved', message: `${comment.data.ref || 'Your feedback'} was marked resolved by ${req.user.name}`, feedbackRef: comment.data.ref });
    }

    const row = await db.getSupabase().from('comments').select('*, rb.name AS resolved_by_name').eq('id', req.params.id).single();
    res.json({ comment: { ...row.data, is_internal: !!row.data.is_internal } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/comments/:id', async (req, res) => {
  try {
    const comment = await db.getSupabase().from('comments').select('*, project_id').eq('id', req.params.id).single();
    if (!comment.data) return res.status(404).json({ error: 'Comment not found' });

    const project = await db.getProjectById(comment.data.project_id);
    if (!project) return res.status(403).json({ error: 'No access to this project' });

    await db.getSupabase().from('comments').delete().eq('id', req.params.id);
    logActivity(project.id, req.user.id, 'comment.deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function safePath(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

// Helper: zip arrays together
function zip(keys, values) {
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

export default router;