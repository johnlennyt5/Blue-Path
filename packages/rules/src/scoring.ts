/**
 * Scoring (ARCHITECTURE §5.2): per-process score = 100 − Σ severity weights,
 * floored at 0, mapped to letter grades. Grade + finding counts are the only
 * analysis outputs synced in Workspace Mode.
 */
import type { Finding, FindingSeverity } from '@prismshift/ir';

export const SEVERITY_WEIGHTS: Record<FindingSeverity, number> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
  info: 0,
};

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Grade bands: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, E ≥ 50, F < 50. */
export function gradeForScore(score: number): LetterGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

export interface QualityScore {
  score: number;
  grade: LetterGrade;
  findingCount: number;
  bySeverity: Record<FindingSeverity, number>;
}

export function scoreFindings(findings: Finding[]): QualityScore {
  const bySeverity: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  let penalty = 0;
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    penalty += SEVERITY_WEIGHTS[finding.severity];
  }
  const score = Math.max(0, 100 - penalty);
  return { score, grade: gradeForScore(score), findingCount: findings.length, bySeverity };
}

/** Score for one process: only findings located in that process count. */
export function scoreProcess(processId: string, findings: Finding[]): QualityScore {
  return scoreFindings(findings.filter((f) => f.location.processId === processId));
}

/** Score for one business object. */
export function scoreObject(objectId: string, findings: Finding[]): QualityScore {
  return scoreFindings(findings.filter((f) => f.location.objectId === objectId));
}
