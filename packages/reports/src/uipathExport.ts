/**
 * UiPath project export assembly (lifted from apps/web in BL-003 so the CLI
 * and the web app share one implementation). Pure: conversion → file list.
 * Zipping/downloading stays in the web app; the CLI writes files to disk.
 */
import type { AutomationModel, ProcessNode } from '@prismshift/ir';
import {
  buildManifests,
  buildProject,
  convertObject,
  convertProcess,
  decideProjectLayout,
  emitWorkflowXaml,
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

export function buildProcessExport(model: AutomationModel, process: ProcessNode): ProcessExport {
  const conversion = convertProcess(model, process);
  const layout = decideProjectLayout({
    stageCount: conversion.totalStageCount,
    usesQueues: processUsesQueues(process),
  });
  const queueName = firstQueueName(process);
  const project = buildProject({
    name: process.name,
    description: `Converted from Blue Prism "${process.name}" by PrismShift (coverage ${conversion.coveragePct}%).`,
    layout,
    ...(queueName !== undefined ? { queueName } : {}),
    workflows: conversion.workflows,
  });

  // Referenced objects ship as Objects/<Object>/<Page>.xaml workflows
  const objectNames = referencedObjects(model, process);
  const objectConversions = model.objects
    .filter((o) => objectNames.includes(o.name))
    .map((o) => convertObject(model, o));
  for (const objectConversion of objectConversions) {
    for (const workflow of objectConversion.workflows) {
      project.files.push({
        path: workflow.path,
        content: emitObjectWorkflow(workflow.doc),
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
export function buildReleaseExport(model: AutomationModel): ReleaseExport {
  const exports = model.processes.map((process) => buildProcessExport(model, process));
  const files = exports.flatMap((processExport) => {
    const folder = processExport.project.name.replace(/[^A-Za-z0-9_-]+/g, '_');
    return processExport.project.files.map((file) => ({
      path: `${folder}/${file.path}`,
      content: file.content,
    }));
  });
  return { exports, files };
}

