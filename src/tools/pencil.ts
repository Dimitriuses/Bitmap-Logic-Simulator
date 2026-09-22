// tools/pencil.ts — freehand painting, and erasing on the right button.

import { INSULATION, type Rgba } from '../colors.js';
import { NO_PREVIEW, type PixelPoint, type Tool, type ToolContext } from './types.js';

/**
 * Shared by the pencil and the eraser, which differ only in the colour they
 * write.
 *
 * Interpolation between successive points is the load-bearing part: pointer
 * events arrive far slower than the pointer moves, and `doc.line` guarantees the
 * gap is filled with a *4-connected* run. Anything else leaves a diagonal
 * staircase that looks like a wire and does not conduct.
 */
export class BrushTool implements Tool {
  readonly mutates = true;
  #last: PixelPoint | null = null;

  constructor(
    readonly id: 'pencil' | 'eraser',
    private readonly colorFor: (ctx: ToolContext) => Rgba,
    readonly usesSecondary = false
  ) {}

  label(ctx: ToolContext): string {
    return this.usesSecondary && ctx.button === 'secondary' ? 'erase' : this.id;
  }

  /** The right button erases; everything else paints the active colour. */
  #ink(ctx: ToolContext): Rgba {
    return ctx.button === 'secondary' && this.usesSecondary ? INSULATION : this.colorFor(ctx);
  }

  down(p: PixelPoint, ctx: ToolContext): void {
    this.#last = p;
    ctx.doc.set(p.x, p.y, this.#ink(ctx));
  }

  move(p: PixelPoint, ctx: ToolContext): void {
    const from = this.#last ?? p;
    ctx.doc.line(from.x, from.y, p.x, p.y, this.#ink(ctx));
    this.#last = p;
  }

  up(p: PixelPoint, ctx: ToolContext): void {
    this.move(p, ctx);
    this.#last = null;
  }

  preview(): ReadonlyMap<number, Rgba> {
    // A single pixel under the cursor; the hover outline already shows it.
    return NO_PREVIEW;
  }
}

/** The pencil erases on the right button, so switching is not a toolbar trip. */
export const pencil = (): Tool => new BrushTool('pencil', (ctx) => ctx.color, true);
