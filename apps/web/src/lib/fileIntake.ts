/**
 * Client-side intake of .bprelease / .xml exports. Files are read entirely
 * in the browser (File.text()) — pipeline content never touches a server
 * (ARCHITECTURE §1). Rejections return a human-readable reason instead of
 * throwing.
 */

/** §12: maximum supported export size. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface LoadedRelease {
  fileName: string;
  sizeBytes: number;
  xml: string;
}

export type IntakeResult =
  | { ok: true; file: LoadedRelease }
  | { ok: false; reason: string };

const ACCEPTED_EXTENSIONS = ['.bprelease', '.xml'];

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Cheap content sniff — full schema validation is the parser's job (S1-6).
 * Accepts documents that start like XML and mention a Blue Prism release or
 * process element anywhere in the head of the file.
 */
export function looksLikeBpExport(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<')) return false;
  if (trimmed.includes('\u0000')) return false;
  const head = trimmed.slice(0, 4096);
  return head.includes('<bpr:release') || head.includes('<process');
}

export async function readReleaseFile(file: File): Promise<IntakeResult> {
  if (!hasAcceptedExtension(file.name)) {
    return {
      ok: false,
      reason: `"${file.name}" is not a Blue Prism export — expected a .bprelease or .xml file.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: `"${file.name}" is empty.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `"${file.name}" is ${formatBytes(file.size)} — the maximum supported export size is ${formatBytes(MAX_FILE_BYTES)}.`,
    };
  }

  let text: string;
  try {
    text = await readFileText(file);
  } catch (cause) {
    return { ok: false, reason: `Could not read "${file.name}": ${String(cause)}` };
  }
  if (!looksLikeBpExport(text)) {
    return {
      ok: false,
      reason: `"${file.name}" does not look like Blue Prism XML. Export your process as a release (.bprelease) from Blue Prism and try again.`,
    };
  }

  return {
    ok: true,
    file: { fileName: file.name, sizeBytes: file.size, xml: text },
  };
}

/** File.text() with a FileReader fallback for environments that lack it. */
async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}
