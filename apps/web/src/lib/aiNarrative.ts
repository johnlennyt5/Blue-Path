/**
 * AI narrative client (S7-2/S7-3). Two transports, both taking ONLY the
 * redacted digest (S7-1): the llm-proxy Edge Function (Workspace Mode — the
 * API key lives server-side), or a user-supplied custom endpoint (S7-3).
 * The client never sees or stores an Anthropic key.
 */
import type { AiDigest } from '@prismshift/reports';
import type { Supabase } from './supabaseClient';

export interface NarrativeResult {
  narrative: string;
}

/** Workspace Mode: through the audited, rate-limited egress point. */
export async function requestNarrative(
  sb: Supabase,
  workspaceId: string,
  digest: AiDigest,
  ownerName?: string,
): Promise<string> {
  const { data, error } = await sb.functions.invoke('llm-proxy', {
    body: { workspace_id: workspaceId, digest, owner_name: ownerName },
  });
  if (error !== null) {
    // FunctionsHttpError carries the response; surface the server's message.
    const context = (error as { context?: Response }).context;
    if (context !== undefined) {
      const body = (await context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  const result = data as { narrative?: string; error?: string } | null;
  if (result?.narrative === undefined) {
    throw new Error(result?.error ?? 'no narrative returned');
  }
  return result.narrative;
}

/** Local Mode alternative: a user-supplied endpoint receives the digest. */
export async function requestNarrativeFromCustomEndpoint(
  endpoint: string,
  digest: AiDigest,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ digest }),
  });
  if (!response.ok) throw new Error(`endpoint returned ${response.status}`);
  const result = (await response.json()) as { narrative?: string };
  if (result.narrative === undefined) throw new Error('endpoint returned no narrative');
  return result.narrative;
}
