// gates.ts — reading standard gates out of a netlist of inverters.
//
// This medium has exactly one gate and one implicit operation, and that is
// enough to derive everything:
//
//   every gate is an inverter, and a net driven by several gates is their
//   wired-OR.
//
// So for a net N driven by gates whose sources are s1..sk:
//
//   N = ¬s1 ∨ … ∨ ¬sk = ¬(s1 ∧ … ∧ sk) = NAND(s1 … sk)
//
// **Every driven net is already a NAND**, with NOT as the k = 1 case. Nothing
// is inferred from pixels here — recognition is algebra over the netlist, so it
// cannot end up disagreeing with the simulation the way a second, independent
// pixel reading could. Same rule that makes netlist.ts take net identity from
// Circuit.wireAt rather than re-deriving it.
//
// Three absorption rules build the rest:
//
//   R2  a NAND whose every source is a NOT-net   ->  OR of those NOTs' sources
//   R3  a NOT whose single source is a NAND-net  ->  AND
//   R4  a NOT whose single source is an OR-net   ->  NOR
//
// R2 holds because NAND(¬t1, ¬t2) = ¬(¬t1 ∧ ¬t2) = t1 ∨ t2.
//
// TWO THINGS KEEP THIS HONEST, and both matter more than the rules:
//
//   - **Fan-out 1 is required to absorb.** A net that something else reads
//     cannot be folded away: doing so would either duplicate a gate or silently
//     drop a connection another part of the circuit depends on.
//   - **Every symbol is verified before it is offered.** Each one is evaluated
//     against the expression of the gates it absorbed, over every combination
//     of its inputs. A symbol that disagrees is discarded and its gates are
//     drawn faithfully. A wrong symbol is worse than no symbol, because it
//     looks authoritative and a reader has no reason to doubt it.
//
// None of this changes what the circuit computes. It is a *reading* of the
// netlist — unlike minimise.ts, which changes circuits.

import { evaluate, expressionFor, type BooleanExpr } from './boolean.js';
import type { NetId, Netlist } from './netlist.js';

export type GateKind = 'NOT' | 'NAND' | 'AND' | 'OR' | 'NOR';

/** Index into `netlist.gates`. */
export type GateRef = number;

export interface RecognisedGate {
  readonly kind: GateKind;
  /** Sources, in a deterministic order. */
  readonly inputs: readonly NetId[];
  readonly output: NetId;
  /** Every engine gate this one symbol stands for. */
  readonly absorbed: readonly GateRef[];
}

export interface Recognition {
  readonly symbols: readonly RecognisedGate[];
  /** Symbols rejected by verification, drawn faithfully instead. */
  readonly rejected: number;
}

export type RecogniseResult =
  | { readonly ok: true; readonly recognition: Recognition }
  | { readonly ok: false; readonly reason: string };

interface Working {
  kind: GateKind;
  inputs: NetId[];
  output: NetId;
  absorbed: GateRef[];
  /** Set once this symbol has been folded into another. */
  gone: boolean;
}

/** How many gates read each net. A net nothing reads has fan-out 0. */
function fanOut(netlist: Netlist): Map<NetId, number> {
  const out = new Map<NetId, number>();
  for (const g of netlist.gates) out.set(g.src, (out.get(g.src) ?? 0) + 1);
  return out;
}

/**
 * Recognise standard gates.
 *
 * Deterministic: nets are processed in ascending id, and every symbol's inputs
 * keep the order its driving gates appear in the netlist.
 */
export function recognise(netlist: Netlist): RecogniseResult {
  const fan = fanOut(netlist);

  // --- base: every driven net is a NAND of its drivers' sources (NOT if one).
  const byOutput = new Map<NetId, Working>();
  const driverGates = new Map<NetId, GateRef[]>();
  netlist.gates.forEach((g, i) => {
    const list = driverGates.get(g.dst);
    if (list) list.push(i);
    else driverGates.set(g.dst, [i]);
  });

  const outputs = [...driverGates.keys()].sort((a, b) => a - b);
  for (const net of outputs) {
    const refs = driverGates.get(net)!;
    byOutput.set(net, {
      kind: refs.length === 1 ? 'NOT' : 'NAND',
      inputs: refs.map((r) => netlist.gates[r].src),
      output: net,
      absorbed: [...refs],
      gone: false,
    });
  }

  /** A net may be folded away only if exactly one gate reads it. */
  const absorbable = (net: NetId): boolean => (fan.get(net) ?? 0) === 1;

  // --- R2: NAND of NOT-nets is an OR. Applied first, because R4 reads its result.
  for (const net of outputs) {
    const sym = byOutput.get(net)!;
    if (sym.gone || sym.kind !== 'NAND') continue;

    const sources = sym.inputs.map((n) => byOutput.get(n));
    const allNots = sources.every(
      (s, i) => s !== undefined && !s.gone && s.kind === 'NOT' && absorbable(sym.inputs[i])
    );
    if (!allNots) continue;

    const folded: NetId[] = [];
    const taken: GateRef[] = [...sym.absorbed];
    for (const s of sources) {
      folded.push(s!.inputs[0]);
      taken.push(...s!.absorbed);
      s!.gone = true;
    }
    sym.kind = 'OR';
    sym.inputs = folded;
    sym.absorbed = taken;
  }

  // --- R3 and R4: a NOT reading a NAND is an AND; reading an OR it is a NOR.
  for (const net of outputs) {
    const sym = byOutput.get(net)!;
    if (sym.gone || sym.kind !== 'NOT') continue;

    const source = sym.inputs[0];
    const inner = byOutput.get(source);
    if (!inner || inner.gone || !absorbable(source)) continue;
    if (inner.kind !== 'NAND' && inner.kind !== 'OR') continue;

    sym.kind = inner.kind === 'NAND' ? 'AND' : 'NOR';
    sym.inputs = [...inner.inputs];
    sym.absorbed = [...sym.absorbed, ...inner.absorbed];
    inner.gone = true;
  }

  // --- verify every symbol before offering it (GR-5).
  const symbols: RecognisedGate[] = [];
  let rejected = 0;
  const faithful = (net: NetId): RecognisedGate => {
    const refs = driverGates.get(net)!;
    return {
      kind: refs.length === 1 ? 'NOT' : 'NAND',
      inputs: refs.map((r) => netlist.gates[r].src),
      output: net,
      absorbed: [...refs],
    };
  };

  // One symbol per output net, and exactly one.
  //
  // The `emitted` set is not defensive tidiness: restoring a rejected fold
  // un-hides nets that the ascending sweep may not have reached yet, and
  // without this they are emitted twice — once by the restore and once when
  // the sweep arrives. Conservation catches that, but only after the fact.
  const emitted = new Set<NetId>();
  const emit = (symbol: RecognisedGate): void => {
    if (emitted.has(symbol.output)) return;
    emitted.add(symbol.output);
    symbols.push(symbol);
  };

  for (const net of outputs) {
    const sym = byOutput.get(net)!;
    if (sym.gone || emitted.has(net)) continue;

    if (sym.kind === 'NOT' || sym.kind === 'NAND') {
      // The base reading, true by construction — nothing was folded.
      emit({ kind: sym.kind, inputs: sym.inputs, output: net, absorbed: sym.absorbed });
      continue;
    }

    if (verifies(netlist, sym)) {
      emit({ kind: sym.kind, inputs: sym.inputs, output: net, absorbed: sym.absorbed });
      continue;
    }

    // Rejected. Put back the base symbol for this net and for everything it
    // had folded away, so no gate goes missing.
    rejected++;
    emit(faithful(net));
    for (const ref of sym.absorbed) {
      const dst = netlist.gates[ref].dst;
      if (dst === net) continue;
      const restored = byOutput.get(dst);
      if (restored?.gone) {
        restored.gone = false;
        emit(faithful(dst));
      }
    }
  }

  symbols.sort((a, b) => a.output - b.output);

  // --- conservation (GR-4): every gate drawn or absorbed exactly once.
  const seen = new Set<GateRef>();
  for (const s of symbols) {
    for (const ref of s.absorbed) {
      if (seen.has(ref)) {
        return { ok: false, reason: `gate ${ref} is accounted for twice` };
      }
      seen.add(ref);
    }
  }
  if (seen.size !== netlist.gates.length) {
    return {
      ok: false,
      reason: `recognition accounts for ${seen.size} gates, the netlist has ${netlist.gates.length}`,
    };
  }

  return { ok: true, recognition: { symbols, rejected } };
}

/**
 * Does this symbol compute what the gates it absorbed compute?
 *
 * The check that makes recognition trustworthy. The symbol's inputs are treated
 * as free, its output expression derived from the netlist, and the two compared
 * on every row. Symbols have a handful of inputs, so this is cheap and exact.
 */
function verifies(netlist: Netlist, sym: Working): boolean {
  if (sym.inputs.length === 0 || sym.inputs.length > 12) return false;

  let expr: BooleanExpr;
  try {
    expr = expressionFor(netlist, sym.output, { treatAsInput: new Set(sym.inputs) });
  } catch {
    // Feedback reached during expansion: not something to guess about.
    return false;
  }

  const total = 2 ** sym.inputs.length;
  const env = new Map<NetId, boolean>();
  for (let i = 0; i < total; i++) {
    const values = sym.inputs.map((_, b) => ((i >> b) & 1) === 1);
    sym.inputs.forEach((net, b) => env.set(net, values[b]));
    if (evaluate(expr, env) !== apply(sym.kind, values)) return false;
  }
  return true;
}

/** What each symbol means, in one place. */
export function apply(kind: GateKind, values: readonly boolean[]): boolean {
  switch (kind) {
    case 'NOT':
      return !values[0];
    case 'NAND':
      return !values.every(Boolean);
    case 'AND':
      return values.every(Boolean);
    case 'OR':
      return values.some(Boolean);
    case 'NOR':
      return !values.some(Boolean);
  }
}

/** How many engine gates a recognised symbol stands for. */
export function absorbedCount(recognition: Recognition): number {
  return recognition.symbols.reduce((n, s) => n + s.absorbed.length, 0);
}
