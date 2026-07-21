import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { buildProcessExport, projectZipBlob } from './exportProject';

describe('buildProcessExport', () => {
  it('clean & simple → plain layout with full coverage', async () => {
    const { xml } = await loadSample('01-clean-and-simple');
    const { model } = await parseBpRelease(xml);
    const { project, conversion } = buildProcessExport(model, model.processes[0]!);

    expect(project.layout).toBe('plain');
    expect(conversion.coveragePct).toBe(100);
    expect(project.files.map((f) => f.path)).toEqual([
      'project.json',
      'Main.xaml',
      'Pages/Calculate_Payment.xaml',
    ]);
  });

  it('queue-driven dispatcher → REFramework layout', async () => {
    const { xml } = await loadSample('02-realistic-mid-size');
    const { model } = await parseBpRelease(xml);
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const { project } = buildProcessExport(model, dispatcher);

    expect(project.layout).toBe('reframework');
    expect(project.files.map((f) => f.path)).toContain('Framework/GetTransactionData.xaml');
  });
});

describe('projectZipBlob', () => {
  it('produces a valid archive that round-trips every file byte-for-byte', async () => {
    const { xml } = await loadSample('01-clean-and-simple');
    const { model } = await parseBpRelease(xml);
    const { project } = buildProcessExport(model, model.processes[0]!);

    const blob = await projectZipBlob(project);
    expect(blob.size).toBeGreaterThan(0);

    const reopened = await JSZip.loadAsync(await blob.arrayBuffer());
    const paths = Object.keys(reopened.files).filter((p) => !reopened.files[p]!.dir);
    expect(paths.sort()).toEqual(project.files.map((f) => f.path).sort());

    for (const file of project.files) {
      const content = await reopened.file(file.path)!.async('string');
      expect(content, file.path).toBe(file.content);
    }

    const projectJson = JSON.parse(await reopened.file('project.json')!.async('string')) as {
      name: string;
      main: string;
    };
    expect(projectJson.name).toBe('Loan Payment Calculator');
    expect(projectJson.main).toBe('Main.xaml');
  });
});
