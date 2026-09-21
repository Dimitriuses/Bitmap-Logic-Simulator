# Contract: Document, History and PNG

**Feature**: `001-circuit-editor` | **Modules**: `src/document.ts`,
`src/history.ts`, `src/png.ts`, plus additions to `src/fileHandler.ts`

Signatures are the contract; bodies are for the implementation phase.

---

## `src/document.ts` — CircuitDocument

```ts
/** Packed RGBA, as produced by viewing the byte array as a Uint32Array. */
export type Rgba = number;

export class CircuitDocument {
  readonly width: number;
  readonly height: number;
  readonly name: string;

  /** Source pixels. Never rendered/dimmed values — see invariant D1. */
  readonly pixels: ImageData;

  get dirty(): boolean;
  get canUndo(): boolean;
  get canRedo(): boolean;

  static fromImageData(name: string, image: ImageData): CircuitDocument;

  /** Read one pixel. Out of bounds returns 0. */
  get(x: number, y: number): Rgba;

  /**
   * Write one pixel inside the current stroke. Out-of-bounds writes are
   * dropped (T3). Records the pre-stroke value on first touch only (E2).
   */
  set(x: number, y: number, color: Rgba): void;

  /** Bresenham between two points, inclusive, so fast pointers stay connected (T2). */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgba): void;

  beginStroke(label: string): void;
  /** Commits one Edit, or discards it when nothing changed (E4). */
  endStroke(): Edit | null;

  undo(): boolean;
  redo(): boolean;

  /** Pixels changed since the last compile, for the overlay (P1–P3). */
  pendingEdits(): ReadonlyMap<number, Rgba>;

  /**
   * Compile to a simulatable Circuit and clear pending.
   * `prevRender` carries wire state across, exactly as live reload does.
   */
  compile(prevRender: PrevRender | null): Circuit;

  markSaved(): void;
}
```

**Requirements**

- **DA-1** — `compile()` is the *only* place a `Circuit` is constructed from a
  document. Callers must not build one from `pixels` directly, or pending-edit
  bookkeeping goes stale.
- **DA-2** — `set()` and `line()` outside a `beginStroke`/`endStroke` pair are a
  programming error and must throw, not silently skip history.
- **DA-3** — `undo()`/`redo()` mutate `pixels` and update `pending`; the caller
  recompiles (H3). They return `false` when the respective stack is empty.
- **DA-4** — `compile()` must not be called more than once per stroke (FR-009).

---

## `src/history.ts` — EditHistory

```ts
export interface Edit {
  readonly label: string;
  readonly indices: Int32Array;
  readonly before: Uint32Array;
  readonly after: Uint32Array;
}

export class EditHistory {
  constructor(pixelBudget?: number);

  get canUndo(): boolean;
  get canRedo(): boolean;

  /** Pushes and clears the redo stack (H2). Trims to budget (H1). */
  push(edit: Edit): void;

  /** Returns the edit to reverse, or null. */
  popUndo(): Edit | null;
  popRedo(): Edit | null;

  clear(): void;
}
```

**Requirements**

- **HA-1** — Trimming is by cumulative touched pixels, never by entry count, so
  history cost is independent of bitmap size (FR-018).
- **HA-2** — Parallel arrays stay equal length (E1).
- **HA-3** — History belongs to a document and is discarded when the document is
  replaced.

---

## `src/png.ts` — Encoding and saving

```ts
export type SaveOutcome =
  | { kind: 'written' }            // written in place through the handle
  | { kind: 'downloaded' }         // fell back to a download
  | { kind: 'cancelled' };         // user dismissed a prompt

/** Encode the document's source pixels as a PNG blob. */
export function encodePng(doc: CircuitDocument): Promise<Blob>;

/**
 * Write in place where possible, download otherwise.
 * MUST be called synchronously from a user gesture (see SV-2).
 */
export function saveDocument(
  doc: CircuitDocument,
  source: FileSource | null
): Promise<SaveOutcome>;

export function downloadPng(doc: CircuitDocument): Promise<void>;
```

**Requirements**

- **SV-1 — Source, not render.** `encodePng` reads `doc.pixels`. Encoding
  `Circuit.frame` would bake the inactive-wire dimming into the file and destroy
  the circuit. This is the feature's most damaging possible defect (D1).
- **SV-2 — Gesture chain.** `handle.requestPermission({ mode: 'readwrite' })` must
  be reached without an intervening `await` that breaks the user-gesture context,
  or Chromium rejects the prompt and the save fails silently (research R4).
- **SV-3 — Alpha 255** on every encoded pixel, for lossless round-tripping (D2).
- **SV-4 — Degrade, don't fail.** No handle, or permission refused, means download.
  A refusal is not an error state.
- **SV-5** — A successful save calls `doc.markSaved()`.

---

## `src/fileHandler.ts` — additions

```ts
export class FileSource {
  /** True when this source can be written in place (handle origin only). */
  get canWrite(): boolean;

  /** Request read-write permission. Call from a user gesture (SV-2). */
  requestWriteAccess(): Promise<boolean>;

  /**
   * Write bytes back to the underlying file and refresh the poll stamp so the
   * next poll() does not mistake this write for an external edit (FR-014).
   */
  write(blob: Blob): Promise<void>;
}
```

**Requirements**

- **FH-1 — No self-reload.** `write()` must update the stored `lastModified` stamp
  from the file *after* writing, before the next poll can run. Without this the
  poller recompiles over the user's work on the next tick (research R4).
- **FH-2** — `canWrite` is false for `url` and `blob` origins; bundled examples and
  `?file=` links can only ever be downloaded.
- **FH-3** — Existing read and poll behaviour is unchanged for every origin.
