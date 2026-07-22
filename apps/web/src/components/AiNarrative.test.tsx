// @vitest-environment jsdom
/**
 * S7-3 · AI narrative UI: off by default (nothing rendered beyond the toggle,
 * nothing sent), disclosure appears on enable, generation goes through the
 * redacted digest only, errors surface, output is labeled AI-generated.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import type { AutomationModel } from '@prismshift/ir';
import { AiNarrative } from './AiNarrative';
import { useAiStore } from '../store/ai';

const mocks = vi.hoisted(() => ({
  requestNarrative: vi.fn(),
  requestNarrativeFromCustomEndpoint: vi.fn(),
}));
vi.mock('../lib/aiNarrative', () => mocks);
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({}) }));

let model: AutomationModel;
beforeEach(async () => {
  const { xml } = await loadSample('01-clean-and-simple');
  model = (await parseBpRelease(xml)).model;
  useAiStore.setState({
    enabled: false,
    transport: 'custom',
    customEndpoint: 'https://ai.internal/x',
    narratives: {},
    busy: false,
    error: null,
  });
  mocks.requestNarrative.mockReset();
  mocks.requestNarrativeFromCustomEndpoint.mockReset();
});

afterEach(cleanup);

const owner = () => model.processes[0]!;

describe('AiNarrative', () => {
  it('OFF BY DEFAULT: toggle unchecked, no disclosure, no generate button', () => {
    render(<AiNarrative model={model} owner={owner()} />);
    const toggle = screen.getByLabelText('enable') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.queryByText(/What leaves your browser/)).toBeNull();
    expect(screen.queryByText('Generate narrative')).toBeNull();
    expect(screen.getByText(/off by default — nothing is sent/)).toBeTruthy();
  });

  it('enabling reveals the disclosure with the exact redaction promises', () => {
    render(<AiNarrative model={model} owner={owner()} />);
    fireEvent.click(screen.getByLabelText('enable'));
    const disclosure = screen.getByText(/What leaves your browser/).parentElement!.textContent!;
    expect(disclosure).toContain('redacted digest only');
    expect(disclosure).toContain('Never your Blue Prism XML');
    expect(disclosure).toContain('never data values');
    expect(disclosure).toContain('audited');
  });

  it('generate sends ONLY the redacted digest to the custom endpoint', async () => {
    mocks.requestNarrativeFromCustomEndpoint.mockResolvedValue('This process calculates loans.');
    render(<AiNarrative model={model} owner={owner()} />);
    fireEvent.click(screen.getByLabelText('enable'));
    fireEvent.click(screen.getByText('Generate narrative'));

    await waitFor(() => {
      expect(screen.getByText('This process calculates loans.')).toBeTruthy();
    });
    expect(screen.getByText(/AI-generated — verify/)).toBeTruthy();

    const [endpoint, digest] = mocks.requestNarrativeFromCustomEndpoint.mock.calls[0]!;
    expect(endpoint).toBe('https://ai.internal/x');
    // The payload is the S7-1 digest: names/structure, no values.
    const serialized = JSON.stringify(digest);
    expect(serialized).toContain('"owners"');
    expect(serialized).not.toContain('initialValue');
    expect(serialized).not.toContain('<process');
  });

  it('workspace transport without a session surfaces a helpful error', async () => {
    useAiStore.setState({ transport: 'workspace' });
    render(<AiNarrative model={model} owner={owner()} />);
    fireEvent.click(screen.getByLabelText('enable'));
    fireEvent.click(screen.getByText('Generate narrative'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('signed-in workspace');
    });
  });

  it('proxy gate errors (rate limit / not configured) render verbatim', async () => {
    mocks.requestNarrativeFromCustomEndpoint.mockRejectedValue(
      new Error('rate limit: 30 AI requests per workspace per hour'),
    );
    render(<AiNarrative model={model} owner={owner()} />);
    fireEvent.click(screen.getByLabelText('enable'));
    fireEvent.click(screen.getByText('Generate narrative'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('rate limit');
    });
  });
});
