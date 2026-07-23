// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from './App';
import { useSession } from './store/session';

// jsdom ships no SubtleCrypto (parser SHA-256) and no ResizeObserver
// (React Flow). Real browsers provide both natively.
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub });
  }
});

afterEach(() => {
  cleanup();
  useSession.getState().reset();
});

/** One process with a planted SEC-001 (hardcoded password) — grade C 75. */
const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">
  <bpr:name>Drop Test</bpr:name>
  <bpr:package-name>Drop Test Package</bpr:package-name>
  <bpr:contents count="1">
    <process id="p1" name="Drop Test Process">
      <process name="Drop Test Process" version="1.0" bpversion="6.10.1" narrative="Integration test process">
        <subsheet subsheetid="page-1" type="MainPage" published="True"><name>Main Page</name></subsheet>
        <stage stageid="s1" name="Start" type="Start"><subsheetid>page-1</subsheetid><display x="15" y="-90" /><onsuccess>s2</onsuccess></stage>
        <stage stageid="s2" name="Login" type="Action">
          <subsheetid>page-1</subsheetid>
          <display x="15" y="-30" />
          <resource object="Portal VBO" action="Log In" />
          <inputs><input type="text" name="Password" expr="&quot;Sup3rS3cret!24&quot;" /></inputs>
          <outputs />
          <onsuccess>s3</onsuccess>
        </stage>
        <stage stageid="s3" name="End" type="End"><subsheetid>page-1</subsheetid><display x="15" y="30" /></stage>
        <stage stageid="s4" name="Recover" type="Recover"><subsheetid>page-1</subsheetid><display x="150" y="-30" /><onsuccess>s5</onsuccess></stage>
        <stage stageid="s5" name="Resume" type="Resume"><subsheetid>page-1</subsheetid><display x="150" y="30" /><onsuccess>s3</onsuccess></stage>
      </process>
    </process>
  </bpr:contents>
</bpr:release>`;

function dropFile(target: HTMLElement, file: File) {
  const files = Object.assign([file], { item: (i: number) => (i === 0 ? file : null) });
  fireEvent.drop(target, { dataTransfer: { files } });
}

async function loadSampleIntoApp() {
  render(<App />);
  dropFile(
    screen.getByRole('button', { name: /drop a/i }),
    new File([SAMPLE_XML], 'drop-test.bprelease'),
  );
  await screen.findByText(/read into browser memory/);
}

describe('drop-to-analysis integration', () => {
  it('dropping a .bprelease shows a graded owner card', async () => {
    await loadSampleIntoApp();

    expect(await screen.findByText('Drop Test Process')).toBeTruthy();
    expect((await screen.findAllByText('C'))[0]).toBeTruthy(); // SEC-001 critical → 75/C (card badge + rollup chip)
    expect(await screen.findByText('75/100')).toBeTruthy();
    expect(await screen.findByText('1 finding')).toBeTruthy();
  });

  it('opening the owner lands on the Summary tab with deterministic facts', async () => {
    await loadSampleIntoApp();
    fireEvent.click(await screen.findByText('Drop Test Process'));

    expect(await screen.findByText('Integration test process')).toBeTruthy();
    expect(await screen.findByText('Step outline')).toBeTruthy();
    expect(await screen.findByText('Call Portal VBO › Log In')).toBeTruthy();
    expect(await screen.findByText(/Recovery on: Main Page/)).toBeTruthy();
  });

  it('the Vulnerabilities tab shows the finding', async () => {
    await loadSampleIntoApp();
    fireEvent.click(await screen.findByText('Drop Test Process'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Vulnerabilities' }));

    expect(await screen.findByText('SEC-001')).toBeTruthy();
    expect(await screen.findByText(/hardcoded literal/)).toBeTruthy();
  });

  it('severity filters hide findings when toggled off', async () => {
    await loadSampleIntoApp();
    fireEvent.click(await screen.findByText('Drop Test Process'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Vulnerabilities' }));
    await screen.findByText('SEC-001');

    fireEvent.click(screen.getByRole('button', { name: /critical \(1\)/i }));
    expect(screen.queryByText('SEC-001')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /critical \(1\)/i }));
    expect(await screen.findByText('SEC-001')).toBeTruthy();
  });

  it('"Show in flow" deep-links to the flow tab with the stage highlighted', async () => {
    await loadSampleIntoApp();
    fireEvent.click(await screen.findByText('Drop Test Process'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Vulnerabilities' }));
    fireEvent.click(await screen.findByRole('button', { name: /show in flow/i }));

    // Flow tab is now active with the page selector rendered
    expect(await screen.findByLabelText('Page')).toBeTruthy();
    const selection = useSession.getState().selection;
    expect(selection?.tab).toBe('flow');
    expect(selection?.highlightStageId).toBe('s2');
    expect(selection?.pageId).toBe('page-1');
  });

  it('the Improvements tab addresses every finding with severity-matched colors', async () => {
    await loadSampleIntoApp();
    fireEvent.click(await screen.findByText('Drop Test Process'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Improvements' }));

    // SEC-001 (critical) maps to the Credential Manager recommendation
    expect(await screen.findByText('Move secrets to Credential Manager')).toBeTruthy();
    expect(await screen.findByText(/addressing/)).toBeTruthy();
    expect((await screen.findByText(/addressing/)).textContent).toContain('all 1');
    expect(await screen.findByText('critical')).toBeTruthy();
  });

  it('the Conversion tab walks every stage mapping', async () => {
    await loadSampleIntoApp();
    fireEvent.click(await screen.findByText('Drop Test Process'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Conversion' }));

    expect(await screen.findByText(/% converted/)).toBeTruthy();
    // The Login action targets an object missing from the release → manual
    expect(await screen.findByText(/Objects\\Portal_VBO\\Log_In\.xaml/)).toBeTruthy();
    expect(await screen.findByText('manual')).toBeTruthy();
    expect(await screen.findByText(/not found in the release/)).toBeTruthy();
  });

  it('dropping a non-XML file shows a friendly rejection', async () => {
    render(<App />);
    dropFile(screen.getByRole('button', { name: /drop a/i }), new File(['not xml'], 'notes.txt'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('notes.txt');
    expect(alert.textContent).toContain('.bprelease');
  });

  it('a file-less drop (e.g. dragged from a code editor) shows guidance', async () => {
    render(<App />);
    const target = screen.getByRole('button', { name: /drop a/i });
    const files = Object.assign([], { item: () => null });
    fireEvent.drop(target, {
      dataTransfer: { files, types: ['text/uri-list', 'codefiles', 'codeeditors'] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('code editor');
  });

  it('reset returns to the drop zone', async () => {
    await loadSampleIntoApp();
    fireEvent.click(screen.getByRole('button', { name: /load a different file/i }));
    expect(screen.getByRole('button', { name: /drop a/i })).toBeTruthy();
  });
});
