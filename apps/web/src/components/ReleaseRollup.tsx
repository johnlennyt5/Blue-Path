import { useMemo } from 'react';
import type { AutomationModel, Finding } from '@prismshift/ir';
import { buildAuditReportData } from '../lib/auditReport';

const SEVERITY_CHIP: Record<string, string> = {
  critical: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  high: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  low: 'border-slate-600 bg-slate-800/60 text-slate-300',
};

/**
 * BL-020: estate-level aggregates above the owner cards — the same rollup
 * the audit PDF prints, so the numbers can never disagree.
 */
export function ReleaseRollup({
  model,
  findings,
}: {
  model: AutomationModel;
  findings: Finding[];
}) {
  const rollup = useMemo(
    () => buildAuditReportData(model, findings, '').rollup,
    [model, findings],
  );
  if (rollup.sections.length === 0) return null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 text-sm" aria-label="Estate rollup">
      <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
        {rollup.sections.length} component{rollup.sections.length === 1 ? '' : 's'}
      </span>
      <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
        avg score <strong>{rollup.averageScore}</strong>
      </span>
      <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
        worst grade <strong>{rollup.worstGrade}</strong>
      </span>
      <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
        est. migration effort <strong>{rollup.totalEffortHours} h</strong>
      </span>
      {Object.entries(rollup.findingsBySeverity)
        .sort(
          (a, b) =>
            ['critical', 'high', 'medium', 'low'].indexOf(a[0]) -
            ['critical', 'high', 'medium', 'low'].indexOf(b[0]),
        )
        .map(([severity, count]) => (
          <span
            key={severity}
            className={`rounded-full border px-3 py-1.5 text-xs ${SEVERITY_CHIP[severity] ?? SEVERITY_CHIP['low']}`}
          >
            {count} {severity}
          </span>
        ))}
    </div>
  );
}
