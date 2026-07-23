import { create } from 'zustand';
import type { AutomationModel } from '@prismshift/ir';
import { buildAiDigest } from '@prismshift/reports';
import { plog } from '../lib/debug';
import { getSupabase } from '../lib/supabaseClient';
import {
  requestNarrative,
  requestNarrativeFromCustomEndpoint,
} from '../lib/aiNarrative';
import {
  requestCodeTranslation,
  requestCodeTranslationFromCustomEndpoint,
} from '../lib/codeTranslate';
import { useWorkspaceStore } from './workspace';

/**
 * AI narrative state (S7-3). OFF by default — nothing here runs, and no
 * digest is even built, until the user flips the toggle and clicks Generate.
 */

export type AiTransport = 'workspace' | 'custom';

export interface CodeSuggestion {
  stageName: string;
  original: string;
  originalLanguage: string;
  suggestion: string;
  status: 'proposed' | 'accepted' | 'declined';
}

export interface AiState {
  /** The explicit opt-in. Default false, never persisted. */
  enabled: boolean;
  transport: AiTransport;
  customEndpoint: string;
  /** Generated narratives per owner id (session memory only). */
  narratives: Record<string, string>;
  /** BL-005: per stage id — suggestion + accept/decline state. */
  codeSuggestions: Record<string, CodeSuggestion>;
  busy: boolean;
  error: string | null;

  setEnabled: (enabled: boolean) => void;
  setTransport: (transport: AiTransport) => void;
  setCustomEndpoint: (endpoint: string) => void;
  generate: (model: AutomationModel, ownerId: string, ownerName: string) => Promise<void>;
  suggestCode: (stageId: string, stageName: string, language: string, code: string) => Promise<void>;
  acceptSuggestion: (stageId: string) => void;
  declineSuggestion: (stageId: string) => void;
}

/** Accepted overrides for the converter (stage id → VB.NET code). */
export function acceptedCodeOverrides(
  suggestions: Record<string, CodeSuggestion>,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [stageId, suggestion] of Object.entries(suggestions)) {
    if (suggestion.status === 'accepted') overrides[stageId] = suggestion.suggestion;
  }
  return overrides;
}

export const useAiStore = create<AiState>((set, get) => ({
  enabled: false,
  transport: 'workspace',
  customEndpoint: '',
  narratives: {},
  codeSuggestions: {},
  busy: false,
  error: null,

  setEnabled: (enabled) => set({ enabled, error: null }),
  setTransport: (transport) => set({ transport, error: null }),
  setCustomEndpoint: (customEndpoint) => set({ customEndpoint }),

  suggestCode: async (stageId, stageName, language, code) => {
    const { enabled, transport, customEndpoint } = get();
    if (!enabled) return;
    set({ busy: true, error: null });
    try {
      let suggestion: string;
      if (transport === 'custom') {
        if (customEndpoint.trim() === '') throw new Error('enter a custom endpoint URL');
        suggestion = await requestCodeTranslationFromCustomEndpoint(customEndpoint.trim(), {
          stageName,
          language,
          code,
        });
      } else {
        const sb = getSupabase();
        const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        if (sb === null || workspaceId === null) {
          throw new Error(
            'Workspace transport needs a signed-in workspace — or switch to a custom endpoint',
          );
        }
        suggestion = await requestCodeTranslation(sb, workspaceId, { stageName, language, code });
      }
      set({
        codeSuggestions: {
          ...get().codeSuggestions,
          [stageId]: { stageName, original: code, originalLanguage: language, suggestion, status: 'proposed' },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plog(`code suggestion failed: ${message}`);
      set({ error: message });
    } finally {
      set({ busy: false });
    }
  },

  acceptSuggestion: (stageId) => {
    const existing = get().codeSuggestions[stageId];
    if (existing === undefined) return;
    set({
      codeSuggestions: { ...get().codeSuggestions, [stageId]: { ...existing, status: 'accepted' } },
    });
    plog(`code suggestion accepted for stage ${stageId}`);
  },

  declineSuggestion: (stageId) => {
    const existing = get().codeSuggestions[stageId];
    if (existing === undefined) return;
    set({
      codeSuggestions: { ...get().codeSuggestions, [stageId]: { ...existing, status: 'declined' } },
    });
  },

  generate: async (model, ownerId, ownerName) => {
    const { enabled, transport, customEndpoint } = get();
    if (!enabled) return; // belt-and-braces: the UI shouldn't even offer it
    set({ busy: true, error: null });
    try {
      // The ONLY thing that ever leaves: the redacted digest (S7-1 module,
      // which refuses to build itself if any value survives).
      const digest = buildAiDigest(model, ownerId);
      let narrative: string;
      if (transport === 'custom') {
        if (customEndpoint.trim() === '') throw new Error('enter a custom endpoint URL');
        narrative = await requestNarrativeFromCustomEndpoint(customEndpoint.trim(), digest);
      } else {
        const sb = getSupabase();
        const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        if (sb === null || workspaceId === null) {
          throw new Error(
            'Workspace transport needs a signed-in workspace — or switch to a custom endpoint',
          );
        }
        narrative = await requestNarrative(sb, workspaceId, digest, ownerName);
      }
      set({ narratives: { ...get().narratives, [ownerId]: narrative } });
      plog(`AI narrative generated for ${ownerName} (${narrative.length} chars)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plog(`AI narrative failed: ${message}`);
      set({ error: message });
    } finally {
      set({ busy: false });
    }
  },
}));
