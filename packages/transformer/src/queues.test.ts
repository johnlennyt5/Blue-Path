import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertProcess } from './convert';
import { buildManifests } from './manifests';
import { buildProject } from './project';
import { emitWorkflowXaml } from './xaml';

async function sample2() {
  const { xml } = await loadSample('02-realistic-mid-size');
  const { model } = await parseBpRelease(xml);
  return model;
}

describe('S5-2 · dispatcher queue conversion', () => {
  it('Add To Queue inside the loop maps to AddQueueItem with per-field ItemInformation', async () => {
    const model = await sample2();
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const conversion = convertProcess(model, dispatcher);
    const xaml = emitWorkflowXaml(conversion.workflows[0]!.doc);

    expect(xaml).toContain(
      '<ui:AddQueueItem DisplayName="Add To Queue" QueueType="[&quot;Invoices Queue&quot;]">',
    );
    expect(xaml).toContain('x:Key="Invoice Ref">[CurrentRow(&quot;Invoice Ref&quot;)]');
    expect(xaml).toContain('x:Key="Amount">[CurrentRow(&quot;Amount&quot;)]');
    expect(xaml).toContain('x:Key="Due Date">[CurrentRow(&quot;Due Date&quot;)]');

    // Everything converts now that VBO calls invoke object workflows
    expect(conversion.punchList).toEqual([]);
    expect(conversion.coveragePct).toBe(100);
  });
});

describe('S5-2 · performer queue conversion', () => {
  it('BL-014: polling machinery is absorbed — the main page is one transaction of work', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const processXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);

    // The framework loop owns Get Next + status writes now (see
    // Framework\GetTransactionData / SetTransactionStatus in the scaffold).
    expect(conversion.workflows[0]!.path).toBe('Process.xaml');
    expect(processXaml).not.toContain('<ui:GetQueueItem');
    expect(processXaml).not.toContain('<ui:SetTransactionStatus');
    expect(processXaml).toContain('BL-014');
    // The work chain survives: one transaction = invoke Process Item.
    expect(processXaml).toContain('Pages\\Process_Item.xaml');
  });

  it('Mark Exception → Failed with reason; TransactionItem arrives as io_ argument', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const pageXaml = emitWorkflowXaml(conversion.workflows[1]!.doc);

    expect(pageXaml).toContain('Status="Failed"');
    expect(pageXaml).toContain('ErrorType="Application"');
    expect(pageXaml).toContain('Reason="[&quot;Failed to enter invoice&quot;]"');

    const reasons = conversion.punchList.map((i) => i.reason);
    // BL-013: the restructure flag is gone — the item is passed through.
    expect(reasons.some((r) => r.includes('pass it into this page'))).toBe(false);
    expect(reasons.some((r) => r.includes('verify every call site binds it'))).toBe(true);
    expect(reasons.some((r) => r.includes('SpecificContent'))).toBe(true);

    // Full coverage — remaining punch entries are review flags, not gaps
    expect(conversion.convertedStageCount).toBe(conversion.totalStageCount);
    expect(conversion.coveragePct).toBe(100);
  });

  it('BL-013: Process Item receives io_TransactionItem; caller binds it; reads use SpecificContent', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const mainXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    const pageXaml = emitWorkflowXaml(conversion.workflows[1]!.doc);

    // Callee declares the InOut argument and uses it for status + field reads
    expect(pageXaml).toContain(
      '<x:Property Name="io_TransactionItem" Type="InOutArgument(ui:QueueItem)" />',
    );
    expect(pageXaml).toContain('TransactionItem="[io_TransactionItem]"');
    expect(pageXaml).toContain(
      'CStr(io_TransactionItem.SpecificContent(&quot;Invoice Ref&quot;))',
    );
    expect(pageXaml).toContain('CDbl(io_TransactionItem.SpecificContent(&quot;Amount&quot;))');
    // No stray local variable shadowing the argument
    expect(pageXaml).not.toContain('<Variable x:TypeArguments="ui:QueueItem"');

    // The absorbed main page passes its own io_TransactionItem through
    expect(mainXaml).toContain(
      '<InOutArgument x:TypeArguments="ui:QueueItem" x:Key="io_TransactionItem">[io_TransactionItem]</InOutArgument>',
    );
  });

  it('BL-014: scaffold Main survives, invokes Process.xaml, and binds the item; deviant cycles stay manual', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);

    const reasons = conversion.punchList.map((i) => i.reason);
    expect(reasons.some((r) => r.includes('cycle needs manual restructuring'))).toBe(false);
    expect(
      reasons.some((r) => r.includes('absorbed into the REFramework transaction loop')),
    ).toBe(true);
    expect(conversion.coveragePct).toBe(100);

    const project = buildProject({
      name: performer.name,
      layout: 'reframework',
      queueName: 'Invoices Queue',
      workflows: conversion.workflows,
    });
    // No Main.xaml collision anymore: scaffold Main + converted Process coexist.
    expect(project.files.filter((f) => f.path === 'Main.xaml')).toHaveLength(1);
    expect(project.files.some((f) => f.path === 'Process.xaml')).toBe(true);
    const scaffoldMain = project.files.find((f) => f.path === 'Main.xaml')!;
    expect(scaffoldMain.content).toContain('Process.xaml');
    expect(scaffoldMain.content).toContain(
      'x:Key="io_TransactionItem">[TransactionItem]</InOutArgument>',
    );

    // Deviant shape: the Monolith's retry cycle is NOT a polling loop — it
    // keeps the honest manual flag.
    const { xml } = await loadSample('03-the-monolith');
    const { model: monolith } = await parseBpRelease(xml);
    const reconciliation = monolith.processes[0]!;
    const monolithConversion = convertProcess(monolith, reconciliation);
    const monolithReasons = monolithConversion.punchList.map((i) => i.reason);
    expect(monolithReasons.some((r) => r.includes('cycle needs manual restructuring'))).toBe(true);
  });

  it('BL-012: queue item data is a rewrite note, never a manual-mapping gap', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const reasons = conversion.punchList.map((i) => i.reason);

    // The old gap — "needs manual mapping" with the variable left unset — is gone…
    expect(reasons.some((r) => r.includes('needs manual mapping'))).toBe(false);
    // …replaced by the review note that field reads use SpecificContent.
    expect(
      reasons.some((r) => r.includes('rewritten to TransactionItem.SpecificContent')),
    ).toBe(true);

    // The Main Page comment tells the reviewer the DataTable is bypassed.
    const mainXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    expect(mainXaml).toContain('stays unused');
  });
});

describe('S5-2 · manifests', () => {
  it('emits queue + asset manifests from the release', async () => {
    const model = await sample2();
    const files = buildManifests(model);
    expect(files.map((f) => f.path)).toEqual(['AssetsManifest.json', 'QueuesManifest.json']);

    const queues = JSON.parse(files[1]!.content) as Record<string, unknown>[];
    expect(queues).toEqual([
      {
        name: 'Invoices Queue',
        keyField: 'Invoice Ref',
        maxAttempts: 3,
        encrypted: false,
        source: 'work-queue-definition',
      },
    ]);

    const assets = JSON.parse(files[0]!.content) as Record<string, unknown>[];
    expect(assets).toEqual([
      {
        name: 'Invoice System URL',
        type: 'Text',
        value: 'https://invoices.corp.example',
        description: 'Base URL of the invoice web application',
        source: 'environment-variable',
      },
    ]);
  });
});

describe('S5-2 · queue-wired REFramework scaffold', () => {
  it('GetTransactionData/SetTransactionStatus use real queue activities', () => {
    const project = buildProject({
      name: 'Queue Driven',
      layout: 'reframework',
      queueName: 'Invoices Queue',
      workflows: [],
    });

    const getData = project.files.find((f) => f.path === 'Framework/GetTransactionData.xaml')!;
    expect(getData.content).toContain('<ui:GetQueueItem');
    expect(getData.content).toContain('QueueType="[&quot;Invoices Queue&quot;]"');
    expect(getData.content).toContain('OutArgument(ui:QueueItem)');

    const setStatus = project.files.find((f) => f.path === 'Framework/SetTransactionStatus.xaml')!;
    expect(setStatus.content).toContain('Status="Successful"');
    expect(setStatus.content).toContain('Status="Failed"');
    expect(setStatus.content).toContain('InArgument(ui:QueueItem)');

    const main = project.files.find((f) => f.path === 'Main.xaml')!;
    expect(main.content).toContain('<Variable x:TypeArguments="ui:QueueItem" Name="TransactionItem" />');
  });
});
