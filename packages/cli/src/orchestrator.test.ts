/**
 * BL-007 · Orchestrator integration: dry-run planning from the corpus,
 * per-item continue-on-failure semantics, exists-skip, correct API bodies
 * and headers, token never logged, CLI exit codes.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { applyPlan, planFromModel } from './orchestrator.js';
import { run } from './cli.js';

async function corpusModel() {
  const { xml } = await loadSample('02-realistic-mid-size');
  return (await parseBpRelease(xml)).model;
}

const CONFIG = { baseUrl: 'https://orch.test/o', folderId: '42', token: 'secret-token' };

function fetchStub(responses: Record<string, { status?: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k)) ?? '';
    const spec = responses[key] ?? {};
    return new Response(JSON.stringify(spec.body ?? { value: [] }), {
      status: spec.status ?? 200,
    });
  });
  return { impl, calls };
}

describe('planFromModel (corpus #2)', () => {
  it('plans queues, typed assets, and credential placeholders', async () => {
    const model = await corpusModel();
    const items = planFromModel(model);
    expect(items.find((i) => i.kind === 'queue' && i.name === 'Invoices Queue')).toBeDefined();
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has('asset-text') || kinds.has('asset-credential')).toBe(true);
    for (const item of items) expect(item.detail.length).toBeGreaterThan(0);
  });
});

describe('applyPlan', () => {
  it('creates new items with correct bodies and headers', async () => {
    const model = await corpusModel();
    const items = planFromModel(model).filter((i) => i.kind === 'queue');
    const { impl, calls } = fetchStub({});

    const results = await applyPlan(CONFIG, model, items, impl);
    expect(results.every((r) => r.status === 'created')).toBe(true);

    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('https://orch.test/o/odata/QueueDefinitions');
    const postHeaders = post.init!.headers as Record<string, string>;
    expect(postHeaders['Authorization']).toBe('Bearer secret-token');
    expect(postHeaders['X-UIPATH-OrganizationUnitId']).toBe('42');
    const body = JSON.parse(post.init!.body as string) as { Name: string; EnforceUniqueReference: boolean };
    expect(body.Name).toBe('Invoices Queue');
  });

  it('existing items are skipped, not recreated', async () => {
    const model = await corpusModel();
    const items = planFromModel(model).filter((i) => i.kind === 'queue');
    const { impl, calls } = fetchStub({ '$filter': { body: { value: [{ Id: 1 }] } } });

    const results = await applyPlan(CONFIG, model, items, impl);
    expect(results.every((r) => r.status === 'exists')).toBe(true);
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('a failing item reports and the batch CONTINUES (the AC)', async () => {
    const model = await corpusModel();
    const items = planFromModel(model);
    expect(items.length).toBeGreaterThan(1);
    let postCount = 0;
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1;
        if (postCount === 1) return new Response('boom', { status: 500 });
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });

    const results = await applyPlan(CONFIG, model, items, impl);
    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.message).toContain('500');
    // every remaining item was still attempted
    expect(results.slice(1).every((r) => r.status === 'created')).toBe(true);
    expect(results).toHaveLength(items.length);
  });

  it('never leaks the token into results', async () => {
    const model = await corpusModel();
    const items = planFromModel(model).slice(0, 1);
    const { impl } = fetchStub({});
    const results = await applyPlan(CONFIG, model, items, impl);
    expect(JSON.stringify(results)).not.toContain('secret-token');
  });
});

describe('CLI orchestrate command', () => {
  it('dry-run lists intended creations, exit 0, no token needed', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const dir = await mkdtemp(join(tmpdir(), 'orch-'));
    const file = join(dir, 'sample.bprelease');
    await writeFile(file, xml, 'utf8');

    const out: string[] = [];
    const code = await run(['orchestrate', file, '--dry-run'], {
      out: (l) => out.push(l),
      err: () => {},
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('Dry run');
    expect(out.join('\n')).toContain('Invoices Queue');
  });

  it('live run without credentials → usage error (exit 3)', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const dir = await mkdtemp(join(tmpdir(), 'orch-'));
    const file = join(dir, 'sample.bprelease');
    await writeFile(file, xml, 'utf8');

    const err: string[] = [];
    const code = await run(['orchestrate', file], { out: () => {}, err: (l) => err.push(l) });
    expect(code).toBe(3);
    expect(err.join('\n')).toContain('--dry-run');
  });
});
