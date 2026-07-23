// @vitest-environment jsdom
/**
 * S6-3 · WorkspacePanel role-gate rendering: what each role actually sees.
 * Store state is injected directly — no network, no Supabase client.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { WorkspacePanel } from './WorkspacePanel';
import { useWorkspaceStore } from '../store/workspace';
import type { WorkspaceRole } from '../lib/workspace';

const session = {
  user: { id: 'me', email: 'me@test.local' },
} as unknown as Session;

function seedStore(role: WorkspaceRole | 'signed-out' | 'unavailable') {
  useWorkspaceStore.setState({
    // The panel calls init() on mount; a real .env.local would flip
    // `available` back on. These tests assert rendering, not init.
    init: () => {},
    available: role !== 'unavailable',
    session: role === 'signed-out' || role === 'unavailable' ? null : session,
    magicLinkSentTo: null,
    workspaces:
      role === 'signed-out' || role === 'unavailable'
        ? []
        : [{ id: 'ws1', name: 'Estate', role, artifactStorageEnabled: false, retentionDays: null }],
    activeWorkspaceId: role === 'signed-out' || role === 'unavailable' ? null : 'ws1',
    members:
      role === 'signed-out' || role === 'unavailable'
        ? []
        : [
            { userId: 'me', email: 'me@test.local', role },
            { userId: 'u2', email: 'other@test.local', role: 'viewer' },
          ],
    invites:
      role === 'admin'
        ? [{ email: 'pending@test.local', role: 'viewer' }]
        : [],
    memberNote: null,
    busy: false,
    error: null,
  });
}

afterEach(cleanup);

describe('WorkspacePanel role gates', () => {
  it('without Supabase config: explains Local-Mode-only, no sign-in form', () => {
    seedStore('unavailable');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByText(/isn't configured/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('you@company.com')).toBeNull();
  });

  it('signed out: shows the magic-link form and the metadata-only promise', () => {
    seedStore('signed-out');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByPlaceholderText('you@company.com')).toBeTruthy();
    expect(screen.getByText(/never/)).toBeTruthy();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('admin: sees role selects, remove buttons, and the invite form', () => {
    seedStore('admin');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByLabelText('Role for other@test.local')).toBeTruthy();
    expect(screen.getAllByText('remove').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('teammate@company.com')).toBeTruthy();
  });

  it('editor: member roster is read-only, no invite form', () => {
    seedStore('editor');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.queryByLabelText('Role for other@test.local')).toBeNull();
    expect(screen.queryByText('remove')).toBeNull();
    expect(screen.queryByPlaceholderText('teammate@company.com')).toBeNull();
    expect(screen.getByText('Only workspace admins can manage members.')).toBeTruthy();
  });

  it('admin: pending invites render with a cancel button', () => {
    seedStore('admin');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByText('invited · viewer')).toBeTruthy();
    expect(screen.getByText('cancel')).toBeTruthy();
  });

  it('settings: admin gets an enabled artifact-storage toggle, viewer a disabled one', () => {
    seedStore('admin');
    render(<WorkspacePanel onClose={() => {}} />);
    const adminToggle = screen.getByLabelText('Encrypted artifact storage');
    expect((adminToggle as HTMLInputElement).disabled).toBe(false);
    cleanup();

    seedStore('viewer');
    render(<WorkspacePanel onClose={() => {}} />);
    const viewerToggle = screen.getByLabelText('Encrypted artifact storage');
    expect((viewerToggle as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Admin-only setting.')).toBeTruthy();
  });

  it('settings: purge button is admin-only; retention disabled for viewers', () => {
    seedStore('admin');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByText('Purge workspace data')).toBeTruthy();
    expect((screen.getByLabelText('Audit retention days') as HTMLInputElement).disabled).toBe(false);
    cleanup();

    seedStore('viewer');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.queryByText('Purge workspace data')).toBeNull();
    expect((screen.getByLabelText('Audit retention days') as HTMLInputElement).disabled).toBe(true);
  });

  it('artifact vault (BL-001): hidden when flag off; key warning when on; vault when key loaded', () => {
    seedStore('admin'); // artifactStorageEnabled: false in the seed
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.queryByText('Encrypted artifact vault')).toBeNull();
    cleanup();

    seedStore('admin');
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'ws1', name: 'Estate', role: 'admin', artifactStorageEnabled: true, retentionDays: null },
      ],
      artifactKey: null,
      artifacts: [],
    });
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByText('Encrypted artifact vault')).toBeTruthy();
    expect(screen.getByText(/Losing the key loses the/)).toBeTruthy();
    expect(screen.getByText('Generate key')).toBeTruthy();
    cleanup();

    seedStore('admin');
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'ws1', name: 'Estate', role: 'admin', artifactStorageEnabled: true, retentionDays: null },
      ],
      artifactKey: 'a'.repeat(44),
      artifacts: [
        { id: 'art1', name: 'estate.bprelease', kind: 'bprelease', sizeBytes: 2048, uploadedAt: '2026-07-22T00:00:00Z' },
      ],
    });
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.getByText(/Store loaded release/)).toBeTruthy();
    expect(screen.getByText('estate.bprelease')).toBeTruthy();
    expect(screen.getByText('decrypt & download')).toBeTruthy();
    expect(screen.getByText(/Key loss = artifact loss/)).toBeTruthy();
  });

  it('viewer: same read-only roster, viewer badge shown', () => {
    seedStore('viewer');
    render(<WorkspacePanel onClose={() => {}} />);
    expect(screen.queryByPlaceholderText('teammate@company.com')).toBeNull();
    expect(screen.getAllByText('viewer').length).toBeGreaterThan(0);
  });
});
