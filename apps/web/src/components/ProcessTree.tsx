import type {
  BusinessObjectNode,
  Page,
  ProcessNode,
  Stage,
  StageKind,
} from '@prismshift/ir';
import type { ParseResult } from '@prismshift/parser';

const KIND_STYLES: Partial<Record<StageKind, string>> = {
  start: 'bg-emerald-500/15 text-emerald-300',
  end: 'bg-emerald-500/15 text-emerald-300',
  action: 'bg-sky-500/15 text-sky-300',
  subsheetRef: 'bg-sky-500/15 text-sky-300',
  decision: 'bg-amber-500/15 text-amber-300',
  choice: 'bg-amber-500/15 text-amber-300',
  exception: 'bg-rose-500/15 text-rose-300',
  recover: 'bg-rose-500/15 text-rose-300',
  resume: 'bg-rose-500/15 text-rose-300',
  data: 'bg-slate-500/20 text-slate-300',
  collection: 'bg-slate-500/20 text-slate-300',
  code: 'bg-violet-500/15 text-violet-300',
  generic: 'bg-orange-500/15 text-orange-300',
};

function StageRow({ stage }: { stage: Stage }) {
  return (
    <li className="flex items-center gap-2 py-0.5">
      <span
        className={`inline-block w-24 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] uppercase tracking-wide ${KIND_STYLES[stage.kind] ?? 'bg-slate-500/20 text-slate-300'}`}
      >
        {stage.kind}
      </span>
      <span className="truncate text-sm text-slate-200">{stage.name}</span>
    </li>
  );
}

function PageBranch({ page }: { page: Page }) {
  return (
    <details className="ml-4 border-l border-slate-800 pl-4" open={page.stages.length <= 12}>
      <summary className="cursor-pointer py-1 text-sm text-slate-300 hover:text-slate-100">
        <span className="font-medium">{page.name}</span>
        <span className="ml-2 text-xs text-slate-500">{page.stages.length} stages</span>
      </summary>
      <ul className="mb-2 mt-1">
        {page.stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </ul>
    </details>
  );
}

export function NodeBranch({
  node,
  label,
}: {
  node: ProcessNode | BusinessObjectNode;
  label: 'Process' | 'Object';
}) {
  const stageCount = node.pages.reduce((n, p) => n + p.stages.length, 0);
  return (
    <details open className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2">
      <summary className="cursor-pointer py-1">
        <span className="mr-2 rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-300">
          {label}
        </span>
        <span className="font-medium text-slate-100">{node.name}</span>
        <span className="ml-2 text-xs text-slate-500">
          {node.pages.length} {node.pages.length === 1 ? 'page' : 'pages'} · {stageCount} stages
        </span>
      </summary>
      {node.description && <p className="mb-2 ml-4 text-xs text-slate-400">{node.description}</p>}
      {node.pages.map((page) => (
        <PageBranch key={page.id} page={page} />
      ))}
    </details>
  );
}

export function ProcessTree({ result }: { result: ParseResult }) {
  const { model, warnings, errors } = result;

  return (
    <div className="mt-6 space-y-4">
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3">
          <p className="text-sm font-medium text-rose-300">
            {errors.length} {errors.length === 1 ? 'error' : 'errors'} while parsing
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-rose-300/80">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-medium text-amber-300">
            {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-300/80">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-slate-400">
        <span className="font-medium text-slate-200">{model.meta.packageName || 'Export'}</span>
        {model.meta.bpVersion && ` · Blue Prism ${model.meta.bpVersion}`} ·{' '}
        {model.processes.length} {model.processes.length === 1 ? 'process' : 'processes'} ·{' '}
        {model.objects.length} {model.objects.length === 1 ? 'object' : 'objects'} ·{' '}
        {model.workQueues.length} {model.workQueues.length === 1 ? 'queue' : 'queues'}
      </p>

      <div className="space-y-3">
        {model.processes.map((process) => (
          <NodeBranch key={process.id} node={process} label="Process" />
        ))}
        {model.objects.map((object) => (
          <NodeBranch key={object.id} node={object} label="Object" />
        ))}
      </div>
    </div>
  );
}
