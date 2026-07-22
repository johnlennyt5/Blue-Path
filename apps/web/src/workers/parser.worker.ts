/// <reference lib="webworker" />
/**
 * Parser Web Worker: runs parseBpRelease off the main thread so the UI
 * stays responsive during large parses (ARCHITECTURE §9, S1-7).
 */
import { expose } from 'comlink';
import { parseBpRelease } from '@prismshift/parser';
import type { ParseProgress } from '@prismshift/parser';

/** §12 guard: refuse anything beyond the supported ceiling outright. */
const MAX_XML_CHARS = 50 * 1024 * 1024;

const api = {
  parse: async (xml: string, onProgress?: (progress: ParseProgress) => void) => {
    if (xml.length > MAX_XML_CHARS) {
      return {
        model: null as never,
        warnings: [],
        errors: [
          {
            message: `Export is ${(xml.length / 1024 / 1024).toFixed(1)} MB — the supported maximum is 50 MB. Split the release in Blue Prism and export in parts.`,
          },
        ],
      };
    }
    try {
      return await parseBpRelease(xml, { onProgress });
    } catch (cause) {
      // OOM and other hard failures become an honest error, not a dead worker.
      return {
        model: null as never,
        warnings: [],
        errors: [
          {
            message: `Parse failed (possibly out of memory for this export size): ${String(cause)}`,
          },
        ],
      };
    }
  },
};

export type ParserWorkerApi = typeof api;

expose(api);
