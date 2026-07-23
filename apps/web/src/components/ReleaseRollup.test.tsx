// @vitest-environment jsdom
/** BL-020 · estate rollup chips above the owner cards (same math as the PDF). */
import { webcrypto } from 'node:crypto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import { ReleaseRollup } from './ReleaseRollup';

beforeAll(() => {
  (globalThis as { crypto?: unknown }).crypto ??= webcrypto;
});
afterEach(cleanup);

describe('ReleaseRollup', () => {
  it('shows components, avg score, worst grade, effort, and severity chips (corpus #2)', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const { findings } = runRules(model, ALL_RULES);
    render(<ReleaseRollup model={model} findings={findings} />);

    expect(screen.getByText('3 components')).toBeTruthy();
    expect(screen.getByText('90')).toBeTruthy(); // avg of 74/100/96
    expect(screen.getByText('C')).toBeTruthy(); // worst grade
    // Down from 9.3 h pre-BL-014: absorbing the performer's polling loop into
    // the REFramework transaction loop removed restructuring work.
    expect(screen.getByText('8.3 h')).toBeTruthy();
    expect(screen.getByText(/1 critical/)).toBeTruthy();
  });
});
