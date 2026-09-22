// history.ts — stroke-granular undo for the circuit editor.
//
// Entries are sparse diffs: only the pixels a stroke touched, with their values
// before and after. A full-bitmap snapshot of the 2048x2048 example is 16 MB, so
// twenty of them would be 320 MB; a stroke touches a few hundred pixels, which is
// four to five orders of magnitude less. That is what lets history be bounded by
// pixels rather than by bitmap size.

/**
 * One user-visible change: a completed stroke, a stamp, or an erase.
 *
 * The three arrays are parallel and equal in length. `before` and `after` hold
 * packed Rgba values (see colors.ts); they are typed arrays rather than
 * Rgba[] so a long stroke costs 12 bytes per pixel instead of a boxed number
 * each.
 */
export interface Edit {
  readonly label: string;
  /** Pixel indices touched, each appearing exactly once. */
  readonly indices: Int32Array;
  /** Value at each index before the edit. */
  readonly before: Uint32Array;
  /** Value at each index after the edit. */
  readonly after: Uint32Array;
}

/**
 * Default budget, in touched pixels. At 12 bytes per pixel across the three
 * parallel arrays this caps history at roughly 12 MB regardless of how large the
 * schematic is.
 */
const DEFAULT_PIXEL_BUDGET = 1_000_000;

export class EditHistory {
  readonly #undo: Edit[] = [];
  readonly #redo: Edit[] = [];
  readonly #budget: number;
  #touched = 0;

  constructor(pixelBudget: number = DEFAULT_PIXEL_BUDGET) {
    this.#budget = Math.max(1, pixelBudget);
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Total pixels currently retained, for diagnostics and the budget check. */
  get touchedPixels(): number {
    return this.#touched;
  }

  /** Record an edit. Clears the redo stack and trims to the pixel budget. */
  push(edit: Edit): void {
    if (edit.indices.length === 0) return; // empty strokes never enter (E4)
    this.#undo.push(edit);
    this.#touched += edit.indices.length;
    this.#redo.length = 0; // a new edit invalidates redo (H2)

    // Trim oldest-first by pixels, not by entry count (H1).
    while (this.#touched > this.#budget && this.#undo.length > 1) {
      const dropped = this.#undo.shift();
      if (!dropped) break;
      this.#touched -= dropped.indices.length;
    }
  }

  /** Move the newest edit onto the redo stack and return it, or null. */
  popUndo(): Edit | null {
    const edit = this.#undo.pop();
    if (!edit) return null;
    this.#touched -= edit.indices.length;
    this.#redo.push(edit);
    return edit;
  }

  /** Move the newest undone edit back onto the undo stack and return it. */
  popRedo(): Edit | null {
    const edit = this.#redo.pop();
    if (!edit) return null;
    this.#undo.push(edit);
    this.#touched += edit.indices.length;
    return edit;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#touched = 0;
  }
}
