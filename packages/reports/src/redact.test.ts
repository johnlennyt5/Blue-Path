/**
 * S7-1 · Redaction suite. The AC verbatim: property tests prove no data-item
 * value survives redaction. Structure: corpus ground-truth checks, then
 * fuzzing — random values planted in every slot a value can live, digest
 * rebuilt, and the serialized output searched for survivors.
 */
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import type { AutomationModel } from '@prismshift/ir';
import { assertNoValuesSurvive, buildAiDigest, extractRefs } from './redact';

async function corpusModel(sample: string): Promise<AutomationModel> {
  const { xml } = await loadSample(sample);
  const { model } = await parseBpRelease(xml);
  return model;
}

// Deterministic pseudo-random values (no Math.random — reproducible failures).
function fuzzValues(count: number, seed: number): string[] {
  const values: string[] = [];
  let state = seed;
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+ .,/\\<>"\'';
  for (let i = 0; i < count; i++) {
    let value = '';
    const length = 8 + (state % 24);
    for (let j = 0; j < length; j++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      value += alphabet[state % alphabet.length];
    }
    values.push(value);
  }
  return values;
}

describe('extractRefs', () => {
  it('pulls only bracketed names, deduped and sorted', () => {
    expect(extractRefs('[Amount] * 2 + [Rate] & "secret" & [Amount]')).toEqual([
      'Amount',
      'Rate',
    ]);
    expect(extractRefs('"no refs here"')).toEqual([]);
  });
});

describe('digest ground truth (corpus #2)', () => {
  it('contains names, types, and structure', async () => {
    const model = await corpusModel('02-realistic-mid-size');
    const digest = buildAiDigest(model);
    const serialized = JSON.stringify(digest);

    expect(digest.owners.map((o) => o.name)).toContain('Invoice Dispatcher');
    expect(digest.owners.map((o) => o.name)).toContain('Invoice Entry VBO');
    expect(digest.queues).toContain('Invoices Queue');
    expect(serialized).toContain('"kind":"action"');
    // Data items appear as name+type…
    const dispatcher = digest.owners.find((o) => o.name === 'Invoice Dispatcher')!;
    expect(dispatcher.dataItems.length).toBeGreaterThan(0);
    for (const item of dispatcher.dataItems) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('type');
      expect(item).not.toHaveProperty('initialValue');
    }
  });

  it('the known corpus secrets do NOT appear', async () => {
    const model = await corpusModel('02-realistic-mid-size');
    const serialized = JSON.stringify(buildAiDigest(model));
    // Real values planted in the corpus sample:
    expect(serialized).not.toContain('ArchiveP@ss2024!');
    expect(serialized).not.toContain('https://invoices.internal');
    // No raw expression text either — only refs:
    expect(serialized).not.toContain('Rows(');
    expect(serialized).not.toContain('&quot;');
  });

  it('App Modeller attribute values are gone; element names remain', async () => {
    const model = await corpusModel('02-realistic-mid-size');
    const digest = buildAiDigest(model);
    const vbo = digest.owners.find((o) => o.name === 'Invoice Entry VBO')!;
    expect(vbo.appElements!.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(digest);
    expect(serialized).not.toContain('invoiceRef'); // the HTML id attribute value
    expect(serialized).not.toContain('webctrl');
  });
});

describe('PROPERTY: no data-item value survives redaction (the S7-1 AC)', () => {
  const SAMPLES = [
    '01-clean-and-simple',
    '02-realistic-mid-size',
    '03-the-monolith',
    '04-edge-cases',
  ];

  for (const sample of SAMPLES) {
    it(`${sample}: 40 fuzzed values planted in every slot, zero survivors`, async () => {
      const model = await corpusModel(sample);
      const planted = fuzzValues(40, sample.length * 7919);
      let cursor = 0;
      const next = () => planted[cursor++ % planted.length]!;

      const mutated = structuredClone(model) as AutomationModel;
      for (const owner of [...mutated.processes, ...mutated.objects]) {
        for (const item of owner.dataItems) item.initialValue = next();
        if ('appModel' in owner && owner.appModel !== undefined) {
          for (const element of owner.appModel.elements) {
            for (const attr of element.attributes) attr.value = next();
          }
        }
      }

      const digest = buildAiDigest(mutated); // throws on any survivor
      const serialized = JSON.stringify(digest).toLowerCase();
      for (const value of planted.slice(0, cursor)) {
        expect(
          serialized.includes(JSON.stringify(value).slice(1, -1).toLowerCase()),
          `planted value "${value}" leaked into the digest`,
        ).toBe(false);
      }
    });
  }

  it('literals inside expressions do not survive (raw text is dropped wholesale)', async () => {
    const model = structuredClone(await corpusModel('01-clean-and-simple')) as AutomationModel;
    const secret = 'S3cret-L1teral-Planted-In-Expression-9917';
    const calc = model.processes[0]!.pages
      .flatMap((p) => p.stages)
      .find((s) => s.kind === 'multiCalc') as unknown as {
      steps?: { expression: { raw: string } }[];
    };
    expect(calc?.steps?.[0]).toBeDefined();
    calc.steps![0]!.expression.raw = `"${secret}" & [Loan Amount]`;

    const serialized = JSON.stringify(buildAiDigest(model));
    expect(serialized).not.toContain(secret);
    // …but the referenced name IS kept:
    expect(serialized).toContain('Loan Amount');
  });
});

describe('assertNoValuesSurvive is a real tripwire', () => {
  it('throws when a digest is hand-tampered with a value', async () => {
    const model = structuredClone(await corpusModel('01-clean-and-simple')) as AutomationModel;
    model.processes[0]!.dataItems[0]!.initialValue = 'Tampered-Value-42';
    const digest = buildAiDigest(model);
    const dirty = structuredClone(digest);
    dirty.owners[0]!.name = 'renamed to Tampered-Value-42';
    expect(() => assertNoValuesSurvive(dirty, model)).toThrow(/redaction violation/);
  });
});

describe('determinism', () => {
  it('same model → byte-identical digest', async () => {
    const model = await corpusModel('02-realistic-mid-size');
    expect(JSON.stringify(buildAiDigest(model))).toBe(JSON.stringify(buildAiDigest(model)));
  });
});
