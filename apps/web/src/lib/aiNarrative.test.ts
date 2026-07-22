// @vitest-environment jsdom
/**
 * S7-2 · AI narrative client: invokes the proxy with digest-only payloads and
 * surfaces server-side gate errors verbatim. No key material anywhere.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AiDigest } from '@prismshift/reports';
import type { Supabase } from './supabaseClient';
import { requestNarrative, requestNarrativeFromCustomEndpoint } from './aiNarrative';

const DIGEST: AiDigest = { owners: [], queues: [], credentials: [] };

describe('requestNarrative (llm-proxy transport)', () => {
  it('invokes the function with workspace + digest and returns the narrative', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { narrative: 'It moves invoices.' }, error: null });
    const sb = { functions: { invoke } } as unknown as Supabase;
    await expect(requestNarrative(sb, 'ws1', DIGEST, 'Invoice Dispatcher')).resolves.toBe(
      'It moves invoices.',
    );
    expect(invoke).toHaveBeenCalledWith('llm-proxy', {
      body: { workspace_id: 'ws1', digest: DIGEST, owner_name: 'Invoice Dispatcher' },
    });
  });

  it('surfaces the server gate message (e.g. rate limit) from error context', async () => {
    const context = new Response(JSON.stringify({ error: 'rate limit: 30 AI requests per workspace per hour' }), {
      status: 429,
    });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'non-2xx', context } });
    const sb = { functions: { invoke } } as unknown as Supabase;
    await expect(requestNarrative(sb, 'ws1', DIGEST)).rejects.toThrow(/rate limit/);
  });

  it('rejects when the function returns no narrative', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { error: 'AI is not configured' }, error: null });
    const sb = { functions: { invoke } } as unknown as Supabase;
    await expect(requestNarrative(sb, 'ws1', DIGEST)).rejects.toThrow(/not configured/);
  });
});

describe('requestNarrativeFromCustomEndpoint', () => {
  it('POSTs the digest and returns the narrative', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ narrative: 'Custom says hi.' })),
    );
    await expect(requestNarrativeFromCustomEndpoint('https://ai.local/x', DIGEST)).resolves.toBe(
      'Custom says hi.',
    );
    expect(fetchMock).toHaveBeenCalledWith('https://ai.local/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digest: DIGEST }),
    });
    fetchMock.mockRestore();
  });
});
