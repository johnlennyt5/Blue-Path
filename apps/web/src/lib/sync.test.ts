/**
 * S6-4 · Metadata sync: the payload is provably metadata-only (built from the
 * real corpus, scanned for content markers), hashes are deterministic (the
 * dedup key), and the push orchestration upserts/replaces/audits correctly.
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import type { Supabase } from './supabaseClient';
import {
  assertMetadataOnly,
  buildSyncPayload,
  locationPath,
  sha256Hex,
  syncToProgram,
  type SyncPayload,
} from './sync';

beforeAll(() => {
  // node test env: expose WebCrypto like the browser does
  (globalThis as { crypto?: unknown }).crypto ??= webcrypto;
});

async function corpusPayload(): Promise<{ payload: SyncPayload; xml: string }> {
  const { xml } = await loadSample('02-realistic-mid-size');
  const { model } = await parseBpRelease(xml);
  const { findings } = runRules(model, ALL_RULES);
  return { payload: await buildSyncPayload(model, xml, findings), xml };
}

describe('buildSyncPayload (corpus #2)', () => {
  it('produces one row per process with scores, counts, and effort', async () => {
    const { payload } = await corpusPayload();
    expect(payload.processes.map((p) => p.row.bp_name).sort()).toEqual([
      'Invoice Dispatcher',
      'Invoice Performer',
    ]);
    for (const { row } of payload.processes) {
      expect(row.stage_count).toBeGreaterThan(0);
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
      expect(row.grade).toMatch(/^[A-F]$/);
      expect(row.effort_hours_est).toBeGreaterThan(0);
      expect(row.source_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('findings carry readable location paths, never raw XML', async () => {
    const { payload } = await corpusPayload();
    const all = payload.processes.flatMap((p) => p.findings);
    expect(all.length).toBeGreaterThan(0);
    for (const finding of all) {
      expect(finding.location_path).toMatch(/^process\//);
      expect(finding.location_path).not.toContain('<');
    }
  });

  it('edges mirror the model dependency graph', async () => {
    const { payload } = await corpusPayload();
    expect(payload.edges.length).toBeGreaterThan(0);
    expect(payload.edges).toContainEqual({
      from_name: 'Invoice Dispatcher',
      from_type: 'process',
      to_name: 'Invoice Entry VBO',
      to_type: 'object',
    });
  });

  it('THE invariant: the serialized payload contains no XML/XAML markers', async () => {
    const { payload } = await corpusPayload();
    const serialized = JSON.stringify(payload).toLowerCase();
    for (const marker of ['<?xml', '<process', '<stage', 'xmlns', '<activity', '</']) {
      expect(serialized, `payload must not contain "${marker}"`).not.toContain(marker);
    }
  });

  it('hash is deterministic per process and differs across processes', async () => {
    const { payload } = await corpusPayload();
    const { payload: again } = await corpusPayload();
    expect(payload.processes.map((p) => p.row.source_hash)).toEqual(
      again.processes.map((p) => p.row.source_hash),
    );
    const [a, b] = payload.processes;
    expect(a!.row.source_hash).not.toBe(b!.row.source_hash);
  });

  it('sha256Hex matches the known test vector', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('assertMetadataOnly', () => {
  it('rejects smuggled XML anywhere in the payload', () => {
    const dirty = {
      processes: [
        {
          row: {
            bp_name: '<process name="sneaky">',
            source_hash: 'x',
            bp_version: null,
            stage_count: 1,
            score: 1,
            grade: 'A',
            effort_hours_est: 1,
          },
          findings: [],
        },
      ],
      edges: [],
    } as SyncPayload;
    expect(() => assertMetadataOnly(dirty)).toThrow(/metadata-only violation/);
  });
});

describe('locationPath', () => {
  it('resolves ids to names', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const { findings } = runRules(model, ALL_RULES);
    const withStage = findings.find((f) => f.location.stageId !== undefined)!;
    const path = locationPath(model, withStage);
    expect(path.split('/').length).toBeGreaterThanOrEqual(3);
    expect(path).not.toContain('undefined');
  });
});

describe('syncToProgram push orchestration', () => {
  function fakeDb() {
    const calls: { upsert: unknown[]; insert: unknown[]; delete: unknown[] } = {
      upsert: [],
      insert: [],
      delete: [],
    };
    const sb = {
      from: vi.fn((table: string) => ({
        upsert: vi.fn((rows: unknown, opts: unknown) => {
          calls.upsert.push({ table, rows, opts });
          return {
            select: vi.fn(() => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: `${table}-id` }, error: null }),
            })),
            // edges upsert is awaited directly
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
        }),
        insert: vi.fn((rows: unknown) => {
          calls.insert.push({ table, rows });
          return Promise.resolve({ error: null });
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(() => {
            calls.delete.push({ table });
            return Promise.resolve({ error: null });
          }),
        })),
      })),
    } as unknown as Supabase;
    return { sb, calls };
  }

  it('upserts on the dedup key, replaces findings, audits, and is idempotent for edges', async () => {
    const { payload } = await corpusPayload();
    const { sb, calls } = fakeDb();

    const result = await syncToProgram(sb, 'prog1', 'ws1', 'me', payload);

    expect(result.processCount).toBe(2);
    const processUpserts = (calls.upsert as { table: string; opts?: { onConflict?: string } }[])
      .filter((c) => c.table === 'processes');
    expect(processUpserts).toHaveLength(2);
    for (const call of processUpserts) {
      expect(call.opts?.onConflict).toBe('program_id,source_hash');
    }
    // findings replaced wholesale per process
    expect((calls.delete as { table: string }[]).filter((c) => c.table === 'findings')).toHaveLength(2);
    // one audit event per process
    const audits = (calls.insert as { table: string }[]).filter((c) => c.table === 'audit_events');
    expect(audits).toHaveLength(2);
    // edges idempotent via ignoreDuplicates on the full PK
    const edgeUpsert = (calls.upsert as { table: string; opts?: { ignoreDuplicates?: boolean; onConflict?: string } }[])
      .find((c) => c.table === 'dependency_edges');
    expect(edgeUpsert?.opts?.ignoreDuplicates).toBe(true);
  });
});
