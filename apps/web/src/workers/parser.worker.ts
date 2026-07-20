/// <reference lib="webworker" />
/**
 * Parser Web Worker: runs parseBpRelease off the main thread so the UI
 * stays responsive during large parses (ARCHITECTURE §9, S1-7).
 */
import { expose } from 'comlink';
import { parseBpRelease } from '@prismshift/parser';

const api = {
  parse: (xml: string) => parseBpRelease(xml),
};

export type ParserWorkerApi = typeof api;

expose(api);
