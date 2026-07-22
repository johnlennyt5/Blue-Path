// llm-proxy (S7-2, ARCHITECTURE §8.3): the ONLY path from PrismShift to an
// LLM in Workspace Mode. The Anthropic key lives here, server-side. Every
// request is: authenticated → workspace-membership-checked → scanned for raw
// XML (blocked + audited) → size-capped → rate-limited per workspace →
// audited (event only, never content) → forwarded.
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

// Hard ceilings — env-overridable, never removable.
const MAX_PAYLOAD_BYTES = Number(Deno.env.get('LLM_MAX_PAYLOAD_BYTES') ?? 100_000);
const RATE_LIMIT_PER_HOUR = Number(Deno.env.get('LLM_RATE_LIMIT_PER_HOUR') ?? 30);

// Anything that smells like source content is refused outright.
const XML_MARKERS = ['<?xml', '<process', '<stage', '<object', 'xmlns', '<activity', '</'];

const SYSTEM_PROMPT = [
  'You are documenting a Blue Prism automation for a migration audit.',
  'You receive a REDACTED digest: names, types, and structure only — no values.',
  'Write a concise business narrative: what the automation appears to do, the',
  'applications and queues it touches, its exception strategy, and anything a',
  'migration team should pay attention to. Never invent specific values,',
  'volumes, or business rules the digest does not show. Under 250 words.',
].join(' ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const bodyText = await req.text();

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Who is calling?
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: caller, error: authError } = await service.auth.getUser(jwt);
    if (authError !== null || caller.user === null) {
      return json({ error: 'not authenticated' }, 401);
    }

    let payload: {
      workspace_id?: string;
      digest?: unknown;
      owner_name?: string;
      dry_run?: boolean;
    };
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    const { workspace_id, digest, owner_name } = payload;
    if (workspace_id === undefined || digest === undefined) {
      return json({ error: 'workspace_id and digest are required' }, 400);
    }

    // 2. Workspace membership (any role — narratives are read-level).
    const { data: membership } = await service
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', caller.user.id)
      .single();
    if (membership === null) {
      return json({ error: 'not a member of this workspace' }, 403);
    }

    // 3. Raw-XML blocker — audited so infosec sees attempts.
    const serialized = JSON.stringify(digest).toLowerCase();
    for (const marker of XML_MARKERS) {
      if (serialized.includes(marker)) {
        await service.from('audit_events').insert({
          workspace_id,
          actor: caller.user.id,
          event: 'ai.blocked',
          subject_type: 'digest',
          detail: { reason: `payload contains "${marker}"` },
        });
        return json(
          { error: `blocked: payload contains raw content marker "${marker}"` },
          400,
        );
      }
    }

    // 4. Size ceiling.
    if (bodyText.length > MAX_PAYLOAD_BYTES) {
      return json(
        { error: `payload too large (${bodyText.length} > ${MAX_PAYLOAD_BYTES} bytes)` },
        413,
      );
    }

    // 5. Per-workspace rate limit — counts requests (audit rows) per hour.
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await service
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('event', 'ai.narrative')
      .gte('at', oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `rate limit: ${RATE_LIMIT_PER_HOUR} AI requests per workspace per hour` },
        429,
      );
    }

    // 6. Audit the request — event + sizes only, never content.
    await service.from('audit_events').insert({
      workspace_id,
      actor: caller.user.id,
      event: 'ai.narrative',
      subject_type: 'digest',
      detail: { owner: owner_name ?? null, bytes: bodyText.length },
    });

    // 7. Keys never leave this function. Provider: LLM_PROVIDER override,
    // else whichever key is configured (anthropic preferred when both).
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
    const provider =
      Deno.env.get('LLM_PROVIDER') ?? (anthropicKey !== '' ? 'anthropic' : 'openai');
    const apiKey = provider === 'openai' ? openaiKey : anthropicKey;
    if (apiKey === '') {
      return json({ error: 'AI is not configured for this deployment' }, 503);
    }

    // Test hook: exercise every gate above without an upstream call.
    if (payload.dry_run === true) {
      return json({ narrative: '[dry-run] gates passed; no upstream call made' });
    }

    let narrative: string;
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: Deno.env.get('LLM_MODEL') ?? 'gpt-4o-mini',
          max_tokens: 700,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(digest) },
          ],
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        console.error('openai error', response.status, detail.slice(0, 200));
        return json({ error: `upstream error (${response.status})` }, 502);
      }
      const result = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      narrative = (result.choices[0]?.message.content ?? '').trim();
    } else {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: Deno.env.get('LLM_MODEL') ?? 'claude-sonnet-5',
          max_tokens: 700,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(digest) }],
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        console.error('anthropic error', response.status, detail.slice(0, 200));
        return json({ error: `upstream error (${response.status})` }, 502);
      }
      const result = (await response.json()) as { content: { type: string; text?: string }[] };
      narrative = result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();
    }

    return json({ narrative });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
