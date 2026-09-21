// Ambient declarations for the parts of the File System Access API that
// TypeScript's lib.dom does not ship.
//
// `FileSystemHandle` and `FileSystemFileHandle` are already in lib.dom; the
// entry points that hand one to us are not. Declared here rather than pulling
// in @types/wicg-file-system-access, since the project has no runtime
// dependencies and this is the only gap.
//
// Everything below is Chrome/Edge-only, hence optional: call sites must
// feature-detect (see `supportsLiveReload` in fileHandler.ts).

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  id?: string;
  startIn?: FileSystemHandle | string;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}

interface DataTransferItem {
  /** Resolves to null when the item is not backed by a file system entry. */
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
