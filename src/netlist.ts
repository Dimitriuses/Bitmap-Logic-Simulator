// netlist.ts — what a circuit contains, in engine terms.
//
// The one module that knows what a gate looks like. Everything downstream
// consumes its output and never touches pixels again.
//
// Net identity is NOT re-derived here. `Circuit.wireAt` is public and already
// returns the engine's own final label for a pixel, so connectivity comes
// straight from the simulator — no second union-find, and therefore no way for
// analysis to disagree with simulation about which pixels form one wire. That
// was the failure mode that would have been hardest to notice.
//
// Only gates are re-detected, and that detection checks itself against
// `Circuit.gateCount`. If the two ever disagree, no netlist is returned at all:
// every answer downstream — truth tables, discrepancies, conclusions about the
// simulator itself — inherits its correctness from here.

import { isWire, type Circuit } from './simulator.js';

export type NetId = number;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface NetInfo {
  readonly id: NetId;
  /** A pixel of this net, for driving it and for reading it back. */
  readonly probe: Point;
  readonly pixelCount: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export type GateDirection = 'up' | 'down' | 'left' | 'right';

export interface GateInfo {
  readonly src: NetId;
  readonly dst: NetId;
  readonly direction: GateDirection;
  /** Centre of the 3×3 pattern, in crop coordinates. */
  readonly at: Point;
}

export interface Netlist {
  readonly nets: readonly NetInfo[];
  readonly gates: readonly GateInfo[];
  /** Nets no gate drives. The engine's own definition of an input. */
  readonly inputs: readonly NetId[];
  /** Structural suggestion: driven by a gate, feeds none. Overridable. */
  readonly outputs: readonly NetId[];
  /** Nets the selection boundary severed. Also present in `inputs`. */
  readonly cut: readonly NetId[];
}

export type ExtractResult =
  | { readonly ok: true; readonly netlist: Netlist }
  | { readonly ok: false; readonly reason: string };

// Corner bits, as detectGates assembles them.
const NW = 1;
const NE = 2;
const SE = 4;
const SW = 8;

/** Look up a net by id. */
export function netById(netlist: Netlist, id: NetId): NetInfo | undefined {
  return netlist.nets.find((n) => n.id === id);
}

/**
 * Extract the netlist of a circuit.
 *
 * `image` must be the pixels `circuit` was compiled from — the document's
 * source pixels, never `Circuit.frame`, whose inactive wires are masked to
 * `& 0x7F` and would read as insulation.
 */
export function extractNetlist(circuit: Circuit, image: ImageData): ExtractResult {
  if (image.width !== circuit.width || image.height !== circuit.height) {
    return { ok: false, reason: 'image does not match the compiled circuit' };
  }

  const nets = collectNets(circuit);
  const gates = detectGates(circuit, image);

  // The self-check. A netlist that disagrees with the engine is worse than no
  // netlist: it would let this tool draw confident wrong conclusions about the
  // very simulator it is meant to be checking.
  if (gates.length !== circuit.gateCount) {
    return {
      ok: false,
      reason:
        `gate detection disagrees with the engine: found ${gates.length}, ` +
        `engine reports ${circuit.gateCount}`,
    };
  }

  const driven = new Set<NetId>();
  const consumed = new Set<NetId>();
  for (const g of gates) {
    driven.add(g.dst);
    consumed.add(g.src);
  }

  const inputs: NetId[] = [];
  const outputs: NetId[] = [];
  for (const net of nets) {
    if (!driven.has(net.id)) inputs.push(net.id);
    else if (!consumed.has(net.id)) outputs.push(net.id);
  }

  // A net touching the border was, before the crop, very likely driven from
  // outside it. Reported so the user can see where the boundary fell: the
  // analysis is only valid relative to it.
  const cut = nets
    .filter((n) => !driven.has(n.id) && touchesBorder(n, circuit.width, circuit.height))
    .map((n) => n.id);

  return {
    ok: true,
    netlist: { nets, gates, inputs, outputs, cut },
  };
}

function touchesBorder(net: NetInfo, width: number, height: number): boolean {
  const b = net.bounds;
  return b.x === 0 || b.y === 0 || b.x + b.width >= width || b.y + b.height >= height;
}

/** Every net present, with a probe pixel and bounds, via the public wireAt. */
function collectNets(circuit: Circuit): NetInfo[] {
  const acc = new Map<NetId, { probe: Point; count: number; x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < circuit.height; y++) {
    for (let x = 0; x < circuit.width; x++) {
      const id = circuit.wireAt(x, y);
      if (id === 0) continue;
      const seen = acc.get(id);
      if (!seen) acc.set(id, { probe: { x, y }, count: 1, x0: x, y0: y, x1: x, y1: y });
      else {
        seen.count++;
        if (x < seen.x0) seen.x0 = x;
        if (y < seen.y0) seen.y0 = y;
        if (x > seen.x1) seen.x1 = x;
        if (y > seen.y1) seen.y1 = y;
      }
    }
  }

  const nets: NetInfo[] = [];
  for (const [id, v] of acc) {
    nets.push({
      id,
      probe: v.probe,
      pixelCount: v.count,
      bounds: { x: v.x0, y: v.y0, width: v.x1 - v.x0 + 1, height: v.y1 - v.y0 + 1 },
    });
  }
  nets.sort((a, b) => a.id - b.id);
  return nets;
}

/**
 * Re-detect gates, mirroring detectGates() in simulator.ts.
 *
 * The flat-index behaviour is reproduced deliberately: reading x+1 on the last
 * column reaches column 0 of the next row. That quirk is in the engine on
 * purpose, and a detector that "fixed" it would disagree with the simulator on
 * circuits whose wires touch the right border.
 */
function detectGates(circuit: Circuit, image: ImageData): GateInfo[] {
  const bw = image.width;
  const bh = image.height;
  const d = image.data;
  const n = bw * bh;

  const wireAtIndex = (i: number): boolean => {
    if (i < 0 || i >= n) return false;
    const p = i << 2;
    return isWire(d[p], d[p + 1], d[p + 2]);
  };

  const gates: GateInfo[] = [];
  for (let y = 1; y <= bh - 2; y++) {
    const s = (y - 1) * bw;
    const mid = y * bw;
    const e = (y + 1) * bw;

    for (let x = 1; x <= bw - 1; x++) {
      if (
        wireAtIndex(mid + x) ||
        !wireAtIndex(mid + x - 1) ||
        !wireAtIndex(mid + x + 1) ||
        !wireAtIndex(s + x) ||
        !wireAtIndex(e + x)
      ) {
        continue;
      }

      let mask = 0;
      if (wireAtIndex(s + x - 1)) mask |= NW;
      if (wireAtIndex(s + x + 1)) mask |= NE;
      if (wireAtIndex(e + x + 1)) mask |= SE;
      if (wireAtIndex(e + x - 1)) mask |= SW;

      let src: Point;
      let dst: Point;
      let direction: GateDirection;
      switch (mask) {
        case 0:
          continue; // crossover: not a gate
        case NW | NE:
          src = { x, y: y - 1 };
          dst = { x, y: y + 1 };
          direction = 'down';
          break;
        case NE | SE:
          src = { x: x + 1, y };
          dst = { x: x - 1, y };
          direction = 'left';
          break;
        case SE | SW:
          src = { x, y: y + 1 };
          dst = { x, y: y - 1 };
          direction = 'up';
          break;
        case SW | NW:
          src = { x: x - 1, y };
          dst = { x: x + 1, y };
          direction = 'right';
          break;
        default:
          continue; // any other corner combination is ignored
      }

      gates.push({
        src: circuit.wireAt(src.x, src.y),
        dst: circuit.wireAt(dst.x, dst.y),
        direction,
        at: { x, y },
      });
    }
  }
  return gates;
}
