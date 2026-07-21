import { describe, expect, it } from 'vitest';
import { SAMPLES, loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import type { Finding, FindingSeverity } from '@prismshift/ir';
import { ALL_RULES, runRules } from './index';
import { gradeForScore, scoreFindings, scoreObject, scoreProcess } from './scoring';

const finding = (severity: FindingSeverity, processId = 'p1'): Finding => ({
  ruleId: 'TST-001',
  severity,
  category: 'reliability',
  location: { processId },
  message: 'm',
  remediation: 'r',
  confidence: 1,
});

describe('scoring math (§5.2)', () => {
  it('scores 100/A with no findings', () => {
    expect(scoreFindings([])).toEqual({
      score: 100,
      grade: 'A',
      findingCount: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    });
  });

  it('applies severity weights: critical 25, high 10, medium 4, low 1, info 0', () => {
    const result = scoreFindings([
      finding('critical'),
      finding('high'),
      finding('medium'),
      finding('low'),
      finding('info'),
    ]);
    expect(result.score).toBe(100 - 25 - 10 - 4 - 1);
    expect(result.findingCount).toBe(5);
    expect(result.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1, info: 1 });
  });

  it('floors at 0', () => {
    expect(scoreFindings(Array.from({ length: 6 }, () => finding('critical'))).score).toBe(0);
  });

  it('maps grade bands at their boundaries', () => {
    expect(gradeForScore(100)).toBe('A');
    expect(gradeForScore(90)).toBe('A');
    expect(gradeForScore(89)).toBe('B');
    expect(gradeForScore(80)).toBe('B');
    expect(gradeForScore(70)).toBe('C');
    expect(gradeForScore(60)).toBe('D');
    expect(gradeForScore(50)).toBe('E');
    expect(gradeForScore(49)).toBe('F');
    expect(gradeForScore(0)).toBe('F');
  });

  it('scopes process/object scores to their own findings', () => {
    const findings = [finding('critical', 'p1'), finding('high', 'p2')];
    expect(scoreProcess('p1', findings).score).toBe(75);
    expect(scoreProcess('p2', findings).score).toBe(90);
    expect(scoreObject('o1', findings).score).toBe(100);
  });
});

/** Golden per-corpus-file scores — §5.2 math applied to the full catalog. */
const GOLDEN: Record<string, { processes: [string, number, string][]; objects: [string, number, string][] }> = {
  '01-clean-and-simple': {
    processes: [['Loan Payment Calculator', 100, 'A']],
    objects: [],
  },
  '02-realistic-mid-size': {
    // SEC-001 (25) + MNT-002 (1) = 26 penalty on the dispatcher
    processes: [
      ['Invoice Dispatcher', 74, 'C'],
      ['Invoice Performer', 100, 'A'],
    ],
    objects: [['Invoice Entry VBO', 96, 'A']], // REL-003 (4)
  },
  '03-the-monolith': {
    // 4×high(SEC-002,SEC-003,REL-001,REL-002) + CMP-001 high + 4×medium
    // (SEC-004, MNT-001×2, MNT-004) + CMP-002 info = 50+16 = 66 penalty
    processes: [['Customer Account Reconciliation', 34, 'F']],
    objects: [
      ['Ledger Terminal VBO', 96, 'A'], // REL-004 (4)
      ['Ledger Terminal VBO v2', 96, 'A'], // MNT-003 (4)
      ['Ledger Terminal VBO Copy', 96, 'A'], // MNT-003 (4)
    ],
  },
  '04-edge-cases': {
    processes: [['Edge Case Gauntlet', 100, 'A']],
    objects: [['Multi Mode VBO', 100, 'A']],
  },
};

describe.each(SAMPLES)('corpus scores · $id', (sampleRef) => {
  it('matches the golden score and grade per process/object', async () => {
    const { xml } = await loadSample(sampleRef.id);
    const { model } = await parseBpRelease(xml);
    const { findings } = runRules(model, ALL_RULES);

    const golden = GOLDEN[sampleRef.id];
    expect(golden, `golden entry for ${sampleRef.id}`).toBeDefined();

    const processScores = model.processes.map((p) => {
      const s = scoreProcess(p.id, findings);
      return [p.name, s.score, s.grade];
    });
    const objectScores = model.objects.map((o) => {
      const s = scoreObject(o.id, findings);
      return [o.name, s.score, s.grade];
    });

    expect(processScores).toEqual(golden!.processes);
    expect(objectScores).toEqual(golden!.objects);
  });
});
