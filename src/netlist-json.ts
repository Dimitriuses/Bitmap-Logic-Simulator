// netlist-json.ts — exchange netlists with the Python tool.
//
// The shape is LogicShorter's `*_raw.json`: a list of nets, a list of gates
// carrying `in_net`/`out_net`, and an `io` block. Keeping its field names means
// files move in both directions without a converter on either side.
//
// IMPORTANT about direction of trust: a netlist exported from here was checked
// against the engine (netlist.ts refuses to produce one that disagrees). A
// netlist read back in was not — it is somebody else's claim about a circuit,
// and anything derived from it is a suggestion to verify, never ground truth.
// The UI says so; this module simply refuses to guess about malformed input.

import type { GateDirection, GateInfo, NetId, NetInfo, Netlist } from './netlist.js';
import type { Label } from './labels.js';

export interface NetlistJson {
  readonly format: 'bitmap-logic-netlist';
  readonly version: 1;
  readonly nets: readonly {
    readonly id: NetId;
    readonly probe: { readonly x: number; readonly y: number };
    readonly pixels: number;
    readonly bounds: { x: number; y: number; width: number; height: number };
  }[];
  readonly gates: readonly {
    readonly in_net: NetId;
    readonly out_net: NetId;
    readonly direction: GateDirection;
    readonly at: { readonly x: number; readonly y: number };
  }[];
  readonly io: {
    readonly inputs: readonly NetId[];
    readonly outputs: readonly NetId[];
    readonly cut: readonly NetId[];
  };
  /**
   * User-given names, anchored to pixels rather than to net ids.
   *
   * Anchors, not ids, for the same reason they are stored that way: an id is
   * only meaningful within one compile, so a name keyed by id would arrive
   * somewhere else entirely. Optional — a file without them is still valid.
   */
  readonly labels?: readonly {
    readonly anchor: { readonly x: number; readonly y: number };
    readonly kind: 'net' | 'gate';
    readonly name: string;
  }[];
}

export function exportNetlist(netlist: Netlist, labels: readonly Label[] = []): NetlistJson {
  return {
    format: 'bitmap-logic-netlist',
    version: 1,
    nets: netlist.nets.map((n) => ({
      id: n.id,
      probe: { x: n.probe.x, y: n.probe.y },
      pixels: n.pixelCount,
      bounds: { ...n.bounds },
    })),
    gates: netlist.gates.map((g) => ({
      in_net: g.src,
      out_net: g.dst,
      direction: g.direction,
      at: { x: g.at.x, y: g.at.y },
    })),
    io: {
      inputs: [...netlist.inputs],
      outputs: [...netlist.outputs],
      cut: [...netlist.cut],
    },
    labels: labels.map((l) => ({
      anchor: { x: l.anchor.x, y: l.anchor.y },
      kind: l.kind,
      name: l.name,
    })),
  };
}

/** Names carried by an imported netlist, validated the same way the rest is. */
export function labelsFrom(text: string): Label[] {
  try {
    const raw = JSON.parse(text) as Partial<NetlistJson>;
    if (!Array.isArray(raw.labels)) return [];
    const out: Label[] = [];
    for (const l of raw.labels) {
      const a = l?.anchor as { x?: unknown; y?: unknown } | undefined;
      if (typeof a?.x !== 'number' || typeof a?.y !== 'number') continue;
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) continue;
      if (typeof l.name !== 'string' || l.name.trim() === '') continue;
      out.push({
        anchor: { x: a.x, y: a.y },
        kind: l.kind === 'gate' ? 'gate' : 'net',
        name: l.name.trim(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export type ImportResult =
  | { readonly ok: true; readonly netlist: Netlist }
  | { readonly ok: false; readonly reason: string };

const DIRECTIONS: readonly string[] = ['up', 'down', 'left', 'right'];

/** Read a netlist back, validating rather than trusting. */
export function importNetlist(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `not valid JSON: ${(err as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'not an object' };
  }

  const j = raw as Partial<NetlistJson>;
  if (j.format !== 'bitmap-logic-netlist') {
    return { ok: false, reason: `unknown format: ${String(j.format)}` };
  }
  if (j.version !== 1) {
    return { ok: false, reason: `unsupported version: ${String(j.version)}` };
  }
  if (!Array.isArray(j.nets) || !Array.isArray(j.gates)) {
    return { ok: false, reason: 'missing nets or gates' };
  }

  const nets: NetInfo[] = [];
  const ids = new Set<NetId>();
  for (const [i, n] of j.nets.entries()) {
    if (typeof n?.id !== 'number' || !Number.isInteger(n.id)) {
      return { ok: false, reason: `net ${i}: id is not an integer` };
    }
    if (ids.has(n.id)) return { ok: false, reason: `net id ${n.id} appears twice` };
    ids.add(n.id);
    if (typeof n.probe?.x !== 'number' || typeof n.probe?.y !== 'number') {
      return { ok: false, reason: `net ${n.id}: probe is not a point` };
    }
    const b = n.bounds;
    if (
      typeof b?.x !== 'number' ||
      typeof b?.y !== 'number' ||
      typeof b?.width !== 'number' ||
      typeof b?.height !== 'number'
    ) {
      return { ok: false, reason: `net ${n.id}: bounds are malformed` };
    }
    nets.push({
      id: n.id,
      probe: { x: n.probe.x, y: n.probe.y },
      pixelCount: typeof n.pixels === 'number' ? n.pixels : 0,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    });
  }

  const gates: GateInfo[] = [];
  for (const [i, g] of j.gates.entries()) {
    if (typeof g?.in_net !== 'number' || typeof g?.out_net !== 'number') {
      return { ok: false, reason: `gate ${i}: in_net/out_net are not numbers` };
    }
    if (!ids.has(g.in_net)) return { ok: false, reason: `gate ${i}: unknown in_net ${g.in_net}` };
    if (!ids.has(g.out_net)) return { ok: false, reason: `gate ${i}: unknown out_net ${g.out_net}` };
    if (typeof g.direction !== 'string' || !DIRECTIONS.includes(g.direction)) {
      return { ok: false, reason: `gate ${i}: bad direction ${String(g.direction)}` };
    }
    gates.push({
      src: g.in_net,
      dst: g.out_net,
      direction: g.direction as GateDirection,
      at: { x: g.at?.x ?? 0, y: g.at?.y ?? 0 },
    });
  }

  // The I/O block is a convenience, not a source of truth: it is recomputed
  // from the gates, and a file that disagrees with its own gate list is
  // rejected rather than silently corrected.
  const driven = new Set<NetId>();
  const consumed = new Set<NetId>();
  for (const g of gates) {
    driven.add(g.dst);
    consumed.add(g.src);
  }
  const inputs = nets.filter((n) => !driven.has(n.id)).map((n) => n.id);
  const outputs = nets.filter((n) => driven.has(n.id) && !consumed.has(n.id)).map((n) => n.id);

  const stated = j.io?.inputs;
  if (Array.isArray(stated) && !sameSet(stated, inputs)) {
    return {
      ok: false,
      reason:
        `the file's input list disagrees with its own gates ` +
        `(states ${stated.length}, gates imply ${inputs.length})`,
    };
  }

  const cut = Array.isArray(j.io?.cut) ? j.io.cut.filter((c) => ids.has(c)) : [];

  return { ok: true, netlist: { nets, gates, inputs, outputs, cut } };
}

function sameSet(a: readonly NetId[], b: readonly NetId[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

/** Pretty-printed, so a diff between two exports is readable. */
export function toJsonText(netlist: Netlist, labels: readonly Label[] = []): string {
  return `${JSON.stringify(exportNetlist(netlist, labels), null, 2)}\n`;
}
