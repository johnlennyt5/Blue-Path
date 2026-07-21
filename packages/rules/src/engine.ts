import type {
  AutomationModel,
  Finding,
  FindingCategory,
  FindingSeverity,
  IrLocation,
} from '@prismshift/ir';

// ---------------------------------------------------------------------------
// Rule definition
// ---------------------------------------------------------------------------

export interface RuleMeta {
  /** e.g. "SEC-001" */
  id: string;
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  /** What the rule checks, in one or two sentences. */
  description: string;
}

/**
 * A rule is a pure function over the IR (ARCHITECTURE §5): no I/O, no
 * mutation, deterministic output for a given model.
 */
export type RuleCheck = (model: AutomationModel) => Finding[];

export interface Rule {
  meta: RuleMeta;
  check: RuleCheck;
}

const RULE_ID_PATTERN = /^[A-Z]{3}-\d{3}$/;

export function defineRule(meta: RuleMeta, check: RuleCheck): Rule {
  if (!RULE_ID_PATTERN.test(meta.id)) {
    throw new Error(`Rule id "${meta.id}" must match ${String(RULE_ID_PATTERN)}`);
  }
  return { meta, check };
}

/** Validates a rule collection (unique ids) and freezes it. */
export function buildRuleset(rules: Rule[]): readonly Rule[] {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.meta.id)) {
      throw new Error(`Duplicate rule id "${rule.meta.id}" in ruleset`);
    }
    seen.add(rule.meta.id);
  }
  return Object.freeze([...rules]);
}

/**
 * Helper for rules to construct findings that always agree with their
 * metadata. Confidence is clamped to [0, 1].
 */
export function makeFinding(
  meta: RuleMeta,
  location: IrLocation,
  message: string,
  remediation: string,
  confidence = 1,
): Finding {
  return {
    ruleId: meta.id,
    severity: meta.severity,
    category: meta.category,
    location,
    message,
    remediation,
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface RulesetConfig {
  /** Rule ids to skip entirely. */
  disabled?: string[];
  /** Per-rule severity overrides applied to every finding the rule emits. */
  severityOverrides?: Record<string, FindingSeverity>;
}

export interface RuleTiming {
  ruleId: string;
  ms: number;
  findingCount: number;
}

/** A rule that threw. The run continues; the crash is reported, not hidden. */
export interface RuleExecutionError {
  ruleId: string;
  message: string;
}

export interface RuleRunResult {
  findings: Finding[];
  timings: RuleTiming[];
  errors: RuleExecutionError[];
  totalMs: number;
}

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const locationKey = (l: IrLocation): string =>
  [l.processId ?? '', l.objectId ?? '', l.pageId ?? '', l.stageId ?? '', l.elementId ?? ''].join(
    '/',
  );

/**
 * Runs every enabled rule against the model and aggregates findings with
 * per-rule timing. Deterministic: findings are sorted by severity, then
 * rule id, then location; a crashing rule never aborts the run.
 */
export function runRules(
  model: AutomationModel,
  rules: readonly Rule[],
  config: RulesetConfig = {},
): RuleRunResult {
  const disabled = new Set(config.disabled ?? []);
  const overrides = config.severityOverrides ?? {};

  const findings: Finding[] = [];
  const timings: RuleTiming[] = [];
  const errors: RuleExecutionError[] = [];
  const runStart = performance.now();

  for (const rule of rules) {
    if (disabled.has(rule.meta.id)) continue;

    const start = performance.now();
    let emitted: Finding[] = [];
    try {
      emitted = rule.check(model);
    } catch (cause) {
      errors.push({ ruleId: rule.meta.id, message: String(cause) });
    }
    const ms = performance.now() - start;

    const override = overrides[rule.meta.id];
    if (override !== undefined) {
      emitted = emitted.map((f) => ({ ...f, severity: override }));
    }

    findings.push(...emitted);
    timings.push({ ruleId: rule.meta.id, ms, findingCount: emitted.length });
  }

  // Stable deterministic ordering: severity → ruleId → location → insertion
  const indexed = findings.map((finding, i) => ({ finding, i }));
  indexed.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity];
    if (bySeverity !== 0) return bySeverity;
    const byRule = a.finding.ruleId.localeCompare(b.finding.ruleId);
    if (byRule !== 0) return byRule;
    const byLocation = locationKey(a.finding.location).localeCompare(
      locationKey(b.finding.location),
    );
    if (byLocation !== 0) return byLocation;
    return a.i - b.i;
  });

  return {
    findings: indexed.map((e) => e.finding),
    timings,
    errors,
    totalMs: performance.now() - runStart,
  };
}
