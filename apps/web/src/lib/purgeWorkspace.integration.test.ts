/**
 * S7-5 · purge-workspace against the local stack (self-skips when down):
 * 401 unauthenticated · 403 non-admin · a real purge that hard-deletes
 * programs, prunes audit events past retention, keeps recent ones, and
 * writes the workspace.purged audit event.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let available = false;
try {
  const ping = await fetch(`${API}/functions/v1/purge-workspace`, {
    method: 'OPTIONS',
    signal: AbortSignal.timeout(2000),
  });
  available = ping.ok;
} catch {
  available = false;
}

const serviceHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};

async function createUser(email: string): Promise<{ token: string; id: string }> {
  await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ email, password: 'purge-test-1', email_confirm: true }),
  });
  const login = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'purge-test-1' }),
  });
  const session = (await login.json()) as { access_token: string; user: { id: string } };
  return { token: session.access_token, id: session.user.id };
}

describe.skipIf(!available)('purge-workspace (local stack)', () => {
  let admin: { token: string; id: string };
  let editor: { token: string; id: string };
  let workspaceId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    admin = await createUser(`purge-admin-${stamp}@test.local`);
    editor = await createUser(`purge-editor-${stamp}@test.local`);

    const ws = await fetch(`${API}/rest/v1/rpc/create_workspace`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_name: `Purge Test ${stamp}` }),
    });
    workspaceId = ((await ws.json()) as string).replace(/"/g, '');

    // editor membership + a program + retention 30d + an ancient audit event
    await fetch(`${API}/rest/v1/workspace_members`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ workspace_id: workspaceId, user_id: editor.id, role: 'editor' }),
    });
    await fetch(`${API}/rest/v1/programs`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ workspace_id: workspaceId, name: 'Doomed Program', created_by: admin.id }),
    });
    await fetch(`${API}/rest/v1/workspaces?id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ retention_days: 30 }),
    });
    await fetch(`${API}/rest/v1/audit_events`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor: admin.id,
        event: 'process.analyzed',
        at: new Date(Date.now() - 100 * 86_400_000).toISOString(),
      }),
    });
  }, 30000);

  const purge = (token: string | null) =>
    fetch(`${API}/functions/v1/purge-workspace`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });

  it('401 without a token', async () => {
    expect((await purge(null)).status).toBe(401);
  });

  it('403 for an editor — purge is admin-only', async () => {
    const response = await purge(editor.token);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toContain('admin');
  });

  it('admin purge: programs hard-deleted, old audit pruned, purge audited', async () => {
    const response = await purge(admin.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      programs_deleted: number;
      audit_events_pruned: number;
    };
    expect(body.ok).toBe(true);
    expect(body.programs_deleted).toBe(1);
    expect(body.audit_events_pruned).toBeGreaterThanOrEqual(1); // the 100-day-old event

    const programs = await fetch(
      `${API}/rest/v1/programs?workspace_id=eq.${workspaceId}&select=id`,
      { headers: serviceHeaders },
    );
    expect(((await programs.json()) as unknown[]).length).toBe(0);

    const audit = await fetch(
      `${API}/rest/v1/audit_events?workspace_id=eq.${workspaceId}&select=event&order=at.desc`,
      { headers: serviceHeaders },
    );
    const events = ((await audit.json()) as { event: string }[]).map((e) => e.event);
    expect(events).toContain('workspace.purged'); // always on the record
    expect(events).toContain('workspace.created'); // recent history survives
    expect(events).not.toContain('process.analyzed'); // the ancient one is gone
  });
});

describe.skipIf(available)('purge-workspace', () => {
  it.skip('skipped — local Supabase stack not running', () => {});
});
