// tools/pencil.ts — freehand painting in the active colour.

import type { Rgba } from '../colors.js';
import { NO_PREVIEW, type PixelPoint, type Tool, type ToolContext } from './types.js';

/**
 * Shared by the pencil and the eraser, which differ only in the colour they
 * write. Interpolation between successive points is the important part: pointer
 * events arrive far slower than the pointer moves, so painting only the reported
 * positions leaves a dotted trail, and a dotted wire does not conduct.
 */
export class BrushTool implements Tool {
  readonly mutates = true;
  #last: PixelPoint | null = null;

  constructor(
    readonly id: 'pencil' | 'eraser',
    private readonly colorFor: (ctx: ToolContext) => Rgba
  ) {}

  label(): string {
    return this.id;
  }

  down(p: PixelPoint, ctx: ToolContext): void {
    this.#last = p;
    ctx.doc.set(p.x, p.y, this.colorFor(ctx));
  }

  move(p: PixelPoint, ctx: ToolContext): void {
    const from = this.#last ?? p;
    ctx.doc.line(from.x, from.y, p.x, p.y, this.colorFor(ctx));
    this.#last = p;
  }

  up(p: PixelPoint, ctx: ToolContext): void {
    this.move(p, ctx);
    this.#last = null;
  }

  preview(p: PixelPoint, ctx: ToolContext): ReadonlyMap<number, Rgba> {
    // A single pixel under the cursor; the hover outline already shows it.
    void p;
    void ctx;
    return NO_PREVIEW;
  }
}

export const pencil = (): Tool => new BrushTool('pencil', (ctx) => ctx.color);
