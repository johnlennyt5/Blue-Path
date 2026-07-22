import type { AutomationModel, BusinessObjectNode, ProcessNode } from '@prismshift/ir';
import { useAiStore } from '../store/ai';
import { useWorkspaceStore } from '../store/workspace';

/**
 * AI narrative section (S7-3), rendered at the bottom of the Summary tab.
 * Off by default; enabling reveals the disclosure (exactly what leaves the
 * browser) and requires one more explicit click to generate.
 */
export function AiNarrative({
  model,
  owner,
}: {
  model: AutomationModel;
  owner: ProcessNode | BusinessObjectNode;
}) {
  const ai = useAiStore();
  const workspaceReady = useWorkspaceStore(
    (s) => s.session !== null && s.activeWorkspaceId !== null,
  );
  const narrative = ai.narratives[owner.id];

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          AI narrative
        </h3>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={(e) => ai.setEnabled(e.target.checked)}
            className="accent-violet-500"
          />
          enable
        </label>
        <span className="text-xs text-slate-500">off by default — nothing is sent until you opt in</span>
      </div>

      {ai.enabled && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs text-slate-300">
            <p className="mb-1 font-semibold text-violet-300">What leaves your browser if you generate:</p>
            <p>
              A <strong>redacted digest only</strong> — stage/page/data-item <em>names, types,
              and structure</em>. Never your Blue Prism XML, never expression text, never
              data values, never selector attributes. The digest builder refuses to run if
              any source value survives redaction, and the Workspace route is rate-limited,
              size-capped, and audited (event only, no content).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5 text-slate-300">
              <input
                type="radio"
                name="ai-transport"
                checked={ai.transport === 'workspace'}
                onChange={() => ai.setTransport('workspace')}
                className="accent-violet-500"
              />
              Workspace proxy {workspaceReady ? '' : '(sign in first)'}
            </label>
            <label className="flex items-center gap-1.5 text-slate-300">
              <input
                type="radio"
                name="ai-transport"
                checked={ai.transport === 'custom'}
                onChange={() => ai.setTransport('custom')}
                className="accent-violet-500"
              />
              Custom endpoint
            </label>
            {ai.transport === 'custom' && (
              <input
                value={ai.customEndpoint}
                onChange={(e) => ai.setCustomEndpoint(e.target.value)}
                placeholder="https://your-llm-endpoint/narrative"
                className="w-72 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
            )}
            <button
              type="button"
              disabled={ai.busy}
              onClick={() => void ai.generate(model, owner.id, owner.name)}
              className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {ai.busy ? 'Generating…' : narrative !== undefined ? 'Regenerate' : 'Generate narrative'}
            </button>
          </div>

          {ai.error !== null && (
            <p role="alert" className="text-sm text-rose-400">
              {ai.error}
            </p>
          )}

          {narrative !== undefined && (
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <p className="mb-2 inline-block rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-300">
                AI-generated — verify before relying on it
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                {narrative}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
