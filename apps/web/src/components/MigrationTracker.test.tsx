// @vitest-environment jsdom
/**
 * S6-5 · Tracker rendering per role: rollup chips, grade badges, editors get
 * status dropdowns, viewers get badges, filters narrow the table, audit trail
 * renders status transitions with actor emails.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { MigrationTracker } from './MigrationTracker';
import { useWorkspaceStore } from '../store/workspace';
import type { WorkspaceRole } from '../lib/workspace';

const session = { user: { id: 'me', email: 'me@test.local' } } as unknown as Session;

// React Flow needs ResizeObserver; jsdom has none.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub });
  }
});

function seedTracker(role: WorkspaceRole) {
  useWorkspaceStore.setState({
    init: () => {},
    available: true,
    session,
    workspaces: [{ id: 'ws1', name: 'Estate', role, artifactStorageEnabled: false }],
    activeWorkspaceId: 'ws1',
    members: [{ userId: 'me', email: 'me@test.local', role }],
    invites: [],
    memberNote: null,
    programs: [{ id: 'prog1', name: 'Invoice Estate' }],
    trackerProgramId: 'prog1',
    trackerRows: [
      {
        id: 'p1',
        name: 'Invoice Dispatcher',
        stageCount: 10,
        score: 74,
        grade: 'C',
        status: 'analyzed',
        effortHours: 3.5,
        findingCount: 2,
        updatedAt: '2026-07-22T00:00:00Z',
      },
      {
        id: 'p2',
        name: 'Invoice Performer',
        stageCount: 19,
        score: 100,
        grade: 'A',
        status: 'converted',
        effortHours: 5,
        findingCount: 0,
        updatedAt: '2026-07-22T00:00:00Z',
      },
    ],
    trackerEdges: [
      { from_name: 'Invoice Dispatcher', from_type: 'process', to_name: 'Invoice Entry VBO', to_type: 'object' },
      { from_name: 'Invoice Performer', from_type: 'process', to_name: 'Invoice Entry VBO', to_type: 'object' },
    ],
    auditTrail: [
      {
        event: 'status.changed',
        actor: 'me',
        at: '2026-07-22T01:00:00Z',
        detail: { name: 'Invoice Dispatcher', from: 'analyzed', to: 'converted' },
      },
    ],
    busy: false,
    error: null,
  });
}

afterEach(cleanup);

describe('MigrationTracker', () => {
  it('shows the rollup: process count, effort total, avg score, worst grade', () => {
    seedTracker('editor');
    render(<MigrationTracker />);
    expect(screen.getByText('2 processes')).toBeTruthy();
    expect(screen.getByText('8.5 h')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
    expect(screen.getByText('C', { selector: 'strong' })).toBeTruthy();
  });

  it('editor gets a status dropdown per process', () => {
    seedTracker('editor');
    render(<MigrationTracker />);
    expect(screen.getByLabelText('Status for Invoice Dispatcher')).toBeTruthy();
    expect(screen.getByLabelText('Status for Invoice Performer')).toBeTruthy();
  });

  it('viewer sees status badges, no dropdowns', () => {
    seedTracker('viewer');
    render(<MigrationTracker />);
    expect(screen.queryByLabelText('Status for Invoice Dispatcher')).toBeNull();
    expect(screen.getByText('analyzed', { selector: 'span' })).toBeTruthy();
  });

  it('filters narrow the table', () => {
    seedTracker('editor');
    render(<MigrationTracker />);
    fireEvent.change(screen.getByPlaceholderText('Filter by name…'), {
      target: { value: 'performer' },
    });
    expect(screen.queryByText('Invoice Dispatcher', { selector: 'td' })).toBeNull();
    expect(screen.getByText('Invoice Performer', { selector: 'td' })).toBeTruthy();
  });

  it('dependency graph section shows the shared-hotspot count (S6-6)', () => {
    seedTracker('viewer');
    render(<MigrationTracker />);
    expect(screen.getByText('Dependency graph')).toBeTruthy();
    expect(screen.getByText('1 shared hotspot')).toBeTruthy();
  });

  it('audit trail shows the transition with the actor email', () => {
    seedTracker('editor');
    render(<MigrationTracker />);
    const entry = screen.getByText(/status\.changed/).closest('li')!.textContent!;
    expect(entry).toContain('Invoice Dispatcher: analyzed → converted');
    expect(entry).toContain('me@test.local');
  });
});
