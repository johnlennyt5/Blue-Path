/**
 * Client-side UiPath project export (S4-5): conversion → ZIP entirely in the
 * browser via JSZip. Nothing is ever sent over the network — the blob is
 * assembled in memory and handed to the browser's download machinery.
 */
import JSZip from 'jszip';
import type { AutomationModel, ProcessNode } from '@prismshift/ir';
import {
  buildProject,
  convertProcess,
  decideProjectLayout,
} from '@prismshift/transformer';
import type { ProcessConversion, UiPathProject } from '@prismshift/transformer';
import { plog } from './debug';

export interface ProcessExport {
  project: UiPathProject;
  conversion: ProcessConversion;
}

/** True when any action stage is a queue operation. */
function processUsesQueues(process: ProcessNode): boolean {
  return process.pages.some((page) =>
    page.stages.some(
      (s) => s.kind === 'action' && (s.queueName !== undefined || s.objectName === 'Work Queues'),
    ),
  );
}

export function buildProcessExport(model: AutomationModel, process: ProcessNode): ProcessExport {
  const conversion = convertProcess(model, process);
  const layout = decideProjectLayout({
    stageCount: conversion.totalStageCount,
    usesQueues: processUsesQueues(process),
  });
  const project = buildProject({
    name: process.name,
    description: `Converted from Blue Prism "${process.name}" by PrismShift (coverage ${conversion.coveragePct}%).`,
    layout,
    workflows: conversion.workflows,
  });
  return { project, conversion };
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
