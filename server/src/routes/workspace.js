import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { uuid, logActivity } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

export function getWorkspaceForUser(userId) {
  let ws = db
    .prepare(
      `SELECT w.* FROM workspaces w
       LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?
       WHERE w.owner_id = ? OR m.user_id = ?
       ORDER BY w.created_at ASC LIMIT 1`
    )
    .get(userId, userId, userId);
  return ws;
}

router.get('/', (req, res) => {
  const ws = getWorkspaceForUser(req.user.id);
  if (!ws) return res.status(404).json({ error: 'No workspace found' });
  const members = db
    .prepare(
      `SELECT u.id, u.email, u.name, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
       UNION
       SELECT u.id, u.email, u.name, 'owner' FROM users u WHERE u.id = ?`
    )
    .all(ws.id, ws.owner_id);
  res.json({ workspace: ws, members });
});

router.post('/', (req, res) => {
  const { name } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Workspace name is required' });
  const existing = getWorkspaceForUser(req.user.id);
  if (existing) return res.status(409).json({ error: 'You already have a workspace' });
  const id = uuid();
  const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + id.slice(0, 6);
  db.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').run(id, name.trim(), slug, req.user.id);
  db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').run(uuid(), id, req.user.id, 'owner');
  logActivity(id, req.user.id, 'workspace.created', { name });
  res.status(201).json({ workspace: db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) });
});

// Invite a member by email (creates a pending user with a temp password if they don't exist)
router.post('/:id/members', (req, res) => {
  const ws = getWorkspaceForUser(req.user.id);
  if (!ws || ws.id !== req.params.id) return res.status(404).json({ error: 'Workspace not found' });
  if (ws.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the workspace owner can invite members' });
  const { email, name, role } = req.body ?? {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  let tempPassword = null;
  if (!user) {
    const id = uuid();
    tempPassword = 'ctx-' + Math.random().toString(36).slice(2, 10);
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      id, email.toLowerCase(), name || email.split('@')[0], bcrypt.hashSync(tempPassword, 10)
    );
    user = { id };
  }
  db.prepare('INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').run(
    uuid(), ws.id, user.id, ['admin', 'member', 'viewer'].includes(role) ? role : 'member'
  );
  res.status(201).json({ ok: true, tempPassword });
});

export default router;
