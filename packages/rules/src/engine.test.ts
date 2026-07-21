import { describe, expect, it } from 'vitest';
import type { AutomationModel } from '@prismshift/ir';
import { buildRuleset, defineRule, makeFinding, runRules } from './engine';
import type { RuleMeta } from './engine';

const emptyModel = (): AutomationModel => ({
  meta: { packageName: 'Test', bpVersion: '6.10.1', sourceHash: 'a'.repeat(64) },
  processes: [],
  objects: [],
  workQueues: [],
  environmentVars: [],
  credentialsRefs: [],
  dependencies: [],
});

const meta = (id: string, severity: RuleMeta['severity'] = 'medium'): RuleMeta => ({
  id,
  title: `Rule ${id}`,
  severity,
  category: 'reliability',
  description: 'test rule',
});

/** Deep-freezes so any mutation attempt by a rule throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('defineRule / buildRuleset', () => {
  it('rejects malformed rule ids', () => {
    expect(() => defineRule(meta('SEC1'), () => [])).toThrow(/must match/);
    expect(() => defineRule(meta('sec-001'), () => [])).toThrow(/must match/);
    expect(() => defineRule(meta('SEC-001'), () => [])).not.toThrow();
  });

  it('rejects duplicate rule ids in a ruleset', () => {
    const a = defineRule(meta('SEC-001'), () => []);
    const b = defineRule(meta('SEC-001'), () => []);
    expect(() => buildRuleset([a, b])).toThrow(/Duplicate rule id "SEC-001"/);
  });

  it('returns a frozen ruleset', () => {
    const ruleset = buildRuleset([defineRule(meta('SEC-001'), () => [])]);
    expect(Object.isFrozen(ruleset)).toBe(true);
  });
});

describe('makeFinding', () => {
  it('copies id/severity/category from the rule meta', () => {
    const finding = makeFinding(meta('SEC-002', 'high'), { processId: 'p1' }, 'msg', 'fix');
    expect(finding).toMatchObject({
      ruleId: 'SEC-002',
      severity: 'high',
      category: 'reliability',
      message: 'msg',
      remediation: 'fix',
      confidence: 1,
    });
  });

  it('clamps confidence to [0, 1]', () => {
    expect(makeFinding(meta('SEC-002'), {}, 'm', 'r', 7).confidence).toBe(1);
    expect(makeFinding(meta('SEC-002'), {}, 'm', 'r', -2).confidence).toBe(0);
    expect(makeFinding(meta('SEC-002'), {}, 'm', 'r', 0.4).confidence).toBe(0.4);
  });
});

describe('runRules', () => {
  it('aggregates findings from all rules with per-rule timing', () => {
    const m1 = meta('AAA-001', 'low');
    const m2 = meta('BBB-002', 'critical');
    const ruleset = buildRuleset([
      defineRule(m1, () => [makeFinding(m1, { processId: 'p1' }, 'low issue', 'fix')]),
      defineRule(m2, () => [makeFinding(m2, { processId: 'p1' }, 'critical issue', 'fix')]),
    ]);

    const result = runRules(deepFreeze(emptyModel()), ruleset);

    expect(result.findings).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(result.timings).toEqual([
      { ruleId: 'AAA-001', ms: expect.any(Number) as number, findingCount: 1 },
      { ruleId: 'BBB-002', ms: expect.any(Number) as number, findingCount: 1 },
    ]);
    for (const t of result.timings) expect(t.ms).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('sorts findings by severity, then rule id, then location', () => {
    const low = meta('ZZZ-001', 'low');
    const high = meta('AAA-001', 'high');
    const alsoHigh = meta('BBB-001', 'high');
    const ruleset = buildRuleset([
      defineRule(low, () => [makeFinding(low, { processId: 'p1' }, 'low', 'fix')]),
      defineRule(alsoHigh, () => [
        makeFinding(alsoHigh, { processId: 'p2' }, 'high b2', 'fix'),
        makeFinding(alsoHigh, { processId: 'p1' }, 'high b1', 'fix'),
      ]),
      defineRule(high, () => [makeFinding(high, { processId: 'p9' }, 'high a', 'fix')]),
    ]);

    const { findings } = runRules(emptyModel(), ruleset);
    expect(findings.map((f) => `${f.ruleId}:${f.location.processId ?? ''}`)).toEqual([
      'AAA-001:p9',
      'BBB-001:p1',
      'BBB-001:p2',
      'ZZZ-001:p1',
    ]);
  });

  it('skips disabled rules', () => {
    const m1 = meta('AAA-001');
    const m2 = meta('BBB-002');
    const ruleset = buildRuleset([
      defineRule(m1, () => [makeFinding(m1, {}, 'a', 'fix')]),
      defineRule(m2, () => [makeFinding(m2, {}, 'b', 'fix')]),
    ]);

    const result = runRules(emptyModel(), ruleset, { disabled: ['AAA-001'] });
    expect(result.findings.map((f) => f.ruleId)).toEqual(['BBB-002']);
    expect(result.timings.map((t) => t.ruleId)).toEqual(['BBB-002']);
  });

  it('applies severity overrides to every finding of the rule', () => {
    const m = meta('AAA-001', 'low');
    const ruleset = buildRuleset([defineRule(m, () => [makeFinding(m, {}, 'x', 'fix')])]);

    const result = runRules(emptyModel(), ruleset, {
      severityOverrides: { 'AAA-001': 'critical' },
    });
    expect(result.findings[0]?.severity).toBe('critical');
  });

  it('reports a crashing rule and keeps running the rest', () => {
    const ok = meta('BBB-001');
    const ruleset = buildRuleset([
      defineRule(meta('AAA-001'), () => {
        throw new Error('rule exploded');
      }),
      defineRule(ok, () => [makeFinding(ok, {}, 'still ran', 'fix')]),
    ]);

    const result = runRules(emptyModel(), ruleset);
    expect(result.errors).toEqual([
      { ruleId: 'AAA-001', message: expect.stringContaining('rule exploded') as string },
    ]);
    expect(result.findings.map((f) => f.message)).toEqual(['still ran']);
  });

  it('never mutates the model (rules are pure over a frozen input)', () => {
    const model = deepFreeze(emptyModel());
    const m = meta('AAA-001');
    const ruleset = buildRuleset([
      defineRule(m, (input) => [
        makeFinding(m, {}, `processes: ${input.processes.length}`, 'fix'),
      ]),
    ]);
    expect(() => runRules(model, ruleset)).not.toThrow();
  });

  it('is deterministic across runs', () => {
    const m = meta('AAA-001');
    const ruleset = buildRuleset([
      defineRule(m, () => [
        makeFinding(m, { processId: 'p2' }, 'b', 'fix'),
        makeFinding(m, { processId: 'p1' }, 'a', 'fix'),
      ]),
    ]);
    const a = runRules(emptyModel(), ruleset).findings;
    const b = runRules(emptyModel(), ruleset).findings;
    expect(a).toEqual(b);
  });
});
