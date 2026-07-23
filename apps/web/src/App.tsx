import { useEffect, useState } from 'react';
import { APP_NAME } from './lib/appInfo';
import { currentPrivacyMode } from './lib/workspace';
import { BUILD_TIME } from './lib/buildInfo';
import { buildAuditReportData, renderAuditPdf } from './lib/auditReport';
import { buildReleaseExport, downloadBlob, releaseZipBlob } from './lib/exportProject';
import { formatBytes } from './lib/fileIntake';
import { DropZone } from './components/DropZone';
import { OwnerCards } from './components/OwnerCards';
import { OwnerDetail } from './components/OwnerDetail';
import { MigrationTracker } from './components/MigrationTracker';
import { WorkspacePanel } from './components/WorkspacePanel';
import { useSession } from './store/session';
import { acceptedCodeOverrides, useAiStore } from './store/ai';
import { useWorkspaceStore } from './store/workspace';

export default function App() {
  const loaded = useSession((s) => s.loaded);
  const parsing = useSession((s) => s.parsing);
  const parsingProgress = useSession((s) => s.parsingProgress);
  const parseResult = useSession((s) => s.parseResult);
  const analysis = useSession((s) => s.analysis);
  const selection = useSession((s) => s.selection);
  const reset = useSession((s) => s.reset);
  const [bundleNote, setBundleNote] = useState<string | null>(null);
  const codeSuggestions = useAiStore((s) => s.codeSuggestions);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  // Init at app load — the magic-link redirect carries the token in the URL
  // hash, and the client must exist right then to consume it (not only when
  // the panel is first opened).
  useEffect(() => useWorkspaceStore.getState().init(), []);

  const signedIn = useWorkspaceStore((s) => s.session !== null);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const mode = currentPrivacyMode(signedIn, activeWorkspaceId);

  const model = parseResult?.model;
  const findings = analysis?.findings ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="font-mono text-[10px] text-slate-600">build {BUILD_TIME}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setWorkspaceOpen((open) => !open)}
            className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100"
          >
            {workspaceOpen ? 'Workspace ▴' : 'Workspace ▾'}
          </button>
          <span
            title={mode.description}
            className={
              mode.key === 'workspace'
                ? 'rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300'
                : 'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400'
            }
          >
            {mode.label}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        {workspaceOpen && <WorkspacePanel onClose={() => setWorkspaceOpen(false)} />}
        {workspaceOpen && <MigrationTracker />}
        {!loaded && (
          <>
            <h2 className="text-center text-2xl font-semibold">
              Blue Prism → UiPath Migration
            </h2>
            <p className="mb-10 mt-3 text-center text-slate-400">
              Analyze, document, and convert your Blue Prism estate — entirely in your browser.
            </p>
            <DropZone />
          </>
        )}

        {loaded && (
          <section aria-label="Loaded release">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-mono text-lg text-slate-100">{loaded.fileName}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {formatBytes(loaded.sizeBytes)} read into browser memory
                  {model &&
                    ` · ${model.meta.packageName || 'Export'}${model.meta.bpVersion ? ` · Blue Prism ${model.meta.bpVersion}` : ''}`}
                  {analysis && ` · ${findings.length} findings in ${analysis.totalMs.toFixed(0)} ms`}
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
              >
                Load a different file
              </button>
            </div>

            {parsing && (
              <p className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-400">
                {parsingProgress ?? 'Parsing…'}
              </p>
            )}

            {parseResult && parseResult.errors.length > 0 && (
              <div role="alert" className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3">
                <p className="text-sm font-medium text-rose-300">
                  {parseResult.errors.length} error(s) while parsing
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-rose-300/80">
                  {parseResult.errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {parseResult && parseResult.warnings.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                <p className="text-sm font-medium text-amber-300">
                  {parseResult.warnings.length} warning(s)
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-amber-300/80">
                  {parseResult.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {model && !selection && model.processes.length > 0 && (
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const release = buildReleaseExport(model, acceptedCodeOverrides(codeSuggestions));
                    void releaseZipBlob(release).then((blob) => {
                      const name = (model.meta.packageName || 'release').replace(/[^A-Za-z0-9_-]+/g, '_');
                      downloadBlob(blob, `${name}-UiPath-projects.zip`);
                      setBundleNote(
                        `${release.exports.length} project(s) bundled — one folder per process, each self-contained with its objects, manifests, and migration report.`,
                      );
                    });
                  }}
                  className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-500/20"
                >
                  ⬇ Download all UiPath projects ({model.processes.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const data = buildAuditReportData(
                      model,
                      findings,
                      new Date().toISOString().slice(0, 16).replace('T', ' '),
                    );
                    const name = (model.meta.packageName || 'release').replace(/[^A-Za-z0-9_-]+/g, '_');
                    downloadBlob(renderAuditPdf(data), `${name}-audit-report.pdf`);
                    setBundleNote(
                      `Audit report generated client-side: rollup + ${data.sections.length} component section(s), findings, coverage, sign-off block.`,
                    );
                  }}
                  className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-500/20"
                >
                  ⬇ Audit report (PDF)
                </button>
                {bundleNote && <span className="text-xs text-slate-400">{bundleNote}</span>}
              </div>
            )}
            {model && !selection && <OwnerCards model={model} findings={findings} />}
            {model && selection && <OwnerDetail model={model} findings={findings} />}
          </section>
        )}
      </main>
    </div>
  );
}
