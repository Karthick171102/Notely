import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL = '7d';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export async function getWorkspaceId(userId) {
  const ws = await db.prepare(
      `SELECT w.id FROM workspaces w
       LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?
       WHERE w.owner_id = ? OR m.user_id = ?
       ORDER BY w.created_at ASC LIMIT 1`
    )
    .get(userId, userId, userId);
  return ws?.id ?? null;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
