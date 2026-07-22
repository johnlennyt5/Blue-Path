/**
 * Metadata sync (S6-4): push analysis results to the active workspace.
 *
 * THE invariant (ARCHITECTURE §1.1/§8.1): only derived metadata leaves the
 * browser — names, hashes, counts, scores, finding summaries, dependency
 * edges. Never Blue Prism XML, never generated XAML, never expressions.
 * `assertMetadataOnly` enforces this at runtime on every payload, and the
 * tests prove it against the real corpus.
 */
import type { AutomationModel, Finding, ProcessNode } from '@prismshift/ir';
import { scoreProcess } from '@prismshift/rules';
import { estimateEffortHours } from '@prismshift/reports';
import type { Supabase } from './supabaseClient';
import { buildProcessExport } from './exportProject';
import { plog } from './debug';

export interface ProcessSyncRow {
  bp_name: string;
  source_hash: string;
  bp_version: string | null;
  stage_count: number;
  score: number;
  grade: string;
  effort_hours_est: number;
}

export interface FindingSyncRow {
  rule_id: string;
  severity: string;
  category: string;
  location_path: string;
  message: string;
}

export interface EdgeSyncRow {
  from_name: string;
  from_type: string;
  to_name: string;
  to_type: string;
}

export interface SyncPayload {
  processes: {
    row: ProcessSyncRow;
    findings: FindingSyncRow[];
  }[];
  edges: EdgeSyncRow[];
}

export interface SyncResult {
  processCount: number;
  findingCount: number;
  edgeCount: number;
}

// ---------------------------------------------------------------------------
// Payload building
// ---------------------------------------------------------------------------

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Human-readable finding location from IR ids (metadata: names only). */
export function locationPath(model: AutomationModel, finding: Finding): string {
  const parts: string[] = [];
  const { processId, objectId, pageId, stageId } = finding.location;
  const owner =
    model.processes.find((p) => p.id === processId) ??
    model.objects.find((o) => o.id === objectId);
  if (owner !== undefined) {
    parts.push(`${processId !== undefined ? 'process' : 'object'}/${owner.name}`);
    const page = owner.pages.find((p) => p.id === pageId);
    if (page !== undefined) {
      parts.push(page.name);
      const stage = page.stages.find((s) => s.id === stageId);
      if (stage !== undefined) parts.push(stage.name);
    }
  }
  return parts.join('/') || 'release';
}

function findingsFor(model: AutomationModel, ownerId: string, findings: Finding[]): Finding[] {
  return findings.filter(
    (f) => f.location.processId === ownerId || f.location.objectId === ownerId,
  );
}

/**
 * Build the full metadata payload for one release. `releaseXml` is used ONLY
 * to derive per-process SHA-256 hashes — it never enters the payload.
 */
export async function buildSyncPayload(
  model: AutomationModel,
  releaseXml: string,
  findings: Finding[],
): Promise<SyncPayload> {
  const processes = await Promise.all(
    model.processes.map(async (process: ProcessNode) => {
      const quality = scoreProcess(process.id, findings);
      const { conversion, objectConversions } = buildProcessExport(model, process);
      const row: ProcessSyncRow = {
        bp_name: process.name,
        // Hash of release content + process name: same release re-synced →
        // same hash → unique(program_id, source_hash) dedups the row.
        source_hash: await sha256Hex(`${process.name}\n${releaseXml}`),
        bp_version: model.meta.bpVersion ?? null,
        stage_count: process.pages.reduce((n, page) => n + page.stages.length, 0),
        score: quality.score,
        grade: quality.grade,
        effort_hours_est: estimateEffortHours(conversion, objectConversions),
      };
      const processFindings = findingsFor(model, process.id, findings).map((f) => ({
        rule_id: f.ruleId,
        severity: f.severity,
        category: f.category,
        location_path: locationPath(model, f),
        message: f.message,
      }));
      return { row, findings: processFindings };
    }),
  );

  const edges: EdgeSyncRow[] = model.dependencies.map((d) => ({
    from_name: d.fromName,
    from_type: d.fromType,
    to_name: d.toName,
    to_type: d.toType,
  }));

  const payload: SyncPayload = { processes, edges };
  assertMetadataOnly(payload);
  return payload;
}

// ---------------------------------------------------------------------------
// Privacy guard — defense in depth before anything is sent
// ---------------------------------------------------------------------------

const CONTENT_MARKERS = ['<?xml', '<process', '<stage', '<object', 'xmlns', '<Activity', '</'];

/** Throws if any string in the payload smells like source content. */
export function assertMetadataOnly(payload: SyncPayload): void {
  const scan = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      for (const marker of CONTENT_MARKERS) {
        if (value.toLowerCase().includes(marker.toLowerCase())) {
          throw new Error(
            `metadata-only violation at ${path}: value contains "${marker}" — refusing to sync`,
          );
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => scan(item, `${path}[${i}]`));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`);
    }
  };
  scan(payload, 'payload');
}

// ---------------------------------------------------------------------------
// Programs + push
// ---------------------------------------------------------------------------

export interface ProgramSummary {
  id: string;
  name: string;
}

export async function listPrograms(sb: Supabase, workspaceId: string): Promise<ProgramSummary[]> {
  const { data, error } = await sb
    .from('programs')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .order('created_at');
  if (error !== null) throw new Error(error.message);
  return data ?? [];
}

export async function createProgram(
  sb: Supabase,
  workspaceId: string,
  name: string,
  userId: string,
): Promise<string> {
  const { data, error } = await sb
    .from('programs')
    .insert({ workspace_id: workspaceId, name, created_by: userId })
    .select('id')
    .single();
  if (error !== null) throw new Error(error.message);
  return data.id;
}

/**
 * Push a payload into a program. Re-syncing the same release upserts on
 * (program_id, source_hash): process rows update in place, their findings are
 * replaced wholesale, edges are idempotent.
 */
export async function syncToProgram(
  sb: Supabase,
  programId: string,
  workspaceId: string,
  userId: string,
  payload: SyncPayload,
): Promise<SyncResult> {
  assertMetadataOnly(payload);
  let findingCount = 0;

  for (const entry of payload.processes) {
    const { data, error } = await sb
      .from('processes')
      .upsert(
        { program_id: programId, ...entry.row, updated_at: new Date().toISOString() },
        { onConflict: 'program_id,source_hash' },
      )
      .select('id')
      .single();
    if (error !== null) throw new Error(`sync ${entry.row.bp_name}: ${error.message}`);
    const processId = data.id;

    const del = await sb.from('findings').delete().eq('process_id', processId);
    if (del.error !== null) throw new Error(del.error.message);
    if (entry.findings.length > 0) {
      const ins = await sb
        .from('findings')
        .insert(entry.findings.map((f) => ({ ...f, process_id: processId })));
      if (ins.error !== null) throw new Error(ins.error.message);
      findingCount += entry.findings.length;
    }

    const audit = await sb.from('audit_events').insert({
      workspace_id: workspaceId,
      actor: userId,
      event: 'process.analyzed',
      subject_type: 'process',
      subject_id: processId,
      detail: { grade: entry.row.grade, score: entry.row.score },
    });
    if (audit.error !== null) throw new Error(audit.error.message);
  }

  if (payload.edges.length > 0) {
    const { error } = await sb
      .from('dependency_edges')
      .upsert(
        payload.edges.map((e) => ({ ...e, program_id: programId })),
        { onConflict: 'program_id,from_name,from_type,to_name,to_type', ignoreDuplicates: true },
      );
    if (error !== null) throw new Error(error.message);
  }

  const result: SyncResult = {
    processCount: payload.processes.length,
    findingCount,
    edgeCount: payload.edges.length,
  };
  plog(
    `sync complete: ${result.processCount} processes, ${result.findingCount} findings, ${result.edgeCount} edges — metadata only`,
  );
  return result;
}
