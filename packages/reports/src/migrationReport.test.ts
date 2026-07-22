import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertObject, convertProcess } from '@prismshift/transformer';
import { buildMigrationReport } from './migrationReport';

async function performerReport() {
  const { xml } = await loadSample('02-realistic-mid-size');
  const { model } = await parseBpRelease(xml);
  const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
  const conversion = convertProcess(model, performer);
  const objectConversion = convertObject(model, model.objects[0]!);
  return {
    report: buildMigrationReport(conversion, [objectConversion]),
    conversion,
    objectConversion,
  };
}

describe('buildMigrationReport (S5-5)', () => {
  it('reports coverage for the process and every object', async () => {
    const { report } = await performerReport();
    expect(report).toContain('# Migration Report — Invoice Performer');
    expect(report).toContain('| Invoice Performer (process) | 19/19 | 100% |');
    expect(report).toContain('| Invoice Entry VBO (object) | 15/15 | 100% |');
  });

  it('punch list rows carry sourceRefs into the original XML', async () => {
    const { report, conversion } = await performerReport();
    expect(conversion.punchList.length).toBeGreaterThan(0);
    for (const issue of conversion.punchList) {
      expect(report).toContain(issue.reason);
      expect(report).toContain(`\`${issue.sourceRef}\``);
    }
    expect(report).toContain('/bpr:release/bpr:contents/process[2]/process/stage[');
  });

  it('lists every selector on the mandatory validation checklist', async () => {
    const { report, objectConversion } = await performerReport();
    expect(report).toContain('## Selector validation checklist (4 — ALL mandatory)');
    for (const selector of objectConversion.selectors) {
      expect(report).toContain(selector.elementName);
    }
    expect(report).toContain("`<webctrl tag='INPUT' id='invoiceRef' />`");
    expect(report).toContain('cannot be verified without the live target applications');
  });

  it('computes a deterministic effort estimate', async () => {
    const { report } = await performerReport();
    expect(report).toContain('## Effort estimate');
    // 34 stages × 3 min = 1.7h review
    expect(report).toContain('| Review converted workflows | 34 stages × 3 min | 1.7 |');
    expect(report).toMatch(/\| \*\*Total\*\* \| \| \*\*\d+\.\d\*\* \|/);

    const again = (await performerReport()).report;
    expect(again).toBe(report);
  });

  it('handles image/OCR selectors as risky in the estimate', async () => {
    const { xml } = await loadSample('04-edge-cases');
    const { model } = await parseBpRelease(xml);
    const process = model.processes[0]!;
    const report = buildMigrationReport(
      convertProcess(model, process),
      [convertObject(model, model.objects[0]!)],
    );
    expect(report).toContain('**Image/OCR required**');
    expect(report).toMatch(/\+20 min for [1-9]\d* risky/);
  });
});
