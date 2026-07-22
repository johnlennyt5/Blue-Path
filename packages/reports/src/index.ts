/**
 * @prismshift/reports — summaries, audit report + migration report
 * generation (ARCHITECTURE §2, §6).
 */
export const PACKAGE_NAME = '@prismshift/reports';

export { buildMigrationReport } from './migrationReport';
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
