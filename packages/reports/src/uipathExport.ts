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
  convertObject,
  convertProcess,
  decideProjectLayout,
  emitWorkflowXaml,
  sanitizeFileName,
} from '@prismshift/transformer';
import type { ObjectConversion, ProcessConversion, UiPathProject } from '@prismshift/transformer';
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
    // BL-008 library mode: no copies — reference the exported libraries as
    // dependencies. Studio compiles library workflows into activities, so
    // each InvokeWorkflowFile into Objects\… needs a one-time manual swap
    // after the library is installed (punch-listed per object; automatic
    // rewiring awaits library-activity XAML ground truth).
    const projectJsonFile = project.files.find((f) => f.path === 'project.json')!;
    const projectJson = JSON.parse(projectJsonFile.content) as {
      dependencies: Record<string, string>;
    };
    for (const name of objectNames) {
      projectJson.dependencies[sanitizeFileName(name)] = '[1.0.0]';
    }
    projectJsonFile.content = `${JSON.stringify(projectJson, null, 2)}\n`;
    for (const name of objectNames) {
      conversion.punchList.push({
        pageName: '(project)',
        stageName: name,
        stageKind: 'action',
        reason: `Library mode: install library "${sanitizeFileName(name)}" (1.0.0) from your feed, then replace each InvokeWorkflowFile into Objects\\${sanitizeFileName(name)}\\… with the corresponding library activity.`,
        sourceRef: 'project.json/dependencies',
      });
    }
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

