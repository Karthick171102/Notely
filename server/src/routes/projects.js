import { Router } from 'express';
import db, { generateUuid, logActivity } from '../db.js';

const router = Router();

// List projects for current user (with open comment counts)
router.get('/', async (req, res) => {
  try {
    const projects = await db.listUserProjects(req.user.id);
    const projectRows = projects.map((p) => ({
      ...p,
      is_public: !!p.is_public,
      allowed_domains: p.allowed_domains === '*' ? ['*'] : JSON.parse(p.allowed_domains),
    }));
    res.json({ projects: projectRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, prototype_url, is_public, allowed_domains, type, client_name } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'Project name is required' });

    const id = uuid();
    // Generate embed token - 16 bytes in hex
    const token = crypto.randomBytes(16).toString('hex');

    await db.createProject({
      id,
      owner_id: req.user.id,
      name: name.trim(),
      description: description ?? null,
      embed_token: token,
      prototype_url: prototype_url ?? null,
      is_public: is_public === false ? 0 : 1,
      allowed_domains: Array.isArray(allowed_domains) && allowed_domains.length ? JSON.stringify(allowed_domains) : '*',
      type: ['website', 'prototype', 'internal_qa'].includes(type) ? type : 'website',
      client_name: client_name ?? null,
    });

    logActivity(id, req.user.id, 'project.created', { name: name.trim() });

    const project = await db.getProjectById(id);
    res.status(201).json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const members = await db.listProjectMembers(req.params.id);
    res.json({ project, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit settings' });

    const allowed = ['name', 'description', 'prototype_url', 'is_public', 'allowed_domains'];
    const updates = {};
    for (const key of allowed) {
      if (key in (req.body ?? {})) {
        if (key === 'allowed_domains') {
          updates.allowed_domains = Array.isArray(req.body.allowed_domains) ? JSON.stringify(req.body.allowed_domains) : '*';
        } else if (key === 'is_public') {
          updates.is_public = req.body.is_public ? 1 : 0;
        } else {
          updates[key] = req.body[key];
        }
      }
    }
    updates.updated_at = new Date().toISOString();

    await db.updateProject(req.params.id, updates);
    logActivity(project.id, req.user.id, 'project.updated', {});
    res.json({ project: await db.getProjectById(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete a project' });

    await db.deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/regenerate-token', async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_id !== req.user.id)
      return res.status(403).json({ error: 'Only the owner can regenerate the embed token' });

    // Generate new embed token - 16 bytes in hex
    const newToken = crypto.randomBytes(16).toString('hex');

    await db.updateProject(req.params.id, { embed_token: newToken, updated_at: new Date().toISOString() });
    logActivity(project.id, req.user.id, 'project.token_regenerated', {});
    res.json({ embed_token: newToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;