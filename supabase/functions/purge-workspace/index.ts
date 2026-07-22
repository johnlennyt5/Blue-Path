// purge-workspace (S7-5, ARCHITECTURE §8.3): admin-invoked hard delete of a
// workspace's synced content, honoring the retention policy. Programs (and
// their processes/findings/edges, via cascade) are removed; audit events
// older than retention_days are pruned; recent audit history and the
// membership survive, and the purge itself is always audited.
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
    const { workspace_id } = (await req.json()) as { workspace_id?: string };
    if (workspace_id === undefined) return json({ error: 'workspace_id is required' }, 400);

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: caller, error: authError } = await service.auth.getUser(jwt);
    if (authError !== null || caller.user === null) {
      return json({ error: 'not authenticated' }, 401);
    }

    const { data: membership } = await service
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', caller.user.id)
      .single();
    if (membership?.role !== 'admin') {
      return json({ error: 'only workspace admins can purge' }, 403);
    }

    const { data: workspace } = await service
      .from('workspaces')
      .select('retention_days')
      .eq('id', workspace_id)
      .single();

    // Hard-delete synced content (cascades to processes/findings/edges).
    const { count: programCount } = await service
      .from('programs')
      .delete({ count: 'exact' })
      .eq('workspace_id', workspace_id);

    // Prune audit history older than retention (never the whole trail).
    let prunedCount = 0;
    const retentionDays = workspace?.retention_days ?? null;
    if (retentionDays !== null) {
      const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
      const { count } = await service
        .from('audit_events')
        .delete({ count: 'exact' })
        .eq('workspace_id', workspace_id)
        .lt('at', cutoff);
      prunedCount = count ?? 0;
    }

    // The purge itself is always on the record.
    await service.from('audit_events').insert({
      workspace_id,
      actor: caller.user.id,
      event: 'workspace.purged',
      subject_type: 'workspace',
      subject_id: workspace_id,
      detail: {
        programs_deleted: programCount ?? 0,
        audit_events_pruned: prunedCount,
        retention_days: retentionDays,
      },
    });

    return json({
      ok: true,
      programs_deleted: programCount ?? 0,
      audit_events_pruned: prunedCount,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
