/**
 * @prismshift/reports — summaries, audit report + migration report
 * generation (ARCHITECTURE §2, §6).
 */
export const PACKAGE_NAME = '@prismshift/reports';

export { buildMigrationReport, estimateEffortHours } from './migrationReport';
export { buildProcessExport, buildReleaseExport } from './uipathExport';
export type { ProcessExport, ReleaseExport } from './uipathExport';
export { assertNoValuesSurvive, buildAiDigest, extractRefs } from './redact';
export type { AiDigest, DigestOwner, DigestPage, DigestStage } from './redact';
export { buildRecommendations, recommendationCoverage } from './recommendations';
export type { Recommendation } from './recommendations';
export { stepSentence, summarizeObject, summarizeProcess } from './summary';
export type {
  ExceptionStrategy,
  ObjectSummary,
  PageOutline,
  ProcessSummary,
  SensitivityFlag,
} from './summary';
