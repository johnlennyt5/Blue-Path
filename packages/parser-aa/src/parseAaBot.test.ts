/**
 * BL-004 · The acceptance test, verbatim: an AA sample passes the FULL
 * pipeline — findings (bidirectional answer-key diff), summaries, and
 * conversion — with only this parser package added. Zero changes to
 * rules/transformer/reports.
 */
import { describe, expect, it } from 'vitest';
import { diffFindings, loadAaSample } from '@prismshift/corpus';
import { ALL_RULES, runRules, scoreProcess } from '@prismshift/rules';
import { summarizeProcess } from '@prismshift/reports';
import { convertProcess, emitWorkflowXaml } from '@prismshift/transformer';
import { aaExpressionToIr, parseAaBot } from './parseAaBot';

describe('aaExpressionToIr', () => {
  it('rewrites $Var$ and $Table.column$ interpolation to [refs]', () => {
    expect(aaExpressionToIr('$RowCount$ + 1')).toBe('[RowCount] + 1');
    expect(aaExpressionToIr('$InvoiceTable.Amount$ > 1000')).toBe('[InvoiceTable.Amount] > 1000');
    expect(aaExpressionToIr('no refs')).toBe('no refs');
  });
});

describe('parse (answer-key enforced, like the BP corpus)', () => {
  it('matches expectedParse exactly', async () => {
    const { json, answerKey } = await loadAaSample('aa-01-invoice-loader');
    const { model, warnings, errors } = await parseAaBot(json);

    expect(errors).toHaveLength(answerKey.expectedParse.errors);
    expect(warnings).toHaveLength(answerKey.expectedParse.warnings);
    expect(model.meta.packageName).toBe(answerKey.expectedParse.packageName);
    expect(model.meta.bpVersion).toBe(answerKey.expectedParse.bpVersion);
    expect(model.processes).toHaveLength(answerKey.expectedParse.counts.processes);

    const expected = answerKey.expectedParse.processes[0]!;
    const process = model.processes[0]!;
    expect(process.name).toBe(expected.name);
    expect(process.pages.map((p) => p.name)).toEqual(expected.pages);
    expect(process.pages[0]!.stages).toHaveLength(expected.stageCount);
    expect(process.dataItems).toHaveLength(expected.dataItemCount);
    expect(process.startupParams.map((p) => p.name)).toEqual(expected.startupParams);
    expect(process.outputs.map((p) => p.name)).toEqual(expected.outputs);

    const kinds: Record<string, number> = {};
    for (const stage of process.pages[0]!.stages) kinds[stage.kind] = (kinds[stage.kind] ?? 0) + 1;
    expect(kinds).toEqual(expected.stageKinds);
  });

  it('unknown commands become generic stages + a warning (never dropped)', async () => {
    const { json } = await loadAaSample('aa-01-invoice-loader');
    const { model, warnings } = await parseAaBot(json);
    const generic = model.processes[0]!.pages[0]!.stages.find((s) => s.kind === 'generic')!;
    expect(generic.name).toBe('Update Mainframe Ledger');
    expect(warnings[0]!.message).toContain('terminalEmulatorConnect');
  });

  it('malformed input fails soft with errors, never throws', async () => {
    expect((await parseAaBot('not json')).errors[0]!.message).toContain('Not valid JSON');
    expect((await parseAaBot('{"foo":1}')).errors[0]!.message).toContain('nodes');
  });
});

describe('THE acceptance: full pipeline, zero downstream changes', () => {
  it('rules: findings match the answer key bidirectionally', async () => {
    const { json, answerKey } = await loadAaSample('aa-01-invoice-loader');
    const { model } = await parseAaBot(json);
    const { findings } = runRules(model, ALL_RULES);
    const diff = diffFindings(model, findings, answerKey);
    expect(diff.missed, 'missed expected findings').toEqual([]);
    expect(diff.unexpected, 'false positives').toEqual([]);
  });

  it('scoring grades the bot like any BP process', async () => {
    const { json } = await loadAaSample('aa-01-invoice-loader');
    const { model } = await parseAaBot(json);
    const { findings } = runRules(model, ALL_RULES);
    const quality = scoreProcess(model.processes[0]!.id, findings);
    expect(quality.score).toBe(76); // 100 − (2×high 10) − (1×medium 4)
    expect(quality.grade).toBe('C');
  });

  it('summaries: deterministic documentation works', async () => {
    const { json } = await loadAaSample('aa-01-invoice-loader');
    const { model } = await parseAaBot(json);
    const summary = summarizeProcess(model, model.processes[0]!);
    expect(summary.objectsCalled).toEqual(['Bots\\Post Invoice', 'Bots\\Post Invoice Approval']);
    expect(summary.outline[0]!.steps.length).toBeGreaterThan(5);
    expect(summary.stageCount).toBe(14);
  });

  it('conversion: emits Main.xaml with the loop/decision structure, punch-lists honestly', async () => {
    const { json } = await loadAaSample('aa-01-invoice-loader');
    const { model } = await parseAaBot(json);
    const conversion = convertProcess(model, model.processes[0]!);

    expect(conversion.coveragePct).toBeGreaterThan(50);
    const xaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    expect(xaml).toContain('<ui:ForEachRow');
    expect(xaml).toContain('<If Condition=');
    expect(xaml).toContain('RowCount + 1'); // expression survived, translated to VB
    // External bots are punch-listed, not invented
    const missing = conversion.punchList.filter((p) => p.reason.includes('not found in the release'));
    expect(missing.length).toBeGreaterThanOrEqual(2);
  });

  it('dependency graph records bot → task edges', async () => {
    const { json } = await loadAaSample('aa-01-invoice-loader');
    const { model } = await parseAaBot(json);
    expect(model.dependencies).toContainEqual({
      fromType: 'process',
      fromName: 'Invoice Loader',
      toType: 'object',
      toName: 'Bots\\Post Invoice Approval',
    });
  });
});
