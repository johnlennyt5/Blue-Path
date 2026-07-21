/**
 * Maintainability rules MNT-001…MNT-004 (ARCHITECTURE §5.1).
 */
import type { BusinessObjectNode, Page, ProcessNode, Stage } from '@prismshift/ir';
import { defineRule, makeFinding } from './engine';
import type { Rule } from './engine';
import { baseIdentifier, eachOwner, identifierRefs } from './helpers';

// ---------------------------------------------------------------------------
// MNT-001 — unreachable stages / orphaned pages
// ---------------------------------------------------------------------------

/** Kinds that are annotations/definitions, not executable flow. */
const NON_FLOW_KINDS = new Set<Stage['kind']>(['data', 'collection', 'note', 'generic']);

/** Flow entry points: Start stages and Recover stages (exception entries). */
const ENTRY_KINDS = new Set<Stage['kind']>(['start', 'recover']);

function unreachableFlowStages(page: Page): Stage[] {
  const adjacency = new Map<string, string[]>(page.stages.map((s) => [s.id, []]));
  for (const edge of page.edges) {
    if (adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
    }
  }
  const reached = new Set<string>();
  const queue = page.stages.filter((s) => ENTRY_KINDS.has(s.kind)).map((s) => s.id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...(adjacency.get(id) ?? []));
  }
  return page.stages.filter(
    (s) => !reached.has(s.id) && !ENTRY_KINDS.has(s.kind) && !NON_FLOW_KINDS.has(s.kind),
  );
}

const mnt001 = defineRule(
  {
    id: 'MNT-001',
    title: 'Dead logic',
    severity: 'medium',
    category: 'maintainability',
    description:
      'Stages that no control flow can reach, or pages never referenced by any page-reference stage — dead logic that still costs maintenance.',
  },
  (model) => {
    const findings = [];

    for (const { owner, ownerType } of eachOwner(model)) {
      const base =
        ownerType === 'process' ? { processId: owner.id } : { objectId: owner.id };
      for (const page of owner.pages) {
        for (const stage of unreachableFlowStages(page)) {
          findings.push(
            makeFinding(
              mnt001.meta,
              { ...base, pageId: page.id, stageId: stage.id },
              `Stage "${stage.name}" on page "${page.name}" is unreachable from any Start or Recover stage.`,
              'Delete the dead stages, or reconnect them if they were meant to run; do not migrate dead logic.',
              0.9,
            ),
          );
        }
      }
    }

    // Orphaned pages: process-scope only — object pages are externally
    // callable actions and legitimately have no internal references.
    for (const process of model.processes) {
      const referenced = new Set<string>();
      for (const page of process.pages) {
        for (const stage of page.stages) {
          if (stage.kind === 'subsheetRef' && stage.targetPageId !== undefined) {
            referenced.add(stage.targetPageId);
          }
        }
      }
      for (const [index, page] of process.pages.entries()) {
        if (index === 0) continue; // main page needs no reference
        if (!referenced.has(page.id)) {
          findings.push(
            makeFinding(
              mnt001.meta,
              { processId: process.id, pageId: page.id },
              `Page "${page.name}" is never referenced by any page-reference stage.`,
              'Remove the orphaned page or wire it back into the flow before migrating.',
              0.9,
            ),
          );
        }
      }
    }

    return findings;
  },
);

// ---------------------------------------------------------------------------
// MNT-002 — unused data items
// ---------------------------------------------------------------------------

/** Every data-item name an owner's stages reference in any way. */
function referencedItemNames(owner: ProcessNode | BusinessObjectNode): Set<string> {
  const names = new Set<string>();
  const addRefs = (raw: string) => {
    for (const ref of identifierRefs(raw)) names.add(baseIdentifier(ref));
  };

  for (const page of owner.pages) {
    for (const stage of page.stages) {
      switch (stage.kind) {
        case 'start':
          for (const b of stage.inputs ?? []) names.add(b.storeIn);
          break;
        case 'end':
          for (const b of stage.outputs ?? []) names.add(b.storeIn);
          break;
        case 'calculation':
          addRefs(stage.expression.raw);
          names.add(stage.storeIn);
          break;
        case 'multiCalc':
          for (const step of stage.steps) {
            addRefs(step.expression.raw);
            names.add(step.storeIn);
          }
          break;
        case 'decision':
          addRefs(stage.expression.raw);
          break;
        case 'choice':
          for (const choice of stage.choices) addRefs(choice.expression.raw);
          break;
        case 'alert':
          addRefs(stage.message.raw);
          break;
        case 'loopStart':
          names.add(stage.collectionName);
          break;
        case 'action':
        case 'subsheetRef':
          for (const input of stage.inputs) addRefs(input.expression.raw);
          for (const output of stage.outputs) names.add(output.storeIn);
          break;
        case 'code':
          for (const input of stage.inputs) addRefs(input.expression.raw);
          for (const output of stage.outputs) names.add(output.storeIn);
          break;
        case 'read':
          for (const step of stage.steps) names.add(step.storeIn);
          break;
        case 'write':
          for (const step of stage.steps) addRefs(step.value.raw);
          break;
        case 'navigate':
          for (const step of stage.steps) {
            for (const param of step.params ?? []) addRefs(param.value.raw);
          }
          break;
        case 'wait':
          for (const condition of stage.conditions) {
            if (condition.expected) addRefs(condition.expected.raw);
          }
          break;
        case 'exception':
          if (stage.detail) addRefs(stage.detail.raw);
          break;
        default:
          break;
      }
    }
  }
  return names;
}

const mnt002 = defineRule(
  {
    id: 'MNT-002',
    title: 'Unused data item',
    severity: 'low',
    category: 'maintainability',
    description: 'A data item is neither read nor written by any stage.',
  },
  (model) => {
    const findings = [];
    for (const { owner, ownerType } of eachOwner(model)) {
      const referenced = referencedItemNames(owner);
      const base =
        ownerType === 'process' ? { processId: owner.id } : { objectId: owner.id };

      for (const page of owner.pages) {
        for (const stage of page.stages) {
          if (stage.kind !== 'data' && stage.kind !== 'collection') continue;
          if (!referenced.has(stage.name)) {
            findings.push(
              makeFinding(
                mnt002.meta,
                { ...base, pageId: page.id, stageId: stage.id },
                `Data item "${stage.name}" on page "${page.name}" is never referenced.`,
                'Delete it — unused data items obscure the real data flow during migration.',
                0.85,
              ),
            );
          }
        }
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// MNT-003 — near-duplicate objects
// ---------------------------------------------------------------------------

/** Structural token bag: stage kinds + edge kinds per page, plus app model shape. */
function structureTokens(object: BusinessObjectNode): Map<string, number> {
  const bag = new Map<string, number>();
  const add = (token: string) => bag.set(token, (bag.get(token) ?? 0) + 1);

  for (const [pageIndex, page] of object.pages.entries()) {
    for (const stage of page.stages) add(`p${pageIndex}:${stage.kind}`);
    for (const edge of page.edges) add(`p${pageIndex}:e:${edge.kind}`);
  }
  for (const element of object.appModel?.elements ?? []) {
    add(`el:${element.mode}`);
    for (const attr of element.attributes) add(`attr:${attr.matchType}`);
  }
  return bag;
}

/** Multiset Jaccard similarity of two objects' structure (0..1). */
export function objectSimilarity(a: BusinessObjectNode, b: BusinessObjectNode): number {
  const bagA = structureTokens(a);
  const bagB = structureTokens(b);
  let intersection = 0;
  let union = 0;
  const tokens = new Set([...bagA.keys(), ...bagB.keys()]);
  for (const token of tokens) {
    const countA = bagA.get(token) ?? 0;
    const countB = bagB.get(token) ?? 0;
    intersection += Math.min(countA, countB);
    union += Math.max(countA, countB);
  }
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.85;

const mnt003 = defineRule(
  {
    id: 'MNT-003',
    title: 'Near-duplicate objects',
    severity: 'medium',
    category: 'maintainability',
    description:
      'Business objects with normalized-structure similarity above 0.85 — clones that should converge on one shared library object.',
  },
  (model) => {
    const findings = [];
    const reported = new Set<string>();

    for (let i = 0; i < model.objects.length; i++) {
      for (let j = i + 1; j < model.objects.length; j++) {
        const canonical = model.objects[i]!;
        const duplicate = model.objects[j]!;
        if (reported.has(duplicate.id) || reported.has(canonical.id)) continue;

        const similarity = objectSimilarity(canonical, duplicate);
        if (similarity > SIMILARITY_THRESHOLD) {
          reported.add(duplicate.id);
          findings.push(
            makeFinding(
              mnt003.meta,
              { objectId: duplicate.id },
              `Object "${duplicate.name}" is a near-duplicate of "${canonical.name}" (structure similarity ${(similarity * 100).toFixed(0)}%).`,
              'Consolidate the clones into one shared object; in UiPath this becomes a single reusable library workflow.',
              0.8,
            ),
          );
        }
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// MNT-004 — monolith thresholds
// ---------------------------------------------------------------------------

const PROCESS_STAGE_LIMIT = 150;
const PAGE_STAGE_LIMIT = 60;

const mnt004 = defineRule(
  {
    id: 'MNT-004',
    title: 'Monolithic process',
    severity: 'medium',
    category: 'maintainability',
    description: `A process with more than ${PROCESS_STAGE_LIMIT} stages or a page with more than ${PAGE_STAGE_LIMIT} — split before migrating.`,
  },
  (model) => {
    const findings = [];
    for (const process of model.processes) {
      const total = process.pages.reduce((n, p) => n + p.stages.length, 0);
      const oversizedPages = process.pages.filter((p) => p.stages.length > PAGE_STAGE_LIMIT);
      if (total > PROCESS_STAGE_LIMIT || oversizedPages.length > 0) {
        const reasons = [
          ...(total > PROCESS_STAGE_LIMIT ? [`${total} stages in the process`] : []),
          ...oversizedPages.map((p) => `${p.stages.length} stages on page "${p.name}"`),
        ];
        findings.push(
          makeFinding(
            mnt004.meta,
            { processId: process.id },
            `Process "${process.name}" is monolithic: ${reasons.join('; ')}.`,
            'Split into a queue-driven dispatcher/performer pair during migration (REFramework performer + a small dispatcher).',
            0.95,
          ),
        );
      }
    }
    return findings;
  },
);

export const MNT_RULES: Rule[] = [mnt001, mnt002, mnt003, mnt004];
