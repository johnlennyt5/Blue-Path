/**
 * Migration tracker (S6-5): read the synced metadata back and manage process
 * statuses. Status transitions are audited by a DB trigger — the client just
 * updates the row.
 */
import type { Supabase } from './supabaseClient';

export const PROCESS_STATUSES = [
  'analyzed',
  'converted',
  'validating',
  'validated',
  'deployed',
  'blocked',
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export interface TrackedProcess {
  id: string;
  name: string;
  stageCount: number;
  score: number;
  grade: string;
  status: ProcessStatus;
  effortHours: number;
  findingCount: number;
  updatedAt: string;
}

export interface AuditEntry {
  event: string;
  actor: string | null;
  at: string;
  detail: Record<string, unknown> | null;
}

export async function listTrackedProcesses(
  sb: Supabase,
  programId: string,
): Promise<TrackedProcess[]> {
  const { data, error } = await sb
    .from('processes')
    .select('id, bp_name, stage_count, score, grade, status, effort_hours_est, updated_at, findings(count)')
    .eq('program_id', programId)
    .order('bp_name');
  if (error !== null) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.bp_name,
    stageCount: row.stage_count ?? 0,
    score: row.score ?? 0,
    grade: row.grade ?? '?',
    status: row.status as ProcessStatus,
    effortHours: Number(row.effort_hours_est ?? 0),
    findingCount: (row.findings as unknown as { count: number }[])[0]?.count ?? 0,
    updatedAt: row.updated_at,
  }));
}

/** DB trigger writes the 'status.changed' audit event; we just update. */
export async function updateProcessStatus(
  sb: Supabase,
  processId: string,
  status: ProcessStatus,
): Promise<void> {
  const { data, error } = await sb
    .from('processes')
    .update({ status })
    .eq('id', processId)
    .select('id');
  if (error !== null) throw new Error(error.message);
  if (data === null || data.length === 0) {
    throw new Error('status not updated — viewers are read-only');
  }
}

export async function listProgramEdges(
  sb: Supabase,
  programId: string,
): Promise<{ from_name: string; from_type: string; to_name: string; to_type: string }[]> {
  const { data, error } = await sb
    .from('dependency_edges')
    .select('from_name, from_type, to_name, to_type')
    .eq('program_id', programId);
  if (error !== null) throw new Error(error.message);
  return data ?? [];
}

export async function listAuditTrail(
  sb: Supabase,
  workspaceId: string,
  limit = 12,
): Promise<AuditEntry[]> {
  const { data, error } = await sb
    .from('audit_events')
    .select('event, actor, at, detail')
    .eq('workspace_id', workspaceId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error !== null) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    event: row.event,
    actor: row.actor,
    at: row.at,
    detail: row.detail as Record<string, unknown> | null,
  }));
}

// ---------------------------------------------------------------------------
// Pure rollup + filtering (unit-tested)
// ---------------------------------------------------------------------------

export interface ProgramRollup {
  processCount: number;
  totalEffortHours: number;
  averageScore: number;
  worstGrade: string;
  byStatus: Partial<Record<ProcessStatus, number>>;
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'];

export function programRollup(rows: TrackedProcess[]): ProgramRollup {
  const byStatus: Partial<Record<ProcessStatus, number>> = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  const worst = rows.reduce(
    (acc, row) => Math.max(acc, GRADE_ORDER.indexOf(row.grade)),
    -1,
  );
  return {
    processCount: rows.length,
    totalEffortHours: Math.round(rows.reduce((n, r) => n + r.effortHours, 0) * 10) / 10,
    averageScore:
      rows.length === 0
        ? 0
        : Math.round(rows.reduce((n, r) => n + r.score, 0) / rows.length),
    worstGrade: worst === -1 ? '—' : GRADE_ORDER[worst]!,
    byStatus,
  };
}

export function filterProcesses(
  rows: TrackedProcess[],
  statusFilter: ProcessStatus | 'all',
  search: string,
): TrackedProcess[] {
  const needle = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (statusFilter === 'all' || row.status === statusFilter) &&
      (needle === '' || row.name.toLowerCase().includes(needle)),
  );
}
