// tools/line.ts — a straight run from press to release, or a bus of them.
//
// Nothing is written until release, so the whole run is one reversible edit and
// the user sees where it lands before committing.
//
// Both the preview and the commit go through walkConnected, so the ghost is
// exactly what gets drawn — and, more importantly, what gets drawn is a
// conductor rather than a diagonal staircase of isolated pixels.

import type { Rgba } from '../colors.js';
import { busOffsets, walkConnected } from '../geometry.js';
import type { PixelPoint, Tool, ToolContext } from './types.js';

class LineTool implements Tool {
  readonly id = 'line' as const;
  readonly mutates = true;
  #origin: PixelPoint | null = null;

  label(ctx: ToolContext): string {
    return ctx.busWidth > 1 ? `bus ${ctx.busWidth}` : 'line';
  }

  down(p: PixelPoint): void {
    this.#origin = p;
  }

  move(): void {
    // Preview only; the run is committed on release.
  }

  up(p: PixelPoint, ctx: ToolContext): void {
    const origin = this.#origin ?? p;
    this.#origin = null;
    for (const { dx, dy } of busOffsets(origin.x, origin.y, p.x, p.y, ctx.busWidth)) {
      ctx.doc.line(origin.x + dx, origin.y + dy, p.x + dx, p.y + dy, ctx.color);
    }
  }

  preview(p: PixelPoint, ctx: ToolContext): ReadonlyMap<number, Rgba> {
    const out = new Map<number, Rgba>();
    const { width, height } = ctx.doc;
    const origin = this.#origin;
    if (!origin) {
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) {
        out.set(p.y * width + p.x, ctx.color);
      }
      return out;
    }
    for (const { dx, dy } of busOffsets(origin.x, origin.y, p.x, p.y, ctx.busWidth)) {
      walkConnected(origin.x + dx, origin.y + dy, p.x + dx, p.y + dy, (x, y) => {
        if (x >= 0 && y >= 0 && x < width && y < height) out.set(y * width + x, ctx.color);
      });
    }
    return out;
  }
}

export const line = (): Tool => new LineTool();
