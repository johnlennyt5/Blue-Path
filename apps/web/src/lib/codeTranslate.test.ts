// @vitest-environment jsdom
/**
 * BL-005 · Code translation privacy + transport contracts: literals never
 * leave, placeholders round-trip, the proxy gets mode:'code' with redacted
 * payloads, and suggestions come back with literals restored.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Supabase } from './supabaseClient';
import {
  assertLiteralsRedacted,
  redactCodeLiterals,
  requestCodeTranslation,
  restoreLiterals,
} from './codeTranslate';

const VB_CODE = [
  'Dim conn As String = "Server=db01;Password=Hunter2!"',
  'Dim path As String = "\\\\fs01\\exports\\ledger.csv"',
  'If x > 5 Then result = "" Else result = path',
].join('\n');

describe('redaction round-trip', () => {
  it('replaces meaningful literals with placeholders; trivial ones stay', () => {
    const { redacted, literals } = redactCodeLiterals(VB_CODE);
    expect(redacted).not.toContain('Hunter2!');
    expect(redacted).not.toContain('fs01');
    expect(redacted).toContain('__LIT_1__');
    expect(redacted).toContain('""'); // trivial literal untouched
    expect(Object.keys(literals)).toHaveLength(2);
  });

  it('restoreLiterals is a perfect inverse over translated text', () => {
    const { redacted, literals } = redactCodeLiterals(VB_CODE);
    const translated = `' translated\n${redacted.replace('Dim conn As String =', 'Dim conn =')}`;
    const restored = restoreLiterals(translated, literals);
    expect(restored).toContain('"Server=db01;Password=Hunter2!"');
    expect(restored).toContain('\\\\fs01\\exports\\ledger.csv');
    expect(restored).not.toContain('__LIT_');
  });

  it('assertLiteralsRedacted trips on a leak', () => {
    const { literals } = redactCodeLiterals(VB_CODE);
    expect(() => assertLiteralsRedacted('leak: Server=db01;Password=Hunter2! here', literals)).toThrow(
      /redaction violation/,
    );
    expect(() => assertLiteralsRedacted('clean payload', literals)).not.toThrow();
  });
});

describe('requestCodeTranslation transport', () => {
  it('sends mode:"code" with the REDACTED body; returns suggestion with literals restored', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { narrative: '```vb\nDim conn As String = "__LIT_1__"\n```' },
      error: null,
    });
    const sb = { functions: { invoke } } as unknown as Supabase;

    const suggestion = await requestCodeTranslation(sb, 'ws1', {
      stageName: 'Read Export',
      language: 'vbnet',
      code: 'Dim conn As String = "Server=db01;Password=Hunter2!"',
    });

    const [, options] = invoke.mock.calls[0]!;
    const payload = JSON.stringify((options as { body: unknown }).body);
    expect(payload).toContain('"mode":"code"');
    expect(payload).not.toContain('Hunter2!'); // the AC: value never left
    expect(payload).toContain('__LIT_1__');

    expect(suggestion).toContain('Password=Hunter2!'); // restored client-side
    expect(suggestion).not.toContain('```'); // fences stripped
  });

  it('surfaces proxy gate errors verbatim', async () => {
    const context = new Response(JSON.stringify({ error: 'rate limit: 30 AI requests per workspace per hour' }), { status: 429 });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'non-2xx', context } });
    const sb = { functions: { invoke } } as unknown as Supabase;
    await expect(
      requestCodeTranslation(sb, 'ws1', { stageName: 'x', language: 'vbnet', code: 'Dim a = "very secret value"' }),
    ).rejects.toThrow(/rate limit/);
  });
});
