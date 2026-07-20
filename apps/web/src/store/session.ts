import { create } from 'zustand';
import type { ParseResult } from '@prismshift/parser';
import { plog } from '../lib/debug';
import { readReleaseFile } from '../lib/fileIntake';
import type { LoadedRelease } from '../lib/fileIntake';
import { parseReleaseXml } from '../lib/parseClient';

/**
 * Local-session state (Local Mode). Holds the loaded export and its parsed
 * IR in browser memory only — never persisted, never sent anywhere.
 *
 * Parsing currently runs on the main thread; S1-7 moves it into a Web
 * Worker.
 */
export interface SessionState {
  loaded: LoadedRelease | null;
  intakeError: string | null;
  parsing: boolean;
  parseResult: ParseResult | null;
  intakeFile: (file: File) => Promise<void>;
  /** Surface an intake problem detected before a File object even exists. */
  flagIntakeError: (reason: string) => void;
  reset: () => void;
}

export const useSession = create<SessionState>((set) => ({
  loaded: null,
  intakeError: null,
  parsing: false,
  parseResult: null,

  intakeFile: async (file: File) => {
    // Whatever goes wrong, the user must see a message — never fail silently.
    plog(`intake started: "${file.name}" (${file.size} B)`);
    try {
      const result = await readReleaseFile(file);
      if (!result.ok) {
        plog(`intake rejected: ${result.reason}`);
        set({ loaded: null, intakeError: result.reason, parseResult: null, parsing: false });
        return;
      }
      plog(`file read OK — ${result.file.xml.length} chars; parsing…`);
      set({ loaded: result.file, intakeError: null, parseResult: null, parsing: true });
      const parseResult = await parseReleaseXml(result.file.xml);
      plog(
        `parse complete: ${parseResult.model.processes.length} processes, ` +
          `${parseResult.model.objects.length} objects, ` +
          `${parseResult.errors.length} errors, ${parseResult.warnings.length} warnings`,
      );
      set({ parseResult, parsing: false });
    } catch (cause) {
      plog(`UNEXPECTED ERROR in intake: ${String(cause)}`);
      set({
        loaded: null,
        intakeError: `Unexpected error while loading "${file.name}": ${String(cause)}`,
        parseResult: null,
        parsing: false,
      });
    }
  },

  flagIntakeError: (reason: string) => {
    plog(`intake flagged: ${reason}`);
    set({ intakeError: reason });
  },

  reset: () => set({ loaded: null, intakeError: null, parseResult: null, parsing: false }),
}));
