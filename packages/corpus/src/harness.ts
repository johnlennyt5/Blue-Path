import type { AutomationModel, Finding } from '@prismshift/ir';
import type { AnswerKey, ExpectedFinding } from './types';

/** An actual finding resolved back to human-readable names for comparison. */
export interface ResolvedFinding {
  ruleId: string;
  processName?: string;
  objectName?: string;
  pageName?: string;
  stageName?: string;
  elementName?: string;
  message: string;
}

export interface FindingDiff {
  /** Expected by the answer key but not reported. CI must fail on any. */
  missed: ExpectedFinding[];
  /** Reported but not in the answer key — false positives. CI must fail on any. */
  unexpected: ResolvedFinding[];
}

function resolve(model: AutomationModel, finding: Finding): ResolvedFinding {
  const { location } = finding;
  const owner =
    model.processes.find((p) => p.id === location.processId) ??
    model.objects.find((o) => o.id === location.objectId);

  const resolved: ResolvedFinding = { ruleId: finding.ruleId, message: finding.message };
  if (owner) {
    if (location.processId !== undefined) resolved.processName = owner.name;
    else resolved.objectName = owner.name;

    const page = owner.pages.find((p) => p.id === location.pageId);
    if (page) {
      resolved.pageName = page.name;
      const stage = page.stages.find((s) => s.id === location.stageId);
      if (stage) resolved.stageName = stage.name;
    }

    if (location.elementId !== undefined && 'appModel' in owner) {
      const element = owner.appModel?.elements.find((e) => e.id === location.elementId);
      if (element) resolved.elementName = element.name;
    }
  }
  return resolved;
}

const matches = (actual: ResolvedFinding, expected: ExpectedFinding): boolean =>
  actual.ruleId === expected.ruleId &&
  actual.processName === expected.processName &&
  actual.objectName === expected.objectName &&
  actual.pageName === expected.pageName &&
  actual.stageName === expected.stageName &&
  actual.elementName === expected.elementName;

/**
 * Diffs actual findings against the answer key. Both directions matter:
 * a missed expectation OR an extra finding fails CI (ARCHITECTURE §10).
 *
 * Pass `ruleIds` to restrict the comparison to rules that are implemented
 * so far — expected findings for other rules are ignored, but every actual
 * finding is always checked against the key.
 */
export function diffFindings(
  model: AutomationModel,
  findings: Finding[],
  answerKey: AnswerKey,
  options: { ruleIds?: string[] } = {},
): FindingDiff {
  const scope = options.ruleIds ? new Set(options.ruleIds) : null;
  const remaining = answerKey.expectedFindings.filter(
    (e) => scope === null || scope.has(e.ruleId),
  );
  const unexpected: ResolvedFinding[] = [];

  for (const finding of findings) {
    const resolved = resolve(model, finding);
    const index = remaining.findIndex((e) => matches(resolved, e));
    if (index === -1) {
      unexpected.push(resolved);
    } else {
      remaining.splice(index, 1);
    }
  }

  return { missed: remaining, unexpected };
}
