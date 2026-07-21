/**
 * Deterministic summary generator (ARCHITECTURE §6, S3-3).
 *
 * Walks the IR to produce structured facts a reviewer can read without
 * touching XML: applications touched, queues, I/O, exception strategy, and a
 * page-by-page step outline. Pure and deterministic — the optional AI
 * narrative (Sprint 7) builds on top of these facts, never replaces them.
 */
import type {
  AutomationModel,
  BusinessObjectNode,
  Param,
  ProcessNode,
  Stage,
} from '@prismshift/ir';
import { SENSITIVE_NAME } from '@prismshift/rules';

/** A data item / collection field whose name or type signals sensitive data. */
export interface SensitivityFlag {
  /** Item name, or `Collection.Field` for flagged fields. */
  itemName: string;
  pageName: string;
  reason: 'name-pattern' | 'password-type';
}

export interface PageOutline {
  pageName: string;
  steps: string[];
}

export interface ExceptionStrategy {
  hasRecovery: boolean;
  recoveryPages: string[];
  /** Deliberate Exception stages (validation throws etc.). */
  deliberateThrows: { pageName: string; stageName: string; exceptionType?: string }[];
}

export interface ProcessSummary {
  kind: 'process';
  name: string;
  description?: string;
  applicationsTouched: string[];
  objectsCalled: string[];
  queuesUsed: string[];
  inputs: Param[];
  outputs: Param[];
  pageCount: number;
  stageCount: number;
  dataItemCount: number;
  exceptionStrategy: ExceptionStrategy;
  sensitivity: SensitivityFlag[];
  outline: PageOutline[];
}

export interface ObjectSummary {
  kind: 'object';
  name: string;
  description?: string;
  applicationName?: string;
  actionPages: string[];
  stageCount: number;
  dataItemCount: number;
  exceptionStrategy: ExceptionStrategy;
  sensitivity: SensitivityFlag[];
  outline: PageOutline[];
}

/** BP's internal work-queues object — queue ops, not object calls. */
const WORK_QUEUES_OBJECT = 'Work Queues';

const truncate = (text: string, max = 60): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** One human-readable sentence per flow stage. Deterministic. */
export function stepSentence(stage: Stage): string | null {
  switch (stage.kind) {
    case 'start':
    case 'end':
    case 'data':
    case 'collection':
    case 'anchor':
    case 'note':
      return null;
    case 'action':
      if (stage.objectName === WORK_QUEUES_OBJECT || stage.queueName !== undefined) {
        return `Queue "${stage.queueName ?? '(dynamic)'}": ${stage.actionName}`;
      }
      return `Call ${stage.objectName} › ${stage.actionName}`;
    case 'calculation':
      return `Set ${stage.storeIn} = ${truncate(stage.expression.raw)}`;
    case 'multiCalc':
      return `Set ${stage.steps.length} values (${truncate(
        stage.steps.map((s) => s.storeIn).join(', '),
        50,
      )})`;
    case 'decision':
      return `Decide: ${truncate(stage.expression.raw)}`;
    case 'choice':
      return `Choose between ${stage.choices.map((c) => c.name).join(' / ')}`;
    case 'loopStart':
      return `For each row in ${stage.collectionName}`;
    case 'loopEnd':
      return 'End loop';
    case 'subsheetRef':
      return `Run page "${stage.targetPageName || stage.name}"`;
    case 'read':
      return `Read ${stage.steps.length} value(s) from the application`;
    case 'write':
      return `Write ${stage.steps.length} value(s) to the application`;
    case 'navigate':
      return `Navigate: ${stage.steps.map((s) => s.action).join(', ')}`;
    case 'wait':
      return `Wait for ${stage.conditions.length} condition(s)${
        stage.timeoutSeconds !== undefined && stage.timeoutSeconds > 0
          ? ` (timeout ${stage.timeoutSeconds}s)`
          : ' (no timeout)'
      }`;
    case 'alert':
      return `Alert: ${truncate(stage.message.raw)}`;
    case 'exception':
      return `Throw ${stage.exceptionType ?? 'exception'}${
        stage.detail ? ` (${truncate(stage.detail.raw, 40)})` : ''
      }`;
    case 'recover':
      return 'Recover from exception';
    case 'resume':
      return 'Resume normal flow';
    case 'code':
      return `Run ${stage.language} code "${stage.name}"`;
    case 'generic':
      return `Unrecognized stage "${stage.name}" (${stage.rawType})`;
  }
}

function outlineOf(owner: ProcessNode | BusinessObjectNode): PageOutline[] {
  return owner.pages.map((page) => ({
    pageName: page.name,
    steps: page.stages.map(stepSentence).filter((s): s is string => s !== null),
  }));
}

function exceptionStrategyOf(owner: ProcessNode | BusinessObjectNode): ExceptionStrategy {
  const recoveryPages: string[] = [];
  const deliberateThrows: ExceptionStrategy['deliberateThrows'] = [];
  for (const page of owner.pages) {
    if (page.stages.some((s) => s.kind === 'recover')) recoveryPages.push(page.name);
    for (const stage of page.stages) {
      if (stage.kind === 'exception') {
        deliberateThrows.push({
          pageName: page.name,
          stageName: stage.name,
          ...(stage.exceptionType !== undefined ? { exceptionType: stage.exceptionType } : {}),
        });
      }
    }
  }
  return { hasRecovery: recoveryPages.length > 0, recoveryPages, deliberateThrows };
}

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

/** SSN/account/card name patterns + password-typed items (S3-4). */
function sensitivityOf(owner: ProcessNode | BusinessObjectNode): SensitivityFlag[] {
  const flags: SensitivityFlag[] = [];
  for (const page of owner.pages) {
    for (const stage of page.stages) {
      if (stage.kind !== 'data' && stage.kind !== 'collection') continue;
      const item = owner.dataItems.find((d) => d.id === stage.dataItemId);
      if (!item) continue;

      if (SENSITIVE_NAME.test(item.name)) {
        flags.push({ itemName: item.name, pageName: page.name, reason: 'name-pattern' });
      } else if (item.dataType === 'password') {
        flags.push({ itemName: item.name, pageName: page.name, reason: 'password-type' });
      }
      for (const field of item.fields ?? []) {
        if (SENSITIVE_NAME.test(field.name)) {
          flags.push({
            itemName: `${item.name}.${field.name}`,
            pageName: page.name,
            reason: 'name-pattern',
          });
        }
      }
    }
  }
  return flags.sort(
    (a, b) => a.itemName.localeCompare(b.itemName) || a.pageName.localeCompare(b.pageName),
  );
}

export function summarizeProcess(model: AutomationModel, process: ProcessNode): ProcessSummary {
  const objectsCalled: string[] = [];
  const queuesUsed: string[] = [];

  for (const page of process.pages) {
    for (const stage of page.stages) {
      if (stage.kind !== 'action') continue;
      if (stage.objectName === WORK_QUEUES_OBJECT || stage.queueName !== undefined) {
        queuesUsed.push(stage.queueName ?? '(dynamic)');
      } else {
        objectsCalled.push(stage.objectName);
      }
    }
  }

  const applicationsTouched = sortedUnique(
    objectsCalled
      .map((name) => model.objects.find((o) => o.name === name)?.appModel?.applicationName)
      .filter((name): name is string => name !== undefined && name !== ''),
  );

  return {
    kind: 'process',
    name: process.name,
    ...(process.description !== undefined ? { description: process.description } : {}),
    applicationsTouched,
    objectsCalled: sortedUnique(objectsCalled),
    queuesUsed: sortedUnique(queuesUsed),
    inputs: process.startupParams,
    outputs: process.outputs,
    pageCount: process.pages.length,
    stageCount: process.pages.reduce((n, p) => n + p.stages.length, 0),
    dataItemCount: process.dataItems.length,
    exceptionStrategy: exceptionStrategyOf(process),
    sensitivity: sensitivityOf(process),
    outline: outlineOf(process),
  };
}

export function summarizeObject(_model: AutomationModel, object: BusinessObjectNode): ObjectSummary {
  return {
    kind: 'object',
    name: object.name,
    ...(object.description !== undefined ? { description: object.description } : {}),
    ...(object.appModel?.applicationName !== undefined
      ? { applicationName: object.appModel.applicationName }
      : {}),
    actionPages: object.pages.map((p) => p.name),
    stageCount: object.pages.reduce((n, p) => n + p.stages.length, 0),
    dataItemCount: object.dataItems.length,
    exceptionStrategy: exceptionStrategyOf(object),
    sensitivity: sensitivityOf(object),
    outline: outlineOf(object),
  };
}
