import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'node:uuid';

// Initialize Supabase client
// These will be injected via environment variables at runtime
let supa = null;

export function setSupabaseClient(client) {
  supa = client;
}

export function getSupabase() {
  if (!supa) throw new Error('Supabase client not initialized');
  return supa;
}

// Export utility functions that match the original API
export const generateUuid = () => crypto.randomBytes(16).toString('hex');
export const now = () => new Date().toISOString();

// --- Contextly v2 tables via Supabase ---

// Users table
export async function getUserById(userId) {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function getUserByEmail(email) {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error) throw error;
  return data;
}

export async function createUser({ id, email, name, password_hash }) {
  const { data, error } = await getSupabase()
    .from('users')
    .insert([{ id, email, name, password_hash, created_at: now(), updated_at: now() }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Projects table
export async function getProjectById(projectId) {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
  if (error) throw error;
  return data;
}

export async function getProjectByToken(token) {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('*')
    .eq('embed_token', token)
    .single();
  if (error) throw error;
  return data;
}

export async function listUserProjects(userId) {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('*')
    .or(`owner_id.eq.${userId},id.in.(SELECT project_id FROM project_members WHERE user_id.eq.${userId})`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProject(projectData) {
  const { data, error } = await getSupabase()
    .from('projects')
    .insert([{
      ...projectData,
      created_at: now(),
      updated_at: now()
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(projectId, updates) {
  const { data, error } = await getSupabase()
    .from('projects')
    .update({ ...updates, updated_at: now() })
    .eq('id', projectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProject(projectId) {
  const { error } = await getSupabase()
    .from('projects')
    .delete()
    .eq('id', projectId);
  if (error) throw error;
}

// Project members
export async function listProjectMembers(projectId) {
  const { data, error } = await getSupabase()
    .from('project_members')
    .select(`
      *,
      users (*)
    `)
    .eq('project_id', projectId);
  if (error) throw error;
  return data;
}

export async function addProjectMember(memberData) {
  const { data, error } = await getSupabase()
    .from('project_members')
    .insert([memberData])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Comments table
export async function listCommentsByProject(projectId, filters = {}) {
  let query = getSupabase()
    .from('comments')
    .select(`
      *,
      users (*)
    `)
    .eq('project_id', projectId);

  // Apply filters
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.q) {
    const like = `%${filters.q}%`;
    query = query.or(`content.ilike like.${like},element_selector.ilike like.${like},author_name.ilike like.${like},ref.ilike like.${like}`);
  }
  if (filters.parent_comment_id !== undefined) {
    query = query.eq('parent_comment_id', filters.parent_comment_id);
  }

  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createComment(commentData) {
  const { data, error } = await getSupabase()
    .from('comments')
    .insert([{
      ...commentData,
      created_at: now(),
      updated_at: now()
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateComment(commentId, updates) {
  const { data, error } = await getSupabase()
    .from('comments')
    .update({ ...updates, updated_at: now() })
    .eq('id', commentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(commentId) {
  const { error } = await getSupabase()
    .from('comments')
    .delete()
    .eq('id', commentId);
  if (error) throw error;
}

// Activity log
export async function logActivity({ projectId, userId, action, metadata }) {
  const { data, error } = await getSupabase()
    .from('activity_log')
    .insert([{
      id: uuid(),
      project_id: projectId,
      user_id: userId,
      action,
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: now()
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Notifications
export async function notifyUser({ userId, projectId, type, message, feedbackRef }) {
  const { data, error } = await getSupabase()
    .from('notifications')
    .insert([{
      id: uuid(),
      user_id: userId,
      project_id: projectId,
      feedback_ref: feedbackRef,
      type,
      message,
      read: 0,
      created_at: now()
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Workspaces
export async function getWorkspaceForUser(userId) {
  const { data, error } = await getSupabase()
    .from('workspaces')
    .select(`
      *,
      workspace_members (*)
    `)
    .or(`owner_id.eq.${userId},id.in.(SELECT workspace_id FROM workspace_members WHERE user_id.eq.${userId})`)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

export async function listWorkspaceMembers(workspaceId) {
  const { data, error } = await getSupabase()
    .from('workspace_members')
    .select(`
      *,
      users (*)
    `)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return data;
}

export async function createWorkspace(workspaceData) {
  const { data, error } = await getSupabase()
    .from('workspaces')
    .insert([{ ...workspaceData, created_at: now() }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addWorkspaceMember(memberData) {
  const { data, error } = await getSupabase()
    .from('workspace_members')
    .insert([memberData])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Review rounds
export async function listReviewRounds(projectId) {
  const { data, error } = await getSupabase()
    .from('review_rounds')
    .select(`
      *,
      versions (*)
    `)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createReviewRound(roundData) {
  const { data, error } = await getSupabase()
    .from('review_rounds')
    .insert([{ ...roundData, created_at: now() }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReviewRound(roundId, updates) {
  const { data, error } = await getSupabase()
    .from('review_rounds')
    .update(updates)
    .eq('id', roundId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Versions
export async function listVersions(roundId) {
  const { data, error } = await getSupabase()
    .from('versions')
    .select('*')
    .eq('round_id', roundId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createVersion(versionData) {
  const { data, error } = await getSupabase()
    .from('versions')
    .insert([{ ...versionData, created_at: now() }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Approvals
export async function listApprovals(roundId) {
  const { data, error } = await getSupabase()
    .from('approvals')
    .select(`
      *,
      users (*)
    `)
    .eq('round_id', roundId)
    .order('created_at', { descending: true });
  if (error) throw error;
  return data;
}

export async function createApproval(approvalData) {
  const { data, error } = await getSupabase()
    .from('approvals')
    .insert([approvalData])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Integrations
export async function listIntegrations(workspaceId) {
  const { data, error } = await getSupabase()
    .from('integrations')
    .select('*')
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return data;
}

export async function upsertIntegration(integrationData) {
  const { data, error } = await getSupabase()
    .from('integrations')
    .upsert([integrationData])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Integration events
export async function logIntegrationEvent(eventData) {
  const { data, error } = await getSupabase()
    .from('integration_events')
    .insert([{ ...eventData, created_at: now() }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Migration: Ensure tables exist ---
// In production, create these via Supabase SQL editor:
// See supabase_schema.sql for the full schema

export async function ensureTablesExist() {
  // This is a no-op for Supabase since tables are created via migration
  // The actual schema should be applied in the Supabase dashboard
  return true;
}