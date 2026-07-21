import type { AutomationModel, BusinessObjectNode, ProcessNode } from '@prismshift/ir';
import { summarizeObject, summarizeProcess } from '@prismshift/reports';

function Chips({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-sm text-slate-200"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Deterministic plain-English documentation for one process/object. */
export function SummaryPanel({
  model,
  owner,
  isProcess,
}: {
  model: AutomationModel;
  owner: ProcessNode | BusinessObjectNode;
  isProcess: boolean;
}) {
  const summary = isProcess
    ? summarizeProcess(model, owner as ProcessNode)
    : summarizeObject(model, owner as BusinessObjectNode);

  const strategy = summary.exceptionStrategy;

  return (
    <div className="space-y-6">
      {summary.description ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
          {summary.description}
        </p>
      ) : (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300/80">
          No description in the source — consider documenting before migration (CMP-002).
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {summary.kind === 'process' ? (
          <>
            <Chips
              title="Applications touched"
              items={summary.applicationsTouched}
              empty="None — pure logic process"
            />
            <Chips title="Work queues" items={summary.queuesUsed} empty="No queue interaction" />
            <Chips
              title="Objects called"
              items={summary.objectsCalled}
              empty="No business objects"
            />
            <Chips
              title="Inputs → Outputs"
              items={[
                ...summary.inputs.map((p) => `in: ${p.name}`),
                ...summary.outputs.map((p) => `out: ${p.name}`),
              ]}
              empty="No startup parameters or outputs"
            />
          </>
        ) : (
          <>
            <Chips
              title="Application"
              items={summary.applicationName ? [summary.applicationName] : []}
              empty="No Application Modeller"
            />
            <Chips title="Published actions" items={summary.actionPages} empty="No pages" />
          </>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
          Exception strategy
        </h3>
        <p className="text-sm text-slate-300">
          {strategy.hasRecovery
            ? `Recovery on: ${strategy.recoveryPages.join(', ')}.`
            : 'No Recover stages — exceptions terminate or propagate to the caller.'}
          {strategy.deliberateThrows.length > 0 &&
            ` Deliberate throws: ${strategy.deliberateThrows
              .map((t) => `"${t.stageName}" (${t.pageName})`)
              .join(', ')}.`}
        </p>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
          Data sensitivity
        </h3>
        {summary.sensitivity.length === 0 ? (
          <p className="text-sm text-slate-500">No sensitive data patterns detected.</p>
        ) : (
          <ul className="space-y-1">
            {summary.sensitivity.map((flag) => (
              <li
                key={`${flag.itemName}-${flag.pageName}`}
                className="flex items-center gap-2 text-sm"
              >
                <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-rose-300">
                  {flag.reason === 'password-type' ? 'password' : 'PII'}
                </span>
                <span className="text-slate-200">{flag.itemName}</span>
                <span className="text-xs text-slate-500">on {flag.pageName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Step outline
        </h3>
        <div className="space-y-2">
          {summary.outline.map((page) => (
            <details
              key={page.pageName}
              open={summary.outline.length <= 2}
              className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2"
            >
              <summary className="cursor-pointer py-1 text-sm font-medium text-slate-200">
                {page.pageName}
                <span className="ml-2 text-xs text-slate-500">{page.steps.length} steps</span>
              </summary>
              <ol className="mb-2 mt-1 list-inside list-decimal space-y-0.5">
                {page.steps.map((step, i) => (
                  <li key={i} className="text-sm text-slate-300">
                    {step}
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
