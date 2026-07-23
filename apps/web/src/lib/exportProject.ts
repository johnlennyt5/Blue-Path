/**
 * Client-side UiPath project export (S4-5): the pure assembly lives in
 * @prismshift/reports (shared with the CLI); this module adds the
 * browser-only parts — ZIP blobs and the download trigger.
 */
import JSZip from 'jszip';
import type { UiPathProject } from '@prismshift/transformer';
import type { ReleaseExport } from '@prismshift/reports';
import { plog } from './debug';

export { buildProcessExport, buildReleaseExport } from '@prismshift/reports';
export type { ProcessExport, ReleaseExport } from '@prismshift/reports';

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
