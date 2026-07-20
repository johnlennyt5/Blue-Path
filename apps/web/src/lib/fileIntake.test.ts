import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  formatBytes,
  hasAcceptedExtension,
  looksLikeBpExport,
  readReleaseFile,
} from './fileIntake';

const BP_XML = `<?xml version="1.0" encoding="utf-8"?>
<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">
  <bpr:name>Test</bpr:name>
</bpr:release>`;

describe('hasAcceptedExtension', () => {
  it('accepts .bprelease and .xml in any case', () => {
    expect(hasAcceptedExtension('export.bprelease')).toBe(true);
    expect(hasAcceptedExtension('Process One.XML')).toBe(true);
    expect(hasAcceptedExtension('EXPORT.BPRELEASE')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(hasAcceptedExtension('export.zip')).toBe(false);
    expect(hasAcceptedExtension('export.bprelease.exe')).toBe(false);
    expect(hasAcceptedExtension('notes.txt')).toBe(false);
  });
});

describe('looksLikeBpExport', () => {
  it('accepts a release export', () => {
    expect(looksLikeBpExport(BP_XML)).toBe(true);
  });

  it('accepts a bare single-process export with leading whitespace', () => {
    expect(looksLikeBpExport('\n  <process name="P1" version="1.0"></process>')).toBe(true);
  });

  it('rejects JSON, HTML-ish garbage, and binary content', () => {
    expect(looksLikeBpExport('{"not": "xml"}')).toBe(false);
    expect(looksLikeBpExport('<html><body>hello</body></html>')).toBe(false);
    expect(looksLikeBpExport('<bpr:release\u0000corrupted')).toBe(false);
  });
});

describe('readReleaseFile', () => {
  it('reads a valid .bprelease client-side', async () => {
    const result = await readReleaseFile(new File([BP_XML], 'sample.bprelease'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.fileName).toBe('sample.bprelease');
      expect(result.file.xml).toBe(BP_XML);
      expect(result.file.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('rejects a wrong extension with a friendly reason', async () => {
    const result = await readReleaseFile(new File([BP_XML], 'sample.zip'));
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('.bprelease') as string,
    });
  });

  it('rejects empty files', async () => {
    const result = await readReleaseFile(new File([], 'empty.bprelease'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('empty');
  });

  it('rejects files over the 50 MB limit without reading them', async () => {
    const big = new File([new Uint8Array(1024)], 'big.bprelease');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    const result = await readReleaseFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('50 MB');
  });

  it('rejects non-XML content with guidance', async () => {
    const result = await readReleaseFile(new File(['just some text'], 'fake.bprelease'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('does not look like Blue Prism XML');
  });
});

describe('formatBytes', () => {
  it('formats sizes at sensible precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
