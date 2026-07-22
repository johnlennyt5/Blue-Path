/**
 * Workspace Mode API (S6-3): thin, typed calls over the Supabase client.
 * Every function takes the client as an argument so tests inject a fake —
 * nothing here touches the network on its own.
 */
import type { Supabase } from './supabaseClient';

export type WorkspaceRole = 'admin' | 'editor' | 'viewer';

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  artifactStorageEnabled: boolean;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: WorkspaceRole;
}

export interface PendingInvite {
  email: string;
  role: WorkspaceRole;
}

export interface PrivacyMode {
  key: 'local' | 'workspace';
  label: string;
  description: string;
}

/**
 * The privacy badge is ALWAYS visible and always truthful (S6-7): pure Local
 * Mode until the user is signed in with a workspace selected — then Workspace
 * Mode, which still never ships content, only metadata.
 */
export function currentPrivacyMode(
  signedIn: boolean,
  activeWorkspace: string | null,
): PrivacyMode {
  if (signedIn && activeWorkspace !== null) {
    return {
      key: 'workspace',
      label: 'Workspace Mode — metadata syncs, content stays local',
      description:
        'Analysis metadata (names, scores, statuses) syncs to your workspace. Blue Prism XML and generated XAML never leave this browser.',
    };
  }
  return {
    key: 'local',
    label: 'Local Mode — data stays in your browser',
    description: 'Nothing is uploaded anywhere. All processing happens in this tab.',
  };
}

/** UI role gates — single source of truth, mirrored by RLS on the server. */
export const can = {
  manageMembers: (role: WorkspaceRole | null): boolean => role === 'admin',
  editWorkspaceSettings: (role: WorkspaceRole | null): boolean => role === 'admin',
  createPrograms: (role: WorkspaceRole | null): boolean =>
    role === 'admin' || role === 'editor',
  syncAnalyses: (role: WorkspaceRole | null): boolean => role === 'admin' || role === 'editor',
} as const;

function orThrow<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error !== null) throw new Error(result.error.message);
  if (result.data === null) throw new Error('empty response');
  return result.data;
}

export async function sendMagicLink(sb: Supabase, email: string): Promise<void> {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error !== null) throw new Error(error.message);
}

export async function signOut(sb: Supabase): Promise<void> {
  const { error } = await sb.auth.signOut();
  if (error !== null) throw new Error(error.message);
}

export async function createWorkspace(sb: Supabase, name: string): Promise<string> {
  return orThrow(await sb.rpc('create_workspace', { workspace_name: name }));
}

/** Workspaces the signed-in user belongs to, with their own role attached. */
export async function listWorkspaces(sb: Supabase, userId: string): Promise<WorkspaceSummary[]> {
  const workspaces = orThrow(
    await sb.from('workspaces').select('id, name, artifact_storage_enabled'),
  );
  const memberships = orThrow(
    await sb.from('workspace_members').select('workspace_id, role').eq('user_id', userId),
  );
  const roleByWorkspace = new Map(memberships.map((m) => [m.workspace_id, m.role]));
  return workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    role: (roleByWorkspace.get(w.id) ?? 'viewer') as WorkspaceRole,
    artifactStorageEnabled: w.artifact_storage_enabled,
  }));
}

export async function listMembers(sb: Supabase, workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = orThrow(await sb.rpc('list_workspace_members', { ws: workspaceId }));
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    role: r.role as WorkspaceRole,
  }));
}

/** 'added' if the account existed; 'invited' if a pending invite was stored. */
export async function addMember(
  sb: Supabase,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<'added' | 'invited'> {
  const { data, error } = await sb.rpc('add_workspace_member', {
    ws: workspaceId,
    member_email: email,
    member_role: role,
  });
  if (error !== null) throw new Error(error.message);
  return data === null ? 'invited' : 'added';
}

/** Email the invitee a sign-in link via the invite-member Edge Function. */
export async function sendInviteEmail(
  sb: Supabase,
  workspaceId: string,
  email: string,
): Promise<void> {
  const { data, error } = await sb.functions.invoke('invite-member', {
    body: { workspace_id: workspaceId, email },
  });
  if (error !== null) throw new Error(error.message);
  const result = data as { ok?: boolean; error?: string } | null;
  if (result?.ok !== true) throw new Error(result?.error ?? 'invite email failed');
}

/** Convert any pending invites for the signed-in email into memberships. */
export async function claimInvites(sb: Supabase): Promise<number> {
  const { data, error } = await sb.rpc('claim_workspace_invites');
  if (error !== null) throw new Error(error.message);
  return data ?? 0;
}

export async function listInvites(
  sb: Supabase,
  workspaceId: string,
): Promise<PendingInvite[]> {
  const rows = orThrow(
    await sb.from('workspace_invites').select('email, role').eq('workspace_id', workspaceId),
  );
  return rows.map((r) => ({ email: r.email, role: r.role as WorkspaceRole }));
}

export async function revokeInvite(
  sb: Supabase,
  workspaceId: string,
  email: string,
): Promise<void> {
  const { error } = await sb
    .from('workspace_invites')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('email', email);
  if (error !== null) throw new Error(error.message);
}

/**
 * Flip the workspace's artifact-storage flag (admin-only via RLS; audited).
 * Flag only — encrypted artifact storage itself is BL-001, not yet built.
 */
export async function setArtifactStorage(
  sb: Supabase,
  workspaceId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const { data, error } = await sb
    .from('workspaces')
    .update({ artifact_storage_enabled: enabled })
    .eq('id', workspaceId)
    .select('id');
  if (error !== null) throw new Error(error.message);
  if (data === null || data.length === 0) {
    throw new Error('settings not changed — only workspace admins can do this');
  }
  const audit = await sb.from('audit_events').insert({
    workspace_id: workspaceId,
    actor: userId,
    event: 'settings.artifact_storage',
    subject_type: 'workspace',
    subject_id: workspaceId,
    detail: { enabled },
  });
  if (audit.error !== null) throw new Error(audit.error.message);
}

export async function updateMemberRole(
  sb: Supabase,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const { error } = await sb
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);
  if (error !== null) throw new Error(error.message);
}

export async function removeMember(
  sb: Supabase,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await sb
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);
  if (error !== null) throw new Error(error.message);
}
