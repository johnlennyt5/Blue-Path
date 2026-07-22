/**
 * S6-5 · Tracker logic: rollup math, filters, and the status-update contract
 * (the DB trigger does the auditing — the client must surface read-only
 * failures instead of pretending they worked).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Supabase } from './supabaseClient';
import {
  filterProcesses,
  programRollup,
  updateProcessStatus,
  type TrackedProcess,
} from './tracker';

const row = (over: Partial<TrackedProcess>): TrackedProcess => ({
  id: 'p1',
  name: 'Proc',
  stageCount: 10,
  score: 80,
  grade: 'B',
  status: 'analyzed',
  effortHours: 2,
  findingCount: 1,
  updatedAt: '2026-07-22T00:00:00Z',
  ...over,
});

describe('programRollup', () => {
  it('aggregates counts, effort, average score, worst grade, status buckets', () => {
    const rollup = programRollup([
      row({ id: 'a', grade: 'A', score: 95, effortHours: 1.5, status: 'deployed' }),
      row({ id: 'b', grade: 'D', score: 61, effortHours: 3.5, status: 'analyzed' }),
      row({ id: 'c', grade: 'B', score: 84, effortHours: 2.0, status: 'analyzed' }),
    ]);
    expect(rollup.processCount).toBe(3);
    expect(rollup.totalEffortHours).toBe(7);
    expect(rollup.averageScore).toBe(80);
    expect(rollup.worstGrade).toBe('D');
    expect(rollup.byStatus).toEqual({ deployed: 1, analyzed: 2 });
  });

  it('empty program: zeros and a dash grade', () => {
    const rollup = programRollup([]);
    expect(rollup.processCount).toBe(0);
    expect(rollup.averageScore).toBe(0);
    expect(rollup.worstGrade).toBe('—');
  });
});

describe('filterProcesses', () => {
  const rows = [
    row({ id: 'a', name: 'Invoice Dispatcher', status: 'analyzed' }),
    row({ id: 'b', name: 'Invoice Performer', status: 'blocked' }),
    row({ id: 'c', name: 'Payroll Runner', status: 'analyzed' }),
  ];

  it('filters by status and by case-insensitive name, combined', () => {
    expect(filterProcesses(rows, 'analyzed', '')).toHaveLength(2);
    expect(filterProcesses(rows, 'all', 'invoice')).toHaveLength(2);
    expect(filterProcesses(rows, 'analyzed', 'INVOICE').map((r) => r.id)).toEqual(['a']);
    expect(filterProcesses(rows, 'all', '')).toHaveLength(3);
  });
});

describe('updateProcessStatus', () => {
  function fakeSb(updated: { id: string }[]) {
    const select = vi.fn().mockResolvedValue({ data: updated, error: null });
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    return { sb: { from: vi.fn(() => ({ update })) } as unknown as Supabase, update, eq };
  }

  it('updates only the status column (trigger handles audit + updated_at)', async () => {
    const { sb, update, eq } = fakeSb([{ id: 'p1' }]);
    await updateProcessStatus(sb, 'p1', 'validated');
    expect(update).toHaveBeenCalledWith({ status: 'validated' });
    expect(eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('zero rows updated (viewer, RLS-filtered) → explicit read-only error', async () => {
    const { sb } = fakeSb([]);
    await expect(updateProcessStatus(sb, 'p1', 'blocked')).rejects.toThrow(/read-only/);
  });
});
