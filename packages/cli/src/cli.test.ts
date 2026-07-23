/**
 * BL-003 · CLI suite: web-parity (byte-identical findings), gates and exit
 * codes, JSON stability, conversion output, and arg-parsing edges.
 */
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from '@prismshift/rules';
import { analyzeAll, analyzeFile, evaluateGates } from './analyze.js';
import { parseArgs, run } from './cli.js';

async function sampleOnDisk(sample: string): Promise<string> {
  const { xml } = await loadSample(sample);
  const dir = await mkdtemp(join(tmpdir(), 'prismshift-cli-'));
  const file = join(dir, `${sample}.bprelease`);
  await writeFile(file, xml, 'utf8');
  return file;
}

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

describe('web parity (the AC)', () => {
  it('CLI findings are byte-identical to the web pipeline on every corpus sample', async () => {
    for (const sample of ['01-clean-and-simple', '02-realistic-mid-size', '03-the-monolith', '04-edge-cases']) {
      const { xml } = await loadSample(sample);
      const report = await analyzeFile(`${sample}.bprelease`, xml);

      const { model } = await parseBpRelease(xml);
      const { findings } = runRules(model, ALL_RULES);
      const webFindings = findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        category: f.category,
        message: f.message,
      }));
      const cliFindings = report.components.flatMap((c) => c.findings);
      expect(JSON.stringify(cliFindings.sort((a, b) => a.message.localeCompare(b.message))))
        .toBe(JSON.stringify(webFindings.sort((a, b) => a.message.localeCompare(b.message))));
    }
  });

  it('JSON output is deterministic', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const a = await analyzeAll([{ file: 'x', xml }]);
    const b = await analyzeAll([{ file: 'x', xml }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('gates', () => {
  it('fail-below flags graded-worse components; max-critical counts per file', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const report = await analyzeAll([{ file: 'monolith', xml }]);

    expect(evaluateGates(report, { failBelow: 'C' }).length).toBeGreaterThan(0); // the F process
    expect(evaluateGates(report, { failBelow: 'F' })).toEqual([]);
    expect(evaluateGates(report, { maxCritical: 0 })).toEqual([]); // monolith has high, not critical
  });
});

describe('run() end-to-end', () => {
  it('clean sample → exit 0, human output includes grades', async () => {
    const file = await sampleOnDisk('01-clean-and-simple');
    const { io, out } = collect();
    const code = await run(['analyze', file], io);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('[A]');
  });

  it('--fail-below C on the monolith → exit 1 with gate lines', async () => {
    const file = await sampleOnDisk('03-the-monolith');
    const { io, err } = collect();
    const code = await run(['analyze', file, '--fail-below', 'C'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('GATE:');
  });

  it('--json emits schemaVersion 1', async () => {
    const file = await sampleOnDisk('01-clean-and-simple');
    const { io, out } = collect();
    const code = await run(['analyze', file, '--json'], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as { schemaVersion: number; files: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.files).toHaveLength(1);
  });

  it('not-a-release XML → exit 2', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prismshift-cli-'));
    const file = join(dir, 'junk.xml');
    await writeFile(file, '<not-blue-prism/>', 'utf8');
    const { io } = collect();
    expect(await run(['analyze', file], io)).toBe(2);
  });

  it('missing file → exit 3; unknown option → exit 3', async () => {
    const { io } = collect();
    expect(await run(['analyze', '/no/such/file.bprelease'], io)).toBe(3);
    expect(await run(['analyze', 'x', '--frobnicate'], io)).toBe(3);
  });

  it('--convert writes one project folder per process with the full file set', async () => {
    const file = await sampleOnDisk('02-realistic-mid-size');
    const outDir = await mkdtemp(join(tmpdir(), 'prismshift-out-'));
    const { io } = collect();
    const code = await run(['analyze', file, '--convert', outDir], io);
    expect(code).toBe(0);

    const base = join(outDir, '02-realistic-mid-size');
    const folders = await readdir(base);
    expect(folders.sort()).toEqual(['Invoice_Dispatcher', 'Invoice_Performer']);
    const dispatcher = await readdir(join(base, 'Invoice_Dispatcher'));
    expect(dispatcher).toContain('project.json');
    expect(dispatcher).toContain('MIGRATION_REPORT.md');
    const projectJson = JSON.parse(
      await readFile(join(base, 'Invoice_Dispatcher', 'project.json'), 'utf8'),
    ) as { name: string };
    expect(projectJson.name).toBe('Invoice Dispatcher');
  });
});

describe('parseArgs edges', () => {
  it('help, unknown command, no files', () => {
    expect(parseArgs(['--help'])).toEqual({ error: '' });
    expect(parseArgs(['frob'])).toHaveProperty('error');
    expect(parseArgs(['analyze'])).toEqual({ error: 'no input files given' });
    expect(parseArgs(['analyze', 'a', '--max-critical', '-2'])).toHaveProperty('error');
  });
});
