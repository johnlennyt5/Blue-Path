/**
 * Reliability rules REL-001…REL-004 (ARCHITECTURE §5.1).
 */
import type { Page, Stage } from '@prismshift/ir';
import { defineRule, makeFinding } from './engine';
import type { Rule } from './engine';
import { eachOwner, locationOf, walkStages } from './helpers';

// ---------------------------------------------------------------------------
// REL-001 — no exception handling coverage in a process
// ---------------------------------------------------------------------------

/** Stage kinds whose failure is realistic enough to demand recovery. */
const RISKY_KINDS = new Set<Stage['kind']>(['action', 'navigate', 'write', 'read', 'wait', 'code']);

const rel001 = defineRule(
  {
    id: 'REL-001',
    title: 'No exception handling',
    severity: 'high',
    category: 'reliability',
    description:
      'A process that interacts with applications or queues has no Recover/Resume coverage anywhere — any exception terminates the run unhandled.',
  },
  (model) => {
    const findings = [];
    for (const process of model.processes) {
      const stages = process.pages.flatMap((p) => p.stages);
      const hasRecovery = stages.some((s) => s.kind === 'recover');
      const hasRiskyWork = stages.some((s) => RISKY_KINDS.has(s.kind));
      if (!hasRecovery && hasRiskyWork) {
        findings.push(
          makeFinding(
            rel001.meta,
            { processId: process.id },
            `Process "${process.name}" performs application/queue work but contains no Recover stage on any page.`,
            'Add Recover/Resume blocks (BP) — in UiPath this maps to REFramework transaction Try/Catch with SetTransactionStatus.',
            0.9,
          ),
        );
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// REL-002 — unguarded cycle (infinite loop risk)
// ---------------------------------------------------------------------------

/** Kinds that bound or gate iteration: their presence makes a cycle "guarded". */
const GUARD_KINDS = new Set<Stage['kind']>(['decision', 'choice', 'loopStart', 'loopEnd', 'wait']);

/**
 * Earliest stage (by diagram order) of each strongly-connected edge cycle on
 * the page that contains no guard stage.
 */
function unguardedCycleHeads(page: Page): Stage[] {
  const order = new Map(page.stages.map((s, i) => [s.id, i]));
  const adjacency = new Map<string, string[]>(page.stages.map((s) => [s.id, []]));
  for (const edge of page.edges) {
    if (adjacency.has(edge.from) && order.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
    }
  }

  const reachableFrom = (start: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...(adjacency.get(start) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(adjacency.get(next) ?? []));
    }
    return seen;
  };

  const reach = new Map<string, Set<string>>();
  for (const stage of page.stages) reach.set(stage.id, reachableFrom(stage.id));

  const cyclic = page.stages.filter((s) => reach.get(s.id)!.has(s.id)).map((s) => s.id);
  const assigned = new Set<string>();
  const heads: Stage[] = [];

  for (const id of cyclic) {
    if (assigned.has(id)) continue;
    const component = cyclic.filter(
      (other) =>
        !assigned.has(other) && reach.get(id)!.has(other) && reach.get(other)!.has(id),
    );
    for (const member of component) assigned.add(member);

    const stages = component
      .map((memberId) => page.stages[order.get(memberId)!]!)
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    if (!stages.some((s) => GUARD_KINDS.has(s.kind))) {
      heads.push(stages[0]!);
    }
  }
  return heads;
}

const rel002 = defineRule(
  {
    id: 'REL-002',
    title: 'Unguarded loop',
    severity: 'high',
    category: 'reliability',
    description:
      'A control-flow cycle has no decision, choice, loop, or wait stage inside it — nothing bounds the iteration.',
  },
  (model) => {
    const findings = [];
    for (const { owner, ownerType } of eachOwner(model)) {
      for (const page of owner.pages) {
        for (const head of unguardedCycleHeads(page)) {
          findings.push(
            makeFinding(
              rel002.meta,
              ownerType === 'process'
                ? { processId: owner.id, pageId: page.id, stageId: head.id }
                : { objectId: owner.id, pageId: page.id, stageId: head.id },
              `Stages around "${head.name}" on page "${page.name}" form a cycle with no guard — a permanent condition loops forever.`,
              'Add a retry counter with a decision, or convert to a bounded loop; in UiPath use RetryScope or REFramework retry settings.',
              0.85,
            ),
          );
        }
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// REL-003 — wait without timeout
// ---------------------------------------------------------------------------

const rel003 = defineRule(
  {
    id: 'REL-003',
    title: 'Wait without timeout',
    severity: 'medium',
    category: 'reliability',
    description:
      'A wait stage has a zero or absent timeout — if the condition never becomes true, the robot hangs indefinitely.',
  },
  (model) => {
    const findings = [];
    for (const visit of walkStages(model)) {
      const stage = visit.stage;
      if (stage.kind !== 'wait') continue;
      if (stage.timeoutSeconds === undefined || stage.timeoutSeconds <= 0) {
        findings.push(
          makeFinding(
            rel003.meta,
            locationOf(visit),
            `Wait stage "${stage.name}" has no timeout.`,
            'Set an explicit timeout with a handled timeout path; in UiPath give activities a Timeout and catch the failure.',
            0.95,
          ),
        );
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// REL-004 — element matched by index/position
// ---------------------------------------------------------------------------

const rel004 = defineRule(
  {
    id: 'REL-004',
    title: 'Brittle selector (index match)',
    severity: 'medium',
    category: 'reliability',
    description:
      'An Application Modeller element is matched by index/position rather than stable attributes — any UI reordering breaks it.',
  },
  (model) => {
    const findings = [];
    for (const object of model.objects) {
      for (const element of object.appModel?.elements ?? []) {
        const indexAttrs = element.attributes.filter(
          (a) => a.enabled && a.matchType === 'index',
        );
        if (indexAttrs.length > 0) {
          findings.push(
            makeFinding(
              rel004.meta,
              { objectId: object.id, elementId: element.id },
              `Element "${element.name}" is matched by index (${indexAttrs.map((a) => a.name).join(', ')}).`,
              'Re-spy the element using stable attributes (id, name, automation id); index-based UiPath selectors will be flagged low-confidence in conversion.',
              0.9,
            ),
          );
        }
      }
    }
    return findings;
  },
);

export const REL_RULES: Rule[] = [rel001, rel002, rel003, rel004];
