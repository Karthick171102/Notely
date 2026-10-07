import bcrypt from 'bcryptjs';
import db, { uuid, newEmbedToken } from './db.js';
import { ensureDefaultRound } from './routes/rounds.js';

const email = 'dana@contextly.test';
if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
  console.log('Seed data already present (dana@contextly.test). Nothing to do.');
  process.exit(0);
}

// --- Workspace: Northstar Product Studio ---
const userId = uuid();
db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
  userId, email, 'Dana Designer', bcrypt.hashSync('password123', 10)
);
const wsId = uuid();
db.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').run(
  wsId, 'Northstar Product Studio', 'northstar-product-studio', userId
);
db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)').run(uuid(), wsId, userId, 'owner');

const projects = [
  { name: 'Acme Marketing Website', type: 'website', client: 'Acme Inc.', desc: 'Public marketing site redesign', demo: true },
  { name: 'FinFlow Mobile App', type: 'prototype', client: 'FinFlow', desc: 'Onboarding flow prototype' },
  { name: 'Orbit SaaS Dashboard', type: 'internal_qa', client: null, desc: 'Internal QA review build' },
];

const feedback = {
  'Acme Marketing Website': [
    { title: 'Increase contrast on secondary button', content: 'The secondary button’s label sits at roughly 3:1 contrast against the background. Bump it to at least 4.5:1 and check the focus ring too.', type: 'accessibility', category: 'color', priority: 'high', status: 'open', author: 'Priya (Client)' },
    { title: 'Hero headline wraps awkwardly on tablet', content: 'At 768px the hero headline breaks mid-phrase leaving a one-word widow line. Adjust the max-width or use a balanced text wrap.', type: 'design_change', category: 'typography', priority: 'medium', status: 'in_progress', author: 'Sam (UX)' },
    { title: 'Dropdown closes before selection', content: 'On the contact form, the country dropdown closes on mousedown before an option can be selected. Reproduces in Chrome and Edge.', type: 'bug', category: 'interaction', priority: 'critical', status: 'in_progress', author: 'Marco (QA)' },
    { title: 'Clarify pricing copy', content: '“Billed annually” is ambiguous — clarify whether monthly billing exists and what the discount is.', type: 'content', category: 'content', priority: 'low', status: 'open', author: 'Priya (Client)' },
    { title: 'Add loading state to submit button', content: 'The demo-request submit button gives no feedback while the request is in flight; users double-click. Add a spinner + disabled state.', type: 'ux', category: 'interaction', priority: 'medium', status: 'open', author: 'Sam (UX)' },
  ],
  'FinFlow Mobile App': [
    { title: 'Login button thumb-reach', content: 'The login button sits in the top half of the screen; move it into the bottom thumb zone for one-handed use.', type: 'ux', category: 'layout', priority: 'medium', status: 'open', author: 'Alex (Client)' },
    { title: 'Balance chart overflows on 320px', content: 'The balance chart introduces horizontal scroll on small devices. Scale the chart or allow horizontal panning with snap points.', type: 'bug', category: 'responsive', priority: 'high', status: 'open', author: 'Marco (QA)' },
  ],
  'Orbit SaaS Dashboard': [
    { title: 'Table pagination resets filters', content: 'Changing pages in the activity table clears the active filters silently. Preserve the filter state across pagination.', type: 'bug', category: 'technical', priority: 'high', status: 'open', author: 'Marco (QA)' },
  ],
};

const createdProjects = [];
for (const p of projects) {
  const id = uuid();
  const token = newEmbedToken();
  db.prepare(
    `INSERT INTO projects (id, owner_id, name, description, embed_token, prototype_url, is_public, allowed_domains, type, client_name)
     VALUES (?, ?, ?, ?, ?, ?, 1, '*', ?, ?)`
  ).run(id, userId, p.name, p.desc, token, p.demo ? 'http://localhost:4000/demo' : null, p.type, p.client);
  createdProjects.push({ id, name: p.name, token });
}

for (const proj of createdProjects) {
  const { round, version } = ensureDefaultRound(proj.id, userId);
  const roundName = proj.name === 'Acme Marketing Website' ? 'Pre-launch review' : 'Round 1';
  db.prepare('UPDATE review_rounds SET name = ?, requires_approval = 1 WHERE id = ?').run(roundName, round.id);

  for (const f of feedback[proj.name] || []) {
    db.prepare(
      `INSERT INTO comments (id, project_id, author_name, element_selector, element_snapshot, page_url, page_path, content, title, type, category, priority, status, round_id, version_id, tech_meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuid(), proj.id, f.author,
      '#sample-element', JSON.stringify({ tag: 'div', textSnippet: f.title.toLowerCase(), fallbackPath: ['html', 'body'] }),
      'http://localhost:4000/demo', '/', f.content, f.title, f.type, f.category, f.priority, f.status, round.id, version.id,
      JSON.stringify({ browser: 'Chrome', os: 'Windows', viewport: '1440x900', device_pixel_ratio: 1, console_errors: [] })
    );
  }

  if (proj.name === 'Acme Marketing Website') {
    db.prepare(
      `INSERT INTO approvals (id, round_id, version_id, reviewer_name, reviewer_email, status, note, signed_name)
       VALUES (?, ?, ?, 'Priya Kapoor', 'priya@acme.test', 'changes_requested', 'Waiting for the pricing copy update before sign-off.', 'Priya Kapoor')`
    ).run(uuid(), round.id, version.id);
  }
}

console.log('Seeded Contextly sample data.');
console.log('  Login:     dana@contextly.test / password123');
console.log(`  Demo page: http://localhost:4000/demo`);
console.log(`  Embed tag: <script src="http://localhost:4000/embed/v1.js" data-project-id="${createdProjects[0].id}" defer></script>`);
