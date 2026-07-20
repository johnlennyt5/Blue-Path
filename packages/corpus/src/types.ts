import type { FindingSeverity } from '@prismshift/ir';

/**
 * Machine-readable ground truth shipped beside every corpus sample.
 * CI fails on any missed expectation OR any false positive
 * (ARCHITECTURE §10).
 */
export interface AnswerKey {
  id: string;
  /** File name of the .bprelease sample, relative to the samples directory. */
  file: string;
  description: string;
  expectedParse: ExpectedParse;
  expectedFindings: ExpectedFinding[];
  notes?: string;
}

export interface ExpectedParse {
  errors: number;
  warnings: number;
  bpVersion: string;
  packageName: string;
  counts: {
    processes: number;
    objects: number;
    workQueues: number;
    environmentVars: number;
    credentialRefs: number;
  };
  processes: ExpectedProcessStats[];
  objects: ExpectedObjectStats[];
}

export interface ExpectedProcessStats {
  name: string;
  /** Page names in document order (main page first). */
  pages: string[];
  stageCount: number;
  dataItemCount: number;
  startupParams: string[];
  outputs: string[];
  /** Count per IR stage kind; the sum must equal stageCount. */
  stageKinds: Record<string, number>;
}

export interface ExpectedObjectStats {
  name: string;
  applicationName?: string;
  appElementCount?: number;
  /** Action page names in document order. */
  pages: string[];
  stageCount: number;
  dataItemCount: number;
  /** Count per IR stage kind; the sum must equal stageCount. */
  stageKinds: Record<string, number>;
}

export interface ExpectedFinding {
  ruleId: string;
  severity: FindingSeverity;
  /** Process the finding must be located in (exactly one of processName/objectName). */
  processName?: string;
  /** Business object the finding must be located in. */
  objectName?: string;
  /** Page the finding must point at (omit for process-level findings). */
  pageName?: string;
  /** Stage name the finding must point at (omit for page/process-level findings). */
  stageName?: string;
}
