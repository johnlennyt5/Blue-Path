/**
 * Audit report (S7-4): a data builder (pure, fully tested) + a client-side
 * PDF renderer (jsPDF — nothing leaves the browser). One document, two
 * levels: the program rollup, then a section per process/object with
 * findings, scores, conversion coverage, and a sign-off block at the end.
 */
import { jsPDF } from 'jspdf';
import type { AutomationModel, Finding } from '@prismshift/ir';
import { scoreObject, scoreProcess } from '@prismshift/rules';
import { estimateEffortHours } from '@prismshift/reports';
import { buildProcessExport } from './exportProject';
import { convertObject } from '@prismshift/transformer';
import { locationPath } from './sync';

export interface AuditFindingRow {
  ruleId: string;
  severity: string;
  location: string;
  message: string;
}

export interface AuditSection {
  name: string;
  role: 'process' | 'object';
  score: number;
  grade: string;
  stageCount: number;
  coveragePct: number;
  punchCount: number;
  effortHours?: number;
  findings: AuditFindingRow[];
}

export interface AuditReportData {
  title: string;
  packageName: string;
  bpVersion?: string;
  generatedAt: string;
  rollup: {
    sections: { name: string; role: string; score: number; grade: string; coveragePct: number; findingCount: number; effortHours?: number }[];
    totalFindings: number;
    findingsBySeverity: Record<string, number>;
    averageScore: number;
    worstGrade: string;
    totalEffortHours: number;
  };
  sections: AuditSection[];
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'];

export function buildAuditReportData(
  model: AutomationModel,
  findings: Finding[],
  generatedAt: string,
): AuditReportData {
  const sections: AuditSection[] = [];

  for (const process of model.processes) {
    const quality = scoreProcess(process.id, findings);
    const { conversion, objectConversions } = buildProcessExport(model, process);
    sections.push({
      name: process.name,
      role: 'process',
      score: quality.score,
      grade: quality.grade,
      stageCount: process.pages.reduce((n, p) => n + p.stages.length, 0),
      coveragePct: conversion.coveragePct,
      punchCount: conversion.punchList.length,
      effortHours: estimateEffortHours(conversion, objectConversions),
      findings: findingsFor(model, process.id, findings),
    });
  }

  for (const object of model.objects) {
    const quality = scoreObject(object.id, findings);
    const conversion = convertObject(model, object);
    sections.push({
      name: object.name,
      role: 'object',
      score: quality.score,
      grade: quality.grade,
      stageCount: object.pages.reduce((n, p) => n + p.stages.length, 0),
      coveragePct: conversion.coveragePct,
      punchCount: conversion.punchList.length,
      findings: findingsFor(model, object.id, findings),
    });
  }

  const findingsBySeverity: Record<string, number> = {};
  for (const finding of findings) {
    findingsBySeverity[finding.severity] = (findingsBySeverity[finding.severity] ?? 0) + 1;
  }
  const worst = sections.reduce((acc, s) => Math.max(acc, GRADE_ORDER.indexOf(s.grade)), -1);

  return {
    title: 'PrismShift Migration Audit Report',
    packageName: model.meta.packageName || 'Blue Prism Release',
    ...(model.meta.bpVersion !== undefined ? { bpVersion: model.meta.bpVersion } : {}),
    generatedAt,
    rollup: {
      sections: sections.map((s) => ({
        name: s.name,
        role: s.role,
        score: s.score,
        grade: s.grade,
        coveragePct: s.coveragePct,
        findingCount: s.findings.length,
        ...(s.effortHours !== undefined ? { effortHours: s.effortHours } : {}),
      })),
      totalFindings: findings.length,
      findingsBySeverity,
      averageScore:
        sections.length === 0
          ? 0
          : Math.round(sections.reduce((n, s) => n + s.score, 0) / sections.length),
      worstGrade: worst === -1 ? '—' : GRADE_ORDER[worst]!,
      totalEffortHours:
        Math.round(sections.reduce((n, s) => n + (s.effortHours ?? 0), 0) * 10) / 10,
    },
    sections,
  };
}

function findingsFor(
  model: AutomationModel,
  ownerId: string,
  findings: Finding[],
): AuditFindingRow[] {
  return findings
    .filter((f) => f.location.processId === ownerId || f.location.objectId === ownerId)
    .sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    )
    .map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      location: locationPath(model, f),
      message: f.message,
    }));
}

// ---------------------------------------------------------------------------
// PDF rendering — plain jsPDF primitives, deterministic layout
// ---------------------------------------------------------------------------

const PAGE_W = 210;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE = 5.2;

class Pdf {
  doc = new jsPDF({ unit: 'mm', format: 'a4' });
  y = MARGIN;

  ensure(height: number): void {
    if (this.y + height > 281) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  heading(text: string, size: number): void {
    this.ensure(size * 0.6 + 4);
    this.doc.setFont('helvetica', 'bold').setFontSize(size);
    this.doc.text(text, MARGIN, this.y);
    this.y += size * 0.5 + 2.5;
  }

  line(text: string, options: { bold?: boolean; size?: number; indent?: number } = {}): void {
    const size = options.size ?? 9.5;
    this.doc
      .setFont('helvetica', options.bold === true ? 'bold' : 'normal')
      .setFontSize(size);
    const wrapped = this.doc.splitTextToSize(text, CONTENT_W - (options.indent ?? 0)) as string[];
    for (const row of wrapped) {
      this.ensure(LINE);
      this.doc.text(row, MARGIN + (options.indent ?? 0), this.y);
      this.y += LINE;
    }
  }

  table(headers: string[], widths: number[], rows: string[][]): void {
    const rowH = LINE + 1;
    const draw = (cells: string[], bold: boolean) => {
      this.doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(8.5);
      // Wrap each cell; row height = tallest cell
      const wrappedCells = cells.map(
        (cell, i) => this.doc.splitTextToSize(cell, widths[i]! - 2) as string[],
      );
      const height = Math.max(...wrappedCells.map((w) => w.length)) * (LINE - 1) + 2;
      this.ensure(height);
      let x = MARGIN;
      wrappedCells.forEach((wrapped, i) => {
        this.doc.text(wrapped, x, this.y);
        x += widths[i]!;
      });
      this.y += height;
    };
    draw(headers, true);
    this.doc.setDrawColor(120).line(MARGIN, this.y - rowH + 2.5, MARGIN + CONTENT_W, this.y - rowH + 2.5);
    for (const row of rows) draw(row, false);
    this.y += 2;
  }

  signatureBlock(): void {
    this.ensure(60);
    this.heading('Sign-off', 13);
    this.line(
      'This audit report was generated by PrismShift entirely on the local machine. ' +
        'Selector validation and UAT remain mandatory before production go-live.',
      { size: 8.5 },
    );
    this.y += 4;
    for (const roleName of ['Prepared by', 'Reviewed by', 'Approved by']) {
      this.ensure(16);
      this.doc.setFont('helvetica', 'normal').setFontSize(9.5);
      this.doc.text(roleName, MARGIN, this.y);
      this.doc.setDrawColor(60);
      this.doc.line(MARGIN + 32, this.y, MARGIN + 100, this.y); // name/signature
      this.doc.text('Date', MARGIN + 108, this.y);
      this.doc.line(MARGIN + 120, this.y, MARGIN + CONTENT_W, this.y);
      this.y += 13;
    }
  }
}

export function renderAuditPdfBytes(data: AuditReportData): ArrayBuffer {
  const pdf = new Pdf();

  // Cover / rollup
  pdf.heading(data.title, 17);
  pdf.line(
    `${data.packageName}${data.bpVersion !== undefined ? ` · Blue Prism ${data.bpVersion}` : ''}`,
    { size: 10.5 },
  );
  pdf.line(`Generated ${data.generatedAt} · client-side (no data left the browser)`, {
    size: 8.5,
  });
  pdf.y += 4;

  pdf.heading('Program rollup', 13);
  pdf.line(
    `Components: ${data.rollup.sections.length} · Findings: ${data.rollup.totalFindings} (` +
      SEVERITY_ORDER.filter((sev) => (data.rollup.findingsBySeverity[sev] ?? 0) > 0)
        .map((sev) => `${data.rollup.findingsBySeverity[sev]} ${sev}`)
        .join(', ') +
      `) · Avg score: ${data.rollup.averageScore} · Worst grade: ${data.rollup.worstGrade} · ` +
      `Est. effort: ${data.rollup.totalEffortHours} h`,
  );
  pdf.y += 2;
  pdf.table(
    ['Component', 'Type', 'Score', 'Grade', 'Coverage', 'Findings', 'Effort (h)'],
    [56, 18, 16, 16, 22, 22, 22],
    data.rollup.sections.map((s) => [
      s.name,
      s.role,
      `${s.score}/100`,
      s.grade,
      `${s.coveragePct}%`,
      String(s.findingCount),
      s.effortHours !== undefined ? String(s.effortHours) : '—',
    ]),
  );

  // Per-component sections
  for (const section of data.sections) {
    pdf.y += 4;
    pdf.heading(`${section.name} (${section.role})`, 13);
    pdf.line(
      `Score ${section.score}/100 (${section.grade}) · ${section.stageCount} stages · ` +
        `conversion coverage ${section.coveragePct}% · ${section.punchCount} punch-list item(s)` +
        (section.effortHours !== undefined ? ` · est. effort ${section.effortHours} h` : ''),
    );
    pdf.y += 1;
    if (section.findings.length === 0) {
      pdf.line('No findings.', { size: 9 });
    } else {
      pdf.table(
        ['Rule', 'Severity', 'Location', 'Finding'],
        [18, 20, 60, 80],
        section.findings.map((f) => [f.ruleId, f.severity, f.location, f.message]),
      );
    }
  }

  pdf.y += 6;
  pdf.signatureBlock();

  return pdf.doc.output('arraybuffer');
}

export function renderAuditPdf(data: AuditReportData): Blob {
  return new Blob([renderAuditPdfBytes(data)], { type: 'application/pdf' });
}
