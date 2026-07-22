import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { plog } from '../lib/debug';
import { getSupabase } from '../lib/supabaseClient';
import {
  addMember,
  claimInvites,
  sendInviteEmail,
  createWorkspace,
  listInvites,
  listMembers,
  listWorkspaces,
  removeMember,
  revokeInvite,
  purgeWorkspace,
  sendMagicLink,
  setArtifactStorage,
  setRetentionDays,
  signOut,
  updateMemberRole,
  type PendingInvite,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceSummary,
} from '../lib/workspace';
import {
  buildSyncPayload,
  createProgram,
  listPrograms,
  syncToProgram,
  type ProgramSummary,
} from '../lib/sync';
import {
  artifactKeyStore,
  downloadArtifact,
  listArtifacts,
  removeArtifact,
  storeArtifact,
  type ArtifactRow,
} from '../lib/artifacts';
import { generateArtifactKey } from '../lib/artifactCrypto';
import {
  listAuditTrail,
  listProgramEdges,
  listTrackedProcesses,
  updateProcessStatus,
  type AuditEntry,
  type ProcessStatus,
  type TrackedProcess,
} from '../lib/tracker';
import type { ProgramEdgeRow } from '../lib/dependencyGraph';
import { useSession } from './session';

/**
 * Workspace Mode state (S6-3). Entirely inert until the user opens the panel
 * and signs in — Local Mode never touches this store.
 */

export interface WorkspaceState {
  /** null = no Supabase env configured (Workspace Mode unavailable). */
  available: boolean;
  session: Session | null;
  /** Email the magic link was sent to, while waiting for the click. */
  magicLinkSentTo: string | null;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  members: WorkspaceMember[];
  invites: PendingInvite[];
  /** Feedback after add-member: distinguishes added vs invited. */
  memberNote: string | null;
  programs: ProgramSummary[];
  /** Human-readable result of the last sync, shown in the panel. */
  syncStatus: string | null;
  /** Program whose processes the tracker is showing. */
  trackerProgramId: string | null;
  trackerRows: TrackedProcess[];
  trackerEdges: ProgramEdgeRow[];
  auditTrail: AuditEntry[];
  artifacts: ArtifactRow[];
  /** Base64 AES key for the active workspace, or null (browser-local only). */
  artifactKey: string | null;
  busy: boolean;
  error: string | null;

  init: () => void;
  requestMagicLink: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  createNewWorkspace: (name: string) => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;
  inviteMember: (email: string, role: WorkspaceRole) => Promise<void>;
  changeMemberRole: (userId: string, role: WorkspaceRole) => Promise<void>;
  dropMember: (userId: string) => Promise<void>;
  cancelInvite: (email: string) => Promise<void>;
  /** Admin-only: record the workspace's artifact-storage intent (BL-001). */
  toggleArtifactStorage: (enabled: boolean) => Promise<void>;
  /** Admin-only: audit retention in days (null = keep everything). */
  updateRetention: (days: number | null) => Promise<void>;
  /** Admin-only: hard-delete synced content, prune audit per retention. */
  purgeActiveWorkspace: () => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  generateArtifactKey: () => Promise<void>;
  importArtifactKeyString: (keyBase64: string) => void;
  storeReleaseArtifact: () => Promise<void>;
  fetchArtifact: (artifactId: string) => Promise<{ name: string; plaintext: Uint8Array } | null>;
  deleteArtifact: (artifactId: string) => Promise<void>;
  refreshPrograms: () => Promise<void>;
  /** Sync the loaded release's analysis metadata into the named program. */
  syncRelease: (programName: string) => Promise<void>;
  /** Load the tracker for a program (rows + workspace audit trail). */
  loadTracker: (programId: string) => Promise<void>;
  /** Change a process status; the DB trigger writes the audit event. */
  setProcessStatus: (processId: string, status: ProcessStatus) => Promise<void>;
}

/** The caller's role in the active workspace (null when none selected). */
export function activeRole(state: Pick<WorkspaceState, 'workspaces' | 'activeWorkspaceId'>) {
  return (
    state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.role ?? null
  );
}

let initialized = false;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const run = async (label: string, work: () => Promise<void>): Promise<void> => {
    set({ busy: true, error: null });
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plog(`workspace ${label} failed: ${message}`);
      set({ error: message });
    } finally {
      set({ busy: false });
    }
  };

  return {
    available: false,
    session: null,
    magicLinkSentTo: null,
    workspaces: [],
    activeWorkspaceId: null,
    members: [],
    invites: [],
    memberNote: null,
    programs: [],
    syncStatus: null,
    trackerProgramId: null,
    trackerRows: [],
    trackerEdges: [],
    auditTrail: [],
    artifacts: [],
    artifactKey: null,
    busy: false,
    error: null,

    init: () => {
      if (initialized) return;
      initialized = true;
      const sb = getSupabase();
      if (sb === null) return;
      set({ available: true });
      sb.auth.onAuthStateChange((event, session) => {
        plog(
          `workspace auth event: ${event} · session: ${
            session !== null ? (session.user.email ?? session.user.id) : 'none'
          }`,
        );
        set({ session, magicLinkSentTo: null });
        if (session !== null) {
          // First: claim any pending invites for this email, so invited
          // workspaces appear in the very first refresh.
          void claimInvites(sb)
            .then((claimed) => {
              if (claimed > 0) plog(`claimed ${claimed} workspace invite(s)`);
            })
            .catch((e: unknown) =>
              plog(`invite claim failed: ${e instanceof Error ? e.message : String(e)}`),
            )
            .finally(() => void get().refreshWorkspaces());
        } else {
          set({ workspaces: [], activeWorkspaceId: null, members: [], invites: [] });
        }
      });
      void sb.auth
        .getSession()
        .then(({ data, error }) => {
          plog(
            `workspace getSession on init: ${
              data.session !== null ? (data.session.user.email ?? 'session present') : 'no session'
            }${error !== null ? ` · error: ${error.message}` : ''}`,
          );
          if (data.session !== null) {
            set({ session: data.session });
            void get().refreshWorkspaces();
          }
        });
    },

    requestMagicLink: async (email) =>
      run('magic link', async () => {
        const sb = getSupabase();
        if (sb === null) throw new Error('Workspace Mode is not configured');
        await sendMagicLink(sb, email);
        set({ magicLinkSentTo: email });
      }),

    logout: async () =>
      run('sign out', async () => {
        const sb = getSupabase();
        if (sb !== null) await signOut(sb);
      }),

    refreshWorkspaces: async () =>
      run('refresh', async () => {
        const sb = getSupabase();
        const session = get().session;
        if (sb === null || session === null) return;
        const workspaces = await listWorkspaces(sb, session.user.id);
        set({ workspaces });
        const active = get().activeWorkspaceId;
        if (active === null && workspaces.length > 0) {
          await get().selectWorkspace(workspaces[0]!.id);
        }
      }),

    createNewWorkspace: async (name) =>
      run('create workspace', async () => {
        const sb = getSupabase();
        if (sb === null) return;
        const id = await createWorkspace(sb, name);
        await get().refreshWorkspaces();
        await get().selectWorkspace(id);
      }),

    selectWorkspace: async (id) => {
      const sb = getSupabase();
      if (sb === null) return;
      set({
        activeWorkspaceId: id,
        syncStatus: null,
        memberNote: null,
        trackerProgramId: null,
        trackerRows: [],
        trackerEdges: [],
        auditTrail: [],
        artifacts: [],
        artifactKey: artifactKeyStore.get(id),
      });
      await run('load members', async () => {
        const programs = await listPrograms(sb, id);
        set({
          members: await listMembers(sb, id),
          invites: await listInvites(sb, id),
          programs,
        });
        if (programs.length > 0) await get().loadTracker(programs[0]!.id);
        if (get().workspaces.find((w) => w.id === id)?.artifactStorageEnabled === true) {
          await get().refreshArtifacts();
        }
      });
    },

    inviteMember: async (email, role) =>
      run('invite', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        const outcome = await addMember(sb, active, email, role);
        let memberNote: string;
        if (outcome === 'added') {
          memberNote = `${email} added as ${role}.`;
        } else {
          try {
            await sendInviteEmail(sb, active, email);
            memberNote = `Invite email sent to ${email} — clicking it signs them in and adds them here as ${role}.`;
          } catch (e) {
            plog(`invite email failed: ${e instanceof Error ? e.message : String(e)}`);
            memberNote = `Invite saved for ${email} (email delivery unavailable: they can simply sign in themselves and they'll join automatically as ${role}).`;
          }
        }
        set({
          members: await listMembers(sb, active),
          invites: await listInvites(sb, active),
          memberNote,
        });
      }),

    changeMemberRole: async (userId, role) =>
      run('change role', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        await updateMemberRole(sb, active, userId, role);
        set({ members: await listMembers(sb, active) });
      }),

    cancelInvite: async (email) =>
      run('cancel invite', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        await revokeInvite(sb, active, email);
        set({ invites: await listInvites(sb, active), memberNote: null });
      }),

    toggleArtifactStorage: async (enabled) =>
      run('artifact storage', async () => {
        const sb = getSupabase();
        const { session, activeWorkspaceId } = get();
        if (sb === null || session === null || activeWorkspaceId === null) return;
        await setArtifactStorage(sb, activeWorkspaceId, session.user.id, enabled);
        set({
          workspaces: get().workspaces.map((w) =>
            w.id === activeWorkspaceId ? { ...w, artifactStorageEnabled: enabled } : w,
          ),
          auditTrail: await listAuditTrail(sb, activeWorkspaceId),
        });
      }),

    updateRetention: async (days) =>
      run('retention', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        await setRetentionDays(sb, active, days);
        set({
          workspaces: get().workspaces.map((w) =>
            w.id === active ? { ...w, retentionDays: days } : w,
          ),
        });
      }),

    purgeActiveWorkspace: async () =>
      run('purge', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        const result = await purgeWorkspace(sb, active);
        set({
          programs: [],
          trackerProgramId: null,
          trackerRows: [],
          trackerEdges: [],
          auditTrail: await listAuditTrail(sb, active),
          syncStatus: null,
          memberNote: `Workspace purged: ${result.programsDeleted} program(s) hard-deleted, ${result.auditPruned} old audit event(s) pruned. Recorded in the audit trail.`,
        });
      }),

    refreshArtifacts: async () =>
      run('artifacts', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        set({ artifacts: await listArtifacts(sb, active) });
      }),

    generateArtifactKey: async () =>
      run('generate key', async () => {
        const active = get().activeWorkspaceId;
        if (active === null) return;
        const key = await generateArtifactKey();
        artifactKeyStore.set(active, key);
        set({ artifactKey: key });
      }),

    importArtifactKeyString: (keyBase64) => {
      const active = get().activeWorkspaceId;
      if (active === null) return;
      artifactKeyStore.set(active, keyBase64.trim());
      set({ artifactKey: keyBase64.trim(), error: null });
    },

    storeReleaseArtifact: async () =>
      run('store artifact', async () => {
        const sb = getSupabase();
        const { session, activeWorkspaceId, artifactKey } = get();
        if (sb === null || session === null || activeWorkspaceId === null) return;
        if (artifactKey === null) throw new Error('generate or import the artifact key first');
        const local = useSession.getState();
        if (local.loaded === null) throw new Error('load a .bprelease file first');
        await storeArtifact(sb, activeWorkspaceId, session.user.id, artifactKey, {
          name: local.loaded.fileName,
          kind: 'bprelease',
          plaintext: new TextEncoder().encode(local.loaded.xml),
        });
        set({ artifacts: await listArtifacts(sb, activeWorkspaceId) });
      }),

    fetchArtifact: async (artifactId) => {
      const sb = getSupabase();
      const { activeWorkspaceId, artifactKey } = get();
      if (sb === null || activeWorkspaceId === null || artifactKey === null) return null;
      set({ busy: true, error: null });
      try {
        return await downloadArtifact(sb, activeWorkspaceId, artifactId, artifactKey);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return null;
      } finally {
        set({ busy: false });
      }
    },

    deleteArtifact: async (artifactId) =>
      run('delete artifact', async () => {
        const sb = getSupabase();
        const { session, activeWorkspaceId } = get();
        if (sb === null || session === null || activeWorkspaceId === null) return;
        await removeArtifact(sb, activeWorkspaceId, session.user.id, artifactId);
        set({ artifacts: await listArtifacts(sb, activeWorkspaceId) });
      }),

    refreshPrograms: async () =>
      run('load programs', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        set({ programs: await listPrograms(sb, active) });
      }),

    syncRelease: async (programName) =>
      run('sync', async () => {
        const sb = getSupabase();
        const { session, activeWorkspaceId } = get();
        if (sb === null || session === null || activeWorkspaceId === null) return;
        const local = useSession.getState();
        const model = local.parseResult?.model;
        const xml = local.loaded?.xml;
        if (model === undefined || xml === undefined) {
          throw new Error('load a .bprelease file first');
        }

        const trimmed = programName.trim();
        if (trimmed === '') throw new Error('program name is required');
        const existing = get().programs.find(
          (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
        );
        const programId =
          existing?.id ??
          (await createProgram(sb, activeWorkspaceId, trimmed, session.user.id));

        const payload = await buildSyncPayload(model, xml, local.analysis?.findings ?? []);
        const result = await syncToProgram(
          sb,
          programId,
          activeWorkspaceId,
          session.user.id,
          payload,
        );
        await get().refreshPrograms();
        await get().loadTracker(programId);
        set({
          syncStatus:
            `Synced ${result.processCount} process(es), ${result.findingCount} finding(s), ` +
            `${result.edgeCount} dependency edge(s) to "${trimmed}" — metadata only, ` +
            're-syncing the same release updates in place.',
        });
      }),

    loadTracker: async (programId) =>
      run('load tracker', async () => {
        const sb = getSupabase();
        const ws = get().activeWorkspaceId;
        if (sb === null || ws === null) return;
        set({
          trackerProgramId: programId,
          trackerRows: await listTrackedProcesses(sb, programId),
          trackerEdges: await listProgramEdges(sb, programId),
          auditTrail: await listAuditTrail(sb, ws),
        });
      }),

    setProcessStatus: async (processId, status) =>
      run('update status', async () => {
        const sb = getSupabase();
        const program = get().trackerProgramId;
        const ws = get().activeWorkspaceId;
        if (sb === null || program === null || ws === null) return;
        await updateProcessStatus(sb, processId, status);
        set({
          trackerRows: await listTrackedProcesses(sb, program),
          auditTrail: await listAuditTrail(sb, ws),
        });
      }),

    dropMember: async (userId) =>
      run('remove member', async () => {
        const sb = getSupabase();
        const active = get().activeWorkspaceId;
        if (sb === null || active === null) return;
        await removeMember(sb, active, userId);
        set({ members: await listMembers(sb, active) });
      }),
  };
});

/** Test seam: allow re-running init with a fresh fake client. */
export function resetWorkspaceInitForTests(): void {
  initialized = false;
}
