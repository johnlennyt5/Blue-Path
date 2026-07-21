/**
 * @prismshift/corpus — synthetic .bprelease samples + JSON answer keys
 * + corpus test harness (ARCHITECTURE §10).
 *
 * Samples are hand-authored to the Blue Prism 6.x export schema. They are the
 * project's ground truth until validated against sanitized real exports
 * (S8-6 protocol). This package is consumed by other packages' test suites
 * (Node only — the loader uses node:fs).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AnswerKey } from './types';

export const PACKAGE_NAME = '@prismshift/corpus';

export type * from './types';

export interface CorpusSampleRef {
  id: string;
  title: string;
}

/** Registry of all corpus samples, in numbering order. */
export const SAMPLES: CorpusSampleRef[] = [
  { id: '01-clean-and-simple', title: 'Clean & Simple' },
  { id: '02-realistic-mid-size', title: 'Realistic Mid-Size' },
  { id: '03-the-monolith', title: 'The Monolith' },
  { id: '04-edge-cases', title: 'Edge Cases' },
];

export interface LoadedSample {
  ref: CorpusSampleRef;
  /** Raw .bprelease XML, exactly as a user would drag into the app. */
  xml: string;
  answerKey: AnswerKey;
}

const samplesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');

/** Loads a sample's XML and answer key from the samples directory. */
export async function loadSample(id: string): Promise<LoadedSample> {
  const ref = SAMPLES.find((s) => s.id === id);
  if (!ref) {
    throw new Error(`Unknown corpus sample "${id}". Known: ${SAMPLES.map((s) => s.id).join(', ')}`);
  }
  const answerKey = JSON.parse(
    await readFile(path.join(samplesDir, `${id}.answer-key.json`), 'utf8'),
  ) as AnswerKey;
  const xml = await readFile(path.join(samplesDir, answerKey.file), 'utf8');
  return { ref, xml, answerKey };
}
