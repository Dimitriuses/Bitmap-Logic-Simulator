# Contract: Blocks, Selection and Clipboard

**Feature**: `002-editor-workflow` | **Modules**: `src/block.ts`, `src/clipboard.ts`,
`src/tools/select.ts`, plus additions to `src/document.ts`

---

## `src/block.ts` — PixelBlock

```ts
export interface Rect {
  readonly x: number; readonly y: number;
  readonly width: number; readonly height: number;
}

export class PixelBlock {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint32Array;   // packed Rgba, row-major

  static fromRect(doc: CircuitDocument, rect: Rect): PixelBlock;

  /** 90° clockwise. Dimensions swap. */
  rotateCW(): PixelBlock;
  rotateCCW(): PixelBlock;

  /** Visit every pixel with its position relative to the block's origin. */
  forEach(visit: (dx: number, dy: number, color: Rgba) => void): void;
}
```

- **BL-1 — Detached.** A block copies out of the document. Cutting the region it came from,
  or loading another circuit, must leave it intact (B1).
- **BL-2 — Rotation is pixels only.** No gate detection, no pattern rewriting. The corner
  mask rotates with the pixels, so a `right` gate becomes `down` on its own — verified on
  the real engine for all four directions.
- **BL-3 — `rotateCW` four times is the identity**, bit for bit. The cheapest check that the
  transform is exact, and the one to write first.
- **BL-4 — Immutable.** Rotation returns a new block; the clipboard's copy never changes
  under a floating paste being turned.

---

## `src/clipboard.ts` — selection, held block, floating paste

```ts
export class EditorClipboard {
  get selection(): Rect | null;
  get floating(): { block: PixelBlock; x: number; y: number } | null;
  get hasContent(): boolean;

  setSelection(rect: Rect | null): void;
  clearSelection(): void;

  /** Ctrl+C — reads, changes nothing. */
  copy(doc: CircuitDocument): boolean;
  /** Ctrl+X — reads, then clears the region as one edit. */
  cut(doc: CircuitDocument): boolean;
  /** Delete — clears the region as one edit, without copying. */
  erase(doc: CircuitDocument): boolean;

  /** Ctrl+V — begins a floating paste centred on the view or at the selection. */
  beginPaste(centreX: number, centreY: number): boolean;
  moveFloating(dx: number, dy: number): void;
  placeFloating(x: number, y: number): void;
  rotateFloating(direction: 'cw' | 'ccw'): void;

  /** Enter — writes it as one edit. Returns false when nothing was floating. */
  commit(doc: CircuitDocument): boolean;
  /** Escape — drops it, document untouched. */
  cancel(): void;
}
```

- **CB-1 — Copy does not mutate.** After `copy()`, the document must be bit-identical.
- **CB-2 — Cut, delete and commit are each exactly one `Edit`** and one recompile, however
  large the region (F4). They go through `beginStroke`/`endStroke` like any tool.
- **CB-3 — Cancelling is free.** `cancel()` touches no pixels, so a cancelled paste leaves
  the document bit-identical to before `beginPaste` (SC-006).
- **CB-4 — Commit writes the whole rectangle**, insulation included (F2), clipped to the
  bitmap (F3).
- **CB-5 — One floating paste at a time.** `beginPaste` while one floats is ignored rather
  than replacing it, so uncommitted work is never silently dropped.
- **CB-6 — Switching tools does not resolve a paste.** Only Enter and Escape do.
- **CB-7 — Nothing survives a document change.** Loading another circuit clears the
  selection and any floating paste, behind the existing unsaved-changes guard.

---

## `src/tools/select.ts`

Implements the existing `Tool` interface, so the editor routes to it unchanged.

- **SE-1 — Drag defines a rectangle**, normalised so any drag direction gives the same
  result (S1), and clipped to the bitmap (S2).
- **SE-2 — It writes no pixels.** `mutates` is false, like the picker: selecting is not an
  edit and must not produce an undo step.
- **SE-3 — A click with no drag clears the selection** rather than making a 1×1 one.
- **SE-4 — Dragging inside an existing floating paste moves it** instead of starting a new
  selection; that is the pointer half of FR-017.

---

## `src/document.ts` — additions

```ts
/** Copy a rectangle out. Does not begin a stroke; reads only. */
readBlock(rect: Rect): PixelBlock;

/** Write a block at (x, y). Must be called inside a stroke. */
writeBlock(block: PixelBlock, x: number, y: number): void;

/** Fill a rectangle with insulation. Must be called inside a stroke. */
clearRect(rect: Rect): void;
```

- **DC-1 — `writeBlock` and `clearRect` obey the existing stroke rules**: they throw outside
  a stroke, record each pixel once at its pre-stroke value, and drop out-of-bounds writes.
  That is what makes a paste a single undo step with no new machinery.
- **DC-2 — `readBlock` never begins a stroke** and never marks the document dirty.
- **DC-3 — Writes that change nothing cost nothing.** Committing a paste onto identical
  pixels produces an empty edit, which the existing `endStroke` already discards.

---

## Verification

Headless, in `scripts/verify/rotate.mjs` and the clipboard checks:

| Check | Expectation |
| --- | --- |
| `rotateCW` ×4 | bit-identical to the original |
| Rotate a block holding all four gate directions, commit, compile | four gates, each behaving as the rotated direction, confirmed by driving them |
| Copy, then compare the document | unchanged, byte for byte |
| Cut, then undo | document bit-identical to before the cut |
| Paste, nudge 20 times, rotate twice, cancel | document bit-identical; zero recompiles |
| Paste, nudge, rotate, commit | one undo step, one recompile |
