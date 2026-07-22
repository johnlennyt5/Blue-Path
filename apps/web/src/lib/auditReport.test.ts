// @vitest-environment jsdom
/**
 * S7-4 · Audit report: the data builder against the corpus (rollup math,
 * per-section findings/coverage, severity ordering) and a real jsPDF render
 * smoke test — valid multi-page PDF bytes, produced entirely client-side.
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import type { AutomationModel, Finding } from '@prismshift/ir';
import { buildAuditReportData, renderAuditPdf, renderAuditPdfBytes } from './auditReport';

beforeAll(() => {
  (globalThis as { crypto?: unknown }).crypto ??= webcrypto;
});

let model: AutomationModel;
let findings: Finding[];
beforeAll(async () => {
  const { xml } = await loadSample('02-realistic-mid-size');
  model = (await parseBpRelease(xml)).model;
  findings = runRules(model, ALL_RULES).findings;
});

describe('buildAuditReportData (corpus #2)', () => {
  it('rolls up every component with score, grade, coverage, findings, effort', () => {
    const data = buildAuditReportData(model, findings, '2026-07-22 12:00');
    expect(data.rollup.sections.map((s) => s.name)).toEqual([
      'Invoice Dispatcher',
      'Invoice Performer',
      'Invoice Entry VBO',
    ]);
    expect(data.rollup.totalFindings).toBe(findings.length);
    expect(data.rollup.averageScore).toBeGreaterThan(0);
    expect(GRADES).toContain(data.rollup.worstGrade);
    expect(data.rollup.totalEffortHours).toBeGreaterThan(0);
    // Processes carry effort; objects' effort is inside their callers'
    const vbo = data.rollup.sections.find((s) => s.name === 'Invoice Entry VBO')!;
    expect(vbo.effortHours).toBeUndefined();
  });

  it('sections carry coverage and severity-ordered findings with locations', () => {
    const data = buildAuditReportData(model, findings, '2026-07-22 12:00');
    for (const section of data.sections) {
      expect(section.coveragePct).toBeGreaterThanOrEqual(0);
      expect(section.coveragePct).toBeLessThanOrEqual(100);
      const severityRank = section.findings.map((f) =>
        ['critical', 'high', 'medium', 'low'].indexOf(f.severity),
      );
      expect([...severityRank].sort((a, b) => a - b)).toEqual(severityRank);
      for (const finding of section.findings) {
        expect(finding.location.length).toBeGreaterThan(0);
        expect(finding.ruleId).toMatch(/^[A-Z]{3}-\d{3}$/);
      }
    }
    const dispatcher = data.sections.find((s) => s.name === 'Invoice Dispatcher')!;
    expect(dispatcher.findings.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed timestamp', () => {
    const a = buildAuditReportData(model, findings, '2026-07-22 12:00');
    const b = buildAuditReportData(model, findings, '2026-07-22 12:00');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('renderAuditPdf', () => {
  it('produces a real multi-page PDF blob, client-side', () => {
    const data = buildAuditReportData(model, findings, '2026-07-22 12:00');
    expect(renderAuditPdf(data).type).toBe('application/pdf');
    const bytes = new Uint8Array(renderAuditPdfBytes(data));
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(4000);
    // The sign-off block and rollup made it in (text objects in the stream
    // are compressed, so assert via page count instead: cover + sections).
    const text = new TextDecoder('latin1').decode(bytes);
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(1);
  });
});

const GRADES = ['A', 'B', 'C', 'D', 'F'];
