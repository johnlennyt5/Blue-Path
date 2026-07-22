import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { translateBpExpression } from './bpExpression';
import { convertProcess } from './convert';
import { emitWorkflowXaml } from './xaml';

/**
 * S5-3 AC: exception paths in corpus #2 preserved semantically.
 * BP semantics: a page's Recover catches every exception from the page flow;
 * Resume continues the recovery chain; deliberate Exception stages throw
 * (business type → BusinessRuleException); in queue context, failures mark
 * the transaction Failed.
 */

describe('S5-3 · corpus #2 exception paths preserved', () => {
  it('Process Item: try = Enter Invoice path, recovery = Mark Exception → Failed', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const pageXaml = emitWorkflowXaml(
      conversion.workflows.find((w) => w.path === 'Pages/Process_Item.xaml')!.doc,
    );

    // Structure: TryCatch wrapping the page flow, single catch-all like BP
    expect(pageXaml).toContain('<TryCatch DisplayName="Process Item (BP Recover/Resume)">');
    expect(pageXaml).toContain('<Catch x:TypeArguments="s:Exception">');
    expect(pageXaml).toContain(
      '<DelegateInArgument x:TypeArguments="s:Exception" Name="exception" />',
    );

    // Recovery chain semantics: Resume marker then transaction Failed
    const recoveryStart = pageXaml.indexOf('DisplayName="Recovery"');
    expect(recoveryStart).toBeGreaterThan(-1);
    const recovery = pageXaml.slice(recoveryStart);
    expect(recovery).toContain('BP Resume: normal flow resumes here.');
    expect(recovery).toContain('Status="Failed"');
    expect(recovery).toContain('ErrorType="Application"');

    // The failure path happens in recovery, not in the try block
    const tryBlock = pageXaml.slice(0, recoveryStart);
    expect(tryBlock).not.toContain('Status="Failed"');
  });

  it('Main page: recovery exits to End without marking success', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const conversion = convertProcess(model, performer);
    const mainXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);

    const recoveryStart = mainXaml.indexOf('DisplayName="Recovery"');
    const recovery = mainXaml.slice(recoveryStart);
    expect(recovery).not.toContain('Status="Successful"');
  });

  it('sample #1: business validation throws BusinessRuleException, caught by main recovery', async () => {
    const { xml } = await loadSample('01-clean-and-simple');
    const { model } = await parseBpRelease(xml);
    const conversion = convertProcess(model, model.processes[0]!);

    const pageXaml = emitWorkflowXaml(conversion.workflows[1]!.doc);
    expect(pageXaml).toContain('New UiPath.Core.BusinessRuleException');

    const mainXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    // BP semantics: the caller's Recover catches the subsheet's throw
    expect(mainXaml).toContain('(BP Recover/Resume)');
    expect(mainXaml).toContain('<Catch x:TypeArguments="s:Exception">');
  });
});

describe('S5-3 · rethrow (preserve current exception)', () => {
  const rethrowXml = `<?xml version="1.0"?>
<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">
  <bpr:package-name>Rethrow Test</bpr:package-name>
  <bpr:contents count="1">
    <process id="p1" name="Rethrow Demo">
      <process name="Rethrow Demo" version="1.0" bpversion="6.10.1" narrative="Rethrow semantics">
        <subsheet subsheetid="page-1" type="MainPage" published="True"><name>Main Page</name></subsheet>
        <stage stageid="s1" name="Start" type="Start"><subsheetid>page-1</subsheetid><onsuccess>s2</onsuccess></stage>
        <stage stageid="s2" name="Work" type="Calculation"><subsheetid>page-1</subsheetid><calculation expression="1" stage="X" /><onsuccess>s3</onsuccess></stage>
        <stage stageid="s3" name="End" type="End"><subsheetid>page-1</subsheetid></stage>
        <stage stageid="s4" name="Recover" type="Recover"><subsheetid>page-1</subsheetid><onsuccess>s5</onsuccess></stage>
        <stage stageid="s5" name="Log And Rethrow" type="Exception"><subsheetid>page-1</subsheetid><exception usecurrent="True" /></stage>
        <stage stageid="s6" name="X" type="Data"><subsheetid>page-1</subsheetid><datatype>number</datatype><initialvalue /></stage>
      </process>
    </process>
  </bpr:contents>
</bpr:release>`;

  it('parses usecurrent and emits <Rethrow /> inside recovery', async () => {
    const { model, errors } = await parseBpRelease(rethrowXml);
    expect(errors).toEqual([]);
    const conversion = convertProcess(model, model.processes[0]!);
    const xaml = emitWorkflowXaml(conversion.workflows[0]!.doc);

    expect(xaml).toContain('<Rethrow DisplayName="Log And Rethrow" />');
    // Rethrow lives in the catch, not the try
    const recoveryStart = xaml.indexOf('DisplayName="Recovery"');
    expect(xaml.indexOf('<Rethrow')).toBeGreaterThan(recoveryStart);
    expect(conversion.punchList.filter((i) => i.reason.includes('Rethrow'))).toEqual([]);
  });
});

describe('S5-3 · recovery-context expression functions', () => {
  it('ExceptionDetail() and ExceptionType() map to the catch delegate', () => {
    expect(translateBpExpression('ExceptionDetail()').vb).toBe('exception.Message');
    expect(translateBpExpression('ExceptionType()').vb).toBe('exception.GetType().Name');
    expect(translateBpExpression('"failed: " & ExceptionDetail()').vb).toBe(
      '"failed: " & exception.Message',
    );
    expect(translateBpExpression('ExceptionType() = "BusinessRuleException"').vb).toBe(
      'exception.GetType().Name = "BusinessRuleException"',
    );
  });

  it('ExceptionStage() is flagged — no runtime equivalent', () => {
    const result = translateBpExpression('ExceptionStage()');
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('no UiPath equivalent');
  });
});
