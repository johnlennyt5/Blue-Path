import { useState } from 'react';
import type { AutomationModel } from '@prismshift/ir';
import { scoreObject, scoreProcess } from '@prismshift/rules';
import type { Finding } from '@prismshift/ir';
import { buildProcessExport, downloadBlob, projectZipBlob } from '../lib/exportProject';
import { GRADE_COLORS } from '../lib/findingView';
import { sanitizeFileName } from '@prismshift/transformer';
import { useSession } from '../store/session';
import type { DetailTab } from '../store/session';
import { ConversionPanel } from './ConversionPanel';
import { FindingsPanel } from './FindingsPanel';
import { FlowView } from './FlowView';
import { ImprovementsPanel } from './ImprovementsPanel';
import { NodeBranch } from './ProcessTree';
import { SummaryPanel } from './SummaryPanel';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'vulnerabilities', label: 'Vulnerabilities' },
  { id: 'improvements', label: 'Improvements' },
  { id: 'conversion', label: 'Conversion' },
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
  const [exportNote, setExportNote] = useState<string | null>(null);

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
        {process && (
          <button
            type="button"
            onClick={() => {
              const { project, conversion } = buildProcessExport(model, process);
              void projectZipBlob(project).then((blob) => {
                downloadBlob(blob, `${sanitizeFileName(process.name)}-UiPath.zip`);
                setExportNote(
                  `${conversion.coveragePct}% converted (${project.layout} layout)` +
                    (conversion.punchList.length > 0
                      ? ` · ${conversion.punchList.length} item(s) need manual work`
                      : '') +
                    ' · open project.json in UiPath Studio DESKTOP 2023.10+ (Studio Web/Maestro cannot load XAML projects)',
                );
              });
            }}
            className="ml-auto rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-500/20"
          >
            ⬇ Download UiPath project
          </button>
        )}
        {!process && (
          <span className="ml-auto text-xs text-slate-500">
            Ships inside each process ZIP that calls it (Objects\…)
          </span>
        )}
        {exportNote && <span className="text-xs text-slate-400">{exportNote}</span>}
      </div>

      <div
        role="tablist"
        aria-label="Analysis views"
        className="mb-4 flex gap-1 border-b border-slate-800"
        onKeyDown={(e) => {
          const ids = TABS.map((t) => t.id);
          const current = ids.indexOf(selection.tab);
          let next = -1;
          if (e.key === 'ArrowRight') next = (current + 1) % ids.length;
          else if (e.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = ids.length - 1;
          if (next !== -1) {
            e.preventDefault();
            setTab(ids[next]!);
            document.getElementById(`analysis-tab-${ids[next]!}`)?.focus();
          }
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`analysis-tab-${tab.id}`}
            role="tab"
            aria-selected={selection.tab === tab.id}
            tabIndex={selection.tab === tab.id ? 0 : -1}
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

      <div role="tabpanel" aria-labelledby={`analysis-tab-${selection.tab}`}>
      {selection.tab === 'summary' && (
        <SummaryPanel model={model} owner={owner} isProcess={process !== undefined} />
      )}
      {selection.tab === 'vulnerabilities' && (
        <FindingsPanel model={model} ownerId={owner.id} findings={ownerFindings} />
      )}
      {selection.tab === 'improvements' && (
        <ImprovementsPanel model={model} ownerId={owner.id} findings={findings} />
      )}
      {selection.tab === 'conversion' && (
        <ConversionPanel model={model} owner={owner} isProcess={process !== undefined} />
      )}
      {selection.tab === 'flow' && <FlowView owner={owner} />}
      </div>
      {selection.tab === 'structure' && (
        <NodeBranch node={owner} label={process ? 'Process' : 'Object'} />
      )}
    </div>
  );
}
