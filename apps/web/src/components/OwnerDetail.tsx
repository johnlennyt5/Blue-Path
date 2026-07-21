import type { AutomationModel } from '@prismshift/ir';
import { scoreObject, scoreProcess } from '@prismshift/rules';
import type { Finding } from '@prismshift/ir';
import { GRADE_COLORS } from '../lib/findingView';
import { useSession } from '../store/session';
import type { DetailTab } from '../store/session';
import { FindingsPanel } from './FindingsPanel';
import { FlowView } from './FlowView';
import { ImprovementsPanel } from './ImprovementsPanel';
import { NodeBranch } from './ProcessTree';
import { SummaryPanel } from './SummaryPanel';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'vulnerabilities', label: 'Vulnerabilities' },
  { id: 'improvements', label: 'Improvements' },
  { id: 'flow', label: 'Flow' },
  { id: 'structure', label: 'Structure' },
];

export function OwnerDetail({
  model,
  findings,
}: {
  model: AutomationModel;
  findings: Finding[];
}) {
  const selection = useSession((s) => s.selection);
  const setTab = useSession((s) => s.setTab);
  const selectOwner = useSession((s) => s.selectOwner);

  if (!selection) return null;
  const process = model.processes.find((p) => p.id === selection.ownerId);
  const object = model.objects.find((o) => o.id === selection.ownerId);
  const owner = process ?? object;
  if (!owner) return null;

  const score = process
    ? scoreProcess(process.id, findings)
    : scoreObject(owner.id, findings);
  const ownerFindings = findings.filter(
    (f) => f.location.processId === owner.id || f.location.objectId === owner.id,
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => selectOwner(null)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
        >
          ← All items
        </button>
        <h2 className="text-lg font-semibold text-slate-100">{owner.name}</h2>
        <span
          className={`rounded-lg border px-2.5 py-1 text-sm font-bold ${GRADE_COLORS[score.grade] ?? ''}`}
        >
          {score.grade} · {score.score}
        </span>
        <span className="text-xs text-slate-500">
          {ownerFindings.length} finding{ownerFindings.length === 1 ? '' : 's'}
        </span>
      </div>

      <div role="tablist" aria-label="Analysis views" className="mb-4 flex gap-1 border-b border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selection.tab === tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              selection.tab === tab.id
                ? 'border border-b-0 border-slate-800 bg-slate-900 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {selection.tab === 'summary' && (
        <SummaryPanel model={model} owner={owner} isProcess={process !== undefined} />
      )}
      {selection.tab === 'vulnerabilities' && (
        <FindingsPanel model={model} ownerId={owner.id} findings={ownerFindings} />
      )}
      {selection.tab === 'improvements' && (
        <ImprovementsPanel model={model} ownerId={owner.id} findings={findings} />
      )}
      {selection.tab === 'flow' && <FlowView owner={owner} />}
      {selection.tab === 'structure' && (
        <NodeBranch node={owner} label={process ? 'Process' : 'Object'} />
      )}
    </div>
  );
}
