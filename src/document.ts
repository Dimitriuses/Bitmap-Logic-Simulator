// document.ts — the editable circuit.
//
// This is the layer the editor adds. Before it, a decoded PNG went straight into
// a Circuit; now it becomes a CircuitDocument, and a Circuit is compiled *from*
// the document. The relationship is strictly one way:
//
//   FileSource ──decode──▶ CircuitDocument ──compile──▶ Circuit ──render──▶ canvas
//
// Nothing compiled ever writes back. That is what keeps simulator.ts frozen and
// its fidelity to UMain.pas reviewable.

import { alphaOf, blueOf, greenOf, redOf, type Rgba, rgba } from './colors.js';
import { EditHistory, type Edit } from './history.js';
import { Circuit, type PrevRender } from './simulator.js';

interface StrokeState {
  readonly label: string;
  /** Pixel index → value before this stroke touched it. First touch wins (E2). */
  readonly before: Map<number, Rgba>;
}

export class CircuitDocument {
  readonly width: number;
  readonly height: number;
  readonly name: string;

  /**
   * The source pixels. These are the circuit as drawn, never as rendered — the
   * dimming Circuit.render() applies to inactive wires must never reach here.
   * Saving a rendered frame would drive every unlit wire below the 224 threshold
   * and destroy the circuit, which is the worst bug this feature can have.
   */
  readonly pixels: ImageData;

  readonly #history = new EditHistory();
  readonly #pending = new Map<number, Rgba>();
  #stroke: StrokeState | null = null;
  #dirty = false;
  #compiles = 0;

  private constructor(name: string, pixels: ImageData) {
    this.name = name;
    this.pixels = pixels;
    this.width = pixels.width;
    this.height = pixels.height;
  }

  /**
   * Wrap a freshly decoded image, **taking ownership of it**. The caller must
   * not keep using the ImageData afterwards; the document mutates it in place.
   *
   * Ownership rather than a defensive copy is deliberate. A document already
   * retains the source bitmap for the lifetime of the circuit — 9.6 MB on
   * Enigma2, 16.8 MB on the 2048x2048 example — on top of the three copies
   * Circuit makes internally. Copying again would add that much short-lived
   * garbage to every load and every live reload, for no benefit: decodeImage()
   * hands back a private ImageData that nothing else references.
   */
  static fromImageData(name: string, image: ImageData): CircuitDocument {
    const data = image.data;
    for (let p = 3; p < data.length; p += 4) data[p] = 255; // documents are opaque (D2)
    return new CircuitDocument(name, image);
  }

  /** Copy instead of adopting, for callers that must keep their ImageData. */
  static copyOf(name: string, image: ImageData): CircuitDocument {
    return CircuitDocument.fromImageData(
      name,
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
    );
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  /** How many times this document has been compiled. Used to verify FR-009. */
  get compileCount(): number {
    return this.#compiles;
  }

  get historyPixels(): number {
    return this.#history.touchedPixels;
  }

  // ---------------------------------------------------------------------
  // Pixel access
  // ---------------------------------------------------------------------

  /** Read a pixel. Out of bounds reads 0. */
  get(x: number, y: number): Rgba {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const p = (y * this.width + x) << 2;
    const d = this.pixels.data;
    return rgba(d[p], d[p + 1], d[p + 2], d[p + 3]);
  }

  /**
   * Write a pixel as part of the current stroke. Out-of-bounds writes are
   * dropped rather than wrapped (T3) — relevant for stamps near an edge.
   */
  set(x: number, y: number, color: Rgba): void {
    const stroke = this.#requireStroke();
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;

    const index = y * this.width + x;
    const previous = this.#readIndex(index);
    if (previous === color) return;

    // Record the pre-stroke value, once (E2): scribbling over the same pixel
    // repeatedly must still undo to where the stroke started, not one step back.
    if (!stroke.before.has(index)) stroke.before.set(index, previous);

    this.#writeIndex(index, color);
    this.#pending.set(index, color);
    this.#dirty = true;
  }

  /**
   * Bresenham between two points, inclusive. Pointer events arrive far slower
   * than the pointer moves, so without this a quick drag leaves a dotted trail —
   * which does not conduct, and reads as an engine fault rather than a UI one.
   */
  line(x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
    this.#requireStroke();
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      this.set(x, y, color);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Strokes and history
  // ---------------------------------------------------------------------

  beginStroke(label: string): void {
    // An unterminated stroke means a lost pointerup; commit it rather than
    // silently merging two user actions into one undo step.
    if (this.#stroke) this.endStroke();
    this.#stroke = { label, before: new Map() };
  }

  /** Commit the stroke as one Edit, or discard it when nothing changed (E4). */
  endStroke(): Edit | null {
    const stroke = this.#stroke;
    this.#stroke = null;
    if (!stroke || stroke.before.size === 0) return null;

    const n = stroke.before.size;
    const indices = new Int32Array(n);
    const before = new Uint32Array(n);
    const after = new Uint32Array(n);
    let i = 0;
    for (const [index, wasColor] of stroke.before) {
      indices[i] = index;
      before[i] = wasColor;
      after[i] = this.#readIndex(index);
      i++;
    }

    const edit: Edit = { label: stroke.label, indices, before, after };
    this.#history.push(edit);
    return edit;
  }

  /** True when something was undone and the caller should recompile (H3). */
  undo(): boolean {
    const edit = this.#history.popUndo();
    if (!edit) return false;
    this.#apply(edit.indices, edit.before);
    return true;
  }

  redo(): boolean {
    const edit = this.#history.popRedo();
    if (!edit) return false;
    this.#apply(edit.indices, edit.after);
    return true;
  }

  #apply(indices: Int32Array, values: Uint32Array): void {
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      this.#writeIndex(index, values[i]);
      this.#pending.set(index, values[i]);
    }
    this.#dirty = true;
  }

  // ---------------------------------------------------------------------
  // Compiling and saving
  // ---------------------------------------------------------------------

  /** Pixels changed since the last compile, for the renderer's overlay. */
  pendingEdits(): ReadonlyMap<number, Rgba> {
    return this.#pending;
  }

  /**
   * Compile to a simulatable Circuit. `prevRender` carries wire state across,
   * exactly as live reload already does, so the circuit keeps running through an
   * edit. Circuit copies the pixels it needs, so the document stays free to
   * mutate afterwards.
   */
  compile(prevRender: PrevRender | null): Circuit {
    const circuit = new Circuit(this.pixels, prevRender);
    this.#pending.clear();
    this.#compiles++;
    return circuit;
  }

  markSaved(): void {
    this.#dirty = false;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  #requireStroke(): StrokeState {
    if (!this.#stroke) {
      throw new Error('CircuitDocument: write outside a stroke. Call beginStroke() first.');
    }
    return this.#stroke;
  }

  #readIndex(index: number): Rgba {
    const p = index << 2;
    const d = this.pixels.data;
    return rgba(d[p], d[p + 1], d[p + 2], d[p + 3]);
  }

  #writeIndex(index: number, color: Rgba): void {
    const p = index << 2;
    const d = this.pixels.data;
    d[p] = redOf(color);
    d[p + 1] = greenOf(color);
    d[p + 2] = blueOf(color);
    d[p + 3] = alphaOf(color) || 255; // documents are always opaque (D2)
  }
}
