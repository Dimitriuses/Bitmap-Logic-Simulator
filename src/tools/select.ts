// tools/select.ts — rectangular selection, and dragging a floating paste.
//
// Selecting is not an edit: this tool writes no pixels and produces no undo
// step, like the picker. What it changes is the clipboard's idea of what is
// selected, which the editor hands it.

import type { Rgba } from '../colors.js';
import { normaliseRect } from '../block.js';
import { NO_PREVIEW, type PixelPoint, type Tool, type ToolContext } from './types.js';

/** What the select tool needs beyond the plain ToolContext. */
export interface SelectionHost {
  setSelection(rect: ReturnType<typeof normaliseRect>): void;
  /** The floating paste, if one is under the pointer and should be dragged. */
  grabFloating(p: PixelPoint): boolean;
  dragFloating(p: PixelPoint): void;
  dropFloating(): void;
}

class SelectTool implements Tool {
  readonly id = 'select' as const;
  readonly mutates = false;
  #anchor: PixelPoint | null = null;
  #draggingPaste = false;

  constructor(private readonly host: SelectionHost) {}

  label(): string {
    return 'select';
  }

  down(p: PixelPoint, ctx: ToolContext): void {
    // Dragging inside a floating paste moves it rather than starting a new
    // selection — that is the pointer half of "move the pasted block".
    if (this.host.grabFloating(p)) {
      this.#draggingPaste = true;
      return;
    }
    this.#anchor = p;
    this.#draggingPaste = false;
    // A press with no drag clears the selection; a drag will replace it.
    this.host.setSelection(null);
    void ctx;
  }

  move(p: PixelPoint, ctx: ToolContext): void {
    if (this.#draggingPaste) {
      this.host.dragFloating(p);
      return;
    }
    const a = this.#anchor;
    if (!a) return;
    this.host.setSelection(
      normaliseRect(a.x, a.y, p.x, p.y, ctx.doc.width, ctx.doc.height)
    );
  }

  up(p: PixelPoint, ctx: ToolContext): void {
    if (this.#draggingPaste) {
      this.host.dropFloating();
      this.#draggingPaste = false;
      return;
    }
    const a = this.#anchor;
    this.#anchor = null;
    if (!a) return;
    // A click with no movement is a deliberate "select nothing", not a 1x1.
    if (a.x === p.x && a.y === p.y) {
      this.host.setSelection(null);
      return;
    }
    this.host.setSelection(
      normaliseRect(a.x, a.y, p.x, p.y, ctx.doc.width, ctx.doc.height)
    );
  }

  preview(): ReadonlyMap<number, Rgba> {
    return NO_PREVIEW;
  }
}

export const select = (host: SelectionHost): Tool => new SelectTool(host);
