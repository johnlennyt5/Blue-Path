// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from './App';
import { useSession } from './store/session';

// jsdom ships no SubtleCrypto; the parser's SHA-256 needs it. Real browsers
// (and Node) provide it natively.
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  }
});

afterEach(() => {
  cleanup();
  useSession.getState().reset();
});

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">
  <bpr:name>Drop Test</bpr:name>
  <bpr:package-name>Drop Test Package</bpr:package-name>
  <bpr:contents count="1">
    <process id="p1" name="Drop Test Process">
      <process name="Drop Test Process" version="1.0" bpversion="6.10.1" narrative="Integration test process">
        <subsheet subsheetid="page-1" type="MainPage" published="True"><name>Main Page</name></subsheet>
        <stage stageid="s1" name="Start" type="Start"><subsheetid>page-1</subsheetid><onsuccess>s2</onsuccess></stage>
        <stage stageid="s2" name="End" type="End"><subsheetid>page-1</subsheetid></stage>
      </process>
    </process>
  </bpr:contents>
</bpr:release>`;

function dropFile(target: HTMLElement, file: File) {
  const files = Object.assign([file], { item: (i: number) => (i === 0 ? file : null) });
  fireEvent.drop(target, { dataTransfer: { files } });
}

describe('drop-to-tree integration', () => {
  it('dropping a .bprelease renders the loaded card and the process tree', async () => {
    render(<App />);
    const target = screen.getByRole('button', { name: /drop a/i });

    dropFile(target, new File([SAMPLE_XML], 'drop-test.bprelease'));

    // Loaded card appears with file metadata
    expect(await screen.findByText('drop-test.bprelease')).toBeTruthy();
    expect(await screen.findByText(/read into browser memory/)).toBeTruthy();

    // Parsed tree appears: package summary, process node, stages
    expect(await screen.findByText(/Drop Test Package/)).toBeTruthy();
    expect(await screen.findByText('Drop Test Process')).toBeTruthy();
    expect(await screen.findByText('Main Page')).toBeTruthy();
    expect((await screen.findAllByText('start')).length).toBeGreaterThan(0);
  });

  it('dropping a non-XML file shows a friendly rejection', async () => {
    render(<App />);
    const target = screen.getByRole('button', { name: /drop a/i });

    dropFile(target, new File(['not xml at all'], 'notes.txt'));

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
    expect(alert.textContent).toContain('File Explorer');
  });

  it('reset returns to the drop zone', async () => {
    render(<App />);
    dropFile(screen.getByRole('button', { name: /drop a/i }), new File([SAMPLE_XML], 'x.bprelease'));
    await screen.findByText(/read into browser memory/);

    fireEvent.click(screen.getByRole('button', { name: /load a different file/i }));
    expect(screen.getByRole('button', { name: /drop a/i })).toBeTruthy();
  });
});
