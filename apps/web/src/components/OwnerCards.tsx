import type { AutomationModel, Finding } from '@prismshift/ir';
import { scoreObject, scoreProcess } from '@prismshift/rules';
import { GRADE_COLORS } from '../lib/findingView';
import { useSession } from '../store/session';

/** Landing list: one graded card per process/object. */
export function OwnerCards({
  model,
  findings,
}: {
  model: AutomationModel;
  findings: Finding[];
}) {
  const selectOwner = useSession((s) => s.selectOwner);

  const entries = [
    ...model.processes.map((p) => ({
      owner: p,
      label: 'Process' as const,
      score: scoreProcess(p.id, findings),
    })),
    ...model.objects.map((o) => ({
      owner: o,
      label: 'Object' as const,
      score: scoreObject(o.id, findings),
    })),
  ];

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {entries.map(({ owner, label, score }) => {
        const stageCount = owner.pages.reduce((n, p) => n + p.stages.length, 0);
        return (
          <button
            key={owner.id}
            type="button"
            onClick={() => selectOwner(owner.id)}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition-colors hover:border-slate-600"
          >
            <div className="flex items-center gap-3">
              <span
                className={`rounded-lg border px-2.5 py-1 text-lg font-bold ${GRADE_COLORS[score.grade] ?? ''}`}
              >
                {score.grade}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-100">{owner.name}</p>
                <p className="text-xs text-slate-500">
                  {label} · {owner.pages.length} {owner.pages.length === 1 ? 'page' : 'pages'} ·{' '}
                  {stageCount} stages
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm text-slate-300">{score.score}/100</p>
                <p className="text-xs text-slate-500">
                  {score.findingCount} finding{score.findingCount === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
