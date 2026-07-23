#!/usr/bin/env node
/**
 * prismshift — Blue Prism analysis & conversion in your terminal/CI.
 * No network calls, ever: files in, findings/projects out, exit code tells CI.
 *
 * Exit codes: 0 pass · 1 gate failed · 2 parse errors · 3 usage error
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseBpRelease } from '@prismshift/parser';
import { buildReleaseExport } from '@prismshift/reports';
import { analyzeAll, evaluateGates, type CliReport } from './analyze.js';

const USAGE = `prismshift analyze <files…> [options]

Options:
  --json                 machine-readable output (schemaVersion 1)
  --fail-below <grade>   exit 1 if any component grades below A|B|C|D
  --max-critical <n>     exit 1 if any file has more than n critical findings
  --convert <dir>        also emit UiPath projects (one folder per process)
  -h, --help             this text

Examples:
  prismshift analyze estate.bprelease --fail-below C
  prismshift analyze exports/*.bprelease --json > report.json
  prismshift analyze estate.bprelease --convert ./uipath-out`;

interface ParsedArgs {
  files: string[];
  json: boolean;
  failBelow?: string;
  maxCritical?: number;
  convertDir?: string;
}

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  if (argv[0] !== 'analyze') return { error: argv[0] === '-h' || argv[0] === '--help' ? '' : `unknown command "${argv[0] ?? ''}"` };
  const args: ParsedArgs = { files: [], json: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') args.json = true;
    else if (arg === '--fail-below') args.failBelow = argv[++i];
    else if (arg === '--max-critical') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) return { error: '--max-critical expects a non-negative integer' };
      args.maxCritical = n;
    } else if (arg === '--convert') args.convertDir = argv[++i];
    else if (arg === '-h' || arg === '--help') return { error: '' };
    else if (arg.startsWith('--')) return { error: `unknown option "${arg}"` };
    else args.files.push(arg);
  }
  if (args.files.length === 0) return { error: 'no input files given' };
  return args;
}

function printHuman(report: CliReport, out: (line: string) => void): void {
  for (const file of report.files) {
    out(`\n${file.file} — ${file.packageName || 'Blue Prism export'} (BP ${file.bpVersion || '?'})`);
    if (file.parseErrors.length > 0) {
      for (const error of file.parseErrors) out(`  PARSE ERROR: ${error}`);
      continue;
    }
    for (const component of file.components) {
      out(
        `  [${component.grade}] ${component.score.toString().padStart(3)}/100  ${component.name} (${component.role}, ${component.stageCount} stages, ${component.findings.length} finding${component.findings.length === 1 ? '' : 's'})`,
      );
      for (const finding of component.findings) {
        out(`        ${finding.severity.padEnd(8)} ${finding.ruleId}  ${finding.message}`);
      }
    }
    const severities = Object.entries(file.totals.bySeverity)
      .map(([severity, count]) => `${count} ${severity}`)
      .join(', ');
    out(
      `  → ${file.totals.findings} finding(s)${severities ? ` (${severities})` : ''} · avg score ${file.totals.averageScore} · worst grade ${file.totals.worstGrade}`,
    );
  }
}

export async function run(
  argv: string[],
  io: { out: (line: string) => void; err: (line: string) => void },
): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.err(parsed.error === '' ? USAGE : `error: ${parsed.error}\n\n${USAGE}`);
    return parsed.error === '' ? 0 : 3;
  }

  const inputs: { file: string; xml: string }[] = [];
  for (const file of parsed.files) {
    try {
      inputs.push({ file, xml: await readFile(file, 'utf8') });
    } catch {
      io.err(`error: cannot read "${file}"`);
      return 3;
    }
  }

  const report = await analyzeAll(inputs);

  if (parsed.convertDir !== undefined) {
    for (const input of inputs) {
      const { model } = await parseBpRelease(input.xml);
      const release = buildReleaseExport(model);
      const base = join(parsed.convertDir, basename(input.file).replace(/\.[^.]+$/, ''));
      for (const file of release.files) {
        const target = join(base, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, 'utf8');
      }
      io.err(
        `converted ${release.exports.length} project(s) from ${input.file} → ${base}`,
      );
    }
  }

  if (parsed.json) {
    io.out(JSON.stringify(report, null, 2));
  } else {
    printHuman(report, io.out);
  }

  const parseErrorCount = report.files.reduce((n, f) => n + f.parseErrors.length, 0);
  const gateFailures = evaluateGates(report, {
    ...(parsed.failBelow !== undefined ? { failBelow: parsed.failBelow } : {}),
    ...(parsed.maxCritical !== undefined ? { maxCritical: parsed.maxCritical } : {}),
  });

  if (parseErrorCount > 0) {
    io.err(`\n${parseErrorCount} parse error(s) — exit 2`);
    return 2;
  }
  if (gateFailures.length > 0) {
    for (const failure of gateFailures) io.err(`GATE: ${failure}`);
    io.err(`\n${gateFailures.length} gate failure(s) — exit 1`);
    return 1;
  }
  return 0;
}

/* c8 ignore start */
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('prismshift'));
if (invokedDirectly) {
  run(process.argv.slice(2), {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).then((code) => process.exit(code));
}
/* c8 ignore stop */
