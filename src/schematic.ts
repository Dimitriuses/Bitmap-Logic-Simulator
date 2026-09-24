// schematic.ts — a netlist, drawn as a circuit.
//
// Joins the two pure halves: gates.ts reads standard symbols out of the
// netlist's inverters, graph-layout.ts arranges them so signal flows one way.
// Everything here is derived from the Netlist and nothing from pixels, so a
// diagram cannot end up describing a different circuit from the one being
// simulated.
//
// Two levels, from one analysis:
//
//   faithful    one symbol per gate. Counts equal the netlist's exactly. This
//               is the ground truth to check against when a recognised symbol
//               looks wrong.
//   recognised  NAND/NOR/AND/OR/NOT folded from inverter and wired-OR
//               patterns. Fewer symbols, same circuit.
//
// The correspondence with the pixels runs both ways — every symbol can name
// its probe point, and every net and gate can name its symbol — because the
// point of the diagram is to be pointed at.

import type { Rect } from './block.js';
import { recognise, type GateKind, type GateRef, type RecognisedGate } from './gates.js';
import { layout, type Layout, type LayoutEdge } from './graph-layout.js';
import { netById, type NetId, type Netlist } from './netlist.js';

export type SchematicLevel = 'faithful' | 'recognised';

export type SymbolKind = GateKind | 'input' | 'output';

export interface SchematicSymbol {
  readonly id: number;
  readonly kind: SymbolKind;
  readonly inputs: readonly NetId[];
  /** The net this symbol drives, or the net itself for a terminal. */
  readonly net: NetId;
  readonly absorbed: readonly GateRef[];
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  /** Where to look on the circuit, in selection coordinates. */
  readonly probe: { readonly x: number; readonly y: number };
  readonly label: string;
}

export interface SchematicEdge {
  readonly from: number;
  readonly to: number;
  readonly net: NetId;
  readonly isFeedback: boolean;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

export interface Schematic {
  readonly level: SchematicLevel;
  readonly symbols: readonly SchematicSymbol[];
  readonly edges: readonly SchematicEdge[];
  readonly width: number;
  readonly height: number;
  /** The selection this came from, in document coordinates. */
  readonly sourceRect: Rect;
  /** Nets the selection boundary severed; drawn entering from the edge. */
  readonly cut: readonly NetId[];
  readonly gateCount: number;
}

export type SchematicResult =
  | { readonly ok: true; readonly schematic: Schematic }
  | { readonly ok: false; readonly reason: string };

export interface SchematicOptions {
  readonly level?: SchematicLevel;
  /** Names a net, if the user has given it one. */
  readonly nameOf?: (net: NetId) => string | null;
}

const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Build a diagram.
 *
 * Symbol ids are assigned deterministically: terminals first in ascending net
 * order, then gate symbols in ascending output-net order. Nothing here consults
 * a clock, a hash or a random source, so the same netlist always produces the
 * same picture.
 */
export function buildSchematic(
  netlist: Netlist,
  sourceRect: Rect = ZERO_RECT,
  opts: SchematicOptions = {}
): SchematicResult {
  const level = opts.level ?? 'recognised';

  let gateSymbols: RecognisedGate[];
  if (level === 'recognised') {
    const r = recognise(netlist);
    if (!r.ok) return { ok: false, reason: r.reason };
    gateSymbols = [...r.recognition.symbols];
  } else {
    // Faithful: **one symbol per engine gate**, not per driven net.
    //
    // Collapsing a net's k drivers into a single NAND would already be a
    // recognition step, and this view exists to be the thing recognition is
    // checked against. So each inverter gets its own triangle and the wired-OR
    // appears as what it is: several edges converging on one net.
    gateSymbols = netlist.gates.map((g, i) => ({
      kind: 'NOT' as GateKind,
      inputs: [g.src],
      output: g.dst,
      absorbed: [i],
    }));
  }

  // --- symbol ids
  //
  // A net may be driven by several symbols at the faithful level (that is the
  // wired-OR), so this maps a net to every symbol that drives it. At the
  // recognised level each list has exactly one entry.
  const driversOfNet = new Map<NetId, number[]>();
  const addDriver = (net: NetId, id: number): void => {
    const list = driversOfNet.get(net);
    if (list) list.push(id);
    else driversOfNet.set(net, [id]);
  };
  let nextId = 0;

  const inputTerminals = [...netlist.inputs].sort((a, b) => a - b);
  const driven = new Set(gateSymbols.map((s) => s.output));
  const outputTerminals = [...netlist.outputs].sort((a, b) => a - b);

  interface Draft {
    id: number;
    kind: SymbolKind;
    inputs: NetId[];
    net: NetId;
    absorbed: GateRef[];
  }
  const drafts: Draft[] = [];

  for (const net of inputTerminals) {
    const id = nextId++;
    addDriver(net, id);
    drafts.push({ id, kind: 'input', inputs: [], net, absorbed: [] });
  }

  for (const s of gateSymbols) {
    const id = nextId++;
    addDriver(s.output, id);
    drafts.push({ id, kind: s.kind, inputs: [...s.inputs], net: s.output, absorbed: [...s.absorbed] });
  }

  // An output terminal hangs off whatever drives it, so it gets its own node
  // only to pin it to the last layer and give it somewhere to be labelled.
  const outputSymbolOf = new Map<NetId, number>();
  for (const net of outputTerminals) {
    if (!driven.has(net)) continue; // an undriven "output" is really an input
    const id = nextId++;
    outputSymbolOf.set(net, id);
    drafts.push({ id, kind: 'output', inputs: [net], net, absorbed: [] });
  }

  // --- edges: one per symbol input, plus one per output terminal
  const edgeNets: NetId[] = [];
  const layoutEdges: LayoutEdge[] = [];
  for (const d of drafts) {
    if (d.kind === 'input') continue;
    for (const source of d.inputs) {
      // One edge per driver. Where a net has several, they converge on this
      // symbol — which is exactly how a wired-OR should read.
      for (const from of driversOfNet.get(source) ?? []) {
        if (from === d.id) continue;
        layoutEdges.push({ from, to: d.id, tag: edgeNets.length });
        edgeNets.push(source);
      }
    }
  }

  const placed: Layout = layout(
    {
      nodes: drafts.map((d) => d.id),
      edges: layoutEdges,
      sources: inputTerminals.flatMap((n) => driversOfNet.get(n) ?? []),
    },
    { layerGap: 96, nodeGap: 48 }
  );

  const position = new Map<number, { x: number; y: number; layer: number }>();
  for (const n of placed.nodes) {
    if (!n.isDummy) position.set(n.id, { x: n.x, y: n.y, layer: n.layer });
  }

  const name = opts.nameOf ?? (() => null);
  const labelFor = (kind: SymbolKind, net: NetId): string => {
    const given = name(net);
    if (given) return given;
    if (kind === 'input' || kind === 'output') {
      const info = netById(netlist, net);
      return info ? `${net}@${info.probe.x},${info.probe.y}` : `n${net}`;
    }
    return kind;
  };

  const symbols: SchematicSymbol[] = drafts.map((d) => {
    const p = position.get(d.id) ?? { x: 0, y: 0, layer: 0 };
    const info = netById(netlist, d.net);
    return {
      id: d.id,
      kind: d.kind,
      inputs: d.inputs,
      net: d.net,
      absorbed: d.absorbed,
      x: p.x,
      y: p.y,
      layer: p.layer,
      probe: info ? { x: info.probe.x, y: info.probe.y } : { x: 0, y: 0 },
      label: labelFor(d.kind, d.net),
    };
  });

  const edges: SchematicEdge[] = placed.edges.map((e) => ({
    from: e.from,
    to: e.to,
    net: edgeNets[e.tag as number] ?? -1,
    isFeedback: e.isFeedback,
    points: e.points,
  }));

  // --- conservation, again, at this level (SM-1 / FR-015a)
  const accounted = symbols.reduce((n, s) => n + s.absorbed.length, 0);
  if (accounted !== netlist.gates.length) {
    return {
      ok: false,
      reason: `the diagram accounts for ${accounted} gates, the netlist has ${netlist.gates.length}`,
    };
  }

  return {
    ok: true,
    schematic: {
      level,
      symbols,
      edges,
      width: placed.width,
      height: placed.height,
      sourceRect,
      cut: [...netlist.cut],
      gateCount: netlist.gates.length,
    },
  };
}

/**
 * Which symbols represent this net. For pixel → diagram highlighting.
 *
 * Plural, because at the faithful level a wired-OR net is driven by several
 * symbols at once and highlighting only one of them would be a lie about where
 * that signal comes from.
 */
export function symbolsForNet(schematic: Schematic, net: NetId): SchematicSymbol[] {
  return schematic.symbols.filter((s) => s.net === net && s.kind !== 'output');
}

/** The first symbol representing a net, where exactly one is wanted. */
export function symbolForNet(schematic: Schematic, net: NetId): SchematicSymbol | undefined {
  return symbolsForNet(schematic, net)[0];
}

/** Every net a symbol stands for, for diagram → pixel highlighting. */
export function netsOfSymbol(schematic: Schematic, symbol: SchematicSymbol): NetId[] {
  const nets = new Set<NetId>([symbol.net, ...symbol.inputs]);
  void schematic;
  return [...nets].sort((a, b) => a - b);
}
