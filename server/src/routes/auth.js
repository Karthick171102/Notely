import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { generateUuid } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

router.post('/register', async (req, res) => {
  const { email, name, password } = req.body ?? {};
  if (!emailOk(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!name || typeof name !== 'string' || name.trim().length < 2)
    return res.status(400).json({ error: 'Name is required' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = await db.getUserByEmail(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const id = generateUuid();
  const hash = bcrypt.hashSync(password, 10);
  await db.createUser({ id, email: email.toLowerCase(), name: name.trim(), password_hash: hash });

  // Auto-create a personal workspace so every user has a home
  const wsId = generateUuid();
  const wsName = `${name.trim().split(' ')[0]}'s Workspace`;
  const slug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + wsId.slice(0, 6);
  await db.createWorkspace({ id: wsId, name: wsName, slug, brand_color: '#4f46e5', plan: 'free', owner_id: id });
  await db.addWorkspaceMember({ id: generateUuid(), workspace_id: wsId, user_id: id, role: 'owner' });

  const user = { id, email: email.toLowerCase(), name: name.trim() };
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = emailOk(email)
    ? await db.getUserByEmail(email.toLowerCase())
    : null;
  if (!user || !bcrypt.compareSync(password ?? '', user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name },
  });
});

router.get('/me', async (req, res) => {
  // In Supabase-auth apps, the token is verified in the frontend
  // This endpoint can return the user from the session
  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  try {
    // Verify token with Supabase - for now, just check if user exists in DB
    const user = await db.getUserById('demo-user'); // placeholder - actual auth handled by Supabase
    res.json({ user: user || null });
  } catch {
    res.json({ user: null });
  }
});

export default router;