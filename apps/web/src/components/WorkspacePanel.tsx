import { useEffect, useState } from 'react';
import { can, type WorkspaceRole } from '../lib/workspace';
import { activeRole, useWorkspaceStore } from '../store/workspace';
import { useSession } from '../store/session';

/**
 * Workspace Mode panel (S6-3): magic-link sign-in, workspace creation, and
 * member/role management. Role gates here mirror the RLS policies — the UI
 * hides what the server would deny anyway.
 */

const ROLE_BADGE: Record<WorkspaceRole, string> = {
  admin: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  editor: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  viewer: 'border-slate-600 bg-slate-800/60 text-slate-300',
};

export function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const store = useWorkspaceStore();
  const role = activeRole(store);
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('editor');
  const [programName, setProgramName] = useState('');
  const releaseLoaded = useSession((s) => s.parseResult?.model !== undefined);
  const releaseName = useSession((s) => s.loaded?.fileName ?? '');

  const init = store.init;
  useEffect(() => init(), [init]);

  return (
    <section
      aria-label="Workspace Mode"
      className="mb-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Workspace Mode
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-slate-500 hover:text-slate-300"
        >
          ✕ close
        </button>
      </div>

      {!store.available && (
        <p className="text-sm text-slate-400">
          Workspace Mode isn't configured — no Supabase environment set, so this stays a
          fully local app. See <code className="text-slate-300">.env.example</code>.
        </p>
      )}

      {store.available && store.session === null && (
        <div>
          <p className="mb-3 text-sm text-slate-400">
            Sign in with a magic link. Only analysis <em>metadata</em> ever syncs — never
            your Blue Prism XML or generated XAML.
          </p>
          {store.magicLinkSentTo === null ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim() !== '') void store.requestMagicLink(email.trim());
              }}
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <button
                type="submit"
                disabled={store.busy}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Send magic link
              </button>
            </form>
          ) : (
            <p className="text-sm text-emerald-300">
              Magic link sent to <span className="font-mono">{store.magicLinkSentTo}</span> —
              check your inbox and click it to sign in.
            </p>
          )}
        </div>
      )}

      {store.available && store.session !== null && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-300">
              Signed in as <span className="font-mono">{store.session.user.email}</span>
            </span>
            {role !== null && (
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[role]}`}
              >
                {role}
              </span>
            )}
            <button
              type="button"
              onClick={() => void store.logout()}
              className="ml-auto rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:border-slate-500"
            >
              Sign out
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {store.workspaces.length > 0 && (
              <select
                aria-label="Active workspace"
                value={store.activeWorkspaceId ?? ''}
                onChange={(e) => void store.selectWorkspace(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100"
              >
                {store.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (workspaceName.trim() !== '') {
                  void store.createNewWorkspace(workspaceName.trim());
                  setWorkspaceName('');
                }
              }}
            >
              <input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="New workspace name"
                className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <button
                type="submit"
                disabled={store.busy}
                className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
              >
                Create
              </button>
            </form>
          </div>

          {store.activeWorkspaceId !== null && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Members
              </h4>
              <ul className="space-y-1">
                {store.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-slate-200">{m.email}</span>
                    {can.manageMembers(role) ? (
                      <>
                        <select
                          aria-label={`Role for ${m.email}`}
                          value={m.role}
                          onChange={(e) =>
                            void store.changeMemberRole(m.userId, e.target.value as WorkspaceRole)
                          }
                          className="ml-auto rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-200"
                        >
                          <option value="admin">admin</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void store.dropMember(m.userId)}
                          className="text-xs text-rose-400 hover:text-rose-300"
                        >
                          remove
                        </button>
                      </>
                    ) : (
                      <span
                        className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${ROLE_BADGE[m.role]}`}
                      >
                        {m.role}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {store.invites.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {store.invites.map((invite) => (
                    <li
                      key={invite.email}
                      className="flex items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-slate-400">{invite.email}</span>
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                        invited · {invite.role}
                      </span>
                      {can.manageMembers(role) && (
                        <button
                          type="button"
                          onClick={() => void store.cancelInvite(invite.email)}
                          className="ml-auto text-xs text-rose-400 hover:text-rose-300"
                        >
                          cancel
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {store.memberNote !== null && (
                <p className="mt-2 text-xs text-emerald-300">{store.memberNote}</p>
              )}

              {can.manageMembers(role) && (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (inviteEmail.trim() !== '') {
                      void store.inviteMember(inviteEmail.trim(), inviteRole);
                      setInviteEmail('');
                    }
                  }}
                >
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@company.com"
                    className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
                  />
                  <select
                    aria-label="Invite role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                  >
                    <option value="admin">admin</option>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button
                    type="submit"
                    disabled={store.busy}
                    className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
                  >
                    Add member
                  </button>
                </form>
              )}
              {!can.manageMembers(role) && (
                <p className="mt-2 text-xs text-slate-500">
                  Only workspace admins can manage members.
                </p>
              )}
            </div>
          )}

          {store.activeWorkspaceId !== null && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Sync analysis
              </h4>
              {!releaseLoaded && (
                <p className="text-xs text-slate-500">
                  Load a .bprelease file below, then sync its analysis metadata here.
                </p>
              )}
              {releaseLoaded && can.syncAnalyses(role) && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (programName.trim() !== '') void store.syncRelease(programName);
                  }}
                >
                  <input
                    list="prismshift-programs"
                    required
                    value={programName}
                    onChange={(e) => setProgramName(e.target.value)}
                    placeholder="Program name (required)"
                    title="Processes are grouped into a program — pick an existing one or type a new name"
                    className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
                  />
                  <datalist id="prismshift-programs">
                    {store.programs.map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                  <button
                    type="submit"
                    disabled={store.busy}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    ⇧ Sync {releaseName} (metadata only)
                  </button>
                </form>
              )}
              {releaseLoaded && !can.syncAnalyses(role) && (
                <p className="text-xs text-slate-500">
                  Viewers can't sync analyses — ask a workspace admin or editor.
                </p>
              )}
              {store.syncStatus !== null && (
                <p className="mt-2 text-xs text-emerald-300">{store.syncStatus}</p>
              )}
            </div>
          )}

          {store.activeWorkspaceId !== null && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Settings
              </h4>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={
                      store.workspaces.find((w) => w.id === store.activeWorkspaceId)
                        ?.artifactStorageEnabled ?? false
                    }
                    disabled={!can.editWorkspaceSettings(role) || store.busy}
                    onChange={(e) => void store.toggleArtifactStorage(e.target.checked)}
                    className="accent-violet-500"
                  />
                  Encrypted artifact storage
                </label>
                <span className="text-xs text-slate-500">
                  {can.editWorkspaceSettings(role)
                    ? 'Records intent only — client-side-encrypted storage ships later (BL-001). Toggling is audited.'
                    : 'Admin-only setting.'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {store.error !== null && (
        <p role="alert" className="mt-3 text-sm text-rose-400">
          {store.error}
        </p>
      )}
    </section>
  );
}
