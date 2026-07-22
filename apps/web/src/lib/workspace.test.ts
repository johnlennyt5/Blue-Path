// @vitest-environment jsdom
/**
 * S6-3 · Workspace API layer over a fake Supabase client. The RLS side is
 * proven by pgTAP (supabase/tests); these tests pin the client-side calls:
 * correct RPC names/args, error surfacing, and the UI role-gate table.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Supabase } from './supabaseClient';
import {
  addMember,
  can,
  claimInvites,
  currentPrivacyMode,
  sendInviteEmail,
  setArtifactStorage,
  createWorkspace,
  listMembers,
  listWorkspaces,
  sendMagicLink,
  updateMemberRole,
} from './workspace';

function fakeSupabase(overrides: Record<string, unknown> = {}): Supabase {
  return {
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(),
    ...overrides,
  } as unknown as Supabase;
}

describe('role gates (mirrors RLS)', () => {
  it('admin can do everything', () => {
    expect(can.manageMembers('admin')).toBe(true);
    expect(can.editWorkspaceSettings('admin')).toBe(true);
    expect(can.createPrograms('admin')).toBe(true);
    expect(can.syncAnalyses('admin')).toBe(true);
  });

  it('editor can work but not administer', () => {
    expect(can.manageMembers('editor')).toBe(false);
    expect(can.editWorkspaceSettings('editor')).toBe(false);
    expect(can.createPrograms('editor')).toBe(true);
    expect(can.syncAnalyses('editor')).toBe(true);
  });

  it('viewer is read-only; signed-out (null) can do nothing', () => {
    for (const role of ['viewer', null] as const) {
      expect(can.manageMembers(role)).toBe(false);
      expect(can.editWorkspaceSettings(role)).toBe(false);
      expect(can.createPrograms(role)).toBe(false);
      expect(can.syncAnalyses(role)).toBe(false);
    }
  });
});

describe('currentPrivacyMode (S6-7: badge always visible, always truthful)', () => {
  it('local until signed in AND a workspace is active', () => {
    expect(currentPrivacyMode(false, null).key).toBe('local');
    expect(currentPrivacyMode(true, null).key).toBe('local');
    expect(currentPrivacyMode(false, 'ws1').key).toBe('local');
  });

  it('workspace mode still promises content stays local', () => {
    const mode = currentPrivacyMode(true, 'ws1');
    expect(mode.key).toBe('workspace');
    expect(mode.label).toContain('content stays local');
  });
});

describe('setArtifactStorage (S6-7: admin-only flag, audited)', () => {
  function storageFake(updated: { id: string }[]) {
    const select = vi.fn().mockResolvedValue({ data: updated, error: null });
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const insert = vi.fn().mockResolvedValue({ error: null });
    const sb = {
      from: vi.fn((table: string) => (table === 'workspaces' ? { update } : { insert })),
    } as unknown as Supabase;
    return { sb, update, insert };
  }

  it('updates the flag and writes the audit event', async () => {
    const { sb, update, insert } = storageFake([{ id: 'ws1' }]);
    await setArtifactStorage(sb, 'ws1', 'me', true);
    expect(update).toHaveBeenCalledWith({ artifact_storage_enabled: true });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'settings.artifact_storage', detail: { enabled: true } }),
    );
  });

  it('zero rows (non-admin, RLS-filtered) → explicit admin-only error, no audit', async () => {
    const { sb, insert } = storageFake([]);
    await expect(setArtifactStorage(sb, 'ws1', 'me', true)).rejects.toThrow(/admin/);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('workspace API calls', () => {
  it('sendMagicLink calls signInWithOtp with a redirect back to the app', async () => {
    const sb = fakeSupabase();
    await sendMagicLink(sb, 'user@test.local');
    expect(sb.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'user@test.local',
      options: { emailRedirectTo: window.location.origin },
    });
  });

  it('createWorkspace returns the new id from the RPC', async () => {
    const sb = fakeSupabase({
      rpc: vi.fn().mockResolvedValue({ data: 'new-ws-id', error: null }),
    });
    await expect(createWorkspace(sb, 'My Estate')).resolves.toBe('new-ws-id');
    expect(sb.rpc).toHaveBeenCalledWith('create_workspace', { workspace_name: 'My Estate' });
  });

  it('createWorkspace surfaces server errors as thrown Errors', async () => {
    const sb = fakeSupabase({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'not authenticated' } }),
    });
    await expect(createWorkspace(sb, 'X')).rejects.toThrow('not authenticated');
  });

  it('listWorkspaces attaches the caller role from memberships', async () => {
    const sb = fakeSupabase({
      from: vi.fn((table: string) => {
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: 'ws1', name: 'One', artifact_storage_enabled: false }],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ workspace_id: 'ws1', role: 'admin' }],
              error: null,
            }),
          })),
        };
      }),
    });
    await expect(listWorkspaces(sb, 'me')).resolves.toEqual([
      { id: 'ws1', name: 'One', role: 'admin', artifactStorageEnabled: false },
    ]);
  });

  it('listMembers maps the RPC roster', async () => {
    const sb = fakeSupabase({
      rpc: vi.fn().mockResolvedValue({
        data: [{ user_id: 'u1', email: 'a@test.local', role: 'admin' }],
        error: null,
      }),
    });
    await expect(listMembers(sb, 'ws1')).resolves.toEqual([
      { userId: 'u1', email: 'a@test.local', role: 'admin' },
    ]);
    expect(sb.rpc).toHaveBeenCalledWith('list_workspace_members', { ws: 'ws1' });
  });

  it('addMember: existing account → added', async () => {
    const sb = fakeSupabase({
      rpc: vi.fn().mockResolvedValue({ data: 'u2', error: null }),
    });
    await expect(addMember(sb, 'ws1', 'new@test.local', 'viewer')).resolves.toBe('added');
    expect(sb.rpc).toHaveBeenCalledWith('add_workspace_member', {
      ws: 'ws1',
      member_email: 'new@test.local',
      member_role: 'viewer',
    });
  });

  it('addMember: unknown account → invited (pending invite stored server-side)', async () => {
    const sb = fakeSupabase({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(addMember(sb, 'ws1', 'stranger@test.local', 'editor')).resolves.toBe('invited');
  });

  it('sendInviteEmail invokes the edge function with workspace + email', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const sb = fakeSupabase({ functions: { invoke } });
    await sendInviteEmail(sb, 'ws1', 'new@test.local');
    expect(invoke).toHaveBeenCalledWith('invite-member', {
      body: { workspace_id: 'ws1', email: 'new@test.local' },
    });
  });

  it('sendInviteEmail surfaces function-reported errors', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { error: 'only workspace admins can send invites' }, error: null });
    const sb = fakeSupabase({ functions: { invoke } });
    await expect(sendInviteEmail(sb, 'ws1', 'x@test.local')).rejects.toThrow('only workspace admins');
  });

  it('claimInvites returns how many memberships materialized', async () => {
    const sb = fakeSupabase({ rpc: vi.fn().mockResolvedValue({ data: 2, error: null }) });
    await expect(claimInvites(sb)).resolves.toBe(2);
    expect(sb.rpc).toHaveBeenCalledWith('claim_workspace_invites');
  });

  it('updateMemberRole targets exactly one membership row', async () => {
    const eqUser = vi.fn().mockResolvedValue({ error: null });
    const eqWs = vi.fn(() => ({ eq: eqUser }));
    const update = vi.fn(() => ({ eq: eqWs }));
    const sb = fakeSupabase({ from: vi.fn(() => ({ update })) });

    await updateMemberRole(sb, 'ws1', 'u2', 'editor');
    expect(update).toHaveBeenCalledWith({ role: 'editor' });
    expect(eqWs).toHaveBeenCalledWith('workspace_id', 'ws1');
    expect(eqUser).toHaveBeenCalledWith('user_id', 'u2');
  });
});
