import { describe, expect, it } from 'vitest';
import { SAMPLES, diffFindings, loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from './index';

/**
 * The corpus contract (ARCHITECTURE §10): every implemented rule must catch
 * every planted trigger AND produce zero false positives on every sample.
 * As rule families land, they join ALL_RULES and are automatically held to
 * the answer keys here.
 */
const IMPLEMENTED_RULE_IDS = ALL_RULES.map((r) => r.meta.id);

describe.each(SAMPLES)('rule catalog vs corpus sample $id', (sampleRef) => {
  it('catches every planted finding for implemented rules, with zero false positives', async () => {
    const { xml, answerKey } = await loadSample(sampleRef.id);
    const { model, errors } = await parseBpRelease(xml);
    expect(errors).toEqual([]);

    const result = runRules(model, ALL_RULES);
    expect(result.errors, 'no rule may crash').toEqual([]);

    const diff = diffFindings(model, result.findings, answerKey, {
      ruleIds: IMPLEMENTED_RULE_IDS,
    });
    expect(diff.unexpected, `false positives on ${sampleRef.id}`).toEqual([]);
    expect(diff.missed, `missed findings on ${sampleRef.id}`).toEqual([]);
  });
});
