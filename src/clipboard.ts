// clipboard.ts — selection, the held block, and the floating paste.
//
// A floating paste is editor state, not document state: nothing is written
// until Enter. That is what makes cancelling free — the document is untouched,
// so there is nothing to undo — and what keeps a paste at one recompile no
// matter how far it was nudged. Writing on every arrow press would mean a
// quarter-second rebuild per pixel of movement on a large schematic.
//
// The clipboard is internal to the page. Interoperating with the operating
// system clipboard would need an encoded PNG and a permission prompt, to
// exchange data with the paint programs this editor exists to replace.

import { PixelBlock, type Rect } from './block.js';
import type { CircuitDocument } from './document.js';

export interface Floating {
  block: PixelBlock;
  x: number;
  y: number;
}

export class EditorClipboard {
  #selection: Rect | null = null;
  #held: PixelBlock | null = null;
  #floating: Floating | null = null;

  get selection(): Rect | null {
    return this.#selection;
  }

  get floating(): Floating | null {
    return this.#floating;
  }

  get hasContent(): boolean {
    return this.#held !== null;
  }

  setSelection(rect: Rect | null): void {
    this.#selection = rect;
  }

  clearSelection(): void {
    this.#selection = null;
  }

  /** Ctrl+C. Reads only — the document must be unchanged afterwards. */
  copy(doc: CircuitDocument): boolean {
    if (!this.#selection) return false;
    this.#held = doc.readBlock(this.#selection);
    return true;
  }

  /** Ctrl+X. One stroke, so one undo step and one recompile. */
  cut(doc: CircuitDocument): boolean {
    if (!this.#selection) return false;
    this.#held = doc.readBlock(this.#selection);
    return this.#clear(doc, 'cut');
  }

  /** Delete. Clears without copying. */
  erase(doc: CircuitDocument): boolean {
    return this.#clear(doc, 'delete');
  }

  #clear(doc: CircuitDocument, label: string): boolean {
    const rect = this.#selection;
    if (!rect) return false;
    doc.beginStroke(label);
    doc.clearRect(rect);
    return doc.endStroke() !== null;
  }

  /**
   * Ctrl+V. Begins a floating paste centred on the given point.
   *
   * A paste while one already floats is ignored rather than replacing it, so
   * uncommitted work is never silently dropped.
   */
  beginPaste(centreX: number, centreY: number): boolean {
    if (!this.#held || this.#floating) return false;
    this.#floating = {
      block: this.#held,
      x: Math.round(centreX - this.#held.width / 2),
      y: Math.round(centreY - this.#held.height / 2),
    };
    return true;
  }

  moveFloating(dx: number, dy: number): void {
    if (!this.#floating) return;
    this.#floating.x += dx;
    this.#floating.y += dy;
  }

  placeFloating(x: number, y: number): void {
    if (!this.#floating) return;
    this.#floating.x = x;
    this.#floating.y = y;
  }

  /** Rotate the floating block about its centre, so it stays where it looks. */
  rotateFloating(direction: 'cw' | 'ccw'): void {
    const f = this.#floating;
    if (!f) return;
    const cx = f.x + f.block.width / 2;
    const cy = f.y + f.block.height / 2;
    f.block = direction === 'cw' ? f.block.rotateCW() : f.block.rotateCCW();
    f.x = Math.round(cx - f.block.width / 2);
    f.y = Math.round(cy - f.block.height / 2);
  }

  /** Enter. Writes the block as a single edit. */
  commit(doc: CircuitDocument): boolean {
    const f = this.#floating;
    if (!f) return false;
    this.#floating = null;
    doc.beginStroke('paste');
    doc.writeBlock(f.block, f.x, f.y);
    // An empty edit (pasting identical pixels) is discarded by endStroke, in
    // which case there is nothing to recompile.
    return doc.endStroke() !== null;
  }

  /** Escape. Touches no pixels. */
  cancel(): void {
    this.#floating = null;
  }

  /** Loading another circuit drops everything positional; the held block stays. */
  resetForDocument(): void {
    this.#selection = null;
    this.#floating = null;
  }
}
