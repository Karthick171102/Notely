import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import db, { uuid } from './db.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import dashboardRoutes from './routes/dashboard.js';
import embedRoutes, { serveEmbedScript } from './routes/embed.js';
import workspaceRoutes from './routes/workspace.js';
import roundsRoutes from './routes/rounds.js';
import aiRoutes from './routes/ai.js';
import notificationsRoutes from './routes/notifications.js';
import integrationsRoutes from './routes/integrations.js';

const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
const webIndex = path.join(webDist, 'index.html');
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'uploads');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// The embed script: /embed/{embed_token}.js (register the fixed library route first)
app.get('/embed/html2canvas.min.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js'));
});
app.get('/embed/:token.js', serveEmbedScript);
// Also allow the token to be passed via query (?p=) for a single shared snippet
app.get('/embed/embed.js', (req, res, next) => {
  if (req.query.p) req.params.token = String(req.query.p);
  serveEmbedScript(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', dashboardRoutes);
app.use('/api/projects', roundsRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/embed', embedRoutes);

// Screenshot uploads (html2canvas route registered above with the embed routes)
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Demo prototype page with the embed script injected.
// /demo serves the first project; /demo/:projectId serves that specific project.
app.get(['/demo', '/demo/:projectId'], (req, res) => {
  const project = req.params.projectId
    ? db.prepare('SELECT embed_token FROM projects WHERE id = ?').get(req.params.projectId)
    : db.prepare('SELECT embed_token FROM projects ORDER BY created_at ASC LIMIT 1').get();
  if (!project) return res.status(404).send('Run `npm run seed` first to create the demo project.');
  const html = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo.html'),
    'utf8'
  ).replace(/__EMBED_TOKEN__/g, project.embed_token);
  res.type('html').send(html);
});

// Serve the built dashboard (production mode)
app.use(express.static(webDist));
app.get(/^\/(?!api|embed).*/, (_req, res) => {
  res.sendFile(webIndex);
});

app.listen(PORT, () => {
  console.log(`Notely server listening on http://localhost:${PORT}`);
});
