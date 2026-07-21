import { describe, expect, it } from 'vitest';
import { SAMPLES, loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { summarizeObject, summarizeProcess } from './summary';

describe.each(SAMPLES)('summaries vs corpus keys · $id', (sampleRef) => {
  it('matches every expected summary fact', async () => {
    const { xml, answerKey } = await loadSample(sampleRef.id);
    expect(
      answerKey.expectedSummaries,
      'every corpus sample must carry summary ground truth',
    ).toBeDefined();

    const { model } = await parseBpRelease(xml);

    for (const expected of answerKey.expectedSummaries!) {
      const process = model.processes.find((p) => p.name === expected.processName);
      expect(process, `process ${expected.processName}`).toBeDefined();
      const summary = summarizeProcess(model, process!);

      expect(summary.applicationsTouched).toEqual(expected.applicationsTouched);
      expect(summary.objectsCalled).toEqual(expected.objectsCalled);
      expect(summary.queuesUsed).toEqual(expected.queuesUsed);
      expect(summary.inputs.map((p) => p.name)).toEqual(expected.inputs);
      expect(summary.outputs.map((p) => p.name)).toEqual(expected.outputs);
      expect(summary.exceptionStrategy.hasRecovery).toBe(expected.hasRecovery);
      expect(summary.exceptionStrategy.recoveryPages).toEqual(expected.recoveryPages);
      expect(summary.exceptionStrategy.deliberateThrows.length > 0).toBe(
        expected.deliberateThrows,
      );

      const mainOutline = summary.outline[0]!;
      expect(
        mainOutline.steps.slice(0, expected.mainPageFirstSteps.length),
        `main page outline for ${expected.processName}`,
      ).toEqual(expected.mainPageFirstSteps);

      const flaggedNames = [...new Set(summary.sensitivity.map((f) => f.itemName))].sort();
      expect(flaggedNames, `sensitivity flags for ${expected.processName}`).toEqual(
        expected.sensitiveItems,
      );
    }
  });

  it('is deterministic', async () => {
    const { xml } = await loadSample(sampleRef.id);
    const { model } = await parseBpRelease(xml);
    for (const process of model.processes) {
      expect(summarizeProcess(model, process)).toEqual(summarizeProcess(model, process));
    }
  });
});

describe('object summaries', () => {
  it('captures application, action pages, and exception strategy', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const summary = summarizeObject(model, model.objects[0]!);

    expect(summary).toMatchObject({
      kind: 'object',
      name: 'Invoice Entry VBO',
      applicationName: 'Invoice Web App',
      actionPages: ['Get Pending Invoices', 'Enter Invoice'],
      stageCount: 15,
    });
    // The VBO throws on save-timeout but has no recover of its own
    expect(summary.exceptionStrategy.hasRecovery).toBe(false);
    expect(summary.exceptionStrategy.deliberateThrows).toEqual([
      { pageName: 'Enter Invoice', stageName: 'Save Not Confirmed', exceptionType: 'System Exception' },
    ]);
  });

  it('outline sentences cover the interactive stage kinds', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const summary = summarizeObject(model, model.objects[0]!);
    const enterInvoice = summary.outline.find((o) => o.pageName === 'Enter Invoice')!;

    expect(enterInvoice.steps.slice(0, 3)).toEqual([
      'Write 2 value(s) to the application',
      'Navigate: Click',
      'Wait for 1 condition(s) (no timeout)',
    ]);
    expect(enterInvoice.steps[3]).toMatch(/^Throw System Exception \("Invoice save was not confirmed/);
    expect(enterInvoice.steps).toHaveLength(4);
  });

  it('flags password-typed items (S3-4)', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const summary = summarizeObject(model, model.objects[0]!);

    expect(summary.sensitivity).toEqual([
      { itemName: 'Archive Password', pageName: 'Get Pending Invoices', reason: 'password-type' },
    ]);
  });

  it('flags PII collection fields and PII-named items (S3-4)', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const { model } = await parseBpRelease(xml);
    const vbo = model.objects.find((o) => o.name === 'Ledger Terminal VBO')!;
    const summary = summarizeObject(model, vbo);

    expect(summary.sensitivity.map((f) => `${f.itemName} [${f.reason}]`)).toEqual([
      'Account Number [name-pattern]',
      'Ledger Rows.Account Number [name-pattern]',
      'Ledger Rows.SSN [name-pattern]',
      'Password [password-type]',
    ]);
  });
});
