import { useMemo } from 'react';
import type { AutomationModel, BusinessObjectNode, CodeStage, ProcessNode } from '@prismshift/ir';
import { buildConversionView } from '../lib/conversionView';
import type { StageMappingRow } from '../lib/conversionView';
import { useAiStore } from '../store/ai';

const STATUS_STYLES: Record<StageMappingRow['status'], string> = {
  converted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  review: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  manual: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

function confidenceStyle(confidence: number): string {
  if (confidence >= 0.8) return 'text-emerald-300';
  if (confidence >= 0.5) return 'text-amber-300';
  return 'text-rose-300';
}

/** BP stage ↔ UiPath activity side-by-side (S5-6). */
export function ConversionPanel({
  model,
  owner,
  isProcess,
}: {
  model: AutomationModel;
  owner: ProcessNode | BusinessObjectNode;
  isProcess: boolean;
}) {
  const view = useMemo(
    () => buildConversionView(model, owner, isProcess),
    [model, owner, isProcess],
  );

  const pages = [...new Set(view.rows.map((r) => r.pageName))];
  const ai = useAiStore();
  const codeStageById = useMemo(() => {
    const map = new Map<string, CodeStage>();
    for (const page of owner.pages) {
      for (const stage of page.stages) {
        if (stage.kind === 'code') map.set(stage.id, stage);
      }
    }
    return map;
  }, [owner]);

  return (
    <div>
      <p className="mb-4 text-sm text-slate-400">
        {view.coveragePct}% converted · {view.reviewCount} to review ·{' '}
        {view.manualCount} manual — every stage listed with its UiPath mapping.
      </p>

      <div className="space-y-3">
        {pages.map((pageName) => (
          <details key={pageName} open className="rounded-lg border border-slate-800 bg-slate-900/40">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-200">
              {pageName}
            </summary>
            <div className="overflow-x-auto px-4 pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-1.5 pr-3">Blue Prism stage</th>
                    <th scope="col" className="py-1.5 pr-3">UiPath</th>
                    <th scope="col" className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows
                    .filter((row) => row.pageName === pageName)
                    .map((row, i) => (
                      <tr key={i} className="border-t border-slate-800/60 align-top">
                        <td className="py-1.5 pr-3">
                          <span className="mr-2 rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                            {row.stageKind}
                          </span>
                          <span className="text-slate-200">{row.stageName}</span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-sky-200">
                          {row.uipath}
                          {row.notes.length > 0 && (
                            <ul className="mt-1 list-inside list-disc font-sans text-[11px] text-slate-500">
                              {row.notes.map((note, j) => (
                                <li key={j}>{note}</li>
                              ))}
                            </ul>
                          )}
                          {row.stageKind === 'code' && ai.enabled && (
                            <CodeSuggestionBlock
                              stageId={row.stageId}
                              stage={codeStageById.get(row.stageId)}
                            />
                          )}
                          {row.stageKind === 'code' && !ai.enabled && (
                            <p className="mt-1 font-sans text-[11px] text-slate-500">
                              Enable AI (Summary tab) to get a VB.NET translation suggestion.
                            </p>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLES[row.status]}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className={`py-1.5 font-mono text-xs ${confidenceStyle(row.confidence)}`}>
                          {row.confidence.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/** BL-005: original vs AI-suggested code, side by side, accept/decline. */
function CodeSuggestionBlock({
  stageId,
  stage,
}: {
  stageId: string;
  stage: CodeStage | undefined;
}) {
  const ai = useAiStore();
  if (stage === undefined) return null;
  const suggestion = ai.codeSuggestions[stageId];

  if (suggestion === undefined) {
    return (
      <button
        type="button"
        disabled={ai.busy}
        onClick={() => void ai.suggestCode(stageId, stage.name, stage.language, stage.body)}
        className="mt-1.5 rounded border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-sans text-[11px] text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
      >
        {ai.busy ? 'Asking…' : `✨ Suggest ${stage.language === 'jscript' ? 'VB.NET port' : 'idiomatic translation'}`}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-violet-500/30 bg-slate-950 p-2 font-sans">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
            Original ({suggestion.originalLanguage})
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px] text-slate-300">
            {suggestion.original}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-violet-300">
            AI suggestion (VB.NET) — never auto-applied
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px] text-violet-200">
            {suggestion.suggestion}
          </pre>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {suggestion.status === 'proposed' && (
          <>
            <button
              type="button"
              onClick={() => ai.acceptSuggestion(stageId)}
              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
            >
              Accept — use in export
            </button>
            <button
              type="button"
              onClick={() => ai.declineSuggestion(stageId)}
              className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500"
            >
              Decline — keep verbatim
            </button>
          </>
        )}
        {suggestion.status === 'accepted' && (
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
            ✓ Accepted — the export uses this translation (punch-listed for review)
          </span>
        )}
        {suggestion.status === 'declined' && (
          <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
            Declined — export keeps the original verbatim
          </span>
        )}
      </div>
    </div>
  );
}
