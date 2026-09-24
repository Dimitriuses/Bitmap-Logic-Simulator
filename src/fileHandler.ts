// fileHandler.ts — getting a PNG into an ImageData, plus live reload.
//
// The desktop version polls FileAge on the schematic and re-runs the whole
// pipeline when the file changes, so you can edit the PNG in a paint program,
// hit save, and watch the running circuit update. The browser equivalent is the
// File System Access API: a FileSystemFileHandle keeps returning fresh contents
// from disk, so we poll lastModified. Browsers without it (Firefox, Safari) get
// a plain one-shot load — everything else works the same.

import { errorMessage } from './errors.js';

/** One schematic in the Examples menu, as written by scripts/gen-examples.mjs. */
export interface ExampleEntry {
  /** Path relative to the site root, e.g. "projects/CPU/ALU.png". */
  readonly path: string;
  readonly label: string;
  /** The folder under projects/, prettified; groups the dropdown. */
  readonly group: string;
}

/** Built at `npm run build` by scanning projects/. */
const EXAMPLES_MANIFEST = 'dist/examples.json';

/**
 * Used when the manifest cannot be fetched — typically because the page was
 * opened straight off the filesystem, or because the build has not been run.
 */
const FALLBACK_EXAMPLES: ExampleEntry[] = [
  { path: 'projects/External_Shemes/Flip Flop.png', label: 'Flip Flop', group: 'External Shemes' },
  { path: 'projects/Enigma_v1/counter.png', label: 'Counter', group: 'Enigma v1' },
  { path: 'projects/CPU/4bitAdder.png', label: '4-bit Adder', group: 'CPU' },
  { path: 'projects/CPU/ALU.png', label: 'ALU', group: 'CPU' },
  { path: 'projects/CPU/4bitCPU.png', label: '4-bit CPU', group: 'CPU' },
  { path: 'projects/Enigma_v2/Enigma2.png', label: 'Enigma 2', group: 'Enigma v2' },
];

/** The schematic shown on a cold start, if it is in the manifest. */
export const DEFAULT_EXAMPLE = 'projects/Enigma_v2/Enigma2.png';

export const supportsLiveReload =
  typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

/** Percent-encode a site-relative path without destroying its separators. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Decode a PNG blob into ImageData. */
export function decodeImage(blob: Blob): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.width || !img.height) {
        reject(new Error('Image has no pixels.'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Canvas 2D is not available in this browser.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      try {
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      } catch (err) {
        reject(
          new Error(`Could not read pixels (${errorMessage(err)}). Serve the page over HTTP.`)
        );
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a readable image file.'));
    };
    img.src = url;
  });
}

/**
 * Where a schematic's bytes come from. Only a handle can be re-read from disk,
 * which is what live reload needs; the other two are one-shot.
 */
type Origin =
  | { readonly kind: 'handle'; readonly handle: FileSystemFileHandle }
  | { readonly kind: 'blob'; readonly blob: Blob }
  | { readonly kind: 'url'; readonly url: string };

/**
 * A schematic the app can (re)read. `poll()` resolves to fresh ImageData when
 * the underlying file changed on disk, or null when it did not / cannot tell.
 */
export class FileSource {
  readonly name: string;
  private readonly origin: Origin;
  private stamp: number | null = null;

  private constructor(name: string, origin: Origin) {
    this.name = name;
    this.origin = origin;
  }

  /** A real file on disk, re-readable — the only origin that can live reload. */
  static fromHandle(handle: FileSystemFileHandle): FileSource {
    return new FileSource(handle.name, { kind: 'handle', handle });
  }

  /** A dropped or picked File, readable once. */
  static fromBlob(name: string, blob: Blob): FileSource {
    return new FileSource(name, { kind: 'blob', blob });
  }

  /** Something served over HTTP: a bundled example, or a ?file= deep link. */
  static fromUrl(name: string, url: string): FileSource {
    return new FileSource(name, { kind: 'url', url });
  }

  get canLiveReload(): boolean {
    return this.origin.kind === 'handle';
  }

  /**
   * True when this source can be written back in place. Only a real file handle
   * can be; bundled examples and `?file=` links are fetched over HTTP and have
   * nothing to write to.
   */
  get canWrite(): boolean {
    return this.origin.kind === 'handle' && typeof this.origin.handle.createWritable === 'function';
  }

  /**
   * Ask for read-write access. A handle from showOpenFilePicker() is read-only
   * until this succeeds, and the prompt requires a live user gesture — so this
   * must be reached without an intervening await that breaks the gesture chain.
   */
  async requestWriteAccess(): Promise<boolean> {
    const origin = this.origin;
    if (origin.kind !== 'handle') return false;
    const handle = origin.handle;
    try {
      const query = await handle.queryPermission?.({ mode: 'readwrite' });
      if (query === 'granted') return true;
      const granted = await handle.requestPermission?.({ mode: 'readwrite' });
      return granted === 'granted';
    } catch {
      return false; // older implementations without the permission methods
    }
  }

  /**
   * Write bytes back to the underlying file.
   *
   * Refreshing the stamp afterwards is load-bearing: poll() compares
   * lastModified, and our own write changes it. Without this the very next poll
   * would see an "external" change and recompile over whatever the user has
   * drawn since.
   */
  async write(blob: Blob): Promise<void> {
    const origin = this.origin;
    if (origin.kind !== 'handle') throw new Error('This circuit cannot be written in place.');
    const writable = await origin.handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    const file = await origin.handle.getFile();
    this.stamp = file.lastModified;
  }

  async read(): Promise<ImageData> {
    const origin = this.origin;
    switch (origin.kind) {
      case 'handle': {
        const file = await origin.handle.getFile();
        this.stamp = file.lastModified;
        return decodeImage(file);
      }
      case 'blob':
        return decodeImage(origin.blob);
      case 'url': {
        const res = await fetch(origin.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return decodeImage(await res.blob());
      }
    }
  }

  /** The FileAge poll from UMain.pas:199, in browser terms. */
  async poll(): Promise<ImageData | null> {
    const origin = this.origin;
    if (origin.kind !== 'handle') return null;
    let file: File;
    try {
      file = await origin.handle.getFile();
    } catch {
      return null; // file was moved or deleted; keep showing what we have
    }
    if (this.stamp !== null && file.lastModified === this.stamp) return null;
    this.stamp = file.lastModified;
    return decodeImage(file);
  }
}

function pickViaInput(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) resolve(file);
      else reject(new DOMException('No file chosen', 'AbortError'));
    };
    input.click();
  });
}

/** "Open File" — uses a real file handle when the browser has one. */
export async function pickFile(): Promise<FileSource> {
  const picker = window.showOpenFilePicker;
  if (picker) {
    const [handle] = await picker.call(window, {
      types: [{ description: 'PNG schematic', accept: { 'image/png': ['.png'] } }],
      multiple: false,
    });
    if (!handle) throw new DOMException('No file chosen', 'AbortError');
    return FileSource.fromHandle(handle);
  }
  const file = await pickViaInput();
  return FileSource.fromBlob(file.name, file);
}

/**
 * Turn a drop into a FileSource, preferring a handle so live reload keeps
 * working for dropped files too.
 */
export async function fromDataTransfer(dataTransfer: DataTransfer): Promise<FileSource> {
  const item = dataTransfer.items?.[0];
  if (item && typeof item.getAsFileSystemHandle === 'function') {
    try {
      const handle = await item.getAsFileSystemHandle();
      if (handle && handle.kind === 'file') {
        return FileSource.fromHandle(handle as FileSystemFileHandle);
      }
    } catch {
      // fall through to the plain File below
    }
  }
  const file = dataTransfer.files?.[0];
  if (!file) throw new Error('Nothing droppable in there.');
  return FileSource.fromBlob(file.name, file);
}

/** Load one of the bundled schematics. Paths stay relative for GitHub Pages. */
export function exampleSource(entry: ExampleEntry): FileSource {
  return FileSource.fromUrl(entry.label, encodePath(entry.path));
}

function isExampleEntry(value: unknown): value is ExampleEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<ExampleEntry>;
  return typeof e.path === 'string' && typeof e.label === 'string' && typeof e.group === 'string';
}

/**
 * Read the example manifest, falling back to the built-in list if it is not
 * reachable or does not parse.
 */
export async function loadExampleList(): Promise<ExampleEntry[]> {
  try {
    const res = await fetch(EXAMPLES_MANIFEST, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const list: unknown = await res.json();
    if (Array.isArray(list)) {
      const entries = list.filter(isExampleEntry);
      if (entries.length) return entries;
    }
  } catch {
    // ignore — the hardcoded list is the fallback
  }
  return FALLBACK_EXAMPLES;
}

/** Drag-and-drop wiring. onFile receives a FileSource, or an error. */
export function setupDragDrop(
  element: HTMLElement,
  onFile: (source: FileSource | null, err?: unknown) => void,
  onState: (active: boolean) => void
): void {
  let depth = 0;

  element.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    onState(true);
  });
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  element.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--depth <= 0) {
      depth = 0;
      onState(false);
    }
  });
  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    onState(false);
    if (!e.dataTransfer) return;
    try {
      onFile(await fromDataTransfer(e.dataTransfer));
    } catch (err) {
      onFile(null, err);
    }
  });
}

// ---------------------------------------------------------------------------
// Sidecar files
// ---------------------------------------------------------------------------

/**
 * Offer a text file for saving.
 *
 * NOTE WHAT THIS CANNOT DO. A FileSystemFileHandle gives no access to its
 * parent directory — there is no getParent(), and resolve() needs a directory
 * handle to resolve against. So the app cannot silently write
 * `4bitCPU.labels.json` next to `4bitCPU.png`, however much it would like to.
 * The user picks the location once, or gets a download. Pretending otherwise in
 * the UI would promise something the platform does not allow.
 */
export async function saveTextFile(suggestedName: string, text: string): Promise<'written' | 'downloaded'> {
  const blob = new Blob([text], { type: 'application/json' });

  const picker = (window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;

  if (typeof picker === 'function') {
    const handle = await picker({
      suggestedName,
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    const writable = await (handle as unknown as {
      createWritable: () => Promise<WritableStream & { write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
    }).createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return 'written';
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

/** Ask for a text file and read it. Resolves to null if the user cancels. */
export async function pickTextFile(accept = 'application/json,.json'): Promise<{ name: string; text: string } | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  const chosen = new Promise<File | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
  });
  input.click();
  const file = await chosen;
  if (!file) return null;
  return { name: file.name, text: await file.text() };
}
