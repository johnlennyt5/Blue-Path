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
  it('Get Next Item → GetQueueItem + Reference assign; Mark Completed → Successful', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const mainXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);

    expect(mainXaml).toContain(
      '<ui:GetQueueItem DisplayName="Get Next Item" QueueType="[&quot;Invoices Queue&quot;]"',
    );
    expect(mainXaml).toContain('TransactionItem="[TransactionItem]"');
    expect(mainXaml).toContain(
      '[If(TransactionItem Is Nothing, String.Empty, TransactionItem.Reference)]',
    );
    expect(mainXaml).toContain(
      '<ui:SetTransactionStatus DisplayName="Mark Completed" Status="Successful" TransactionItem="[TransactionItem]" />',
    );
    expect(mainXaml).toContain('<Variable x:TypeArguments="ui:QueueItem" Name="TransactionItem" />');
  });

  it('Mark Exception → Failed with reason; cross-page TransactionItem is flagged', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const pageXaml = emitWorkflowXaml(conversion.workflows[1]!.doc);

    expect(pageXaml).toContain('Status="Failed"');
    expect(pageXaml).toContain('ErrorType="Application"');
    expect(pageXaml).toContain('Reason="[&quot;Failed to enter invoice&quot;]"');

    const reasons = conversion.punchList.map((i) => i.reason);
    expect(reasons.some((r) => r.includes('pass it into this page'))).toBe(true);
    expect(reasons.some((r) => r.includes('SpecificContent'))).toBe(true);

    // Full coverage — remaining punch entries are review flags, not gaps
    expect(conversion.convertedStageCount).toBe(conversion.totalStageCount);
    expect(conversion.coveragePct).toBe(100);
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
