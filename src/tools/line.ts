// tools/line.ts — a straight run from press to release.
//
// Nothing is written until release, so the whole run is one reversible edit and
// the user can see where it lands before committing.

import type { Rgba } from '../colors.js';
import type { PixelPoint, Tool, ToolContext } from './types.js';

/** Bresenham, duplicated from CircuitDocument.line because preview must not write. */
function walk(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === x1 && y === y1) break;
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

class LineTool implements Tool {
  readonly id = 'line' as const;
  readonly mutates = true;
  #origin: PixelPoint | null = null;

  label(): string {
    return 'line';
  }

  down(p: PixelPoint): void {
    this.#origin = p;
  }

  move(): void {
    // Preview only; the run is committed on release.
  }

  up(p: PixelPoint, ctx: ToolContext): void {
    const origin = this.#origin ?? p;
    ctx.doc.line(origin.x, origin.y, p.x, p.y, ctx.color);
    this.#origin = null;
  }

  preview(p: PixelPoint, ctx: ToolContext): ReadonlyMap<number, Rgba> {
    const origin = this.#origin;
    const out = new Map<number, Rgba>();
    const width = ctx.doc.width;
    if (!origin) {
      out.set(p.y * width + p.x, ctx.color);
      return out;
    }
    walk(origin.x, origin.y, p.x, p.y, (x, y) => {
      if (x >= 0 && y >= 0 && x < width && y < ctx.doc.height) out.set(y * width + x, ctx.color);
    });
    return out;
  }
}

export const line = (): Tool => new LineTool();
