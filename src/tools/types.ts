// tools/types.ts — the contract every drawing tool implements.
//
// Tools write pixels and nothing else. They never touch Circuit, simulation
// state, the viewport or the DOM; that separation is what keeps the editor from
// entangling itself with the engine.

import type { Rgba } from '../colors.js';
import type { CircuitDocument } from '../document.js';
import type { GateDirection } from '../stamps.js';

export type ToolId = 'pencil' | 'line' | 'eraser' | 'picker' | 'gate' | 'crossover';

/** A point in bitmap pixel coordinates, already floored. */
export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface ToolContext {
  readonly doc: CircuitDocument;
  /** Active wire colour. Guaranteed to satisfy isWireColor. */
  readonly color: Rgba;
  readonly direction: GateDirection;
  /** How the picker reports what it found. */
  setColor(color: Rgba): void;
}

export interface Tool {
  readonly id: ToolId;
  /** True when the tool writes pixels. False for the picker. */
  readonly mutates: boolean;
  /** Label for the Edit this tool produces, e.g. "gate right". */
  label(ctx: ToolContext): string;

  down(p: PixelPoint, ctx: ToolContext): void;
  move(p: PixelPoint, ctx: ToolContext): void;
  up(p: PixelPoint, ctx: ToolContext): void;

  /**
   * Pixels this tool would write if committed at `p`. Must be pure — it runs on
   * every pointer move.
   */
  preview(p: PixelPoint, ctx: ToolContext): ReadonlyMap<number, Rgba>;
}

/** Empty preview, shared so tools that have none allocate nothing. */
export const NO_PREVIEW: ReadonlyMap<number, Rgba> = new Map();
