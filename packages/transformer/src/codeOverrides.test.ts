/**
 * BL-005 · Accepted-override semantics in the converter: applied code lands
 * in the emitted InvokeCode with a punch record; no override = verbatim;
 * an accepted VB.NET port unlocks JScript stages.
 */
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertObject } from './convert';
import { emitWorkflowXaml } from './xaml';

async function vboWithCode() {
  const { xml } = await loadSample('02-realistic-mid-size');
  const { model } = await parseBpRelease(xml);
  const vbo = model.objects.find((o) => o.name === 'Invoice Entry VBO')!;
  const codeStage = vbo.pages
    .flatMap((p) => p.stages)
    .find((s) => s.kind === 'code')!;
  return { model, vbo, codeStage };
}

describe('BL-005 · code overrides in conversion', () => {
  it('no override → verbatim body (regression)', async () => {
    const { model, vbo, codeStage } = await vboWithCode();
    const conversion = convertObject(model, vbo);
    const xaml = conversion.workflows.map((w) => emitWorkflowXaml(w.doc)).join('');
    expect(xaml).toContain('ExportReader'); // original code text
    expect(
      conversion.punchList.some((p) => p.reason.includes('AI suggestion')),
    ).toBe(false);
    expect(codeStage.id).toBeTruthy();
  });

  it('accepted override → translated code emitted + punch-listed for the report', async () => {
    const { model, vbo, codeStage } = await vboWithCode();
    const translated = "' Idiomatic translation\nDim reader = New ExportReader(in_Archive_Password)";
    const conversion = convertObject(model, vbo, {
      codeOverrides: { [codeStage.id]: translated },
    });
    const xaml = conversion.workflows.map((w) => emitWorkflowXaml(w.doc)).join('');
    expect(xaml).toContain('Idiomatic translation');
    const punch = conversion.punchList.find((p) => p.reason.includes('AI suggestion'));
    expect(punch).toBeDefined();
    expect(punch!.stageName).toBe(codeStage.name);
  });

  it('JScript stays refused without an override, converts with one', async () => {
    const { xml } = await loadSample('04-edge-cases');
    const { model } = await parseBpRelease(xml);
    const owner = model.objects.find((o) =>
      o.pages.some((p) => p.stages.some((s) => s.kind === 'code' && s.language === 'jscript')),
    );
    if (owner === undefined) return; // corpus layout guard
    const js = owner.pages.flatMap((p) => p.stages).find(
      (s) => s.kind === 'code' && s.language === 'jscript',
    )!;

    const refused = convertObject(model, owner);
    expect(refused.punchList.some((p) => p.reason.includes('JScript'))).toBe(true);

    const ported = convertObject(model, owner, {
      codeOverrides: { [js.id]: "' Ported from JScript\nout_Result = in_Value" },
    });
    const xaml = ported.workflows.map((w) => emitWorkflowXaml(w.doc)).join('');
    expect(xaml).toContain('Ported from JScript');
    expect(ported.punchList.some((p) => p.reason.includes('AI suggestion'))).toBe(true);
  });
});
