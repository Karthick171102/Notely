import { Router } from 'express';
import db, { uuid, logActivity, notifyUser } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

async function assertMember(projectId, userId) {
  return await db.prepare(
      `SELECT p.* FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.id = ? AND (p.owner_id = ? OR m.user_id IS NOT NULL)`
    )
    .get(userId, projectId, userId);
}

async function roundWithMeta(r) {
  const versions = await db.prepare('SELECT * FROM versions WHERE round_id = ? ORDER BY created_at ASC').all(r.id);
  const approvals = await db.prepare('SELECT * FROM approvals WHERE round_id = ? ORDER BY created_at DESC').all(r.id);
  const openCount = await db.prepare(`SELECT COUNT(*) AS c FROM comments WHERE round_id = ? AND parent_comment_id IS NULL AND status NOT IN ('resolved')`)
    .get(r.id).c;
  return { ...r, versions, approvals, open_count: openCount };
}

// Ensure every project has a default round + version so feedback always has a home
export async function ensureDefaultRound(projectId, userId) {
  let round = await db.prepare(`SELECT * FROM review_rounds WHERE project_id = ? ORDER BY created_at ASC LIMIT 1`)
    .get(projectId);
  if (!round) {
    const id = uuid();
    await db.prepare(
      `INSERT INTO review_rounds (id, project_id, name, description, created_by) VALUES (?, ?, 'Round 1', 'First review round', ?)`
    ).run(id, projectId, userId ?? null);
    round = await db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(id);
  }
  let version = await db.prepare(`SELECT * FROM versions WHERE round_id = ? ORDER BY created_at ASC LIMIT 1`).get(round.id);
  if (!version) {
    const vid = uuid();
    await db.prepare(`INSERT INTO versions (id, project_id, round_id, name) VALUES (?, ?, ?, 'v1.0')`).run(vid, projectId, round.id);
    version = await db.prepare('SELECT * FROM versions WHERE id = ?').get(vid);
  }
  return { round, version };
}

router.get('/:projectId/rounds', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  await ensureDefaultRound(p.id, req.user.id);
  const roundRows = await db.prepare('SELECT * FROM review_rounds WHERE project_id = ? ORDER BY created_at ASC')
    .all(p.id);
  const rounds = [];
  for (const r of roundRows) rounds.push(await roundWithMeta(r));
  res.json({ rounds });
});

router.post('/:projectId/rounds', async (req, res) => {
  const p = await assertMember(req.params.projectId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const { name, description, deadline, requires_approval, instructions } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Round name is required' });
  const id = uuid();
  await db.prepare(
    `INSERT INTO review_rounds (id, project_id, name, description, deadline, requires_approval, instructions, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, p.id, name.trim(), description ?? null, deadline ?? null, requires_approval ? 1 : 0, instructions ?? null, req.user.id);
  const vid = uuid();
  await db.prepare(`INSERT INTO versions (id, project_id, round_id, name) VALUES (?, ?, ?, 'v1.0')`).run(vid, p.id, id);
  await logActivity(p.id, req.user.id, 'round.created', { name });
  res.status(201).json({ round: await roundWithMeta(await db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(id)) });
});

router.patch('/rounds/:roundId', async (req, res) => {
  const round = await db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(req.params.roundId);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const p = await assertMember(round.project_id, req.user.id);
  if (!p) return res.status(403).json({ error: 'No access' });
  const { name, status, deadline, requires_approval, instructions } = req.body ?? {};
  const fields = [];
  const values = [];
  if (name) { fields.push('name = ?'); values.push(name); }
  if (status && ['active', 'closed'].includes(status)) { fields.push('status = ?'); values.push(status); }
  if ('deadline' in (req.body ?? {})) { fields.push('deadline = ?'); values.push(deadline ?? null); }
  if ('requires_approval' in (req.body ?? {})) { fields.push('requires_approval = ?'); values.push(requires_approval ? 1 : 0); }
  if ('instructions' in (req.body ?? {})) { fields.push('instructions = ?'); values.push(instructions ?? null); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(round.id);
  await db.prepare(`UPDATE review_rounds SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ round: await roundWithMeta(await db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(round.id)) });
});

router.post('/rounds/:roundId/versions', async (req, res) => {
  const round = await db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(req.params.roundId);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const p = await assertMember(round.project_id, req.user.id);
  if (!p) return res.status(403).json({ error: 'No access' });
  const { name, source_url } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Version label is required' });
  const id = uuid();
  await db.prepare('INSERT INTO versions (id, project_id, round_id, name, source_url) VALUES (?, ?, ?, ?, ?)').run(
    id, round.project_id, round.id, name.trim(), source_url ?? null
  );
  await logActivity(round.project_id, req.user.id, 'version.created', { name });
  res.status(201).json({ version: await db.prepare('SELECT * FROM versions WHERE id = ?').get(id) });
});

// Record an approval / change request (from dashboard or client via embed)
router.post('/rounds/:roundId/approvals', async (req, res) => {
  const round = await db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(req.params.roundId);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const p = await assertMember(round.project_id, req.user.id);
  if (!p) return res.status(403).json({ error: 'No access' });
  const { status, note, signed_name, version_id } = req.body ?? {};
  if (!['approved', 'changes_requested'].includes(status))
    return res.status(400).json({ error: 'status must be approved or changes_requested' });
  if (!signed_name || !String(signed_name).trim())
    return res.status(400).json({ error: 'Type your name to confirm this decision' });
  const version = version_id
    ? await db.prepare('SELECT * FROM versions WHERE id = ?').get(version_id)
    : await db.prepare('SELECT * FROM versions WHERE round_id = ? ORDER BY created_at DESC LIMIT 1').get(round.id);
  const id = uuid();
  await db.prepare(
    `INSERT INTO approvals (id, round_id, version_id, reviewer_name, reviewer_email, status, note, signed_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, round.id, version?.id ?? null, req.user.name, req.user.email, status, note ?? null, String(signed_name).trim());
  await logActivity(round.project_id, req.user.id, `approval.${status}`, { round: round.name });
  const owner = await db.prepare('SELECT id FROM users WHERE id = ?').get(p.owner_id);
  if (owner) await notifyUser(owner.id, p.id, `approval.${status}`, `Approval recorded on ΓÇ£${round.name}ΓÇ¥: ${status.replace('_', ' ')} by ${req.user.name}`);
  res.status(201).json({ approval: await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) });
});

export default router;
