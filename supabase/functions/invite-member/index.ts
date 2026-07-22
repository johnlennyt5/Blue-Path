// invite-member (BL-021, S6-3 follow-up): sends the actual invite email.
// The service-role key lives HERE, server-side, never in the browser. Caller
// must be an admin of the workspace; the invitee gets a GoTrue invite email
// (Mailpit locally) that signs them in — claim_workspace_invites() then
// materializes the membership with the role the admin chose.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { workspace_id, email } = (await req.json()) as {
      workspace_id?: string;
      email?: string;
    };
    if (workspace_id === undefined || email === undefined) {
      return json({ error: 'workspace_id and email are required' }, 400);
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Who is calling? (their JWT, not the service key)
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: caller, error: authError } = await service.auth.getUser(jwt);
    if (authError !== null || caller.user === null) {
      return json({ error: 'not authenticated' }, 401);
    }

    // Admin gate — same rule RLS enforces everywhere else.
    const { data: membership } = await service
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', caller.user.id)
      .single();
    if (membership?.role !== 'admin') {
      return json({ error: 'only workspace admins can send invites' }, 403);
    }

    const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') ?? 'http://localhost:5173';
    const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });
    if (inviteError !== null) {
      return json({ error: inviteError.message }, 400);
    }

    await service.from('audit_events').insert({
      workspace_id,
      actor: caller.user.id,
      event: 'member.invite_emailed',
      subject_type: 'email',
    });

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
