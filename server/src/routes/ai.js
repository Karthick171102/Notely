import { Router } from 'express';
import db, { uuid } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

/*
 * Rule-based AI assist. Deterministic heuristics (no external LLM key required):
 * every suggestion is labeled as AI-assisted, shown before applying, and never
 * silently overwrites the reviewer's original text.
 */

const TYPE_HINTS = [
  ['bug', ['broken', 'error', 'crash', 'not working', "doesn't work", 'fails', 'exception', 'undefined']],
  ['accessibility', ['contrast', 'screen reader', 'a11y', 'accessib', 'focus state', 'color blind', 'wcag', 'aria']],
  ['performance', ['slow', 'lag', 'loading', 'jank', 'perf']],
  ['ux', ['confus', 'hard to', 'can\'t find', 'unclear', 'usability', 'user flow', 'friction']],
  ['content', ['typo', 'copy', 'wording', 'text', 'spelling', 'grammar']],
  ['design', ['spacing', 'color', 'font', 'align', 'padding', 'hierarchy', 'typograph', 'margin']],
];

const CATEGORY_HINTS = [
  ['layout', ['layout', 'grid', 'overflow', 'wrap', 'break']],
  ['typography', ['font', 'typograph', 'letter', 'line height']],
  ['color', ['color', 'contrast', 'palette', 'shade']],
  ['spacing', ['spacing', 'padding', 'margin', 'gap', 'too close', 'crowded']],
  ['interaction', ['click', 'hover', 'tap', 'drag', 'toggle', 'button state']],
  ['navigation', ['nav', 'menu', 'breadcrumb', 'link']],
  ['responsive', ['mobile', 'tablet', 'viewport', 'breakpoint', 'responsive']],
  ['accessibility', ['contrast', 'screen reader', 'a11y', 'focus', 'wcag']],
];

function detect(list, text) {
  const t = text.toLowerCase();
  for (const [value, hints] of list) {
    if (hints.some((h) => t.includes(h))) return value;
  }
  return null;
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function makeTitle(content) {
  const first = String(content).replace(/\s+/g, ' ').trim().split(/[.!?]/)[0] || String(content);
  let t = first.length > 80 ? first.slice(0, 77) + 'ΓÇª' : first;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function clarify(content, type, elementLabel) {
  const where = elementLabel ? ` on the ${elementLabel}` : '';
  const templates = {
    bug: `Fix the reported issue${where}: ${content.trim()} The element does not behave as expected and needs a corrective change.`,
    accessibility: `Improve accessibility${where}: ${content.trim()} Ensure the element meets WCAG 2.2 AA (contrast, focus state, and assistive-tech labels).`,
    ux: `Improve the experience${where}: ${content.trim()} Reduce friction so users can complete the task without confusion.`,
    content: `Update the copy${where}: ${content.trim()} Align the wording with the approved voice and tone.`,
    performance: `Improve performance${where}: ${content.trim()} Investigate rendering/loading behavior and remove the bottleneck.`,
    design: `Refine the visual design${where}: ${content.trim()} Match the element to the design system (spacing, color, and hierarchy tokens).`,
  };
  return (templates[type] || templates.design).slice(0, 600);
}

function acceptanceCriteria(type, elementLabel) {
  const where = elementLabel || 'the element';
  const base = [
    `${titleCase(where)} matches the approved design/system tokens.`,
    'No regression on desktop, tablet, and mobile viewports (320px, 768px, 1440px).',
    'Behavior verified by a reviewer on the live prototype.',
  ];
  if (type === 'accessibility') base.splice(1, 0, 'Contrast ratio ΓëÑ 4.5:1 for text and ΓëÑ 3:1 for UI boundaries.');
  if (type === 'bug') base.splice(1, 0, 'The reported reproduction steps no longer produce the issue.');
  return base;
}

router.post('/refine', async (req, res) => {
  const { content, element_label } = req.body ?? {};
  const text = String(content ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text is required' });

  const type = detect(TYPE_HINTS, text) ?? 'design';
  const category = detect(CATEGORY_HINTS, text) ?? 'layout';
  const vague = text.length < 25 || /^(fix this|looks wrong|bad|ugly|weird)\b/i.test(text);
  const priority = /(critical|broken|crash|blocker|cannot)/i.test(text)
    ? 'high'
    : /(typo|minor|nit|suggestion|maybe|cosmetic)/i.test(text)
      ? 'low'
      : 'medium';

  res.json({
    ai: true,
    title: makeTitle(text),
    type,
    category,
    priority_suggestion: priority,
    clarified: vague ? clarify(text, type, element_label) : null,
    acceptance_criteria: acceptanceCriteria(type, element_label),
    notes: [
      'Rule-based suggestion ΓÇö review before applying.',
      'Your original comment is never changed automatically.',
    ],
  });
});

// Developer brief for one feedback item (structured, AI-coding-agent ready)
router.get('/brief/:feedbackId', async (req, res) => {
  const f = await db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.feedbackId);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  const project = await db.prepare('SELECT name FROM projects WHERE id = ?').get(f.project_id);
  const round = f.round_id ? await db.prepare('SELECT name FROM review_rounds WHERE id = ?').get(f.round_id) : null;
  const version = f.version_id ? await db.prepare('SELECT name FROM versions WHERE id = ?').get(f.version_id) : null;
  const snap = JSON.parse(f.element_snapshot || '{}');
  const tech = JSON.parse(f.tech_meta || '{}');
  const elementLabel = snap.textSnippet || snap.tag || f.element_selector;

  const brief = {
    title: f.title || makeTitle(f.content),
    context: `${f.content}`,
    project: project?.name,
    review_round: round?.name,
    version: version?.name,
    page_url: f.page_url,
    target: {
      selector: f.element_selector,
      component: snap.tag ? `<${snap.tag}>` : null,
      region: f.region ? JSON.parse(f.region) : null,
    },
    current_behavior: snap.textSnippet ? `Element currently reads ΓÇ£${snap.textSnippet}ΓÇ¥.` : 'See selector and screenshot.',
    expected_behavior: f.title || f.content,
    acceptance_criteria: acceptanceCriteria(detect(TYPE_HINTS, f.content) ?? 'design', elementLabel),
    technical_context: {
      browser: tech.browser ?? 'unknown',
      viewport: tech.viewport ?? 'unknown',
      device_pixel_ratio: tech.device_pixel_ratio ?? null,
      operating_system: tech.os ?? 'unknown',
      console_errors: tech.console_errors ?? [],
      locale: tech.locale ?? null,
      timezone: tech.timezone ?? null,
    },
    reference: f.ref,
  };

  res.json({ brief, markdown: briefToMarkdown(brief) });
});

function briefToMarkdown(b) {
  return [
    `# ${b.title}`,
    '',
    `**Reference:** ${b.reference}  `,
    `**Project:** ${b.project} ┬╖ Round: ${b.review_round} ┬╖ Version: ${b.version}`,
    '',
    '## Context',
    b.context,
    '',
    '## Affected page',
    b.page_url || '(unknown)',
    '',
    '## Affected element',
    '```',
    b.target.selector,
    '```',
    '',
    '## Current behavior',
    b.current_behavior,
    '',
    '## Expected behavior',
    b.expected_behavior,
    '',
    '## Acceptance criteria',
    ...b.acceptance_criteria.map((c) => `- [ ] ${c}`),
    '',
    '## Technical context',
    `- Browser: ${b.technical_context.browser}`,
    `- Viewport: ${b.technical_context.viewport}`,
    `- OS: ${b.technical_context.operating_system}`,
    `- Console errors: ${b.technical_context.console_errors.length ? b.technical_context.console_errors.join('; ') : 'none captured'}`,
  ].join('\n');
}

export default router;
