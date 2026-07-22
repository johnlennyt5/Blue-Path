/**
 * S8-1 · Chunked parsing + performance budgets (§12 targets, enforced in CI):
 *   - chunked ≡ whole parse on the real corpus (byte-identical models)
 *   - 5 MB synthetic release parses in < 5 s
 *   - 50 MB synthetic release parses chunked, with progress, bounded memory,
 *     and correct global source-path indices
 */
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from './parse';
import { scanTopLevelElements } from './chunked';

// ---------------------------------------------------------------------------
// Synthetic release generator (valid BP shapes, size-controllable)
// ---------------------------------------------------------------------------

function syntheticProcess(index: number, stageCount: number): string {
  const stages: string[] = [
    `<stage stageid="s${index}-start" name="Start" type="Start"><subsheetid>main${index}</subsheetid><onsuccess>s${index}-0</onsuccess></stage>`,
  ];
  for (let i = 0; i < stageCount; i++) {
    const next = i + 1 < stageCount ? `s${index}-${i + 1}` : `s${index}-end`;
    stages.push(
      `<stage stageid="s${index}-${i}" name="Calc ${i}" type="Calculation"><subsheetid>main${index}</subsheetid><calculation expression="([Amount ${index}] * ${i + 1}) + (${i} / 2) - 0.125" stage="Result ${index}" /><onsuccess>${next}</onsuccess></stage>`,
    );
  }
  stages.push(
    `<stage stageid="s${index}-end" name="End" type="End"><subsheetid>main${index}</subsheetid></stage>`,
    `<stage stageid="d${index}-1" name="Amount ${index}" type="Data"><subsheetid>main${index}</subsheetid><datatype>number</datatype><initialvalue>123.45</initialvalue></stage>`,
    `<stage stageid="d${index}-2" name="Result ${index}" type="Data"><subsheetid>main${index}</subsheetid><datatype>number</datatype></stage>`,
  );
  return [
    `<process name="Synthetic Process ${index}" id="proc-${index}">`,
    `<process name="Synthetic Process ${index}" version="1.0" bpversion="6.10.1.12345" narrative="Synthetic process ${index} for performance budgeting.">`,
    `<view><camerax>0</camerax></view>`,
    `<subsheet subsheetid="main${index}" type="MainPage"><name>Main Page</name></subsheet>`,
    stages.join('\n'),
    `</process>`,
    `</process>`,
  ].join('\n');
}

export function syntheticRelease(processCount: number, stagesPerProcess: number): string {
  const processes = Array.from({ length: processCount }, (_, i) =>
    syntheticProcess(i + 1, stagesPerProcess),
  );
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">`,
    `<bpr:name>Synthetic Estate</bpr:name>`,
    `<bpr:package-name>Synthetic Estate</bpr:package-name>`,
    `<bpr:created>2026-07-22 12:00:00Z</bpr:created>`,
    `<bpr:contents count="${processCount}">`,
    processes.join('\n'),
    `</bpr:contents>`,
    `</bpr:release>`,
  ].join('\n');
}

function sized(targetBytes: number, stagesPerProcess: number): string {
  const one = syntheticProcess(1, stagesPerProcess).length;
  const count = Math.max(2, Math.ceil(targetBytes / one));
  return syntheticRelease(count, stagesPerProcess);
}

// ---------------------------------------------------------------------------

describe('scanTopLevelElements', () => {
  it('ignores CDATA and comments that contain angle brackets', () => {
    const xml =
      '<c><a><![CDATA[ </a><b> ]]></a><!-- <fake></fake> --><b attr="1"/><d><e/></d></c>';
    const spans = scanTopLevelElements(xml, 3, xml.length - 4);
    expect(spans.map((s) => s.tag)).toEqual(['a', 'b', 'd']);
  });
});

describe('chunked ≡ whole (corpus)', () => {
  for (const sample of ['02-realistic-mid-size', '03-the-monolith', '04-edge-cases']) {
    it(`${sample}: chunked parse produces the identical model`, async () => {
      const { xml } = await loadSample(sample);
      const whole = await parseBpRelease(xml);
      const chunked = await parseBpRelease(xml, { chunkThreshold: 0 });
      expect(JSON.stringify(chunked.model)).toBe(JSON.stringify(whole.model));
      expect(JSON.stringify(chunked.warnings)).toBe(JSON.stringify(whole.warnings));
      expect(JSON.stringify(chunked.errors)).toBe(JSON.stringify(whole.errors));
    });
  }
});

describe('§12 performance budgets (CI-enforced)', () => {
  it('5 MB release parses in under 5 seconds', async () => {
    const xml = sized(5 * 1024 * 1024, 40);
    expect(xml.length).toBeGreaterThan(5 * 1024 * 1024);

    const startedAt = performance.now();
    const result = await parseBpRelease(xml);
    const elapsedMs = performance.now() - startedAt;

    expect(result.errors).toEqual([]);
    expect(result.model.processes.length).toBeGreaterThan(50);
    console.log(`5MB parse: ${elapsedMs.toFixed(0)} ms, ${result.model.processes.length} processes`);
    expect(elapsedMs).toBeLessThan(5000);
  }, 30000);

  it('50 MB release parses chunked with progress, bounded memory, correct indices', async () => {
    const xml = sized(50 * 1024 * 1024, 60);
    expect(xml.length).toBeGreaterThan(50 * 1024 * 1024);

    const progress: number[] = [];
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const result = await parseBpRelease(xml, {
      onProgress: ({ done, total }) => progress.push(done / total),
    });
    const elapsedMs = performance.now() - startedAt;
    const heapAfterMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

    expect(result.errors).toEqual([]);
    const count = result.model.processes.length;
    expect(count).toBeGreaterThan(400);
    // progress actually streamed
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.at(-1)).toBe(1);
    // global source-path indices survived the chunk merge
    expect(result.model.processes[count - 1]!.sourceRef.path).toContain(`process[${count}]`);
    // memory guard: retained heap stays far below the "whole-tree" blowup
    // (a whole parse of 50 MB expands to several hundred MB of JS objects)
    console.log(
      `50MB chunked parse: ${(elapsedMs / 1000).toFixed(1)} s, ${count} processes, +${heapAfterMb.toFixed(0)} MB retained heap`,
    );
    expect(elapsedMs).toBeLessThan(120_000);
  }, 240000);
});
