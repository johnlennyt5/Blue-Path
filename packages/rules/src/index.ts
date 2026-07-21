/**
 * @prismshift/rules — vulnerability & quality rules engine.
 * Each rule is a pure function over the IR (ARCHITECTURE §5).
 */
export const PACKAGE_NAME = '@prismshift/rules';

import { CMP_RULES } from './compliance';
import { buildRuleset } from './engine';
import { MNT_RULES } from './maintenance';
import { REL_RULES } from './reliability';
import { SEC_RULES } from './security';

export {
  buildRuleset,
  defineRule,
  makeFinding,
  runRules,
  SEVERITY_RANK,
} from './engine';
export type {
  Rule,
  RuleCheck,
  RuleExecutionError,
  RuleMeta,
  RuleRunResult,
  RuleTiming,
  RulesetConfig,
} from './engine';
export {
  SEVERITY_WEIGHTS,
  gradeForScore,
  scoreFindings,
  scoreObject,
  scoreProcess,
} from './scoring';
export type { LetterGrade, QualityScore } from './scoring';
export { SENSITIVE_NAME } from './helpers';
export { SEC_RULES } from './security';
export { REL_RULES } from './reliability';
export { MNT_RULES, objectSimilarity } from './maintenance';
export { CMP_RULES } from './compliance';

/** The complete v1 rule catalog (ARCHITECTURE §5.1). */
export const ALL_RULES = buildRuleset([...SEC_RULES, ...REL_RULES, ...MNT_RULES, ...CMP_RULES]);
