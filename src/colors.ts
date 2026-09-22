// colors.ts — packed colour values for the editor.
//
// Packed as 0xRRGGBBAA, an explicit byte order rather than the platform's native
// word order. The engine's render tables view RGBA bytes through a Uint32Array,
// which is endianness-dependent and therefore fine only because it never
// inspects the components; editor code does inspect them, so it uses an order it
// can rely on and converts at the boundary.

import { isWire } from './simulator.js';

/** A colour packed as 0xRRGGBBAA. */
export type Rgba = number;

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
}

export const redOf = (v: Rgba): number => (v >>> 24) & 255;
export const greenOf = (v: Rgba): number => (v >>> 16) & 255;
export const blueOf = (v: Rgba): number => (v >>> 8) & 255;
export const alphaOf = (v: Rgba): number => v & 255;

/**
 * Default palette. Wire is pure white and insulation pure black, deliberately
 * far from the 224 threshold: PNG encoders are not always bit-exact (Safari
 * drifts by ±1 on colour-rich images), and a value at the boundary could in
 * principle cross it. 255 and 0 cannot.
 */
export const WIRE_WHITE: Rgba = rgba(255, 255, 255);
export const INSULATION: Rgba = rgba(0, 0, 0);

/**
 * True when the engine would read this colour as wire — any channel >= 224.
 * Note this is per-channel and not luminance: saturated blue is a perfectly good
 * wire despite looking dark, which is why several bundled schematics use it.
 */
export function isWireColor(v: Rgba): boolean {
  return isWire(redOf(v), greenOf(v), blueOf(v));
}

/** `#rrggbb`, for a colour input. */
export function toHex(v: Rgba): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(redOf(v))}${h(greenOf(v))}${h(blueOf(v))}`;
}

/** Parse `#rrggbb`. Returns null when malformed. */
export function fromHex(hex: string): Rgba | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** `rgb(r, g, b)`, for canvas fill styles. */
export function toCss(v: Rgba): string {
  return `rgb(${redOf(v)}, ${greenOf(v)}, ${blueOf(v)})`;
}
