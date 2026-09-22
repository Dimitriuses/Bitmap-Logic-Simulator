// tools/types.ts — the contract every drawing tool implements.
//
// Tools write pixels and nothing else. They never touch Circuit, simulation
// state, the viewport or the DOM; that separation is what keeps the editor from
// entangling itself with the engine.

import type { Rgba } from '../colors.js';
import type { CircuitDocument } from '../document.js';
import type { GateDirection } from '../stamps.js';

export type ToolId =
  | 'pencil'
  | 'line'
  | 'eraser'
  | 'picker'
  | 'gate'
  | 'crossover'
  | 'select';

/** Which pointer button drove the stroke. */
export type Button = 'primary' | 'secondary';

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
  /** Which button is driving this stroke. The pencil erases on 'secondary'. */
  readonly button: Button;
  /** Conductors to draw for the line tool, 1 = a plain line. */
  readonly busWidth: number;
  /** How the picker reports what it found. */
  setColor(color: Rgba): void;
}

export interface Tool {
  readonly id: ToolId;
  /** True when the tool writes pixels. False for the picker and select. */
  readonly mutates: boolean;
  /**
   * True when the tool does something useful with the right button — the pencil
   * erases. Tools that leave this false ignore the secondary button entirely,
   * so it never falls through to anything else.
   */
  readonly usesSecondary?: boolean;
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
