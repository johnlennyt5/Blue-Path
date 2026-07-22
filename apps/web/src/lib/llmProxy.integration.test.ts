/**
 * S7-2 · llm-proxy abuse-case suite (the AC): runs against the LOCAL Supabase
 * stack when it's up; skips cleanly when it isn't (CI unit-test job). Every
 * gate is provable without an Anthropic key because validation happens before
 * the upstream call:
 *   401 no auth · 403 non-member · 400 raw-XML blocked (audited) ·
 *   413 oversize · 429 rate-limited · 503 key not configured
 */
import { beforeAll, describe, expect, it } from 'vitest';

const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let available = false;
try {
  const ping = await fetch(`${API}/functions/v1/llm-proxy`, {
    method: 'OPTIONS',
    signal: AbortSignal.timeout(2000),
  });
  available = ping.ok;
} catch {
  available = false;
}

const CLEAN_DIGEST = {
  owners: [{ name: 'Proc', role: 'process', pages: [], dataItems: [] }],
  queues: [],
  credentials: [],
};

async function createUser(email: string): Promise<string> {
  await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: 'llm-test-pass-1', email_confirm: true }),
  });
  const login = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'llm-test-pass-1' }),
  });
  const session = (await login.json()) as { access_token: string };
  return session.access_token;
}

async function callProxy(
  token: string | null,
  body: unknown,
): Promise<{ status: number; body: { error?: string; narrative?: string } }> {
  const response = await fetch(`${API}/functions/v1/llm-proxy`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as never };
}

describe.skipIf(!available)('llm-proxy abuse cases (local stack)', () => {
  let memberToken: string;
  let strangerToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    memberToken = await createUser(`llm-member-${stamp}@test.local`);
    strangerToken = await createUser(`llm-stranger-${stamp}@test.local`);
    const ws = await fetch(`${API}/rest/v1/rpc/create_workspace`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${memberToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace_name: `LLM Test ${stamp}` }),
    });
    workspaceId = ((await ws.json()) as string).replace(/"/g, '');
  }, 30000);

  it('401: no token', async () => {
    const { status } = await callProxy(null, {
      workspace_id: 'x',
      digest: CLEAN_DIGEST,
    });
    expect(status).toBe(401);
  });

  it('403: authenticated but not a member of the workspace', async () => {
    const { status, body } = await callProxy(strangerToken, {
      workspace_id: workspaceId,
      digest: CLEAN_DIGEST,
    });
    expect(status).toBe(403);
    expect(body.error).toContain('member');
  });

  it('400: raw XML markers are blocked and the attempt is audited', async () => {
    const { status, body } = await callProxy(memberToken, {
      workspace_id: workspaceId,
      digest: { sneaky: '<process name="Payroll"><stage>…</stage></process>' },
    });
    expect(status).toBe(400);
    expect(body.error).toContain('blocked');

    const audit = await fetch(
      `${API}/rest/v1/audit_events?workspace_id=eq.${workspaceId}&event=eq.ai.blocked&select=detail`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    const rows = (await audit.json()) as { detail: { reason: string } }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it('413: payload over the size ceiling', async () => {
    const { status, body } = await callProxy(memberToken, {
      workspace_id: workspaceId,
      digest: { ...CLEAN_DIGEST, padding: 'x'.repeat(120_000) },
    });
    expect(status).toBe(413);
    expect(body.error).toContain('too large');
  });

  it('gates pass (503 keyless / 200 dry-run), then 429 once the hourly budget is spent', async () => {
    let sawConfiguredError = false;
    let finalStatus = 0;
    for (let i = 0; i < 32; i++) {
      const { status } = await callProxy(memberToken, {
        workspace_id: workspaceId,
        digest: CLEAN_DIGEST,
        owner_name: `attempt ${i}`,
        dry_run: true, // gates still fully exercised; no credits ever spent
      });
      finalStatus = status;
      if (status === 503) sawConfiguredError = true;
      if (status === 429) break;
      // 200 would mean a real key is configured locally — also fine; the
      // loop still must end in 429.
    }
    expect(sawConfiguredError || finalStatus === 429).toBe(true);
    expect(finalStatus).toBe(429);

    // Audit counted the requests (event only, no content):
    const audit = await fetch(
      `${API}/rest/v1/audit_events?workspace_id=eq.${workspaceId}&event=eq.ai.narrative&select=id`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    const rows = (await audit.json()) as unknown[];
    expect(rows.length).toBe(30); // exactly the hourly limit, then cut off
  }, 60000);
});

describe.skipIf(available)('llm-proxy abuse cases', () => {
  it.skip('skipped — local Supabase stack not running', () => {});
});
