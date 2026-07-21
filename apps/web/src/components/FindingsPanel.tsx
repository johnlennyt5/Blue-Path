import { useMemo, useState } from 'react';
import type { AutomationModel, Finding, FindingSeverity } from '@prismshift/ir';
import { SEVERITY_BADGE, SEVERITY_ORDER, resolveFinding } from '../lib/findingView';
import { useSession } from '../store/session';

/** Findings for one process/object, with severity filters and flow deep-links. */
export function FindingsPanel({
  model,
  ownerId,
  findings,
}: {
  model: AutomationModel;
  ownerId: string;
  findings: Finding[];
}) {
  const showInFlow = useSession((s) => s.showInFlow);
  const [enabled, setEnabled] = useState<Set<FindingSeverity>>(new Set(SEVERITY_ORDER));

  const counts = useMemo(() => {
    const bySeverity = new Map<FindingSeverity, number>();
    for (const f of findings) bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
    return bySeverity;
  }, [findings]);

  const visible = findings.filter((f) => enabled.has(f.severity));

  const toggle = (severity: FindingSeverity) => {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  if (findings.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-6 text-center text-sm text-emerald-300">
        No findings — this one is clean. 🎉
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Severity filters">
        {SEVERITY_ORDER.map((severity) => (
          <button
            key={severity}
            type="button"
            aria-pressed={enabled.has(severity)}
            onClick={() => toggle(severity)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-opacity ${SEVERITY_BADGE[severity]} ${
              enabled.has(severity) ? '' : 'opacity-30'
            }`}
          >
            {severity} ({counts.get(severity) ?? 0})
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {visible.map((finding, i) => {
          const loc = resolveFinding(model, finding);
          const crumb = [loc.pageName, loc.stageName && `"${loc.stageName}"`, loc.elementName && `element "${loc.elementName}"`]
            .filter(Boolean)
            .join(' › ');
          return (
            <li
              key={`${finding.ruleId}-${i}`}
              className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${SEVERITY_BADGE[finding.severity]}`}
                >
                  {finding.severity}
                </span>
                <span className="font-mono text-xs text-slate-400">{finding.ruleId}</span>
                {crumb && <span className="text-xs text-slate-500">{crumb}</span>}
                {loc.pageId && loc.stageId && (
                  <button
                    type="button"
                    onClick={() => showInFlow(ownerId, loc.pageId!, loc.stageId)}
                    className="ml-auto rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-500/20"
                  >
                    Show in flow →
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-200">{finding.message}</p>
              <p className="mt-1 text-xs text-slate-400">↳ {finding.remediation}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
