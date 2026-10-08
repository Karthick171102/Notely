-- Supabase Schema for Notely
-- Run this in the Supabase SQL Editor after creating a new Supabase project
-- Based on the original SQLite schema from server/src/db.js

-- 1. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  embed_token TEXT UNIQUE NOT NULL,
  prototype_url TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  allowed_domains TEXT NOT NULL DEFAULT '*',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. Project members table
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  UNIQUE (project_id, user_id)
);

-- 5. Comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  element_selector TEXT NOT NULL,
  element_snapshot JSONB NOT NULL,
  page_url TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '/',
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'suggestion' CHECK (type IN ('bug','suggestion','question','other','design_change','ux','content','accessibility','performance','feature')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','reopened')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Indexes for comments
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);

-- 5. Activity log table
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  brand_color TEXT NOT NULL DEFAULT '#4f46e5',
  plan TEXT NOT NULL DEFAULT 'free',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 7. Workspace members table
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  UNIQUE (workspace_id, user_id)
);

-- 8. Review rounds table
CREATE TABLE IF NOT EXISTS review_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  deadline TIMESTAMP WITH TIME ZONE,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  instructions TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 9. Versions table
CREATE TABLE IF NOT EXISTS versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 10. Approvals table
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES review_rounds(id) ON DELETE SET NULL,
  version_id UUID REFERENCES versions(id) ON DELETE SET NULL,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('approved','changes_requested')),
  note TEXT,
  signed_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 11. Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  feedback_ref TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 12. Integrations table
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','connected','error')),
  configuration JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 13. Integration events table
CREATE TABLE IF NOT EXISTS integration_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  feedback_id UUID REFERENCES comments(id),
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  payload JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 14. Enable RLS (Row Level Security) - recommended for production
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
-- ALLE TABLE review_rounds ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE versions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;

-- 15. Create RLS policies (example for public app)
-- These policies allow public read access to projects/comments, auth for writes

-- Projects policies
-- CREATE POLICY "Projects are viewable by everyone" ON projects FOR SELECT USING (true);
-- CREATE POLICY "Projects are insertable by owners" ON projects FOR INSERT WITH CHECK (auth.role() = 'service_role' OR owner_id = auth.uid());
-- etc.

-- Comments policies
-- CREATE POLICY "Comments are viewable by project members" ON comments FOR SELECT USING (
--   EXISTS (SELECT 1 FROM project_members WHERE project_id = comments.project_id AND user_id = auth.uid())
--   OR EXISTS (SELECT 1 FROM projects WHERE id = comments.project_id AND is_public = true)
-- );

-- Users policies
-- CREATE POLICY "Users are viewable by project members" ON users FOR SELECT USING (
--   EXISTS (SELECT 1 FROM project_members WHERE user_id = auth.uid())
-- );

-- Insert default admin user (to be run after Supabase setup)
-- INSERT INTO users (id, email, name, password_hash) VALUES ('00000000-0000-0000-0000-000000000000', 'admin@notely.test', 'Admin', '$2a$10$example');