// tools/stamp.ts — place a gate or a crossover in one click.
//
// All nine pixels are written, insulation included. Writing only the wire ones
// would leave whatever corner was underneath in place, which silently turns the
// intended gate into a different one, or into nothing at all.

import { INSULATION, type Rgba } from '../colors.js';
import { STAMPS, stampLabel, type StampId } from '../stamps.js';
import type { PixelPoint, Tool, ToolContext } from './types.js';

function patternFor(id: 'gate' | 'crossover', ctx: ToolContext): StampId {
  return id === 'crossover' ? 'crossover' : ctx.direction;
}

/** Visit the nine cells of a stamp centred at (cx, cy). */
function cells(
  cx: number,
  cy: number,
  which: StampId,
  color: Rgba,
  visit: (x: number, y: number, c: Rgba) => void
): void {
  const rows = STAMPS[which];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      visit(cx - 1 + dx, cy - 1 + dy, rows[dy][dx] === '#' ? color : INSULATION);
    }
  }
}

class StampTool implements Tool {
  readonly mutates = true;

  constructor(readonly id: 'gate' | 'crossover') {}

  label(ctx: ToolContext): string {
    return stampLabel(patternFor(this.id, ctx));
  }

  down(p: PixelPoint, ctx: ToolContext): void {
    // doc.set() drops out-of-bounds writes, so a stamp near an edge lands
    // partially rather than wrapping onto the next row.
    cells(p.x, p.y, patternFor(this.id, ctx), ctx.color, (x, y, c) => ctx.doc.set(x, y, c));
  }

  /** Stamps commit on press and are not drag-extended. */
  move(): void {}
  up(): void {}

  preview(p: PixelPoint, ctx: ToolContext): ReadonlyMap<number, Rgba> {
    const out = new Map<number, Rgba>();
    const { width, height } = ctx.doc;
    cells(p.x, p.y, patternFor(this.id, ctx), ctx.color, (x, y, c) => {
      if (x >= 0 && y >= 0 && x < width && y < height) out.set(y * width + x, c);
    });
    return out;
  }
}

export const gateStamp = (): Tool => new StampTool('gate');
export const crossoverStamp = (): Tool => new StampTool('crossover');
