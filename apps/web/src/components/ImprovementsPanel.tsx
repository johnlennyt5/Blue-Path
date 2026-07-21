import type { AutomationModel, Finding } from '@prismshift/ir';
import { buildRecommendations, recommendationCoverage } from '@prismshift/reports';
import { SEVERITY_BADGE } from '../lib/findingView';

/**
 * UiPath-practice recommendations covering every finding (S3-5). Severity
 * colors intentionally match the Vulnerabilities tab so a recommendation
 * visually pairs with the findings it addresses.
 */
export function ImprovementsPanel({
  model,
  ownerId,
  findings,
}: {
  model: AutomationModel;
  ownerId: string;
  findings: Finding[];
}) {
  const recommendations = buildRecommendations(model, findings, ownerId);
  const coverage = recommendationCoverage(findings, ownerId);

  if (recommendations.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-6 text-center text-sm text-emerald-300">
        No findings to address — nothing here blocks a clean migration.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-400">
        {recommendations.length} recommendation{recommendations.length === 1 ? '' : 's'} addressing{' '}
        <span className="text-slate-200">
          {coverage.covered === coverage.total
            ? `all ${coverage.total}`
            : `${coverage.covered} of ${coverage.total}`}
        </span>{' '}
        finding{coverage.total === 1 ? '' : 's'} — badge colors match the Vulnerabilities tab.
      </p>
      <ul className="space-y-3">
        {recommendations.map((rec) => (
          <li
            key={rec.id}
            className={`rounded-lg border bg-slate-900/40 p-4 ${
              SEVERITY_BADGE[rec.severity].split(' ').find((c) => c.startsWith('border-')) ??
              'border-slate-800'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${SEVERITY_BADGE[rec.severity]}`}
              >
                {rec.severity}
              </span>
              <h3 className="font-medium text-slate-100">{rec.title}</h3>
              {rec.ruleIds.map((ruleId) => (
                <span
                  key={ruleId}
                  title={`Addresses ${ruleId} findings`}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${SEVERITY_BADGE[rec.ruleSeverities[ruleId] ?? rec.severity]}`}
                >
                  {ruleId}
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-300">{rec.practice}</p>
            <p className="mt-1.5 text-xs text-slate-500">{rec.rationale}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
