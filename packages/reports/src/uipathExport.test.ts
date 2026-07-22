/**
 * BL-008 · Library export suite: standalone library projects per VBO, and
 * the embed-vs-library delivery toggle on process/release exports.
 */
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import type { AutomationModel } from '@prismshift/ir';
import {
  buildObjectLibraryExport,
  buildProcessExport,
  buildReleaseExport,
} from './uipathExport';

async function sample2(): Promise<AutomationModel> {
  const { xml } = await loadSample('02-realistic-mid-size');
  return (await parseBpRelease(xml)).model;
}

describe('buildObjectLibraryExport', () => {
  it('emits a publishable library: outputType Library, workflows at root, all entry points', async () => {
    const model = await sample2();
    const vbo = model.objects.find((o) => o.name === 'Invoice Entry VBO')!;
    const { project } = buildObjectLibraryExport(model, vbo);

    const paths = project.files.map((f) => f.path);
    expect(paths).toContain('project.json');
    expect(paths).toContain('Get_Pending_Invoices.xaml'); // root, not Objects/…
    expect(paths).toContain('Enter_Invoice.xaml');
    expect(paths.some((p) => p.startsWith('Objects/'))).toBe(false);

    const projectJson = JSON.parse(
      project.files.find((f) => f.path === 'project.json')!.content,
    ) as {
      name: string;
      designOptions: { outputType: string };
      entryPoints: { filePath: string }[];
      dependencies: Record<string, string>;
    };
    expect(projectJson.name).toBe('Invoice Entry VBO');
    expect(projectJson.designOptions.outputType).toBe('Library');
    expect(projectJson.entryPoints.map((e) => e.filePath).sort()).toEqual([
      'Enter_Invoice.xaml',
      'Get_Pending_Invoices.xaml',
    ]);
    expect(projectJson.dependencies['UiPath.UIAutomation.Activities']).toBeDefined();
  });

  it('ships the mandatory selector checklist inside the library', async () => {
    const model = await sample2();
    const vbo = model.objects[0]!;
    const { project } = buildObjectLibraryExport(model, vbo);
    const readme = project.files.find((f) => f.path === 'LIBRARY_README.md')!;
    expect(readme.content).toContain('Selector validation checklist');
    expect(readme.content).toContain('cannot be verified without the live target applications');
  });
});

describe('process export delivery modes', () => {
  it('embed (default): Objects/ copies, no library dependency', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const { project } = buildProcessExport(model, performer);
    expect(project.files.some((f) => f.path.startsWith('Objects/'))).toBe(true);
    const projectJson = JSON.parse(
      project.files.find((f) => f.path === 'project.json')!.content,
    ) as { dependencies: Record<string, string> };
    expect(projectJson.dependencies['Invoice_Entry_VBO']).toBeUndefined();
  });

  it('library: no copies, dependency entry, per-object punch instructions', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const { project, conversion } = buildProcessExport(model, performer, 'library');

    expect(project.files.some((f) => f.path.startsWith('Objects/'))).toBe(false);
    const projectJson = JSON.parse(
      project.files.find((f) => f.path === 'project.json')!.content,
    ) as { dependencies: Record<string, string> };
    expect(projectJson.dependencies['Invoice_Entry_VBO']).toBe('[1.0.0]');

    const punch = conversion.punchList.find((p) => p.reason.includes('Library mode'));
    expect(punch).toBeDefined();
    expect(punch!.reason).toContain('Invoice_Entry_VBO');
  });
});

describe('release export delivery modes', () => {
  it('library mode bundles Libraries/<Object>/ once, shared by all consumers', async () => {
    const model = await sample2();
    const release = buildReleaseExport(model, { objects: 'library' });
    const paths = release.files.map((f) => f.path);

    expect(paths).toContain('Libraries/Invoice_Entry_VBO/project.json');
    expect(paths).toContain('Libraries/Invoice_Entry_VBO/Enter_Invoice.xaml');
    // exactly one library copy despite two consuming processes
    expect(paths.filter((p) => p === 'Libraries/Invoice_Entry_VBO/project.json')).toHaveLength(1);
    // and no embedded copies anywhere
    expect(paths.some((p) => p.includes('/Objects/'))).toBe(false);
  });

  it('embed mode is unchanged (regression)', async () => {
    const model = await sample2();
    const release = buildReleaseExport(model);
    const paths = release.files.map((f) => f.path);
    expect(paths).toContain('Invoice_Performer/Objects/Invoice_Entry_VBO/Enter_Invoice.xaml');
    expect(paths.some((p) => p.startsWith('Libraries/'))).toBe(false);
  });
});
