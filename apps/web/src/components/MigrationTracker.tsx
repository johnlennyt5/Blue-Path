import { useState } from 'react';
import { can } from '../lib/workspace';
import {
  filterProcesses,
  programRollup,
  PROCESS_STATUSES,
  type ProcessStatus,
} from '../lib/tracker';
import { activeRole, useWorkspaceStore } from '../store/workspace';
import { DependencyGraph } from './DependencyGraph';

/**
 * Migration tracker dashboard (S6-5): the synced estate at a glance —
 * statuses, grades, effort rollup, filters, and the audit trail. Status
 * changes are editor/admin only (RLS enforces; the DB trigger audits).
 */

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  B: 'bg-lime-500/15 text-lime-300 border-lime-500/40',
  C: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  D: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  F: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

const STATUS_COLORS: Record<ProcessStatus, string> = {
  analyzed: 'text-slate-300 border-slate-600',
  converted: 'text-sky-300 border-sky-500/40',
  validating: 'text-amber-300 border-amber-500/40',
  validated: 'text-lime-300 border-lime-500/40',
  deployed: 'text-emerald-300 border-emerald-500/40',
  blocked: 'text-rose-300 border-rose-500/40',
};

export function MigrationTracker() {
  const store = useWorkspaceStore();
  const role = activeRole(store);
  const [statusFilter, setStatusFilter] = useState<ProcessStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  if (store.activeWorkspaceId === null || store.programs.length === 0) return null;

  const rows = filterProcesses(store.trackerRows, statusFilter, search);
  const rollup = programRollup(store.trackerRows);
  const emailByUserId = new Map(store.members.map((m) => [m.userId, m.email]));

  return (
    <section
      aria-label="Migration tracker"
      className="mb-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Migration tracker
        </h3>
        <select
          aria-label="Tracked program"
          value={store.trackerProgramId ?? ''}
          onChange={(e) => void store.loadTracker(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        >
          {store.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Rollup */}
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
          {rollup.processCount} process{rollup.processCount === 1 ? '' : 'es'}
        </span>
        <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
          est. effort <strong>{rollup.totalEffortHours} h</strong>
        </span>
        <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
          avg score <strong>{rollup.averageScore}</strong>
        </span>
        <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
          worst grade <strong>{rollup.worstGrade}</strong>
        </span>
        {PROCESS_STATUSES.filter((s) => (rollup.byStatus[s] ?? 0) > 0).map((s) => (
          <span
            key={s}
            className={`rounded-full border px-3 py-1.5 text-xs ${STATUS_COLORS[s]}`}
          >
            {s}: {rollup.byStatus[s]}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name…"
          className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
        />
        <select
          aria-label="Status filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProcessStatus | 'all')}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        >
          <option value="all">all statuses</option>
          {PROCESS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Process table */}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          {store.trackerRows.length === 0
            ? 'Nothing synced into this program yet.'
            : 'No processes match the filter.'}
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Process</th>
              <th className="py-2 pr-3">Grade</th>
              <th className="py-2 pr-3">Score</th>
              <th className="py-2 pr-3">Stages</th>
              <th className="py-2 pr-3">Findings</th>
              <th className="py-2 pr-3">Effort</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-800/60">
                <td className="py-2 pr-3 font-medium text-slate-200">{row.name}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${GRADE_COLORS[row.grade] ?? 'border-slate-600 text-slate-300'}`}
                  >
                    {row.grade}
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-300">{row.score}/100</td>
                <td className="py-2 pr-3 text-slate-400">{row.stageCount}</td>
                <td className="py-2 pr-3 text-slate-400">{row.findingCount}</td>
                <td className="py-2 pr-3 text-slate-400">{row.effortHours} h</td>
                <td className="py-2 pr-3">
                  {can.syncAnalyses(role) ? (
                    <select
                      aria-label={`Status for ${row.name}`}
                      value={row.status}
                      onChange={(e) =>
                        void store.setProcessStatus(row.id, e.target.value as ProcessStatus)
                      }
                      className={`rounded-full border bg-slate-950 px-2 py-0.5 text-xs ${STATUS_COLORS[row.status]}`}
                    >
                      {PROCESS_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[row.status]}`}
                    >
                      {row.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DependencyGraph rows={store.trackerEdges} />

      {/* Audit trail */}
      {store.auditTrail.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recent activity
          </h4>
          <ul className="space-y-1 text-xs text-slate-400">
            {store.auditTrail.map((entry, i) => {
              const detail = entry.detail ?? {};
              const suffix =
                entry.event === 'status.changed'
                  ? ` — ${String(detail['name'] ?? '')}: ${String(detail['from'] ?? '?')} → ${String(detail['to'] ?? '?')}`
                  : '';
              return (
                <li key={i} className="font-mono">
                  {new Date(entry.at).toLocaleString()} ·{' '}
                  <span className="text-slate-300">{entry.event}</span>
                  {suffix} ·{' '}
                  {entry.actor !== null
                    ? (emailByUserId.get(entry.actor) ?? entry.actor.slice(0, 8))
                    : 'system'}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
