import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertProcess } from './convert';
import { sanitizeIdentifier } from './naming';
import { emitWorkflowXaml } from './xaml';

async function convertSampleOne() {
  const { xml } = await loadSample('01-clean-and-simple');
  const { model } = await parseBpRelease(xml);
  return { model, conversion: convertProcess(model, model.processes[0]!) };
}

describe('convertProcess · corpus #1 "Clean & Simple"', () => {
  it('converts 100% of stages with an empty punch list (S4-3 AC)', async () => {
    const { conversion } = await convertSampleOne();
    expect(conversion.punchList).toEqual([]);
    expect(conversion.convertedStageCount).toBe(conversion.totalStageCount);
    expect(conversion.totalStageCount).toBe(19);
    expect(conversion.coveragePct).toBe(100);
  });

  it('emits Main.xaml + one workflow per subsheet, all well-formed', async () => {
    const { conversion } = await convertSampleOne();
    expect(conversion.workflows.map((w) => w.path)).toEqual([
      'Main.xaml',
      'Pages/Calculate_Payment.xaml',
    ]);
    for (const workflow of conversion.workflows) {
      expect(XMLValidator.validate(emitWorkflowXaml(workflow.doc)), workflow.path).toBe(true);
    }
  });

  it('maps process params to in_/out_ arguments replacing their data items', async () => {
    const { conversion } = await convertSampleOne();
    const main = conversion.workflows[0]!.doc;
    expect(main.arguments).toEqual([
      { name: 'in_Principal', direction: 'in', type: 'Double' },
      { name: 'in_Annual_Rate', direction: 'in', type: 'Double' },
      { name: 'in_Term_Months', direction: 'in', type: 'Double' },
      { name: 'out_Monthly_Payment', direction: 'out', type: 'Double' },
    ]);

    const xaml = emitWorkflowXaml(main);
    // The invoke passes translated identifiers, not raw BP names
    expect(xaml).toContain('x:Key="in_Principal">[in_Principal]');
    expect(xaml).toContain('x:Key="out_Monthly_Payment">[out_Monthly_Payment]');
  });

  it('reconstructs the subsheet flow: If → assigns / throw', async () => {
    const { conversion } = await convertSampleOne();
    const page = conversion.workflows[1]!.doc;
    const xaml = emitWorkflowXaml(page);

    expect(xaml).toContain('<If Condition="[in_Principal &gt; 0 And in_Term_Months &gt; 0]"');
    expect(xaml).toContain('[in_Annual_Rate / 12 / 100]');
    expect(xaml).toContain(
      'Exception="[New UiPath.Core.BusinessRuleException(&quot;Principal and Term Months must be greater than zero&quot;)]"',
    );
    // Local data item stays a variable; bound params became arguments
    expect(xaml).toContain('<Variable x:TypeArguments="x:Double" Name="Monthly_Rate" />');
    expect(page.arguments.map((a) => a.name)).toContain('out_Monthly_Payment');
  });

  it('wraps the main page in TryCatch for BP Recover/Resume', async () => {
    const { conversion } = await convertSampleOne();
    const xaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    expect(xaml).toContain('(BP Recover/Resume)');
    expect(xaml).toContain('<Catch x:TypeArguments="s:Exception">');
    expect(xaml).toContain('BP Resume: normal flow resumes here.');
  });

  it('is deterministic and snapshot-locked', async () => {
    const { conversion } = await convertSampleOne();
    const again = (await convertSampleOne()).conversion;
    expect(again).toEqual(conversion);
    expect(emitWorkflowXaml(conversion.workflows[0]!.doc)).toMatchSnapshot('main-xaml');
    expect(emitWorkflowXaml(conversion.workflows[1]!.doc)).toMatchSnapshot('page-xaml');
  });
});

describe('convertProcess · loops and object invokes (corpus #2 dispatcher)', () => {
  it('maps collection loops to ForEachRow and invokes converted VBO workflows', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const conversion = convertProcess(model, dispatcher);

    const xaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    expect(xaml).toContain('<ui:ForEachRow DataTable="[New_Invoices]"');
    // VBO calls now invoke the converted object workflows (S5-5)
    expect(xaml).toContain('WorkflowFileName="Objects\\Invoice_Entry_VBO\\Get_Pending_Invoices.xaml"');
    expect(xaml).toContain('x:Key="in_Archive_Password">[&quot;ArchiveP@ss2024!&quot;]');

    expect(conversion.punchList).toEqual([]);
    expect(conversion.convertedStageCount).toBe(conversion.totalStageCount);
    expect(conversion.coveragePct).toBe(100);
  });
});

describe('sanitizeIdentifier', () => {
  it('produces valid VB identifiers', () => {
    expect(sanitizeIdentifier('Monthly Payment')).toBe('Monthly_Payment');
    expect(sanitizeIdentifier('2nd Try!')).toBe('_2nd_Try');
    expect(sanitizeIdentifier('  ')).toBe('Item');
  });
});
