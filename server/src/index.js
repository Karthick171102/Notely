import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { initSchema } from './db.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import dashboardRoutes from './routes/dashboard.js';
import embedRoutes, { serveEmbedScript } from './routes/embed.js';
import workspaceRoutes from './routes/workspace.js';
import roundsRoutes from './routes/rounds.js';
import aiRoutes from './routes/ai.js';
import notificationsRoutes from './routes/notifications.js';
import integrationsRoutes from './routes/integrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Ensure the schema exists before handling any request (idempotent, once per instance)
const schemaReady = initSchema().catch((e) => {
  console.error('[db] schema init failed:', e.message);
});
app.use(async (_req, _res, next) => {
  await schemaReady;
  next();
});

// The embed script: /embed/{embed_token}.js (register the fixed library route first)
app.get('/embed/html2canvas.min.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(publicDir, 'html2canvas.min.js'));
});
app.get('/embed/:token.js', serveEmbedScript);
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

app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Export the app for Vercel serverless (local start uses bin via npm start)
if (process.env.VERCEL !== '1' && !process.env.VERCEL_DEV) {
  app.listen(PORT, () => {
    console.log(`Notely server listening on http://localhost:${PORT}`);
  });
}

export default app;
