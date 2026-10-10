import { Router } from 'express';
import db, { uuid, logActivity } from '../db.js';
import { requireAuth, getWorkspaceId } from '../auth.js';

const router = Router();
router.use(requireAuth);

// Mock project-management integration ("TaskBridge") standing in for Jira/Linear.
// Connect, push feedback as tasks, and simulate two-way status sync.

const PROVIDER = 'taskbridge';

async function getIntegration(workspaceId) {
  return await db.prepare('SELECT * FROM integrations WHERE workspace_id = ? AND provider = ?')
    .get(workspaceId, PROVIDER);
}

router.get('/', async (req, res) => {
  const wsId = await getWorkspaceId(req.user.id);
  if (!wsId) return res.status(404).json({ error: 'No workspace' });
  const integrations = await db.prepare('SELECT * FROM integrations WHERE workspace_id = ?').all(wsId);
  const events = await db.prepare(
      `SELECT e.* FROM integration_events e JOIN integrations i ON i.id = e.integration_id
       WHERE i.workspace_id = ? ORDER BY e.created_at DESC LIMIT 30`
    )
    .all(wsId);
  res.json({ integrations, events });
});

router.post('/taskbridge/connect', async (req, res) => {
  const wsId = await getWorkspaceId(req.user.id);
  if (!wsId) return res.status(404).json({ error: 'No workspace' });
  let integ = await getIntegration(wsId);
  const config = JSON.stringify({
    workspace_name: req.body?.workspace_name || 'Northstar PM',
    project: req.body?.project || 'ACME',
    task_type: req.body?.task_type || 'Task',
    default_status: 'To do',
    sync_comments: true,
    direction: 'two-way',
  });
  if (integ) {
    await db.prepare(`UPDATE integrations SET connection_status = 'connected', configuration = ? WHERE id = ?`).run(config, integ.id);
  } else {
    const id = uuid();
    await db.prepare(
      `INSERT INTO integrations (id, workspace_id, provider, connection_status, configuration) VALUES (?, ?, ?, 'connected', ?)`
    ).run(id, wsId, PROVIDER, config);
    integ = { id };
  }
  await logActivity(wsId, req.user.id, 'integration.connected', { provider: PROVIDER });
  res.json({ integration: await getIntegration(wsId) });
});

router.post('/taskbridge/disconnect', async (req, res) => {
  const wsId = await getWorkspaceId(req.user.id);
  await db.prepare(`UPDATE integrations SET connection_status = 'disconnected' WHERE workspace_id = ? AND provider = ?`).run(wsId, PROVIDER);
  res.json({ ok: true });
});

router.get('/test', async (req, res) => {
  const wsId = await getWorkspaceId(req.user.id);
  const integ = await getIntegration(wsId);
  res.json({ ok: !!integ && integ.connection_status === 'connected', provider: PROVIDER });
});

// Push a feedback item to TaskBridge ΓåÆ returns external task ID
router.post('/send/:feedbackId', async (req, res) => {
  const f = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.feedbackId);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(f.project_id);
  const wsId = await getWorkspaceId(req.user.id);
  const integ = await getIntegration(wsId);
  if (!integ || integ.connection_status !== 'connected')
    return res.status(400).json({ error: 'Connect the TaskBridge integration first' });

  const cfg = JSON.parse(integ.configuration || '{}');
  const externalTaskId = `${cfg.project || 'TSK'}-${1000 + Math.floor(Math.random() * 9000)}`;

  await db.prepare('UPDATE comments SET external_task_id = ? WHERE id = ?').run(externalTaskId, f.id);
  await db.prepare(
    `INSERT INTO integration_events (id, integration_id, feedback_id, event_type, status, payload)
     VALUES (?, ?, ?, 'task.created', 'success', ?)`
  ).run(uuid(), integ.id, f.id, JSON.stringify({ externalTaskId, title: f.title || f.ref, project: project?.name }));
  await logActivity(f.project_id, req.user.id, 'integration.task_created', { ref: f.ref, externalTaskId });
  res.json({ external_task_id: externalTaskId });
});

// Simulate the external system pushing a status change back (two-way sync)
router.post('/simulate-status/:feedbackId', async (req, res) => {
  const f = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.feedbackId);
  if (!f?.external_task_id) return res.status(400).json({ error: 'Feedback has no external task' });
  const wsId = await getWorkspaceId(req.user.id);
  const integ = await getIntegration(wsId);
  const { status } = req.body ?? {};
  if (!['open', 'in_progress', 'resolved'].includes(status))
    return res.status(400).json({ error: 'Unsupported status' });

  await db.prepare(`UPDATE comments SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(status, f.id);
  await db.prepare(
    `INSERT INTO integration_events (id, integration_id, feedback_id, event_type, status, payload)
     VALUES (?, ?, ?, 'status.synced', 'success', ?)`
  ).run(uuid(), integ.id, f.id, JSON.stringify({ externalTaskId: f.external_task_id, status }));
  res.json({ ok: true, status });
});

export default router;
