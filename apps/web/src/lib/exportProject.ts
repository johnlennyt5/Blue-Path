/**
 * Client-side UiPath project export (S4-5): conversion → ZIP entirely in the
 * browser via JSZip. Nothing is ever sent over the network — the blob is
 * assembled in memory and handed to the browser's download machinery.
 */
import JSZip from 'jszip';
import type { AutomationModel, ProcessNode } from '@prismshift/ir';
import {
  buildManifests,
  buildProject,
  convertObject,
  convertProcess,
  decideProjectLayout,
} from '@prismshift/transformer';
import type { ObjectConversion, ProcessConversion, UiPathProject } from '@prismshift/transformer';
import { buildMigrationReport } from '@prismshift/reports';
import { emitWorkflowXaml as emitObjectWorkflow } from '@prismshift/transformer';
import { plog } from './debug';

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

export function buildProcessExport(
  model: AutomationModel,
  process: ProcessNode,
  codeOverrides: Record<string, string> = {},
): ProcessExport {
  const conversion = convertProcess(model, process, { codeOverrides });
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
    .map((o) => convertObject(model, o, { codeOverrides }));
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

export async function releaseZipBlob(release: ReleaseExport): Promise<Blob> {
  const zip = new JSZip();
  for (const file of release.files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function projectZipBlob(project: UiPathProject): Promise<Blob> {
  const zip = new JSZip();
  for (const file of project.files) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Browser download via an object URL — local only, revoked immediately. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  plog(`ZIP "${fileName}" generated client-side and handed to the browser (no network).`);
}
