import { APP_NAME, DEFAULT_MODE, modeLabel } from './lib/appInfo';
import { BUILD_TIME } from './lib/buildInfo';
import { formatBytes } from './lib/fileIntake';
import { DropZone } from './components/DropZone';
import { ProcessTree } from './components/ProcessTree';
import { useSession } from './store/session';

export default function App() {
  const loaded = useSession((s) => s.loaded);
  const parsing = useSession((s) => s.parsing);
  const parseResult = useSession((s) => s.parseResult);
  const reset = useSession((s) => s.reset);

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
      <main className="mx-auto max-w-3xl px-6 py-16">
        {loaded ? (
          <section aria-label="Loaded release" className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-mono text-lg text-slate-100">{loaded.fileName}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {formatBytes(loaded.sizeBytes)} read into browser memory
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
              >
                Load a different file
              </button>
            </div>
            {parsing && (
              <p className="mt-6 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-400">
                Parsing…
              </p>
            )}
            {parseResult && <ProcessTree result={parseResult} />}
          </section>
        ) : (
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
      </main>
    </div>
  );
}
