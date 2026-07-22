import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { buildConversionView } from './conversionView';

describe('buildConversionView (S5-6)', () => {
  it('walks every dispatcher stage with its UiPath mapping', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const view = buildConversionView(model, dispatcher, true);

    expect(view.rows).toHaveLength(10); // one row per BP stage
    expect(view.coveragePct).toBe(100);
    expect(view.manualCount).toBe(0);

    const byName = new Map(view.rows.map((r) => [r.stageName, r]));
    expect(byName.get('Add To Queue')!.uipath).toBe('ui:AddQueueItem (per-field ItemInformation)');
    expect(byName.get('Add To Queue')!.status).toBe('converted');
    expect(byName.get('For Each Invoice')!.uipath).toBe('ForEachRow over New Invoices');
    expect(byName.get('Get Pending Invoices')!.uipath).toBe(
      'InvokeWorkflowFile Objects\\Invoice_Entry_VBO\\Get_Pending_Invoices.xaml',
    );
  });

  it('classifies performer stages truthfully: cycle → manual, cross-page item → review', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const view = buildConversionView(model, performer, true);

    // The polling loop-back makes this genuinely manual work (restructure
    // into the REFramework transaction loop) — and it says so.
    const getNext = view.rows.find((r) => r.stageName === 'Get Next Item')!;
    expect(getNext.uipath).toBe('ui:GetQueueItem → TransactionItem');
    expect(getNext.status).toBe('manual');
    expect(getNext.notes.join(' ')).toContain('Reference');
    expect(getNext.notes.join(' ')).toContain('cycle');

    // Cross-page TransactionItem is a review item, not a conversion gap
    const markException = view.rows.find((r) => r.stageName === 'Mark Exception')!;
    expect(markException.uipath).toBe('ui:SetTransactionStatus (Failed)');
    expect(markException.status).toBe('review');

    const markCompleted = view.rows.find((r) => r.stageName === 'Mark Completed')!;
    expect(markCompleted.status).toBe('converted');
    expect(view.reviewCount).toBeGreaterThan(0);
    expect(view.manualCount).toBeGreaterThan(0);
  });

  it('object UI stages inherit their selector confidence', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const view = buildConversionView(model, model.objects[0]!, false);

    const write = view.rows.find((r) => r.stageName === 'Write Invoice Fields')!;
    expect(write.uipath).toBe('ui:TypeInto ×2');
    expect(write.confidence).toBeGreaterThanOrEqual(0.85); // strong HTML id selector

    const wait = view.rows.find((r) => r.stageName === 'Wait For Confirmation')!;
    expect(wait.uipath).toBe('ui:UiElementExists + If (found / timed out)');
    expect(wait.status).toBe('review'); // defaulted timeout
  });

  it('unknown stage types surface as manual work', async () => {
    const { xml } = await loadSample('04-edge-cases');
    const { model } = await parseBpRelease(xml);
    const view = buildConversionView(model, model.processes[0]!, true);

    const info = view.rows.find((r) => r.stageName === 'About This Process')!;
    expect(info.status).toBe('manual');
    expect(info.uipath).toContain('unknown BP stage type "ProcessInfo"');
    expect(info.confidence).toBe(0.2);
    expect(view.manualCount).toBeGreaterThan(0);
  });
});
