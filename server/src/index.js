import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import dashboardRoutes from './routes/dashboard.js';
import embedRoutes from './routes/embed.js';
import workspaceRoutes from './routes/workspace.js';
import roundsRoutes from './routes/rounds.js';
import aiRoutes from './routes/ai.js';
import notificationsRoutes from './routes/notifications.js';
import integrationsRoutes from './routes/integrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Supabase client - credentials from environment variables
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Set the Supabase client for the db module
import db from './db.js';
db.setSupabaseClient(supa);

const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
const webIndex = path.join(webDist, 'index.html');
const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'uploads');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', dashboardRoutes);
app.use('/api/embed', embedRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/integrations', integrationsRoutes);

// Screenshot uploads
app.use('/uploads', express.static(uploadsDir));

// Serve built dashboard (production mode)
app.use(express.static(webDist));
app.get(/^\/(?!api|embed).*/, (_req, res) => {
  res.sendFile(webIndex);
});

// Export app for Vercel serverless functions
// Vercel automatically handles the HTTP server
export default app;