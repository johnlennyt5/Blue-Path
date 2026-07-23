/**
 * UiPath project export assembly (lifted from apps/web in BL-003 so the CLI
 * and the web app share one implementation). Pure: conversion → file list.
 * Zipping/downloading stays in the web app; the CLI writes files to disk.
 */
import type { AutomationModel, BusinessObjectNode, ProcessNode } from '@prismshift/ir';
import {
  buildLibraryProject,
  buildManifests,
  buildProject,
  buildTestCases,
  convertObject,
  convertProcess,
  decideProjectLayout,
  emitWorkflowXaml,
  sanitizeFileName,
} from '@prismshift/transformer';
import type { ObjectConversion, ProcessConversion, UiPathProject } from '@prismshift/transformer';
import { deterministicGuid } from '@prismshift/transformer';
import { buildMigrationReport } from './migrationReport';

const emitObjectWorkflow = emitWorkflowXaml;

export interface ProcessExport {
  project: UiPathProject;
  conversion: ProcessConversion;
  objectConversions: ObjectConversion[];
}

/** True when any action stage is a queue operation. */
function processUsesQueues(process: ProcessNode): boolean {
  return process.pages.some((page) =>
    page.stages.some(
      (s) => s.kind === 'action' && (s.queueName !== undefined || s.objectName === 'Work Queues'),
    ),
  );
}

/** First queue this process touches (wires the REFramework scaffolds). */
function firstQueueName(process: ProcessNode): string | undefined {
  for (const page of process.pages) {
    for (const stage of page.stages) {
      if (stage.kind === 'action' && stage.queueName !== undefined) return stage.queueName;
    }
  }
  return undefined;
}

/** Objects this process actually calls (their workflows ship in the ZIP). */
function referencedObjects(model: AutomationModel, process: ProcessNode): string[] {
  const names = new Set<string>();
  for (const page of process.pages) {
    for (const stage of page.stages) {
      if (stage.kind === 'action' && stage.queueName === undefined) names.add(stage.objectName);
    }
  }
  return model.objects.filter((o) => names.has(o.name)).map((o) => o.name);
}

export type ObjectDelivery = 'embed' | 'library';

/**
 * The NuGet package id Studio mints on publish: the project name with
 * non-alphanumeric runs replaced by dots ("Invoice Entry VBO" →
 * "Invoice.Entry.VBO"). Verified against a real published .nupkg.
 */
export function libraryPackageId(name: string): string {
  return name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join('.');
}

/**
 * BL-008 residual: replace every `InvokeWorkflowFile Objects\<Obj>\<Page>.xaml`
 * in the tree with the compiled library activity it becomes once the library
 * package is installed. Mutates nodes in place (generic walk — container
 * shapes don't matter).
 */
function rewireLibraryInvokes(node: unknown, rawNameByDir: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewireLibraryInvokes(item, rawNameByDir);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record['kind'] === 'invokeWorkflow' && typeof record['workflowFile'] === 'string') {
    const match = /^Objects\\([^\\]+)\\([^\\]+)\.xaml$/.exec(record['workflowFile']);
    if (match !== null) {
      const dir = match[1]!;
      record['kind'] = 'libraryActivity';
      record['clrNamespace'] = dir;
      record['assembly'] = rawNameByDir.get(dir) ?? dir;
      record['activityClass'] = match[2]!;
      delete record['workflowFile'];
      return;
    }
  }
  for (const value of Object.values(record)) rewireLibraryInvokes(value, rawNameByDir);
}

export function buildProcessExport(
  model: AutomationModel,
  process: ProcessNode,
  codeOverrides: Record<string, string> = {},
  objectDelivery: ObjectDelivery = 'embed',
): ProcessExport {
  const conversion = convertProcess(model, process, { codeOverrides });
  const layout = decideProjectLayout({
    stageCount: conversion.totalStageCount,
    usesQueues: processUsesQueues(process),
  });
  const queueName = firstQueueName(process);
  const objectNames = referencedObjects(model, process);

  // BL-008 residual: in library mode, rewire InvokeWorkflowFile calls into
  // Objects\… as compiled library activities BEFORE the workflows are emitted.
  // Shape verified against a Studio-published .nupkg (assembly metadata):
  // namespace/class = sanitized object/page names; every workflow argument is
  // a same-named activity property; the package id dots the object name.
  if (objectDelivery === 'library') {
    const rawNameByDir = new Map(model.objects.map((o) => [sanitizeFileName(o.name), o.name]));
    for (const workflow of conversion.workflows) {
      rewireLibraryInvokes(workflow.doc.body, rawNameByDir);
    }
  }
  // BL-016: seed the REFramework Config from the release itself
  const configEntries = [
    ...(queueName !== undefined ? [{ key: 'OrchestratorQueueName', value: queueName }] : []),
    ...model.environmentVars.map((envVar) => ({ key: envVar.name, value: envVar.value ?? '' })),
    ...model.credentialsRefs.map((credential) => ({
      key: `${credential.name}_CredentialAsset`,
      value: credential.name,
    })),
  ];
  const project = buildProject({
    name: process.name,
    description: `Converted from Blue Prism "${process.name}" by PrismShift (coverage ${conversion.coveragePct}%).`,
    layout,
    ...(queueName !== undefined ? { queueName } : {}),
    workflows: conversion.workflows,
    configEntries,
  });
  if (layout === 'reframework') {
    project.files.push({
      path: 'Data/Config.json',
      content: `${JSON.stringify(Object.fromEntries(configEntries.map((e) => [e.key, e.value])), null, 2)}\n`,
    });
  }

  const objectConversions = model.objects
    .filter((o) => objectNames.includes(o.name))
    .map((o) => convertObject(model, o, { codeOverrides }));

  if (objectDelivery === 'embed') {
    // Copy mode (default): referenced objects ship as Objects/<Object>/<Page>.xaml
    for (const objectConversion of objectConversions) {
      for (const workflow of objectConversion.workflows) {
        project.files.push({
          path: workflow.path,
          content: emitObjectWorkflow(workflow.doc),
        });
      }
    }
  } else {
    // BL-008 library mode: no copies — object calls are wired as compiled
    // library activities (rewired above) and the packages become project
    // dependencies. Package ids verified against a Studio publish: the
    // project name with non-alphanumeric runs replaced by dots.
    const projectJsonFile = project.files.find((f) => f.path === 'project.json')!;
    const projectJson = JSON.parse(projectJsonFile.content) as {
      dependencies: Record<string, string>;
    };
    for (const name of objectNames) {
      projectJson.dependencies[libraryPackageId(name)] = '[1.0.0]';
    }
    projectJsonFile.content = `${JSON.stringify(projectJson, null, 2)}\n`;
    for (const name of objectNames) {
      conversion.punchList.push({
        pageName: '(project)',
        stageName: name,
        stageKind: 'action',
        reason: `Library mode: object calls are wired as compiled "${sanitizeFileName(name)}" activities — publish Libraries/${sanitizeFileName(name)} to your feed and install package "${libraryPackageId(name)}" (adjust the [1.0.0] pin if your feed holds a different version) before opening this project.`,
        sourceRef: 'project.json/dependencies',
      });
    }
  }

  // BL-006: Given/When/Then test-case stubs per process, registered in
  // project.json (fileInfoCollection) with the Testing dependency declared.
  const mainWorkflow = conversion.workflows[0];
  if (mainWorkflow !== undefined) {
    const testCases = buildTestCases({
      processName: process.name,
      mainFile: mainWorkflow.path,
      arguments: mainWorkflow.doc.arguments,
    });
    for (const testCase of testCases) {
      project.files.push({ path: testCase.path, content: emitWorkflowXaml(testCase.doc) });
    }
    const projectJsonFile = project.files.find((f) => f.path === 'project.json')!;
    const projectJson = JSON.parse(projectJsonFile.content) as {
      dependencies: Record<string, string>;
      designOptions: { fileInfoCollection: unknown[] };
    };
    projectJson.dependencies['UiPath.Testing.Activities'] = '[24.10.0]';
    projectJson.designOptions.fileInfoCollection = testCases.map((testCase) => ({
      editingStatus: 'Publishable',
      testCaseId: deterministicGuid(`${process.name}/test/${testCase.path}`),
      testCaseType: 'TestCase',
      fileName: testCase.path,
    }));
    projectJsonFile.content = `${JSON.stringify(projectJson, null, 2)}\n`;
  }

  // Orchestrator setup manifests + the honest migration report ride along
  project.files.push(...buildManifests(model));
  project.files.push({
    path: 'MIGRATION_REPORT.md',
    content: buildMigrationReport(conversion, objectConversions),
  });
  return { project, conversion, objectConversions };
}

export interface ObjectLibraryExport {
  project: UiPathProject;
  conversion: ObjectConversion;
}

/**
 * BL-008: export one VBO as a standalone, publishable UiPath library.
 * Selector validation stays mandatory — the checklist ships inside.
 */
export function buildObjectLibraryExport(
  model: AutomationModel,
  object: BusinessObjectNode,
  codeOverrides: Record<string, string> = {},
): ObjectLibraryExport {
  const conversion = convertObject(model, object, { codeOverrides });
  const project = buildLibraryProject({
    name: object.name,
    workflows: conversion.workflows,
  });
  const selectorLines =
    conversion.selectors.length === 0
      ? ['_No application elements in scope._']
      : [
          '| Element | Mode | Selector / strategy | Confidence | Notes |',
          '|---|---|---|---|---|',
          ...conversion.selectors.map(
            (s) =>
              `| ${s.elementName} | ${s.mode} | ${s.selector !== undefined ? `\`${s.selector}\`` : '**Image/OCR required**'} | ${s.confidence} | ${s.notes.length > 0 ? s.notes.join('; ') : '—'} |`,
          ),
        ];
  project.files.push({
    path: 'LIBRARY_README.md',
    content: [
      `# ${object.name} — UiPath Library (converted by PrismShift)`,
      '',
      'Publish this project to your Orchestrator/NuGet feed, then reference it',
      'from consuming processes as a dependency. Each root workflow becomes a',
      'reusable activity on publish.',
      '',
      `## Selector validation checklist (${conversion.selectors.length} — ALL mandatory)`,
      '',
      ...selectorLines,
      '',
      '> Selectors are generated from App Modeller metadata and **cannot be verified without the live target applications**.',
      '',
    ].join('\n'),
  });
  return { project, conversion };
}

export interface ReleaseExport {
  /** One complete, self-contained UiPath project per process. */
  exports: ProcessExport[];
  /** All project files, prefixed with <ProcessFolder>/ for the bundle ZIP. */
  files: { path: string; content: string }[];
}

/**
 * Whole-release bundle: every process becomes its own UiPath project in a
 * top-level folder (UiPath projects have exactly one entry process each —
 * a multi-process release cannot be a single project.json).
 */
export function buildReleaseExport(
  model: AutomationModel,
  codeOverrides: Record<string, string> = {},
  options: { objects?: ObjectDelivery } = {},
): ReleaseExport {
  const objectDelivery = options.objects ?? 'embed';
  const exports = model.processes.map((process) =>
    buildProcessExport(model, process, codeOverrides, objectDelivery),
  );
  const files = exports.flatMap((processExport) => {
    const folder = processExport.project.name.replace(/[^A-Za-z0-9_-]+/g, '_');
    return processExport.project.files.map((file) => ({
      path: `${folder}/${file.path}`,
      content: file.content,
    }));
  });

  if (objectDelivery === 'library') {
    // One publishable library project per object referenced by any process.
    const referenced = new Set(
      model.processes.flatMap((process) => referencedObjects(model, process)),
    );
    for (const object of model.objects) {
      if (!referenced.has(object.name)) continue;
      const library = buildObjectLibraryExport(model, object, codeOverrides);
      const folder = `Libraries/${sanitizeFileName(object.name)}`;
      files.push(
        ...library.project.files.map((file) => ({
          path: `${folder}/${file.path}`,
          content: file.content,
        })),
      );
    }
  }
  return { exports, files };
}

