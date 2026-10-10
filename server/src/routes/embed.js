import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import db, { uuid, logActivity, notifyUser, nextRef } from '../db.js';
import { ensureDefaultRound } from './rounds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');

const router = Router();

// --- In-memory rate limiter: N comment writes per minute per IP+project ---
const buckets = new Map();
function rateLimit(req, res, next) {
  const key = `${req.ip}:${req.params.token ?? ''}`;
  const nowMs = Date.now();
  const windowMs = 60_000;
  const limit = 30;
  let b = buckets.get(key);
  if (!b || nowMs - b.start > windowMs) {
    b = { start: nowMs, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) return res.status(429).json({ error: 'Too many requests, slow down' });
  next();
}

async function projectByToken(tokenOrId) {
  return await db.prepare('SELECT * FROM projects WHERE embed_token = ? OR id = ?').get(tokenOrId, tokenOrId);
}

function originAllowed(project, origin) {
  let domains;
  try {
    domains = project.allowed_domains === '*' ? ['*'] : JSON.parse(project.allowed_domains);
  } catch {
    domains = ['*'];
  }
  if (domains.includes('*')) return true;
  if (!origin) return false;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return domains.some((d) => d === host || host.endsWith(`.${d.replace(/^\*\./, '')}`));
}

function sanitize(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, 5000);
}

function publicComment(c) {
  return {
    id: c.id,
    ref: c.ref,
    title: c.title,
    parent_comment_id: c.parent_comment_id,
    author_name: c.author_name,
    element_selector: c.element_selector,
    element_snapshot: JSON.parse(c.element_snapshot || '{}'),
    region: c.region ? JSON.parse(c.region) : null,
    page_url: c.page_url,
    page_path: c.page_path,
    content: c.content,
    type: c.type,
    category: c.category,
    priority: c.priority,
    status: c.status,
    screenshot_url: c.screenshot_url,
    round_name: c.round_name,
    version_name: c.version_name,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// Project meta for the embed panel header
router.get('/:token/meta', async (req, res) => {
  const p = await projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: 'Unknown embed token' });
  const origin = req.headers.origin;
  if (!originAllowed(p, origin)) return res.status(403).json({ error: 'This domain is not allowed to use this embed' });

  const round = req.query.round_id
    ? await db.prepare('SELECT * FROM review_rounds WHERE id = ? AND project_id = ?').get(String(req.query.round_id), p.id)
    : await db.prepare(`SELECT * FROM review_rounds WHERE project_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`).get(p.id);
  const version = round
    ? await db.prepare('SELECT * FROM versions WHERE round_id = ? ORDER BY created_at DESC LIMIT 1').get(round.id)
    : null;
  const approvalCount = round
    ? await db.prepare(`SELECT COUNT(*) AS c FROM approvals WHERE round_id = ? AND status = 'approved'`).get(round.id).c
    : 0;

  res.json({
    project: { id: p.id, name: p.name, is_public: !!p.is_public },
    round: round ? { id: round.id, name: round.name, deadline: round.deadline, instructions: round.instructions, requires_approval: !!round.requires_approval } : null,
    version: version ? { id: version.id, name: version.name } : null,
    approval_count: approvalCount,
  });
});

// Client approval / change request from the embed panel
router.post('/:token/approvals', rateLimit, async (req, res) => {
  const p = await projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: 'Unknown embed token' });
  const origin = req.headers.origin;
  if (!originAllowed(p, origin)) return res.status(403).json({ error: 'This domain is not allowed' });

  const { round_id, status, note, signed_name, reviewer_name, reviewer_email } = req.body ?? {};
  const round = round_id
    ? await db.prepare('SELECT * FROM review_rounds WHERE id = ? AND project_id = ?').get(round_id, p.id)
    : await db.prepare(`SELECT * FROM review_rounds WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`).get(p.id);
  if (!round) return res.status(404).json({ error: 'No review round found' });
  if (!['approved', 'changes_requested'].includes(status))
    return res.status(400).json({ error: 'status must be approved or changes_requested' });
  if (!signed_name || !String(signed_name).trim())
    return res.status(400).json({ error: 'Type your name to confirm this decision' });

  const version = await db.prepare('SELECT * FROM versions WHERE round_id = ? ORDER BY created_at DESC LIMIT 1').get(round.id);
  const id = uuid();
  await db.prepare(
    `INSERT INTO approvals (id, round_id, version_id, reviewer_name, reviewer_email, status, note, signed_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    round.id,
    version?.id ?? null,
    sanitize(reviewer_name || 'Client reviewer').slice(0, 80),
    reviewer_email ? sanitize(reviewer_email).slice(0, 120) : null,
    status,
    note ? sanitize(note).slice(0, 2000) : null,
    sanitize(signed_name).trim().slice(0, 80)
  );
  await logActivity(p.id, null, `approval.${status}`, { round: round.name, via: 'embed' });
  const owner = await db.prepare('SELECT id FROM users WHERE id = ?').get(p.owner_id);
  if (owner)
    await notifyUser(owner.id, p.id, `approval.${status}`, `Client ${status === 'approved' ? 'approved' : 'requested changes on'} ΓÇ£${round.name}ΓÇ¥ (${p.name})`);
  res.status(201).json({ approval: await db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) });
});

// Public comments for this project (internal notes excluded)
router.get('/:token/comments', rateLimit, async (req, res) => {
  const p = await projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: 'Unknown embed token' });
  const origin = req.headers.origin;
  if (!originAllowed(p, origin)) return res.status(403).json({ error: 'This domain is not allowed to use this embed' });
  const rows = await db.prepare(
      `SELECT c.*, r.name AS round_name, v.name AS version_name FROM comments c
       LEFT JOIN review_rounds r ON r.id = c.round_id
       LEFT JOIN versions v ON v.id = c.version_id
       WHERE c.project_id = ? AND c.is_internal = 0 ORDER BY c.created_at ASC`
    )
    .all(p.id);
  const roots = [];
  const byId = new Map();
  for (const r of rows) {
    const c = { ...publicComment(r), replies: [] };
    byId.set(c.id, c);
  }
  for (const c of byId.values()) {
    if (c.parent_comment_id && byId.has(c.parent_comment_id)) byId.get(c.parent_comment_id).replies.push(c);
    else roots.push(c);
  }
  res.json({ comments: roots });
});

// Create a comment from the embed script (element OR region target, with screenshot + tech metadata)
router.post('/:token/comments', rateLimit, async (req, res) => {
  const p = await projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: 'Unknown embed token' });
  const origin = req.headers.origin;
  if (!originAllowed(p, origin))
    return res.status(403).json({ error: 'This domain is not allowed to submit feedback' });
  if (!p.is_public)
    return res.status(403).json({ error: 'This project is invite-only; commenting is disabled for guests' });

  const {
    content, title, element_selector, element_snapshot, region, page_url, type, category, priority,
    author_name, author_email, round_id, screenshot, tech_meta,
  } = req.body ?? {};
  const text = sanitize(content);
  if (!text) return res.status(400).json({ error: 'Comment text is required' });
  if (!element_selector && !region)
    return res.status(400).json({ error: 'An element selector or region is required' });

  let pagePath = '/';
  try {
    pagePath = new URL(page_url).pathname || '/';
  } catch {
    /* keep '/' */
  }

  // Bind to the requested review round (or the project's default) and its latest version
  let round = round_id
    ? await db.prepare('SELECT * FROM review_rounds WHERE id = ? AND project_id = ?').get(round_id, p.id)
    : null;
  if (!round) {
    round = await db.prepare(`SELECT * FROM review_rounds WHERE project_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1`)
      .get(p.id);
  }
  if (!round) ({ round } = await ensureDefaultRound(p.id, null));
  const version = await db.prepare('SELECT * FROM versions WHERE round_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(round.id);

  // Optional annotated screenshot (dataURL) ΓåÆ saved to disk
  let screenshotUrl = null;
  if (typeof screenshot === 'string' && screenshot.startsWith('data:image/')) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      const b64 = screenshot.slice(screenshot.indexOf(',') + 1);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 4 * 1024 * 1024) throw new Error('Screenshot too large');
      const name = `${uuid()}.jpg`;
      fs.writeFileSync(path.join(uploadsDir, name), buf);
      screenshotUrl = `/uploads/${name}`;
    } catch (e) {
      console.warn('[Notely] screenshot capture failed:', e.message);
    }
  }

  const TYPE_VALUES = ['bug', 'design_change', 'ux', 'content', 'accessibility', 'performance', 'question', 'other', 'suggestion', 'feature'];
  const CATEGORIES = ['layout', 'typography', 'color', 'spacing', 'interaction', 'navigation', 'content', 'responsive', 'accessibility', 'technical'];

  const id = uuid();
  const ref = await nextRef(p.id);
  const cleanTitle = title ? sanitize(title).slice(0, 200) : text.split(/[.!?\n]/)[0].slice(0, 80);
  await db.prepare(
    `INSERT INTO comments (id, project_id, author_id, author_name, author_email,
       element_selector, element_snapshot, region, round_id, version_id, screenshot_url, tech_meta,
       page_url, page_path, content, title, type, category, priority, ref)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    p.id,
    sanitize(author_name || 'Guest reviewer').slice(0, 80),
    author_email ? sanitize(author_email).slice(0, 120) : null,
    element_selector ? sanitize(element_selector).slice(0, 1000) : '(region)',
    JSON.stringify(element_snapshot ?? {}),
    region ? JSON.stringify(region).slice(0, 2000) : null,
    round.id,
    version?.id ?? null,
    screenshotUrl,
    JSON.stringify(tech_meta ?? {}).slice(0, 8000),
    sanitize(page_url || '').slice(0, 1000),
    pagePath,
    text,
    cleanTitle,
    TYPE_VALUES.includes(type) ? type : 'suggestion',
    CATEGORIES.includes(category) ? category : null,
    ['low', 'medium', 'high', 'critical'].includes(priority) ? priority : 'medium',
    ref
  );
  await logActivity(p.id, null, 'comment.created', { id, via: 'embed' });

  // Notify the project owner about new guest feedback
  const owner = await db.prepare('SELECT id FROM users WHERE id = ?').get(p.owner_id);
  if (owner) await notifyUser(owner.id, p.id, 'new_feedback', `New feedback ${ref} on ΓÇ£${p.name}ΓÇ¥: ${cleanTitle}`, ref);

  const row = await db.prepare(
      `SELECT c.*, r.name AS round_name, v.name AS version_name FROM comments c
       LEFT JOIN review_rounds r ON r.id = c.round_id
       LEFT JOIN versions v ON v.id = c.version_id
       WHERE c.id = ?`
    )
    .get(id);
  res.status(201).json({ comment: publicComment(row) });
});

// Reply to a comment from the embed script
router.post('/:token/comments/:id/replies', rateLimit, async (req, res) => {
  const p = await projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: 'Unknown embed token' });
  const origin = req.headers.origin;
  if (!originAllowed(p, origin))
    return res.status(403).json({ error: 'This domain is not allowed to submit feedback' });
  if (!p.is_public) return res.status(403).json({ error: 'This project is invite-only' });

  const parent = await db.prepare('SELECT * FROM comments WHERE id = ? AND project_id = ? AND parent_comment_id IS NULL')
    .get(req.params.id, p.id);
  if (!parent) return res.status(404).json({ error: 'Comment not found' });

  const { content, author_name } = req.body ?? {};
  const text = sanitize(content);
  if (!text) return res.status(400).json({ error: 'Reply text is required' });

  const id = uuid();
  await db.prepare(
    `INSERT INTO comments (id, project_id, parent_comment_id, author_name, element_selector, element_snapshot, page_url, page_path, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    p.id,
    parent.id,
    sanitize(author_name || 'Guest reviewer').slice(0, 80),
    parent.element_selector,
    parent.element_snapshot,
    parent.page_url,
    parent.page_path,
    text
  );
  await logActivity(p.id, null, 'comment.replied', { id, parent: parent.id, via: 'embed' });
  const row = await db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  res.status(201).json({ comment: publicComment(row) });
});

// Public rule-based AI assist for the embed composer (no auth; origin-checked)
router.post('/:token/ai-refine', rateLimit, async (req, res) => {
  const p = await projectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: 'Unknown embed token' });
  if (!originAllowed(p, req.headers.origin)) return res.status(403).json({ error: 'Domain not allowed' });
  const { content, element_label } = req.body ?? {};
  const text = String(content ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text is required' });

  const t = text.toLowerCase();
  const pick = (pairs, fallback) => {
    for (const [value, hints] of pairs) if (hints.some((h) => t.includes(h))) return value;
    return fallback;
  };
  const type = pick([
    ['bug', ['broken', 'error', 'crash', 'not working', "doesn't work", 'fails']],
    ['accessibility', ['contrast', 'screen reader', 'accessib', 'focus state', 'wcag']],
    ['performance', ['slow', 'lag', 'loading', 'perf']],
    ['ux', ['confus', 'hard to', "can't find", 'unclear', 'usability']],
    ['content', ['typo', 'copy', 'wording', 'text', 'spelling']],
    ['design_change', ['spacing', 'color', 'font', 'align', 'padding', 'hierarchy']],
  ], 'design_change');
  const category = pick([
    ['layout', ['layout', 'overflow', 'wrap']],
    ['typography', ['font', 'typograph']],
    ['color', ['color', 'contrast']],
    ['spacing', ['spacing', 'padding', 'margin', 'gap', 'too close']],
    ['interaction', ['click', 'hover', 'tap', 'toggle']],
    ['navigation', ['nav', 'menu']],
    ['responsive', ['mobile', 'tablet', 'viewport', 'responsive']],
  ], 'layout');
  const vague = text.length < 25 || /^(fix this|looks wrong|bad|ugly|weird)\b/i.test(text);
  const where = element_label ? ` (ΓÇ£${element_label}ΓÇ¥)` : '';
  const title = text.replace(/\s+/g, ' ').split(/[.!?]/)[0].slice(0, 80);
  const clarified = vague
    ? `Address this feedback${where}: ${text.trim()}. Align the element with the design system and verify the result at desktop and mobile widths.`.slice(0, 500)
    : null;
  res.json({
    ai: true,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    type,
    category,
    priority_suggestion: /(critical|broken|crash|blocker)/i.test(t) ? 'high' : /(minor|nit|cosmetic|maybe)/i.test(t) ? 'low' : 'medium',
    clarified,
    notes: ['Rule-based suggestion ΓÇö review before applying. Your original comment is never changed automatically.'],
  });
});

export default router;

// --- Static embed script: GET /embed/:token.js ---
export function serveEmbedScript(req, res) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'embed.js'));
}
