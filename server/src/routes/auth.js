import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { uuid } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

router.post('/register', async (req, res) => {
  const { email, name, password } = req.body ?? {};
  if (!emailOk(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!name || typeof name !== 'string' || name.trim().length < 2)
    return res.status(400).json({ error: 'Name is required' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email.toLowerCase(),
    name.trim(),
    hash
  );

  // Auto-create a personal workspace so every user has a home
  const wsId = uuid();
  const wsName = `${name.trim().split(' ')[0]}'s Workspace`;
  const slug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + wsId.slice(0, 6);
  await db.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').run(wsId, wsName, slug, id);
  await db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').run(uuid(), wsId, id, 'owner');

  const user = { id, email: email.toLowerCase(), name: name.trim() };
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = emailOk(email)
    ? await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase())
    : null;
  if (!user || !bcrypt.compareSync(password ?? '', user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
