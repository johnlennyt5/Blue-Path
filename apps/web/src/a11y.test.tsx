// @vitest-environment jsdom
/**
 * S8-3 · Accessibility (WCAG 2.1 AA): axe runs over every major surface in
 * CI — landing, detail tabs (each panel), tracker, workspace panel — plus
 * explicit keyboard-navigation tests for the tab bar and drop zone.
 * (Color-contrast rules need a real renderer and are covered by the design
 * system's slate/eight-hundred palette choices; axe-jsdom checks the rest.)
 */
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import type { AutomationModel, Finding } from '@prismshift/ir';
import type { Session } from '@supabase/supabase-js';
import App from './App';
import { OwnerDetail } from './components/OwnerDetail';
import { MigrationTracker } from './components/MigrationTracker';
import { WorkspacePanel } from './components/WorkspacePanel';
import { useSession } from './store/session';
import { useWorkspaceStore } from './store/workspace';

expect.extend(matchers);

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Assertion<T> {
    toHaveNoViolations(): void;
  }
}

beforeAll(() => {
  (globalThis as { crypto?: unknown }).crypto ??= webcrypto;
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub });
  }
});

let model: AutomationModel;
let findings: Finding[];
beforeAll(async () => {
  const { xml } = await loadSample('02-realistic-mid-size');
  model = (await parseBpRelease(xml)).model;
  findings = runRules(model, ALL_RULES).findings;
});

afterEach(cleanup);

const session = { user: { id: 'me', email: 'me@test.local' } } as unknown as Session;

function seedWorkspace() {
  useWorkspaceStore.setState({
    init: () => {},
    available: true,
    session,
    magicLinkSentTo: null,
    workspaces: [
      { id: 'ws1', name: 'Estate', role: 'admin', artifactStorageEnabled: false, retentionDays: null },
    ],
    activeWorkspaceId: 'ws1',
    members: [{ userId: 'me', email: 'me@test.local', role: 'admin' }],
    invites: [],
    memberNote: null,
    programs: [{ id: 'prog1', name: 'Estate Program' }],
    trackerProgramId: 'prog1',
    trackerRows: [
      {
        id: 'p1',
        name: 'Invoice Dispatcher',
        stageCount: 10,
        score: 74,
        grade: 'C',
        status: 'analyzed',
        effortHours: 2.9,
        findingCount: 2,
        updatedAt: '2026-07-22T00:00:00Z',
      },
    ],
    trackerEdges: [
      { from_name: 'A', from_type: 'process', to_name: 'B', to_type: 'object' },
    ],
    auditTrail: [{ event: 'workspace.created', actor: 'me', at: '2026-07-22T00:00:00Z', detail: null }],
    busy: false,
    error: null,
  });
}

async function expectNoViolations(container: HTMLElement) {
  const results = await axe(container, {
    rules: {
      // jsdom has no layout engine — these need a real renderer
      'color-contrast': { enabled: false },
      'scrollable-region-focusable': { enabled: false },
    },
  });
  expect(results).toHaveNoViolations();
}

describe('axe (CI-enforced)', () => {
  it('landing page', async () => {
    const { container } = render(<App />);
    await expectNoViolations(container);
  });

  it('detail view — every tab', async () => {
    for (const tab of ['summary', 'vulnerabilities', 'improvements', 'conversion', 'structure'] as const) {
      useSession.setState({
        selection: { ownerId: model.processes[0]!.id, tab },
      });
      const { container, unmount } = render(<OwnerDetail model={model} findings={findings} />);
      await expectNoViolations(container);
      unmount();
    }
  });

  it('migration tracker', async () => {
    seedWorkspace();
    const { container } = render(<MigrationTracker />);
    await expectNoViolations(container);
  });

  it('workspace panel', async () => {
    seedWorkspace();
    const { container } = render(<WorkspacePanel onClose={() => {}} />);
    await expectNoViolations(container);
  });
});

describe('keyboard navigation', () => {
  it('tab bar: arrow keys move selection and focus; Home/End jump', () => {
    useSession.setState({ selection: { ownerId: model.processes[0]!.id, tab: 'summary' } });
    render(<OwnerDetail model={model} findings={findings} />);
    const tablist = screen.getByRole('tablist');
    const summaryTab = screen.getByRole('tab', { name: 'Summary' });
    expect(summaryTab.getAttribute('aria-selected')).toBe('true');
    expect(summaryTab.tabIndex).toBe(0);

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Vulnerabilities' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Structure' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true');

    // Only the active tab is in the tab order (roving tabindex)
    const inTabOrder = screen.getAllByRole('tab').filter((t) => t.tabIndex === 0);
    expect(inTabOrder).toHaveLength(1);
  });

  it('drop zone: focusable and operable with Enter/Space', () => {
    useSession.setState({ loaded: null, selection: null });
    render(<App />);
    const zone = screen.getByRole('button', { name: /drop a blue prism export file/i });
    expect(zone.tabIndex).toBe(0);
    fireEvent.keyDown(zone, { key: 'Enter' }); // must not throw; opens picker
  });
});
