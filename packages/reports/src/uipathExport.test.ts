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

  it('library: no copies, dotted package dependency, per-object punch instructions', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const { project, conversion } = buildProcessExport(model, performer, {}, 'library');

    expect(project.files.some((f) => f.path.startsWith('Objects/'))).toBe(false);
    const projectJson = JSON.parse(
      project.files.find((f) => f.path === 'project.json')!.content,
    ) as { dependencies: Record<string, string> };
    // Package id verified against a real Studio publish: dots, not underscores.
    expect(projectJson.dependencies['Invoice.Entry.VBO']).toBe('[1.0.0]');
    expect(projectJson.dependencies['Invoice_Entry_VBO']).toBeUndefined();

    const punch = conversion.punchList.find((p) => p.reason.includes('Library mode'));
    expect(punch).toBeDefined();
    expect(punch!.reason).toContain('Invoice.Entry.VBO');
    // The swap is no longer manual — the punch asks for install, not rewiring.
    expect(punch!.reason).not.toContain('replace each InvokeWorkflowFile');
  });

  it('library (BL-008 residual): object calls are wired as compiled library activities', async () => {
    const model = await sample2();
    const performer = model.processes.find((p) => p.name === 'Invoice Performer')!;
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;

    // Performer: Process Item's Enter Invoice call becomes <lib0:Enter_Invoice …/>
    const { project } = buildProcessExport(model, performer, {}, 'library');
    const pageXaml = project.files.find((f) => f.path === 'Pages/Process_Item.xaml')!.content;
    expect(pageXaml).toContain(
      'xmlns:lib0="clr-namespace:Invoice_Entry_VBO;assembly=Invoice Entry VBO"',
    );
    expect(pageXaml).toContain('<lib0:Enter_Invoice DisplayName="Enter Invoice"');
    expect(pageXaml).toContain('in_Invoice_Ref="[');
    expect(pageXaml).not.toContain('WorkflowFileName="Objects\\');

    // Dispatcher: the out-argument binds as a plain attribute too. (REFramework
    // emits scaffold + converted page both at Main.xaml pre-BL-014 — take the
    // converted one, pushed last.)
    const { project: dispatcherProject } = buildProcessExport(model, dispatcher, {}, 'library');
    const mainXaml = dispatcherProject.files.filter((f) => f.path === 'Main.xaml').at(-1)!.content;
    expect(mainXaml).toContain('<lib0:Get_Pending_Invoices');
    expect(mainXaml).toContain('out_Invoices="[');
    expect(mainXaml).not.toContain('WorkflowFileName="Objects\\');

    // Embed mode still uses InvokeWorkflowFile (regression)
    const { project: embedProject } = buildProcessExport(model, performer);
    const embedXaml = embedProject.files.find((f) => f.path === 'Pages/Process_Item.xaml')!.content;
    expect(embedXaml).toContain('WorkflowFileName="Objects\\Invoice_Entry_VBO\\Enter_Invoice.xaml"');
    expect(embedXaml).not.toContain('<lib0:');
  });
});

describe('release export delivery modes', () => {
  it('library mode bundles Libraries/<Object>/ once, shared by all consumers', async () => {
    const model = await sample2();
    const release = buildReleaseExport(model, {}, { objects: 'library' });
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

describe('BL-006 · test-case stubs ride in every process export', () => {
  it('Tests/ workflows present + registered in fileInfoCollection + Testing dependency', async () => {
    const model = await sample2();
    const dispatcher = model.processes.find((p) => p.name === 'Invoice Dispatcher')!;
    const { project } = buildProcessExport(model, dispatcher);

    const paths = project.files.map((f) => f.path);
    expect(paths).toContain('Tests/Invoice_Dispatcher_HappyPath.xaml');
    expect(paths).toContain('Tests/Invoice_Dispatcher_ExceptionPath.xaml');

    const projectJson = JSON.parse(
      project.files.find((f) => f.path === 'project.json')!.content,
    ) as {
      dependencies: Record<string, string>;
      designOptions: { fileInfoCollection: { fileName: string; testCaseType: string; testCaseId: string }[] };
    };
    expect(projectJson.dependencies['UiPath.Testing.Activities']).toBe('[24.10.0]');
    const registered = projectJson.designOptions.fileInfoCollection;
    expect(registered.map((f) => f.fileName).sort()).toEqual([
      'Tests/Invoice_Dispatcher_ExceptionPath.xaml',
      'Tests/Invoice_Dispatcher_HappyPath.xaml',
    ]);
    for (const entry of registered) {
      expect(entry.testCaseType).toBe('TestCase');
      expect(entry.testCaseId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
