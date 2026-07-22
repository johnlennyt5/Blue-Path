/**
 * BL-003 · CLI analysis core (pure — the bin wrapper adds I/O and exit
 * codes). Runs the exact same pipeline as the web app: parseBpRelease →
 * runRules → scoring, so CI and browser can never disagree.
 */
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules, scoreObject, scoreProcess } from '@prismshift/rules';
import { summarizeObject, summarizeProcess } from '@prismshift/reports';
import type { AutomationModel, Finding } from '@prismshift/ir';

export interface CliFinding {
  ruleId: string;
  severity: string;
  category: string;
  message: string;
}

export interface CliComponent {
  name: string;
  role: 'process' | 'object';
  score: number;
  grade: string;
  stageCount: number;
  purpose: string;
  findings: CliFinding[];
}

export interface CliFileReport {
  file: string;
  packageName: string;
  bpVersion: string;
  parseErrors: string[];
  parseWarnings: number;
  components: CliComponent[];
  totals: {
    findings: number;
    bySeverity: Record<string, number>;
    worstGrade: string;
    averageScore: number;
  };
}

export interface CliReport {
  tool: 'prismshift';
  schemaVersion: 1;
  files: CliFileReport[];
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'];

function findingsFor(ownerId: string, findings: Finding[]): CliFinding[] {
  return findings
    .filter((f) => f.location.processId === ownerId || f.location.objectId === ownerId)
    .map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      category: f.category,
      message: f.message,
    }));
}

function componentsOf(model: AutomationModel, findings: Finding[]): CliComponent[] {
  const components: CliComponent[] = [];
  for (const process of model.processes) {
    const quality = scoreProcess(process.id, findings);
    components.push({
      name: process.name,
      role: 'process',
      score: quality.score,
      grade: quality.grade,
      stageCount: process.pages.reduce((n, p) => n + p.stages.length, 0),
      purpose: summarizeProcess(model, process).description ?? '',
      findings: findingsFor(process.id, findings),
    });
  }
  for (const object of model.objects) {
    const quality = scoreObject(object.id, findings);
    components.push({
      name: object.name,
      role: 'object',
      score: quality.score,
      grade: quality.grade,
      stageCount: object.pages.reduce((n, p) => n + p.stages.length, 0),
      purpose: summarizeObject(model, object).description ?? '',
      findings: findingsFor(object.id, findings),
    });
  }
  return components;
}

export async function analyzeFile(fileName: string, xml: string): Promise<CliFileReport> {
  const { model, warnings, errors } = await parseBpRelease(xml);
  const { findings } = runRules(model, ALL_RULES);
  const components = componentsOf(model, findings);

  const bySeverity: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }
  const worst = components.reduce(
    (acc, c) => Math.max(acc, GRADE_ORDER.indexOf(c.grade)),
    -1,
  );

  return {
    file: fileName,
    packageName: model.meta.packageName,
    bpVersion: model.meta.bpVersion,
    parseErrors: errors.map((e) => e.message),
    parseWarnings: warnings.length,
    components,
    totals: {
      findings: findings.length,
      bySeverity,
      worstGrade: worst === -1 ? '—' : GRADE_ORDER[worst]!,
      averageScore:
        components.length === 0
          ? 0
          : Math.round(components.reduce((n, c) => n + c.score, 0) / components.length),
    },
  };
}

export async function analyzeAll(
  inputs: { file: string; xml: string }[],
): Promise<CliReport> {
  const files: CliFileReport[] = [];
  for (const input of inputs) {
    files.push(await analyzeFile(input.file, input.xml));
  }
  return { tool: 'prismshift', schemaVersion: 1, files };
}

/** Gate evaluation: returns human-readable failures (empty = pass). */
export function evaluateGates(
  report: CliReport,
  gates: { failBelow?: string; maxCritical?: number },
): string[] {
  const failures: string[] = [];
  if (gates.failBelow !== undefined) {
    const threshold = GRADE_ORDER.indexOf(gates.failBelow.toUpperCase());
    if (threshold === -1) {
      failures.push(`--fail-below expects one of A/B/C/D/F, got "${gates.failBelow}"`);
      return failures;
    }
    for (const file of report.files) {
      for (const component of file.components) {
        if (GRADE_ORDER.indexOf(component.grade) > threshold) {
          failures.push(
            `${file.file}: "${component.name}" grades ${component.grade} (gate: ${gates.failBelow.toUpperCase()} or better)`,
          );
        }
      }
    }
  }
  if (gates.maxCritical !== undefined) {
    for (const file of report.files) {
      const critical = file.totals.bySeverity['critical'] ?? 0;
      if (critical > gates.maxCritical) {
        failures.push(
          `${file.file}: ${critical} critical finding(s) (gate: at most ${gates.maxCritical})`,
        );
      }
    }
  }
  return failures;
}
