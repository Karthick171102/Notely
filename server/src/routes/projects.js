import { Router } from 'express';
import db, { uuid, newEmbedToken, logActivity } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

function projectRow(p) {
  return {
    ...p,
    is_public: !!p.is_public,
    allowed_domains: p.allowed_domains === '*' ? ['*'] : JSON.parse(p.allowed_domains),
  };
}

async function assertMember(projectId, userId) {
  return await db.prepare(
      `SELECT p.* FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.id = ? AND (p.owner_id = ? OR m.user_id IS NOT NULL)`
    )
    .get(userId, projectId, userId);
}

// List projects for current user (with open comment counts)
router.get('/', async (req, res) => {
  const rows = await db.prepare(
      `SELECT p.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id AND c.parent_comment_id IS NULL AND c.status NOT IN ('resolved')) AS open_count,
        (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id AND c.parent_comment_id IS NULL) AS total_count,
        (SELECT MAX(c.updated_at) FROM comments c WHERE c.project_id = p.id) AS last_activity
       FROM projects p JOIN users u ON u.id = p.owner_id
       WHERE p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
       ORDER BY p.created_at DESC`
    )
    .all(req.user.id, req.user.id);
  res.json({ projects: rows.map(projectRow) });
});

router.post('/', async (req, res) => {
  const { name, description, prototype_url, is_public, allowed_domains, type, client_name } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'Project name is required' });

  const id = uuid();
  const token = newEmbedToken();
  await db.prepare(
    `INSERT INTO projects (id, owner_id, name, description, embed_token, prototype_url, is_public, allowed_domains, type, client_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.id,
    name.trim(),
    description ?? null,
    token,
    prototype_url ?? null,
    is_public === false ? 0 : 1,
    JSON.stringify(Array.isArray(allowed_domains) && allowed_domains.length ? allowed_domains : ['*']),
    ['website', 'prototype', 'internal_qa'].includes(type) ? type : 'website',
    client_name ?? null
  );
  await logActivity(id, req.user.id, 'project.created', { name: name.trim() });
  const project = projectRow(await db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  res.status(201).json({ project });
});

router.get('/:id', async (req, res) => {
  const p = await assertMember(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const owner = await db.prepare('SELECT name FROM users WHERE id = ?').get(p.owner_id);
  const members = await db.prepare(
      `SELECT u.id, u.email, u.name, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?`
    )
    .all(p.id);
  res.json({ project: { ...projectRow(p), owner_name: owner?.name, members } });
});

router.patch('/:id', async (req, res) => {
  const p = await assertMember(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit settings' });

  const fields = [];
  const values = [];
  const allow = ['name', 'description', 'prototype_url'];
  for (const key of allow) {
    if (key in (req.body ?? {})) {
      fields.push(`${key} = ?`);
      values.push(req.body[key]);
    }
  }
  if ('is_public' in (req.body ?? {})) {
    fields.push('is_public = ?');
    values.push(req.body.is_public ? 1 : 0);
  }
  if ('allowed_domains' in (req.body ?? {})) {
    const domains = req.body.allowed_domains;
    if (!Array.isArray(domains)) return res.status(400).json({ error: 'allowed_domains must be an array' });
    fields.push('allowed_domains = ?');
    values.push(JSON.stringify(domains));
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  values.push(p.id);
  await db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  await logActivity(p.id, req.user.id, 'project.updated', {});
  res.json({ project: projectRow(await db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id)) });
});

router.delete('/:id', async (req, res) => {
  const p = await assertMember(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete a project' });
  await db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

router.post('/:id/regenerate-token', async (req, res) => {
  const p = await assertMember(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.owner_id !== req.user.id)
    return res.status(403).json({ error: 'Only the owner can regenerate the embed token' });
  const token = newEmbedToken();
  await db.prepare(`UPDATE projects SET embed_token = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(token, p.id);
  await logActivity(p.id, req.user.id, 'project.token_regenerated', {});
  res.json({ embed_token: token });
});

export default router;
