/**
 * Terminal preview of the analysis pipeline: parse a .bprelease, run the
 * full rule catalog, print findings and grades. (The proper CLI is a
 * post-v1 backlog item; this is a dev/testing convenience.)
 *
 *   pnpm analyze packages/corpus/samples/03-the-monolith.bprelease
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutomationModel, Finding } from '@prismshift/ir';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules, scoreObject, scoreProcess } from '../src/index';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: pnpm analyze <path-to .bprelease>');
  process.exit(1);
}
const filePath = path.resolve(process.env['INIT_CWD'] ?? process.cwd(), fileArg);

const SEVERITY_ICON: Record<string, string> = {
  critical: '🟥 CRITICAL',
  high: '🟧 HIGH    ',
  medium: '🟨 MEDIUM  ',
  low: '🟦 LOW     ',
  info: '⬜ INFO    ',
};

function where(model: AutomationModel, finding: Finding): string {
  const l = finding.location;
  const owner =
    model.processes.find((p) => p.id === l.processId) ??
    model.objects.find((o) => o.id === l.objectId);
  if (!owner) return '(unresolved location)';
  const parts = [owner.name];
  const page = owner.pages.find((p) => p.id === l.pageId);
  if (page) parts.push(page.name);
  const stage = page?.stages.find((s) => s.id === l.stageId);
  if (stage) parts.push(`"${stage.name}"`);
  if (l.elementId !== undefined && 'appModel' in owner) {
    const element = owner.appModel?.elements.find((e) => e.id === l.elementId);
    if (element) parts.push(`element "${element.name}"`);
  }
  return parts.join(' › ');
}

const xml = await readFile(filePath, 'utf8');
const { model, warnings, errors } = await parseBpRelease(xml);

console.log(`\n═══ PrismShift analysis · ${path.basename(filePath)} ═══`);
console.log(
  `${model.meta.packageName || '(unnamed)'} · Blue Prism ${model.meta.bpVersion} · ` +
    `${model.processes.length} process(es), ${model.objects.length} object(s), ` +
    `${model.workQueues.length} queue(s) · sha256 ${model.meta.sourceHash.slice(0, 12)}…`,
);

if (errors.length > 0) {
  console.log(`\n⛔ Parse errors (${errors.length}):`);
  for (const e of errors) console.log(`   ${e.message}`);
}
if (warnings.length > 0) {
  console.log(`\n⚠️  Parse warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`   ${w.message}`);
}

const result = runRules(model, ALL_RULES);
console.log(
  `\n${result.findings.length} finding(s) from ${ALL_RULES.length} rules in ${result.totalMs.toFixed(1)} ms`,
);
for (const finding of result.findings) {
  console.log(`\n${SEVERITY_ICON[finding.severity]} ${finding.ruleId} · ${where(model, finding)}`);
  console.log(`   ${finding.message}`);
  console.log(`   ↳ ${finding.remediation}`);
}

console.log('\n─── Grades ───');
for (const process of model.processes) {
  const s = scoreProcess(process.id, result.findings);
  console.log(`  ${s.grade} ${String(s.score).padStart(3)}  ${process.name} (process)`);
}
for (const object of model.objects) {
  const s = scoreObject(object.id, result.findings);
  console.log(`  ${s.grade} ${String(s.score).padStart(3)}  ${object.name} (object)`);
}
console.log('');
