/**
 * Chunked release parsing (S8-1, ARCHITECTURE §12): large .bprelease files
 * are parsed component-by-component instead of as one giant document, so
 * peak memory is bounded by the largest single component (not the whole
 * file), progress is reportable, and the worker yields to its event loop
 * between components.
 *
 * Approach: a depth-aware scanner (CDATA/comment/PI safe) finds the direct
 * children of <bpr:contents>; batches of children are wrapped back into a
 * minimal release document and run through the ordinary single-pass parser;
 * results are merged with source-path indices rewritten from batch-local to
 * global, so a chunked parse is byte-identical to a whole parse.
 */
import type { AutomationModel } from '@prismshift/ir';
import { buildDependencyGraph } from '@prismshift/ir';
import type { ParseIssue, ParseResult } from './parse';

export interface ParseProgress {
  done: number;
  total: number;
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void;
  /** Releases larger than this many characters parse component-by-component. */
  chunkThreshold?: number;
}

interface TopLevelElement {
  tag: string;
  start: number;
  end: number;
}

/** Direct children of the container span, ignoring CDATA/comments/PIs. */
export function scanTopLevelElements(xml: string, from: number, to: number): TopLevelElement[] {
  const elements: TopLevelElement[] = [];
  let i = from;
  let depth = 0;
  let currentStart = -1;
  let currentTag = '';

  while (i < to) {
    const lt = xml.indexOf('<', i);
    if (lt === -1 || lt >= to) break;

    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      i = end === -1 ? to : end + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      i = end === -1 ? to : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      i = end === -1 ? to : end + 1;
      continue;
    }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) break;

    if (xml[lt + 1] === '/') {
      depth -= 1;
      if (depth === 0 && currentStart !== -1) {
        elements.push({ tag: currentTag, start: currentStart, end: gt + 1 });
        currentStart = -1;
      }
    } else {
      const selfClosing = xml[gt - 1] === '/';
      if (depth === 0) {
        const nameEnd = Math.min(
          ...[xml.indexOf(' ', lt), xml.indexOf('>', lt), xml.indexOf('/', lt + 1)].filter(
            (n) => n !== -1,
          ),
        );
        const tag = xml.slice(lt + 1, nameEnd);
        if (selfClosing) {
          elements.push({ tag, start: lt, end: gt + 1 });
        } else {
          currentStart = lt;
          currentTag = tag;
          depth = 1;
        }
      } else if (!selfClosing) {
        depth += 1;
      }
    }
    i = gt + 1;
  }
  return elements;
}

/** Rewrite `/bpr:release/bpr:contents/<tag>[local]` prefixes to global indices. */
function rewritePaths(value: unknown, from: string, to: string): void {
  if (Array.isArray(value)) {
    for (const item of value) rewritePaths(item, from, to);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['path'] === 'string' && record['path'].startsWith(from)) {
      record['path'] = to + record['path'].slice(from.length);
    }
    for (const child of Object.values(record)) rewritePaths(child, from, to);
  }
}

const prefixFor = (tag: string, index: number): string =>
  `/bpr:release/bpr:contents/${tag}[${index}]`;

const MAX_BATCH_CHARS = 4 * 1024 * 1024;
const MAX_BATCH_ELEMENTS = 32;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function parseChunkedRelease(
  xml: string,
  sourceHash: string,
  options: ParseOptions,
  parseCore: (xml: string, sourceHash: string) => ParseResult,
): Promise<ParseResult> {
  const contentsOpen = xml.indexOf('<bpr:contents');
  const contentsOpenEnd = contentsOpen === -1 ? -1 : xml.indexOf('>', contentsOpen);
  const contentsClose = xml.lastIndexOf('</bpr:contents>');
  if (contentsOpen === -1 || contentsOpenEnd === -1 || contentsClose === -1) {
    return parseCore(xml, sourceHash); // unexpected shape — fall back to whole parse
  }

  const prefix = xml.slice(0, contentsOpenEnd + 1);
  const suffix = xml.slice(contentsClose);
  const elements = scanTopLevelElements(xml, contentsOpenEnd + 1, contentsClose);
  if (elements.length === 0) return parseCore(xml, sourceHash);

  const merged: ParseResult = {
    model: {
      meta: { packageName: '', bpVersion: '', sourceHash },
      processes: [],
      objects: [],
      workQueues: [],
      environmentVars: [],
      credentialsRefs: [],
      dependencies: [],
    } as AutomationModel,
    warnings: [],
    errors: [],
  };
  const counters: Record<string, number> = {};

  let batch: TopLevelElement[] = [];
  let batchChars = 0;
  let done = 0;

  const flush = (batchElements: TopLevelElement[]): void => {
    if (batchElements.length === 0) return;
    const body = batchElements.map((e) => xml.slice(e.start, e.end)).join('\n');
    const chunk = parseCore(`${prefix}\n${body}\n${suffix}`, sourceHash);

    // Rewrite batch-local indices to global ones, per top-level tag.
    const locals: Record<string, number> = {};
    const rewrites: { from: string; to: string }[] = [];
    const nodeLists: unknown[][] = [
      chunk.model.processes,
      chunk.model.objects,
      chunk.model.workQueues,
      chunk.model.environmentVars,
    ];
    for (const element of batchElements) {
      locals[element.tag] = (locals[element.tag] ?? 0) + 1;
      counters[element.tag] = (counters[element.tag] ?? 0) + 1;
      if (locals[element.tag] !== counters[element.tag]) {
        rewrites.push({
          from: prefixFor(element.tag, locals[element.tag]!),
          to: prefixFor(element.tag, counters[element.tag]!),
        });
      }
    }
    // Descending local order: a rewritten global index can never collide
    // with a later (smaller) local index still waiting to be rewritten.
    for (const { from, to } of rewrites.reverse()) {
      for (const list of nodeLists) rewritePaths(list, from, to);
      for (const issues of [chunk.warnings, chunk.errors]) {
        for (const issue of issues as ParseIssue[]) {
          if (issue.path !== undefined && issue.path.startsWith(from)) {
            issue.path = to + issue.path.slice(from.length);
          }
        }
      }
    }

    if (merged.model.meta.packageName === '') {
      merged.model.meta.packageName = chunk.model.meta.packageName;
    }
    if (merged.model.meta.bpVersion === '') {
      merged.model.meta.bpVersion = chunk.model.meta.bpVersion;
    }
    if (merged.model.meta.exportDate === undefined && chunk.model.meta.exportDate !== undefined) {
      merged.model.meta.exportDate = chunk.model.meta.exportDate;
    }
    merged.model.processes.push(...chunk.model.processes);
    merged.model.objects.push(...chunk.model.objects);
    merged.model.workQueues.push(...chunk.model.workQueues);
    merged.model.environmentVars.push(...chunk.model.environmentVars);
    merged.model.credentialsRefs.push(...chunk.model.credentialsRefs);
    merged.warnings.push(...chunk.warnings);
    merged.errors.push(...chunk.errors);
  };

  for (const element of elements) {
    batch.push(element);
    batchChars += element.end - element.start;
    if (batch.length >= MAX_BATCH_ELEMENTS || batchChars >= MAX_BATCH_CHARS) {
      flush(batch);
      done += batch.length;
      options.onProgress?.({ done, total: elements.length });
      batch = [];
      batchChars = 0;
      await yieldToEventLoop();
    }
  }
  flush(batch);
  done += batch.length;
  options.onProgress?.({ done, total: elements.length });

  merged.model.dependencies = buildDependencyGraph(merged.model);
  return merged;
}
