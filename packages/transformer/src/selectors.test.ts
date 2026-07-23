import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertObject } from './convert';
import { generateObjectSelectors } from './selectors';
import { emitWorkflowXaml } from './xaml';

describe('S5-4 · selector generation per mode', () => {
  it('HTML elements → webctrl selectors with strong-id confidence', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const selectors = generateObjectSelectors(model.objects[0]!);

    expect(selectors).toHaveLength(4);
    const refField = selectors.find((s) => s.elementName === 'Invoice Ref Field')!;
    expect(refField.selector).toBe("<webctrl tag='INPUT' id='invoiceRef' />");
    expect(refField.strategy).toBe('selector');
    expect(refField.confidence).toBeGreaterThanOrEqual(0.85);
    expect(refField.notes).toEqual([]);
  });

  it('Win32 index matches cap confidence and carry the REL-004 note', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const { model } = await parseBpRelease(xml);
    const vbo = model.objects.find((o) => o.name === 'Ledger Terminal VBO')!;
    const selectors = generateObjectSelectors(vbo);

    const session = selectors.find((s) => s.elementName === 'Session Window')!;
    expect(session.selector).toBe("<wnd title='Ledger Terminal' cls='LedgerMainWnd' />");
    expect(session.confidence).toBeGreaterThanOrEqual(0.7);

    const grid = selectors.find((s) => s.elementName === 'Grid Rows')!;
    expect(grid.selector).toContain("idx='3'");
    expect(grid.confidence).toBeLessThanOrEqual(0.25);
    expect(grid.notes.join(' ')).toContain('index/position match');
  });

  it('Citrix/Region are image/OCR candidates; disabled attributes are skipped', async () => {
    const { xml } = await loadSample('04-edge-cases');
    const { model } = await parseBpRelease(xml);
    const selectors = generateObjectSelectors(model.objects[0]!);

    const citrix = selectors.find((s) => s.elementName === 'Citrix Canvas')!;
    expect(citrix.strategy).toBe('image-ocr');
    expect(citrix.selector).toBeUndefined();
    expect(citrix.confidence).toBe(0.1);
    expect(citrix.notes.join(' ')).toContain('Image/OCR');

    const region = selectors.find((s) => s.elementName === 'Screen Region')!;
    expect(region.strategy).toBe('image-ocr');

    const sap = selectors.find((s) => s.elementName === 'SAP Field')!;
    expect(sap.selector).toBe("<sap id='wnd[0]/usr/txtBSEG-SGTXT' />");
    expect(sap.confidence).toBeGreaterThanOrEqual(0.85);

    const uia = selectors.find((s) => s.elementName === 'UIA Button')!;
    expect(uia.selector).toBe("<ctrl automationid='submitBtn' />");
  });
});

describe('S5-4 · object conversion (corpus #2 VBO)', () => {
  it('converts UI stages to Target-based activities with 100% coverage', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const conversion = convertObject(model, model.objects[0]!);

    expect(conversion.workflows.map((w) => w.path)).toEqual([
      'Objects/Invoice_Entry_VBO/Get_Pending_Invoices.xaml',
      'Objects/Invoice_Entry_VBO/Enter_Invoice.xaml',
    ]);
    expect(conversion.coveragePct).toBe(100);

    const enterInvoice = emitWorkflowXaml(conversion.workflows[1]!.doc);
    expect(enterInvoice).toContain(
      '<ui:Target Selector="&lt;webctrl tag=\'INPUT\' id=\'invoiceRef\' /&gt;" />',
    );
    expect(enterInvoice).toContain('<ui:TypeInto');
    expect(enterInvoice).toContain('Text="[in_Invoice_Ref]"');
    expect(enterInvoice).toContain('<ui:Click DisplayName="Click Save: Save Button">');
    expect(enterInvoice).toContain('<ui:UiElementExists DisplayName="Wait For Confirmation">');
    expect(enterInvoice).toContain('TimeoutMS="30000"');
    expect(enterInvoice).toContain('<Variable x:TypeArguments="x:Boolean" Name="Exists_Wait_For_Confirmation" />');
    // Timeout branch preserves the throw
    expect(enterInvoice).toContain('New System.Exception');
  });

  it('maps the VB.NET code stage to InvokeCode with argument bindings', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const conversion = convertObject(model, model.objects[0]!);

    const getPending = emitWorkflowXaml(conversion.workflows[0]!.doc);
    expect(getPending).toContain('<ui:InvokeCode');
    expect(getPending).toContain('Language="VBNet"');
    expect(getPending).toContain('ExportReader');
    expect(getPending).toContain('x:Key="Archive_Password">[in_Archive_Password]');
    // "Pending Invoices" backs the page's output param → it became out_Invoices
    expect(getPending).toContain('x:Key="Invoices">[out_Invoices]');
  });

  it('flags honestly: wait timeout default, code review, low-confidence items', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const conversion = convertObject(model, model.objects[0]!);

    const reasons = conversion.punchList.map((i) => i.reason);
    expect(reasons.some((r) => r.includes('defaulted to 30s'))).toBe(true);
    expect(reasons.some((r) => r.includes('Code stage body carried over'))).toBe(true);
    expect(conversion.selectors).toHaveLength(4);
  });
});

describe('BL-015 · multi-condition waits', () => {
  it('single-condition corpus wait is unchanged and dropped-conditions flag is gone', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const conversion = convertObject(model, model.objects[0]!);
    expect(
      conversion.punchList.some((p) => p.reason.includes('Additional wait conditions dropped')),
    ).toBe(false);
    const xamlOut = conversion.workflows.map((w) => emitWorkflowXaml(w.doc)).join('');
    expect(xamlOut).toContain('Name="Exists_Wait_For_Confirmation"');
  });

  it('a two-condition wait emits two UiElementExists Or-combined', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const vbo = structuredClone(model.objects[0]!);
    const wait = vbo.pages.flatMap((p) => p.stages).find((s) => s.kind === 'wait')!;
    if (wait.kind !== 'wait') return;
    wait.conditions = [...wait.conditions, ...wait.conditions];
    const conversion = convertObject(model, vbo);
    const xamlOut = conversion.workflows.map((w) => emitWorkflowXaml(w.doc)).join('');
    expect(xamlOut).toContain('Exists_Wait_For_Confirmation_1');
    expect(xamlOut).toContain('Exists_Wait_For_Confirmation_2');
    expect(xamlOut).toContain('Exists_Wait_For_Confirmation_1 Or Exists_Wait_For_Confirmation_2');
  });
});
