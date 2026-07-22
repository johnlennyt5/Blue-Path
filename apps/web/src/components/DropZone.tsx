import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { plog } from '../lib/debug';
import { useSession } from '../store/session';

export function DropZone() {
  const intakeFile = useSession((s) => s.intakeFile);
  const flagIntakeError = useSession((s) => s.flagIntakeError);
  const intakeError = useSession((s) => s.intakeError);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // If a file is dropped outside the drop target, the browser's default is
  // to navigate away from the app to the file — silently. Prevent that at
  // the window level so a near-miss drop is a no-op instead of a page loss.
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    plog('drop guard armed — window-level dragover/drop defaults prevented');
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files.item(0);
    plog(
      'drop event received',
      file ? `file: ${file.name} (${file.size} B, type "${file.type}")` : 'NO FILE in dataTransfer',
      `dataTransfer.types: ${JSON.stringify(Array.from(event.dataTransfer.types ?? []))}`,
    );
    if (file) {
      void intakeFile(file);
      return;
    }
    // No File object in the drop: dragging from inside an editor (VS Code,
    // Cursor) or a zipped-folder view hands the browser a link, not a file.
    const types = Array.from(event.dataTransfer.types ?? []);
    const fromEditor = types.some((t) => t.includes('code') || t === 'resourceurls');
    flagIntakeError(
      fromEditor
        ? 'That drop came from a code editor, which sends a link instead of the file itself. Drag the file from Windows File Explorer, or click here to browse.'
        : 'That drop contained no file. Drag a .bprelease from Windows File Explorer (not from inside a zipped folder), or click here to browse.',
    );
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    plog('dragenter — something is being dragged over the drop zone');
  };

  return (
    <section aria-label="Import a Blue Prism release">
      <button
        type="button"
        role="button"
        tabIndex={0}
        aria-label="Drop a Blue Prism export file here, or press Enter to browse"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={() => setDragActive(false)}
        className={`w-full rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors ${
          dragActive
            ? 'border-sky-400 bg-sky-500/10'
            : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'
        }`}
      >
        <p className="text-lg font-medium text-slate-200">
          Drop a <span className="font-mono text-sky-400">.bprelease</span> file here
        </p>
        <p className="mt-2 text-sm text-slate-400">
          or click to browse — single-process <span className="font-mono">.xml</span> exports work
          too
        </p>
        <p className="mt-6 text-xs text-slate-500">
          Files are read locally in your browser. Nothing is uploaded.
        </p>
      </button>
      <input
        ref={inputRef}
        aria-label="Blue Prism export file"
        type="file"
        accept=".bprelease,.xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          plog('file picked via browse dialog', file ? `${file.name} (${file.size} B)` : 'none');
          if (file) void intakeFile(file);
          event.target.value = '';
        }}
      />
      {intakeError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
        >
          {intakeError}
        </p>
      )}
    </section>
  );
}
