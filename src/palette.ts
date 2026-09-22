// palette.ts — the colours you can actually draw with.
//
// The engine's wire test is per-channel, not luminance: any channel >= 224 is
// wire. So saturated blue is a perfectly good conductor despite looking dark,
// which is why the bundled schematics colour their buses blue and green. A
// palette organised by hue therefore costs nothing in validity.

import { isWireColor, rgba, WIRE_WHITE, type Rgba } from './colors.js';

/**
 * Sixteen defaults: white, the hue circle, and three soft tints for annotation.
 * Every one satisfies the wire test — asserted at module load below, so a bad
 * default cannot ship.
 */
export const DEFAULT_PALETTE: readonly Rgba[] = [
  WIRE_WHITE,
  rgba(255, 0, 0),
  rgba(255, 128, 0),
  rgba(255, 255, 0),
  rgba(128, 255, 0),
  rgba(0, 255, 0),
  rgba(0, 255, 128),
  rgba(0, 255, 255),
  rgba(0, 128, 255),
  rgba(0, 0, 255),
  rgba(128, 0, 255),
  rgba(255, 0, 255),
  rgba(255, 0, 128),
  rgba(255, 224, 176),
  rgba(192, 255, 192),
  rgba(224, 224, 255),
];

for (const color of DEFAULT_PALETTE) {
  if (!isWireColor(color)) {
    throw new Error(`palette.ts: default colour ${color.toString(16)} is not a wire colour`);
  }
}

export class Palette {
  #custom: Rgba[] = [];
  #activeIndex = 0;

  constructor(custom: readonly Rgba[] = [], activeIndex = 0) {
    for (const c of custom) this.add(c);
    this.select(activeIndex);
  }

  /** Defaults first, then custom entries in the order they were added. */
  get colors(): readonly Rgba[] {
    return [...DEFAULT_PALETTE, ...this.#custom];
  }

  get custom(): readonly Rgba[] {
    return this.#custom;
  }

  get activeIndex(): number {
    return this.#activeIndex;
  }

  get active(): Rgba {
    return this.colors[this.#activeIndex] ?? WIRE_WHITE;
  }

  /** How many entries are removable — the defaults never are. */
  get customStart(): number {
    return DEFAULT_PALETTE.length;
  }

  select(index: number): void {
    const n = this.colors.length;
    if (!Number.isFinite(index)) return;
    this.#activeIndex = ((Math.floor(index) % n) + n) % n;
  }

  /** Wheel: step by notches, wrapping in both directions. */
  cycle(delta: number): void {
    this.select(this.#activeIndex + Math.sign(delta) * Math.max(1, Math.abs(Math.round(delta))));
  }

  /**
   * Add a custom colour and select it.
   *
   * Returns false for a colour the engine would read as insulation. Refusing is
   * deliberate: silently brightening it would teach the user the wrong rule, and
   * wire that does not conduct looks exactly like wire that does.
   */
  add(color: Rgba): boolean {
    if (!isWireColor(color)) return false;
    const existing = this.colors.indexOf(color);
    if (existing >= 0) {
      // Already present — select it rather than storing a duplicate.
      this.#activeIndex = existing;
      return true;
    }
    this.#custom.push(color);
    this.#activeIndex = this.colors.length - 1;
    return true;
  }

  /** Remove a custom entry. Defaults are not removable, so this returns false. */
  remove(index: number): boolean {
    const customIndex = index - DEFAULT_PALETTE.length;
    if (customIndex < 0 || customIndex >= this.#custom.length) return false;
    this.#custom.splice(customIndex, 1);
    if (this.#activeIndex >= this.colors.length) this.#activeIndex = this.colors.length - 1;
    return true;
  }
}
