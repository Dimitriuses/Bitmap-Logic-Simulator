// block.ts — a detached rectangle of pixels.
//
// One type does three jobs: what a selection captures, what the clipboard
// holds, and what floats during a paste.
//
// Rotation is a pure pixel transform with no knowledge of gates, and it does not
// need any: the engine reads a gate's direction from which two corners are wire,
// and those corners rotate with the pixels. A rightward inverter turned a
// quarter turn clockwise comes out as a downward inverter on its own. Verified
// against the real engine for all four directions.

import type { Rgba } from './colors.js';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Normalise a drag into a positive-area rectangle, clipped to a bitmap. */
export function normaliseRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bitmapWidth: number,
  bitmapHeight: number
): Rect | null {
  const x0 = Math.max(0, Math.min(ax, bx));
  const y0 = Math.max(0, Math.min(ay, by));
  const x1 = Math.min(bitmapWidth - 1, Math.max(ax, bx));
  const y1 = Math.min(bitmapHeight - 1, Math.max(ay, by));
  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export class PixelBlock {
  readonly width: number;
  readonly height: number;
  /** Packed Rgba, row-major, width * height entries. */
  readonly pixels: Uint32Array;

  constructor(width: number, height: number, pixels: Uint32Array) {
    if (pixels.length !== width * height) {
      throw new Error(`PixelBlock: expected ${width * height} pixels, got ${pixels.length}`);
    }
    this.width = width;
    this.height = height;
    this.pixels = pixels;
  }

  get(dx: number, dy: number): Rgba {
    return this.pixels[dy * this.width + dx];
  }

  /** 90 degrees clockwise. Dimensions swap. */
  rotateCW(): PixelBlock {
    const { width: w, height: h, pixels } = this;
    const out = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // (x, y) -> (h - 1 - y, x) in a block that is h wide.
        out[x * h + (h - 1 - y)] = pixels[y * w + x];
      }
    }
    return new PixelBlock(h, w, out);
  }

  /** 90 degrees counter-clockwise. */
  rotateCCW(): PixelBlock {
    const { width: w, height: h, pixels } = this;
    const out = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // (x, y) -> (y, w - 1 - x) in a block that is h wide.
        out[(w - 1 - x) * h + y] = pixels[y * w + x];
      }
    }
    return new PixelBlock(h, w, out);
  }

  forEach(visit: (dx: number, dy: number, color: Rgba) => void): void {
    const { width: w, height: h, pixels } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) visit(x, y, pixels[y * w + x]);
    }
  }
}
