import { proxy, wrap } from 'comlink';
import type { Remote } from 'comlink';
import { parseBpRelease } from '@prismshift/parser';
import type { ParseProgress, ParseResult } from '@prismshift/parser';
import type { ParserWorkerApi } from '../workers/parser.worker';
import { plog } from './debug';

let remote: Remote<ParserWorkerApi> | null = null;

/**
 * Parses release XML in a Web Worker so the UI thread never blocks during
 * parse. Falls back to main-thread parsing where Workers don't exist
 * (unit tests / very old environments) — same result either way.
 */
export async function parseReleaseXml(
  xml: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  if (typeof Worker === 'undefined') {
    plog('Web Worker unavailable — parsing on the main thread');
    return parseBpRelease(xml, { onProgress });
  }
  if (!remote) {
    const worker = new Worker(new URL('../workers/parser.worker.ts', import.meta.url), {
      type: 'module',
    });
    remote = wrap<ParserWorkerApi>(worker);
    plog('parser worker started');
  }
  return remote.parse(xml, onProgress !== undefined ? proxy(onProgress) : undefined);
}
