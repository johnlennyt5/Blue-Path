/**
 * BL-011 · Alert stages → ui:LogMessage. The Monolith's "Log Customer Detail"
 * alert logs an SSN — so it must convert AND carry the SEC-003 warning.
 */
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertProcess } from './convert';
import { emitWorkflowXaml } from './index';

describe('BL-011 · alert → LogMessage', () => {
  it('converts the Monolith alert to ui:LogMessage with the translated message', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const { model } = await parseBpRelease(xml);
    const conversion = convertProcess(model, model.processes[0]!);

    const allXaml = conversion.workflows.map((w) => emitWorkflowXaml(w.doc)).join('\n');
    expect(allXaml).toContain('<ui:LogMessage DisplayName="Log Customer Detail" Level="Info"');
    expect(allXaml).toContain('Reconciling account');
    // No more "not yet converted" TODO for alerts
    expect(allXaml).not.toContain('alert stage "Log Customer Detail" not yet converted');
  });

  it('sensitive message → SEC-003 comment + punch entry (never silent PII logging)', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const { model } = await parseBpRelease(xml);
    const conversion = convertProcess(model, model.processes[0]!);

    const allXaml = conversion.workflows.map((w) => emitWorkflowXaml(w.doc)).join('\n');
    expect(allXaml).toContain('PrismShift SEC-003: this alert message references sensitive data');

    const punch = conversion.punchList.find(
      (p) => p.stageName === 'Log Customer Detail' && p.reason.includes('SEC-003'),
    );
    expect(punch).toBeDefined();
  });

  it('alerts count as converted (coverage credit, punch only for sensitivity)', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const { model } = await parseBpRelease(xml);
    const conversion = convertProcess(model, model.processes[0]!);
    const pendingPunch = conversion.punchList.filter((p) =>
      p.reason.includes('Stage kind "alert"'),
    );
    expect(pendingPunch).toEqual([]);
  });
});
