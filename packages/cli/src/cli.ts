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
import { applyPlan, planFromModel, type OrchestratorConfig } from './orchestrator.js';

const USAGE = `prismshift <command>

Commands:
  analyze <files…>       parse + 14-rule analysis (+ optional conversion)
  orchestrate <file>     create the release's queues/assets in Orchestrator

prismshift analyze <files…> [options]

Options:
  --json                 machine-readable output (schemaVersion 1)
  --fail-below <grade>   exit 1 if any component grades below A|B|C|D
  --max-critical <n>     exit 1 if any file has more than n critical findings
  --convert <dir>        also emit UiPath projects (one folder per process)
  --objects <mode>       with --convert: embed (default) or library
  -h, --help             this text

prismshift orchestrate <file> --url <orchestratorUrl> --folder <folderId> [options]
  --url <url>            e.g. https://cloud.uipath.com/org/tenant/orchestrator_
  --folder <id>          Orchestrator folder (Organization Unit) id
  --token <token>        bearer token; or set PRISMSHIFT_ORCH_TOKEN (never stored)
  --dry-run              list intended creations without calling the API
  --json                 machine-readable results

Examples:
  prismshift analyze estate.bprelease --fail-below C
  prismshift analyze exports/*.bprelease --json > report.json
  prismshift analyze estate.bprelease --convert ./uipath-out
  prismshift orchestrate estate.bprelease --url … --folder 123 --dry-run`;

interface ParsedArgs {
  files: string[];
  json: boolean;
  failBelow?: string;
  maxCritical?: number;
  convertDir?: string;
  objects: 'embed' | 'library';
}

export interface OrchestrateArgs {
  command: 'orchestrate';
  file: string;
  url?: string;
  folder?: string;
  token?: string;
  dryRun: boolean;
  json: boolean;
}

export function parseOrchestrateArgs(argv: string[]): OrchestrateArgs | { error: string } {
  const args: OrchestrateArgs = { command: 'orchestrate', file: '', dryRun: false, json: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--url') args.url = argv[++i];
    else if (arg === '--folder') args.folder = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--')) return { error: `unknown option "${arg}"` };
    else if (args.file === '') args.file = arg;
    else return { error: 'orchestrate takes exactly one file' };
  }
  if (args.file === '') return { error: 'no input file given' };
  if (!args.dryRun) {
    if (args.url === undefined || args.folder === undefined) {
      return { error: 'live runs need --url and --folder (or use --dry-run)' };
    }
    args.token = args.token ?? process.env['PRISMSHIFT_ORCH_TOKEN'];
    if (args.token === undefined || args.token === '') {
      return { error: 'live runs need --token or PRISMSHIFT_ORCH_TOKEN' };
    }
  }
  return args;
}

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  if (argv[0] !== 'analyze') return { error: argv[0] === '-h' || argv[0] === '--help' ? '' : `unknown command "${argv[0] ?? ''}"` };
  const args: ParsedArgs = { files: [], json: false, objects: 'embed' };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') args.json = true;
    else if (arg === '--fail-below') args.failBelow = argv[++i];
    else if (arg === '--max-critical') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) return { error: '--max-critical expects a non-negative integer' };
      args.maxCritical = n;
    } else if (arg === '--convert') args.convertDir = argv[++i];
    else if (arg === '--objects') {
      const mode = argv[++i];
      if (mode !== 'embed' && mode !== 'library') return { error: '--objects expects embed or library' };
      args.objects = mode;
    }
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
  if (argv[0] === 'orchestrate') return runOrchestrate(argv, io);
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
      const release = buildReleaseExport(model, { objects: parsed.objects });
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

async function runOrchestrate(
  argv: string[],
  io: { out: (line: string) => void; err: (line: string) => void },
  fetchImpl?: typeof fetch,
): Promise<number> {
  const parsed = parseOrchestrateArgs(argv);
  if ('error' in parsed) {
    io.err(`error: ${parsed.error}\n\n${USAGE}`);
    return 3;
  }
  let xml: string;
  try {
    xml = await readFile(parsed.file, 'utf8');
  } catch {
    io.err(`error: cannot read "${parsed.file}"`);
    return 3;
  }
  const { model, errors } = await parseBpRelease(xml);
  if (errors.length > 0) {
    for (const parseError of errors) io.err(`PARSE ERROR: ${parseError.message}`);
    return 2;
  }
  const items = planFromModel(model);
  if (items.length === 0) {
    io.out('Nothing to create: the release declares no queues, environment variables, or credentials.');
    return 0;
  }

  if (parsed.dryRun) {
    if (parsed.json) {
      io.out(JSON.stringify({ dryRun: true, items }, null, 2));
    } else {
      io.out(`Dry run — ${items.length} item(s) would be created:`);
      for (const item of items) io.out(`  [${item.kind}] ${item.name} — ${item.detail}`);
    }
    return 0;
  }

  const config: OrchestratorConfig = {
    baseUrl: parsed.url!.replace(/\/$/, ''),
    folderId: parsed.folder!,
    token: parsed.token!,
  };
  const results = await applyPlan(config, model, items, fetchImpl ?? fetch);
  if (parsed.json) {
    io.out(JSON.stringify({ dryRun: false, results: results.map(({ item, status, message }) => ({ ...item, status, message })) }, null, 2));
  } else {
    for (const result of results) {
      const suffix = result.message !== undefined ? ` — ${result.message}` : '';
      io.out(`  [${result.status.toUpperCase().padEnd(7)}] ${result.item.kind} ${result.item.name}${suffix}`);
    }
  }
  const failed = results.filter((r) => r.status === 'failed').length;
  io.err(
    `\n${results.filter((r) => r.status === 'created').length} created · ${results.filter((r) => r.status === 'exists').length} existing · ${failed} failed`,
  );
  return failed > 0 ? 1 : 0;
}

export const _internal = { runOrchestrate };

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
