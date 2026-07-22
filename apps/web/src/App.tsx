import { useState } from 'react';
import { APP_NAME, DEFAULT_MODE, modeLabel } from './lib/appInfo';
import { BUILD_TIME } from './lib/buildInfo';
import { buildReleaseExport, downloadBlob, releaseZipBlob } from './lib/exportProject';
import { formatBytes } from './lib/fileIntake';
import { DropZone } from './components/DropZone';
import { OwnerCards } from './components/OwnerCards';
import { OwnerDetail } from './components/OwnerDetail';
import { useSession } from './store/session';

export default function App() {
  const loaded = useSession((s) => s.loaded);
  const parsing = useSession((s) => s.parsing);
  const parseResult = useSession((s) => s.parseResult);
  const analysis = useSession((s) => s.analysis);
  const selection = useSession((s) => s.selection);
  const reset = useSession((s) => s.reset);
  const [bundleNote, setBundleNote] = useState<string | null>(null);

  const model = parseResult?.model;
  const findings = analysis?.findings ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="font-mono text-[10px] text-slate-600">build {BUILD_TIME}</p>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          {modeLabel(DEFAULT_MODE)} — data stays in your browser
        </span>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
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
                Parsing…
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
                    const release = buildReleaseExport(model);
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
