import { describe, expect, it } from 'vitest';
import { SAMPLES, loadSample } from '@prismshift/corpus';
import { validateModel } from '@prismshift/ir';
import type { BusinessObjectNode, ProcessNode } from '@prismshift/ir';
import { parseBpRelease } from './index';

/** Tally IR stage kinds across all pages of a process/object. */
function tallyKinds(node: ProcessNode | BusinessObjectNode): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const page of node.pages) {
    for (const stage of page.stages) {
      tally[stage.kind] = (tally[stage.kind] ?? 0) + 1;
    }
  }
  return tally;
}

describe.each(SAMPLES)('parseBpRelease · corpus sample $id', (sampleRef) => {
  it('parses to IR matching the answer key', async () => {
    const { xml, answerKey } = await loadSample(sampleRef.id);
    const { model, warnings, errors } = await parseBpRelease(xml);
    const expected = answerKey.expectedParse;

    expect(errors, JSON.stringify(errors)).toHaveLength(expected.errors);
    expect(warnings, JSON.stringify(warnings)).toHaveLength(expected.warnings);

    expect(model.meta.bpVersion).toBe(expected.bpVersion);
    expect(model.meta.packageName).toBe(expected.packageName);
    expect(model.meta.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    expect(model.processes).toHaveLength(expected.counts.processes);
    expect(model.objects).toHaveLength(expected.counts.objects);
    expect(model.workQueues).toHaveLength(expected.counts.workQueues);
    expect(model.environmentVars).toHaveLength(expected.counts.environmentVars);
    expect(model.credentialsRefs).toHaveLength(expected.counts.credentialRefs);

    for (const [i, stats] of expected.processes.entries()) {
      const node = model.processes[i]!;
      expect(node.name).toBe(stats.name);
      expect(node.pages.map((p) => p.name)).toEqual(stats.pages);
      expect(node.pages.reduce((n, p) => n + p.stages.length, 0)).toBe(stats.stageCount);
      expect(node.dataItems).toHaveLength(stats.dataItemCount);
      expect(node.startupParams.map((p) => p.name)).toEqual(stats.startupParams);
      expect(node.outputs.map((p) => p.name)).toEqual(stats.outputs);
      expect(tallyKinds(node)).toEqual(stats.stageKinds);
      expect(node.description, `${stats.name} keeps its narrative`).toBeTruthy();
    }

    for (const [i, stats] of expected.objects.entries()) {
      const node = model.objects[i]!;
      expect(node.name).toBe(stats.name);
      expect(node.pages.map((p) => p.name)).toEqual(stats.pages);
      expect(node.pages.reduce((n, p) => n + p.stages.length, 0)).toBe(stats.stageCount);
      expect(node.dataItems).toHaveLength(stats.dataItemCount);
      expect(tallyKinds(node)).toEqual(stats.stageKinds);
      if (stats.applicationName !== undefined) {
        expect(node.appModel?.applicationName).toBe(stats.applicationName);
      }
      if (stats.appElementCount !== undefined) {
        expect(node.appModel?.elements).toHaveLength(stats.appElementCount);
      }
    }
  });

  it('produces a structurally sound model (validateModel finds nothing)', async () => {
    const { xml } = await loadSample(sampleRef.id);
    const { model } = await parseBpRelease(xml);
    expect(validateModel(model)).toEqual([]);
  });

  it('is deterministic: identical input yields identical IR', async () => {
    const { xml } = await loadSample(sampleRef.id);
    const first = await parseBpRelease(xml);
    const second = await parseBpRelease(xml);
    expect(second).toEqual(first);
  });
});

describe('parseBpRelease · specific mappings (sample #2)', () => {
  it('tags queue actions with the queue name and builds the dependency graph', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);

    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const addToQueue = dispatcher.pages[0]!.stages.find((s) => s.name === 'Add To Queue');
    expect(addToQueue?.kind).toBe('action');
    if (addToQueue?.kind === 'action') {
      expect(addToQueue.queueName).toBe('Invoices Queue');
    }

    expect(model.dependencies).toEqual(
      expect.arrayContaining([
        { fromType: 'process', fromName: 'Invoice Dispatcher', toType: 'queue', toName: 'Invoices Queue' },
        { fromType: 'process', fromName: 'Invoice Dispatcher', toType: 'object', toName: 'Invoice Entry VBO' },
        { fromType: 'process', fromName: 'Invoice Performer', toType: 'queue', toName: 'Invoices Queue' },
        { fromType: 'process', fromName: 'Invoice Performer', toType: 'object', toName: 'Invoice Entry VBO' },
        { fromType: 'object', fromName: 'Invoice Entry VBO', toType: 'application', toName: 'Invoice Web App' },
      ]),
    );
  });

  it('preserves the planted issues for the rules engine to find', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);

    // SEC-001 raw material: the literal password survives in the expression
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const getPending = dispatcher.pages[0]!.stages.find((s) => s.name === 'Get Pending Invoices');
    if (getPending?.kind !== 'action') throw new Error('expected action stage');
    expect(getPending.inputs[0]?.expression.raw).toBe('"ArchiveP@ss2024!"');

    // REL-003 raw material: the wait stage has no timeout
    const vbo = model.objects[0]!;
    const wait = vbo.pages
      .flatMap((p) => p.stages)
      .find((s) => s.name === 'Wait For Confirmation');
    if (wait?.kind !== 'wait') throw new Error('expected wait stage');
    expect(wait.timeoutSeconds).toBeUndefined();
    expect(wait.conditions[0]).toEqual({
      elementId: 'eeeeeeee-0000-4000-9000-00000000e004',
      condition: 'CheckExists',
    });

    // Code stage body survives with its language
    const code = vbo.pages.flatMap((p) => p.stages).find((s) => s.kind === 'code');
    if (code?.kind !== 'code') throw new Error('expected code stage');
    expect(code.language).toBe('vbnet');
    expect(code.body).toContain('ExportReader');

    // Environment exposure mapped
    const envItem = vbo.dataItems.find((d) => d.name === 'Invoice System URL');
    expect(envItem?.exposure).toBe('environment');
  });
});

describe('parseBpRelease · resilience', () => {
  it('reports malformed XML as an error instead of throwing', async () => {
    const result = await parseBpRelease('<bpr:release><unclosed');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.model.processes).toHaveLength(0);
    expect(result.model.meta.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports non-BP XML as an error', async () => {
    const result = await parseBpRelease('<html><body>nope</body></html>');
    expect(result.errors[0]?.message).toContain('Not a Blue Prism export');
  });

  it('degrades unknown stage types to GenericStage with a warning', async () => {
    const xml = `<?xml version="1.0"?>
<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">
  <bpr:package-name>Test</bpr:package-name>
  <bpr:contents count="1">
    <process id="p1" name="P1">
      <process name="P1" version="1.0" bpversion="6.10.1" narrative="Test process">
        <subsheet subsheetid="page-1" type="MainPage" published="True"><name>Main Page</name></subsheet>
        <stage stageid="s1" name="Start" type="Start"><subsheetid>page-1</subsheetid><onsuccess>s2</onsuccess></stage>
        <stage stageid="s2" name="Mystery" type="HologramProjector"><subsheetid>page-1</subsheetid><onsuccess>s3</onsuccess></stage>
        <stage stageid="s3" name="End" type="End"><subsheetid>page-1</subsheetid></stage>
      </process>
    </process>
  </bpr:contents>
</bpr:release>`;
    const { model, warnings, errors } = await parseBpRelease(xml);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('HologramProjector');

    const stage = model.processes[0]!.pages[0]!.stages[1];
    expect(stage?.kind).toBe('generic');
    if (stage?.kind === 'generic') {
      expect(stage.rawType).toBe('HologramProjector');
      expect(stage.raw).toBeDefined();
    }
  });

  it('parses a bare single-process export', async () => {
    const xml = `<process name="Solo" version="1.0" bpversion="6.10.1" narrative="Standalone export" preferredid="solo-1">
      <subsheet subsheetid="page-1" type="MainPage" published="True"><name>Main Page</name></subsheet>
      <stage stageid="s1" name="Start" type="Start"><subsheetid>page-1</subsheetid><onsuccess>s2</onsuccess></stage>
      <stage stageid="s2" name="End" type="End"><subsheetid>page-1</subsheetid></stage>
    </process>`;
    const { model, errors } = await parseBpRelease(xml);
    expect(errors).toHaveLength(0);
    expect(model.processes).toHaveLength(1);
    expect(model.processes[0]!.name).toBe('Solo');
    expect(model.processes[0]!.id).toBe('solo-1');
  });
});
