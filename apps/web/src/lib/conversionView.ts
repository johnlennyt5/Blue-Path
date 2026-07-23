/**
 * Conversion tab data (S5-6): BP stage ↔ UiPath activity mapping rows with
 * confidence, derived from a real conversion run — a reviewer can walk every
 * mapping without opening the generated XAML.
 */
import type {
  AutomationModel,
  BusinessObjectNode,
  ProcessNode,
  Stage,
} from '@prismshift/ir';
import { convertObject, convertProcess, sanitizeFileName } from '@prismshift/transformer';
import type { GeneratedSelector } from '@prismshift/transformer';

export interface StageMappingRow {
  pageName: string;
  stageId: string;
  stageName: string;
  stageKind: Stage['kind'];
  /** What it became on the UiPath side. */
  uipath: string;
  status: 'converted' | 'review' | 'manual';
  confidence: number;
  notes: string[];
}

export interface ConversionView {
  rows: StageMappingRow[];
  coveragePct: number;
  reviewCount: number;
  manualCount: number;
}

const MANUAL_MARKERS = [
  'not yet converted',
  'not found in the release',
  'no InvokeCode equivalent',
  'no selector',
  'needs Image/OCR',
  'manual restructuring',
];

function queueActivityLabel(actionName: string): string {
  const action = actionName.toLowerCase();
  if (/get next/.test(action)) return 'ui:GetQueueItem → TransactionItem';
  if (/add to queue/.test(action)) return 'ui:AddQueueItem (per-field ItemInformation)';
  if (/mark completed|complete/.test(action)) return 'ui:SetTransactionStatus (Successful)';
  if (/mark exception|exception/.test(action)) return 'ui:SetTransactionStatus (Failed)';
  return `queue action "${actionName}"`;
}

function uipathLabel(stage: Stage): string {
  switch (stage.kind) {
    case 'start':
      return 'Workflow arguments (in_/io_)';
    case 'end':
      return 'Workflow arguments (out_/io_)';
    case 'data':
    case 'collection':
      return 'Typed variable / argument';
    case 'calculation':
      return `Assign ${stage.storeIn}`;
    case 'multiCalc':
      return `${stage.steps.length}× Assign`;
    case 'decision':
      return 'If';
    case 'choice':
      return `Nested If (${stage.choices.length} choices + otherwise)`;
    case 'loopStart':
      return `ForEachRow over ${stage.collectionName}`;
    case 'loopEnd':
      return '(loop boundary)';
    case 'subsheetRef':
      return `InvokeWorkflowFile Pages\\${sanitizeFileName(stage.targetPageName || stage.name)}.xaml`;
    case 'action':
      if (stage.queueName !== undefined || stage.objectName === 'Work Queues') {
        return queueActivityLabel(stage.actionName);
      }
      return `InvokeWorkflowFile Objects\\${sanitizeFileName(stage.objectName)}\\${sanitizeFileName(stage.actionName)}.xaml`;
    case 'exception':
      if (stage.preserve === true) return 'Rethrow';
      return (stage.exceptionType ?? '').toLowerCase().includes('business')
        ? 'Throw BusinessRuleException'
        : 'Throw System.Exception';
    case 'recover':
      return 'TryCatch (catch entry)';
    case 'resume':
      return '(recovery continues)';
    case 'anchor':
      return '(flow pass-through)';
    case 'note':
      return 'ui:Comment';
    case 'alert':
      return 'ui:LogMessage (Info)';
    case 'write':
      return `ui:TypeInto ×${stage.steps.length}`;
    case 'read':
      return `ui:GetText ×${stage.steps.length}`;
    case 'navigate':
      return `ui:Click ×${stage.steps.length}`;
    case 'wait':
      return 'ui:UiElementExists + If (found / timed out)';
    case 'code':
      return stage.language === 'jscript' ? '— (JScript unsupported)' : 'ui:InvokeCode';
    case 'generic':
      return `— (unknown BP stage type "${stage.rawType}")`;
  }
}

/** Selector confidence for stages that target App Modeller elements. */
function selectorConfidence(
  stage: Stage,
  selectorsById: Map<string, GeneratedSelector>,
): number | undefined {
  let elementId: string | undefined;
  if (stage.kind === 'write' || stage.kind === 'read' || stage.kind === 'navigate') {
    elementId = stage.steps[0]?.elementId;
  } else if (stage.kind === 'wait') {
    elementId = stage.conditions[0]?.elementId;
  }
  if (elementId === undefined) return undefined;
  return selectorsById.get(elementId)?.confidence;
}

export function buildConversionView(
  model: AutomationModel,
  owner: ProcessNode | BusinessObjectNode,
  isProcess: boolean,
): ConversionView {
  const conversion = isProcess
    ? convertProcess(model, owner as ProcessNode)
    : convertObject(model, owner as BusinessObjectNode);

  const selectorsById = new Map(
    ('selectors' in conversion ? conversion.selectors : []).map((s) => [s.elementId, s]),
  );

  const notesByStage = new Map<string, string[]>();
  for (const issue of conversion.punchList) {
    const key = `${issue.pageName}::${issue.stageName}`;
    notesByStage.set(key, [...(notesByStage.get(key) ?? []), issue.reason]);
  }

  const rows: StageMappingRow[] = [];
  for (const page of owner.pages) {
    for (const stage of page.stages) {
      const notes = notesByStage.get(`${page.name}::${stage.name}`) ?? [];
      const isManual =
        stage.kind === 'generic' ||
        notes.some((note) => MANUAL_MARKERS.some((marker) => note.includes(marker)));
      const status: StageMappingRow['status'] = isManual
        ? 'manual'
        : notes.length > 0
          ? 'review'
          : 'converted';

      const selConfidence = selectorConfidence(stage, selectorsById);
      const confidence =
        status === 'manual'
          ? 0.2
          : (selConfidence ?? (status === 'review' ? 0.6 : 0.95));

      rows.push({
        pageName: page.name,
        stageId: stage.id,
        stageName: stage.name,
        stageKind: stage.kind,
        uipath: uipathLabel(stage),
        status,
        confidence: Math.round(confidence * 100) / 100,
        notes,
      });
    }
  }

  return {
    rows,
    coveragePct: conversion.coveragePct,
    reviewCount: rows.filter((r) => r.status === 'review').length,
    manualCount: rows.filter((r) => r.status === 'manual').length,
  };
}
