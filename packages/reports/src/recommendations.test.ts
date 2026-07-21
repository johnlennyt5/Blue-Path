import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import { buildRecommendations, recommendationCoverage } from './recommendations';

async function analyzed(sampleId: string) {
  const { xml } = await loadSample(sampleId);
  const { model } = await parseBpRelease(xml);
  const { findings } = runRules(model, ALL_RULES);
  return { model, findings };
}

describe('buildRecommendations', () => {
  it('maps the Monolith process findings to structural recommendations', async () => {
    const { model, findings } = await analyzed('03-the-monolith');
    const process = model.processes[0]!;
    const recs = buildRecommendations(model, findings, process.id);

    const ids = recs.map((r) => r.id);
    expect(ids).toContain('REC-REFRAMEWORK-EXCEPTIONS'); // REL-001
    expect(ids).toContain('REC-BOUNDED-RETRIES'); // REL-002
    expect(ids).toContain('REC-DISPATCHER-PERFORMER'); // MNT-004
    expect(ids).toContain('REC-DELETE-DEAD-LOGIC'); // MNT-001 ×2
    expect(ids).toContain('REC-CREDENTIAL-MANAGER'); // SEC-002
    expect(ids).toContain('REC-MASK-PII-LOGS'); // SEC-003
    expect(ids).toContain('REC-EXTERNALIZE-CONFIG'); // SEC-004
    expect(ids).toContain('REC-ENCRYPT-QUEUES'); // CMP-001
    expect(ids).toContain('REC-DOCUMENT-PROCESSES'); // CMP-002

    // Every process finding is addressed by some recommendation
    const coverage = recommendationCoverage(findings, process.id);
    expect(coverage.covered).toBe(coverage.total);
    expect(coverage.total).toBe(10);

    // Severity mirrors the worst triggering finding (badge colors match tab)
    expect(recs.find((r) => r.id === 'REC-REFRAMEWORK-EXCEPTIONS')!.severity).toBe('high');
    expect(recs.find((r) => r.id === 'REC-DOCUMENT-PROCESSES')!.severity).toBe('info');

    const retries = recs.find((r) => r.id === 'REC-BOUNDED-RETRIES')!;
    expect(retries.rationale).toContain('Refresh Session');

    const deadLogic = recs.find((r) => r.id === 'REC-DELETE-DEAD-LOGIC')!;
    expect(deadLogic.findingCount).toBe(2);
    expect(deadLogic.rationale).toContain('Legacy Adjustment');
    expect(deadLogic.rationale).toContain('Orphaned Utilities');

    // High-severity reliability recs sort before medium maintainability ones
    expect(ids.indexOf('REC-REFRAMEWORK-EXCEPTIONS')).toBeLessThan(
      ids.indexOf('REC-DISPATCHER-PERFORMER'),
    );
  });

  it('recommends pruning for the Dispatcher and clone consolidation for the estate', async () => {
    const { model, findings } = await analyzed('02-realistic-mid-size');
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const dispatcherRecs = buildRecommendations(model, findings, dispatcher.id);
    // Critical credential rec first, then the low-severity pruning rec
    expect(dispatcherRecs.map((r) => r.id)).toEqual(['REC-CREDENTIAL-MANAGER', 'REC-PRUNE-DATA']);
    expect(dispatcherRecs[0]!.severity).toBe('critical');
    expect(dispatcherRecs[0]!.ruleSeverities).toEqual({ 'SEC-001': 'critical' });
    expect(dispatcherRecs[1]!.rationale).toContain('Temp Counter');

    const vbo = model.objects[0]!;
    const vboRecs = buildRecommendations(model, findings, vbo.id);
    expect(vboRecs.map((r) => r.id)).toEqual(['REC-TIMEOUTS']);
    expect(vboRecs[0]!.rationale).toContain('Wait For Confirmation');
  });

  it('covers clone consolidation and selector rework on the Monolith objects', async () => {
    const { model, findings } = await analyzed('03-the-monolith');

    const vbo1 = model.objects.find((o) => o.name === 'Ledger Terminal VBO')!;
    expect(buildRecommendations(model, findings, vbo1.id).map((r) => r.id)).toEqual([
      'REC-STABLE-SELECTORS',
    ]);

    const clone = model.objects.find((o) => o.name === 'Ledger Terminal VBO v2')!;
    const cloneRecs = buildRecommendations(model, findings, clone.id);
    expect(cloneRecs.map((r) => r.id)).toEqual(['REC-SHARED-LIBRARY']);
  });

  it('returns nothing for clean processes', async () => {
    const { model, findings } = await analyzed('01-clean-and-simple');
    expect(buildRecommendations(model, findings, model.processes[0]!.id)).toEqual([]);
  });

  it('is deterministic', async () => {
    const { model, findings } = await analyzed('03-the-monolith');
    expect(buildRecommendations(model, findings)).toEqual(buildRecommendations(model, findings));
  });
});
