import { walkStages } from '@prismshift/ir';
import type {
  AutomationModel,
  BusinessObjectNode,
  IrLocation,
  ProcessNode,
  Stage,
} from '@prismshift/ir';
import type { StageVisit } from '@prismshift/ir';

/** IrLocation for a stage visit (process- or object-owned). */
export function locationOf(visit: StageVisit): IrLocation {
  const owner =
    visit.ownerType === 'process'
      ? { processId: visit.owner.id }
      : { objectId: visit.owner.id };
  return { ...owner, pageId: visit.page.id, stageId: visit.stage.id };
}

/** IrLocation for a whole process/object. */
export function ownerLocation(
  owner: ProcessNode | BusinessObjectNode,
  ownerType: 'process' | 'object',
): IrLocation {
  return ownerType === 'process' ? { processId: owner.id } : { objectId: owner.id };
}

export { walkStages };

/** PII-ish field/item names (shared by SEC-003 and CMP-001). */
export const SENSITIVE_NAME =
  /\bssn\b|social\s*security|account\s*number|card\s*number|credit\s*card|\biban\b|sort\s*code/i;

/** `[Data Item]` / `[Collection.Field]` references inside a BP expression. */
export function identifierRefs(raw: string): string[] {
  return [...raw.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1] ?? '');
}

/** `Collection.Field` → `Collection`; plain names pass through. */
export function baseIdentifier(ref: string): string {
  const dot = ref.indexOf('.');
  return dot === -1 ? ref : ref.slice(0, dot);
}

/**
 * If the expression is exactly one quoted string literal (`"value"`),
 * returns its content; otherwise null.
 */
export function wholeLiteral(raw: string): string | null {
  const match = /^"([^"]*)"$/.exec(raw.trim());
  return match ? (match[1] ?? '') : null;
}

/**
 * Maps every data item id to the page/stage where its Data/Collection stage
 * sits, so data-item findings can point at a concrete diagram location.
 */
export function dataItemStages(
  owner: ProcessNode | BusinessObjectNode,
): Map<string, { pageId: string; stageId: string }> {
  const index = new Map<string, { pageId: string; stageId: string }>();
  for (const page of owner.pages) {
    for (const stage of page.stages) {
      if (stage.kind === 'data' || stage.kind === 'collection') {
        index.set(stage.dataItemId, { pageId: page.id, stageId: stage.id });
      }
    }
  }
  return index;
}

/** Every named input binding on a stage (actions and page references). */
export function inputBindings(stage: Stage): { paramName: string; raw: string }[] {
  if (stage.kind === 'action' || stage.kind === 'subsheetRef') {
    return stage.inputs.map((i) => ({ paramName: i.paramName, raw: i.expression.raw }));
  }
  return [];
}

export function* eachOwner(model: AutomationModel): Generator<{
  owner: ProcessNode | BusinessObjectNode;
  ownerType: 'process' | 'object';
}> {
  for (const process of model.processes) yield { owner: process, ownerType: 'process' };
  for (const object of model.objects) yield { owner: object, ownerType: 'object' };
}
