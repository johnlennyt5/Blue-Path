import { create } from 'zustand';
import type { Finding } from '@prismshift/ir';
import type { ParseResult } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import { plog } from '../lib/debug';
import { readReleaseFile } from '../lib/fileIntake';
import type { LoadedRelease } from '../lib/fileIntake';
import { parseReleaseXml } from '../lib/parseClient';

/**
 * Local-session state (Local Mode). Holds the loaded export, its parsed IR,
 * and the analysis results in browser memory only — never persisted, never
 * sent anywhere.
 */

export interface AnalysisResult {
  findings: Finding[];
  totalMs: number;
}

export type DetailTab =
  | 'summary'
  | 'vulnerabilities'
  | 'improvements'
  | 'conversion'
  | 'flow'
  | 'structure';

/** Which process/object the user is looking at, and where. */
export interface Selection {
  ownerId: string;
  tab: DetailTab;
  pageId?: string;
  /** Stage to highlight in the flow view (set by finding deep-links). */
  highlightStageId?: string;
}

export interface SessionState {
  loaded: LoadedRelease | null;
  intakeError: string | null;
  /** Large-file chunked-parse progress line (null when idle/small files). */
  parsingProgress: string | null;
  parsing: boolean;
  parseResult: ParseResult | null;
  analysis: AnalysisResult | null;
  selection: Selection | null;

  intakeFile: (file: File) => Promise<void>;
  /** Surface an intake problem detected before a File object even exists. */
  flagIntakeError: (reason: string) => void;
  selectOwner: (ownerId: string | null) => void;
  setTab: (tab: DetailTab) => void;
  /** Deep-link from a finding into the flow view. */
  showInFlow: (ownerId: string, pageId: string, stageId?: string) => void;
  setFlowPage: (pageId: string) => void;
  reset: () => void;
}

export const useSession = create<SessionState>((set) => ({
  loaded: null,
  intakeError: null,
  parsing: false,
  parsingProgress: null,
  parseResult: null,
  analysis: null,
  selection: null,

  intakeFile: async (file: File) => {
    // Whatever goes wrong, the user must see a message — never fail silently.
    plog(`intake started: "${file.name}" (${file.size} B)`);
    try {
      const result = await readReleaseFile(file);
      if (!result.ok) {
        plog(`intake rejected: ${result.reason}`);
        set({
          loaded: null,
          intakeError: result.reason,
          parseResult: null,
          analysis: null,
          selection: null,
          parsing: false,
        });
        return;
      }
      plog(`file read OK — ${result.file.xml.length} chars; parsing…`);
      set({
        loaded: result.file,
        intakeError: null,
        parseResult: null,
        analysis: null,
        selection: null,
        parsing: true,
        parsingProgress: null,
      });
      const parseResult = await parseReleaseXml(result.file.xml, ({ done, total }) => {
        set({ parsingProgress: `Parsing… ${done}/${total} components` });
      });
      plog(
        `parse complete: ${parseResult.model.processes.length} processes, ` +
          `${parseResult.model.objects.length} objects, ` +
          `${parseResult.errors.length} errors, ${parseResult.warnings.length} warnings`,
      );

      const run = runRules(parseResult.model, ALL_RULES);
      plog(`analysis complete: ${run.findings.length} findings in ${run.totalMs.toFixed(1)} ms`);
      set({
        parseResult,
        analysis: { findings: run.findings, totalMs: run.totalMs },
        parsing: false,
        parsingProgress: null,
      });
    } catch (cause) {
      plog(`UNEXPECTED ERROR in intake: ${String(cause)}`);
      set({
        loaded: null,
        intakeError: `Unexpected error while loading "${file.name}": ${String(cause)}`,
        parseResult: null,
        analysis: null,
        selection: null,
        parsing: false,
      });
    }
  },

  flagIntakeError: (reason: string) => {
    plog(`intake flagged: ${reason}`);
    set({ intakeError: reason });
  },

  selectOwner: (ownerId) =>
    set({ selection: ownerId === null ? null : { ownerId, tab: 'summary' } }),

  setTab: (tab) =>
    set((state) => (state.selection ? { selection: { ...state.selection, tab } } : {})),

  showInFlow: (ownerId, pageId, stageId) =>
    set({
      selection: { ownerId, tab: 'flow', pageId, ...(stageId ? { highlightStageId: stageId } : {}) },
    }),

  setFlowPage: (pageId) =>
    set((state) =>
      state.selection
        ? { selection: { ...state.selection, pageId, highlightStageId: undefined } }
        : {},
    ),

  reset: () =>
    set({
      loaded: null,
      intakeError: null,
      parseResult: null,
      analysis: null,
      selection: null,
      parsing: false,
    }),
}));
