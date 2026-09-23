// oracle.ts — check the simulator against the logic.
//
// The reason this feature exists. The Delphi original is the reference
// implementation and is not runnable headlessly, so the analysis is the only
// available second opinion about what a circuit should do.
//
// Both halves work on the engine's public surface and are already proven by the
// existing verification suites:
//
//   driving  — setStateAt sets a net's state, and StoreGateStatesToWires only
//              clears nets a gate drives. An input is by definition undriven,
//              so it holds. This is what makes clicking a wire work.
//   reading  — render() writes lit wires at their source colour and unlit ones
//              masked to & 0x7F, so a pixel's brightness *is* its net's state.

import {
  combinationFor,
  expressionFor,
  type BooleanExpr,
  type RowStatus,
  type TruthTable,
} from './boolean.js';
import { netById, type NetId, type Netlist } from './netlist.js';
import type { Circuit } from './simulator.js';

export interface Discrepancy {
  readonly inputs: readonly boolean[];
  readonly expected: readonly boolean[];
  readonly observed: readonly boolean[];
  /** Where the two first differ, when it can be localised. Never guessed. */
  readonly firstDivergentNet: NetId | null;
}

export interface SweepOptions {
  /** Cycles the output vector must hold before it counts as settled. */
  readonly stableWindow?: number;
  readonly maxCycles?: number;
  readonly onProgress?: (done: number, total: number) => void;
  readonly shouldAbort?: () => boolean;
  /** Sweep each row twice to catch timing dependence. */
  readonly repeat?: boolean;
  /**
   * Spot-check this many random combinations instead of enumerating all of
   * them. For a selection too wide to enumerate, a sample is the difference
   * between a weak answer and no answer — but it can only ever find a defect,
   * never establish absence, so callers must say which they did.
   */
  readonly sampleRows?: number;
  /**
   * Sweep only rows [from, to) of the enumeration.
   *
   * The UI drives a long sweep in slices so the page keeps painting and the
   * Stop button keeps working — a 16-input sweep is around twelve seconds, and
   * twelve seconds of a frozen tab is indistinguishable from a crash. Results
   * from consecutive windows concatenate.
   */
  readonly window?: { readonly from: number; readonly to: number };
}

export interface SweepResult {
  readonly observed: TruthTable;
  readonly discrepancies: readonly Discrepancy[];
  readonly aborted: boolean;
  readonly nonConvergentRows: number;
  readonly timingDependentRows: number;
  /** False when only a sample of the combinations was tried. */
  readonly exhaustive: boolean;
}

const DEFAULTS = { stableWindow: 12, maxCycles: 4000, repeat: true };

/**
 * Above this many states, the full set of rest states is not enumerated.
 * Whether the observed state is one is still checked — that is a single
 * evaluation — so the verdict stands; only the "how many other rest states
 * exist" note is dropped.
 */
const MAX_STATE_ENUMERATION = 4096;

/** Is this net currently high, read from the rendered frame? */
function netIsHigh(circuit: Circuit, netlist: Netlist, id: NetId): boolean {
  const net = netById(netlist, id);
  if (!net) return false;
  const d = circuit.frame.data;
  const p = (net.probe.y * circuit.width + net.probe.x) << 2;
  return Math.max(d[p], d[p + 1], d[p + 2]) >= 224;
}

/**
 * A cheap hash of the whole rendered frame, i.e. of every net's state.
 *
 * WHY THE WHOLE FRAME: watching only the probed nets says "settled" while some
 * other part of the selection is still oscillating. That produced rows which
 * claimed to have settled onto a state satisfying none of the circuit's own
 * equations — an impossibility for a circuit genuinely at rest, and the tell
 * that the stability test was too narrow. Quiescence is a property of the whole
 * selection or it is not quiescence.
 */
function frameHash(frame: ImageData): number {
  const d = frame.data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i += 4) {
    h ^= d[i] + d[i + 1] + d[i + 2];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Drive one combination and step until the whole circuit stops moving.
 *
 * Settling is detected by stability rather than a fixed count. A circuit that
 * never holds steady is reported non-convergent — never sampled and reported as
 * a value. A ring oscillator has no truth table row, and pretending it does
 * would hide exactly the evidence this tool is for.
 */
function settleOnce(
  circuit: Circuit,
  netlist: Netlist,
  drive: readonly { net: NetId; value: boolean }[],
  probes: readonly NetId[],
  stableWindow: number,
  maxCycles: number
): { values: boolean[]; settled: boolean; cycles: number } {
  const driven = drive
    .map((d) => ({ probe: netById(netlist, d.net)?.probe, value: d.value }))
    .filter((d): d is { probe: { x: number; y: number }; value: boolean } => !!d.probe);

  let last: number | null = null;
  let same = 0;
  let values = probes.map(() => false);

  for (let i = 0; i < maxCycles; i++) {
    // Re-assert every cycle: cheap, and it removes any dependence on the
    // assumption that nothing else rewrites an input net.
    for (const d of driven) circuit.setStateAt(d.probe.x, d.probe.y, d.value ? '1' : '0');
    circuit.simulate();
    const frame = circuit.render();

    values = probes.map((p) => netIsHigh(circuit, netlist, p));
    const key = frameHash(frame);
    if (key === last) {
      if (++same >= stableWindow) return { values, settled: true, cycles: i + 1 };
    } else {
      same = 0;
      last = key;
    }
  }
  return { values, settled: false, cycles: maxCycles };
}

/**
 * Drive every input combination through the real simulator and compare against
 * the analytically derived table.
 */
export function sweep(
  circuit: Circuit,
  netlist: Netlist,
  expected: TruthTable,
  opts: SweepOptions = {}
): SweepResult {
  const stableWindow = opts.stableWindow ?? DEFAULTS.stableWindow;
  const maxCycles = opts.maxCycles ?? DEFAULTS.maxCycles;
  const repeat = opts.repeat ?? DEFAULTS.repeat;

  const inputs = expected.inputs;
  const outputs = expected.outputs;
  const total = 2 ** inputs.length;

  const rows: TruthTable['rows'][number][] = [];
  const discrepancies: Discrepancy[] = [];
  let aborted = false;
  let nonConvergentRows = 0;
  let timingDependentRows = 0;

  const from = Math.max(0, opts.window?.from ?? 0);
  const to = Math.min(total, opts.window?.to ?? total);

  for (let i = from; i < to; i++) {
    if (opts.shouldAbort?.()) {
      aborted = true;
      break;
    }

    const combo = combinationFor(i, inputs.length);
    const drive = inputs.map((net, b) => ({ net, value: combo[b] }));

    const first = settleOnce(circuit, netlist, drive, outputs, stableWindow, maxCycles);
    let status: RowStatus = first.settled ? 'settled' : 'nonConvergent';
    let values = first.values;

    // The engine's ramp carries deliberate jitter, so a row that differs
    // between two sweeps is timing-dependent — a finding in its own right, and
    // not a discrepancy to blame on the netlist.
    if (repeat && first.settled) {
      const second = settleOnce(circuit, netlist, drive, outputs, stableWindow, maxCycles);
      if (!second.settled || second.values.some((v, k) => v !== values[k])) {
        status = 'timingDependent';
      }
    }

    if (status === 'nonConvergent') nonConvergentRows++;
    if (status === 'timingDependent') timingDependentRows++;

    rows.push({ inputs: combo, outputs: values, status });

    if (status === 'settled') {
      const want = expected.rows[i];
      const differs = values.some((v, k) => v !== want.outputs[k]);
      if (differs) {
        const k = values.findIndex((v, idx) => v !== want.outputs[idx]);
        discrepancies.push({
          inputs: combo,
          expected: want.outputs,
          observed: values,
          firstDivergentNet: k >= 0 ? outputs[k] : null,
        });
      }
    }

    if (opts.onProgress && (i % 64 === 0 || i === to - 1)) opts.onProgress(i + 1, total);
  }

  return {
    observed: { inputs, outputs, rows },
    discrepancies,
    aborted,
    nonConvergentRows,
    timingDependentRows,
    exhaustive: true,
  };
}

/** Apply the next-state functions once. */
function stepState(
  inputs: readonly NetId[],
  inputValues: readonly boolean[],
  stateNets: readonly NetId[],
  nextState: ReadonlyMap<NetId, BooleanExpr>,
  state: readonly boolean[],
  evaluateExpr: (e: BooleanExpr, env: ReadonlyMap<NetId, boolean>) => boolean
): boolean[] {
  const env = new Map<NetId, boolean>();
  inputs.forEach((net, b) => env.set(net, inputValues[b]));
  stateNets.forEach((net, b) => env.set(net, state[b]));
  return stateNets.map((s) => {
    const e = nextState.get(s);
    return e ? evaluateExpr(e, env) : false;
  });
}

/**
 * Every state the circuit can rest in, for a given input combination.
 *
 * WHY A SET AND NOT ONE VALUE: a latch is bistable by construction — that is
 * what makes it a latch — so for many inputs there is more than one state
 * satisfying the next-state equations, and which one the engine reaches depends
 * on its gate evaluation order, which is shuffled at load. An earlier version
 * of this compared the settled state against a single iterated fixed point and
 * duly reported the register as broken, differently on each run. It was
 * measuring the shuffle.
 *
 * A circuit at rest must satisfy its own equations. So the only defensible
 * question is whether the observed state is *among* the fixed points — and
 * landing on a different one of several is reported as multi-stable, which is a
 * fact about the circuit, not a fault in the simulator.
 *
 * Enumeration is 2^|state|, the same order as the sweep that calls it.
 */
function fixedPoints(
  inputs: readonly NetId[],
  inputValues: readonly boolean[],
  stateNets: readonly NetId[],
  nextState: ReadonlyMap<NetId, BooleanExpr>,
  evaluateExpr: (e: BooleanExpr, env: ReadonlyMap<NetId, boolean>) => boolean
): boolean[][] {
  const out: boolean[][] = [];
  const total = 2 ** stateNets.length;
  if (total > MAX_STATE_ENUMERATION) return out;
  for (let s = 0; s < total; s++) {
    const state = combinationFor(s, stateNets.length);
    const next = stepState(inputs, inputValues, stateNets, nextState, state, evaluateExpr);
    if (next.every((v, k) => v === state[k])) out.push(state);
  }
  return out;
}

/**
 * Sequential variant: seed the state, release it, and see where it lands.
 *
 * WHY NOT HOLD THE STATE NETS: a state net is by definition gate-driven, and
 * `#gateInput` reads the *driving gate's* state rather than the wire whenever a
 * wire has drivers. So poking a state net every cycle — the way inputs are
 * driven — changes nothing at all about the logic. The wire poke would only
 * affect rendering, and `StoreGateStatesToWires` overwrites even that. An
 * earlier draft of this function did exactly that and would have reported a
 * confident, meaningless table.
 *
 * `loadGateStatesFromWires` is the engine's own mechanism for seeding gates
 * from wire states — it is what the constructor uses to carry state across a
 * reload. So: poke the state nets once, seed through it, then let the circuit
 * run freely and settle.
 *
 * The analytic side is iterated to a fixed point to match, since settling is
 * what the engine is being asked to do. A row where either side fails to
 * converge is reported, never diffed.
 */
export function sweepSequential(
  circuit: Circuit,
  netlist: Netlist,
  inputs: readonly NetId[],
  stateNets: readonly NetId[],
  nextState: ReadonlyMap<NetId, BooleanExpr>,
  evaluateExpr: (e: BooleanExpr, env: ReadonlyMap<NetId, boolean>) => boolean,
  opts: SweepOptions = {}
): SweepResult {
  const stableWindow = opts.stableWindow ?? DEFAULTS.stableWindow;
  const maxCycles = opts.maxCycles ?? DEFAULTS.maxCycles;

  const repeat = opts.repeat ?? DEFAULTS.repeat;

  const all = [...inputs, ...stateNets];
  const total = 2 ** all.length;
  const rows: TruthTable['rows'][number][] = [];
  const discrepancies: Discrepancy[] = [];
  let aborted = false;
  let nonConvergentRows = 0;
  let timingDependentRows = 0;

  const probeOf = (id: NetId) => netById(netlist, id)?.probe;

  // Every net as a function of inputs and current state, so a row can start
  // from a state the circuit could actually be in.
  const treatAsInput = new Set(stateNets);
  const seedExpr = new Map<NetId, BooleanExpr>();
  for (const net of netlist.nets) {
    try {
      seedExpr.set(net.id, expressionFor(netlist, net.id, { treatAsInput }));
    } catch {
      // Still cyclic after the cut: leave it to the engine to resolve.
    }
  }

  // Enumerate, or spot-check a sample when there are too many combinations to
  // enumerate. The sample is drawn from a fixed seed so a finding reproduces.
  const sample = opts.sampleRows ?? 0;
  const exhaustive = sample <= 0 || sample >= total;
  const rowCount = exhaustive ? total : sample;
  let seed = 0x2f6e2b1 >>> 0;
  const nextIndex = (): number => {
    if (exhaustive) return -1;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % total;
  };

  for (let i = 0; i < rowCount; i++) {
    if (opts.shouldAbort?.()) {
      aborted = true;
      break;
    }
    const index = exhaustive ? i : nextIndex();
    const combo = combinationFor(index, all.length);
    const inputValues = combo.slice(0, inputs.length);

    const env = new Map<NetId, boolean>();
    all.forEach((net, b) => env.set(net, combo[b]));

    const seedAndSettle = () => {
      // Seed EVERY net, not just the state nets.
      //
      // `loadGateStatesFromWires` seeds each gate from the wire it drives, so
      // any net left unseeded carries a stale value into the new row. In a
      // two-inverter latch that is fatal: seeding only the cut net leaves its
      // partner holding the previous row's value, the loop starts inconsistent,
      // and the circuit resolves to whichever side wins — so a latch seeded low
      // came back high. Every other net is a function of the inputs and the
      // state, so there is a consistent value for it, and it costs one
      // evaluation to use it.
      for (const net of netlist.nets) {
        const p = probeOf(net.id);
        if (!p) continue;
        const e = seedExpr.get(net.id);
        const value = e ? evaluateExpr(e, env) : (env.get(net.id) ?? false);
        circuit.setStateAt(p.x, p.y, value ? '1' : '0');
      }
      circuit.loadGateStatesFromWires();
      // Release. Inputs are undriven so they keep being asserted; state nets
      // are left to the gates.
      const drive = inputs.map((net, b) => ({ net, value: inputValues[b] }));
      return settleOnce(circuit, netlist, drive, stateNets, stableWindow, maxCycles);
    };

    const observed = seedAndSettle();

    // The test that decides the verdict, and it is one step: a circuit
    // genuinely at rest must reproduce its own state.
    const afterObserved = stepState(
      inputs, inputValues, stateNets, nextState, observed.values, evaluateExpr
    );
    const isRestState = observed.values.every((v, k) => v === afterObserved[k]);

    // Only the richer "could it have rested elsewhere" note, and only when the
    // state space is small enough to enumerate.
    const enumerable = 2 ** stateNets.length <= MAX_STATE_ENUMERATION;
    const rest = enumerable
      ? fixedPoints(inputs, inputValues, stateNets, nextState, evaluateExpr)
      : [];

    let status: RowStatus;
    if (!observed.settled) {
      status = 'nonConvergent';
      nonConvergentRows++;
    } else if (isRestState) {
      // Agreement. If the engine could equally have landed elsewhere, that is
      // worth saying, so re-run the row and see whether it does.
      status = 'settled';
      if (repeat && (rest.length > 1 || !enumerable)) {
        const again = seedAndSettle();
        if (!again.settled || again.values.some((v, k) => v !== observed.values[k])) {
          status = 'timingDependent';
          timingDependentRows++;
        }
      }
    } else {
      status = 'settled';
    }

    rows.push({ inputs: combo, outputs: observed.values, status });

    // The only genuine disagreement: the circuit came to rest in a state that
    // satisfies none of its own equations.
    if (observed.settled && !isRestState) {
      const nearest = rest[0] ?? observed.values;
      const k = observed.values.findIndex((v, idx) => v !== nearest[idx]);
      discrepancies.push({
        inputs: combo,
        expected: nearest,
        observed: observed.values,
        firstDivergentNet: k >= 0 ? stateNets[k] : null,
      });
    }
    if (opts.onProgress && (i % 64 === 0 || i === total - 1)) opts.onProgress(i + 1, total);
  }

  return {
    observed: { inputs: all, outputs: stateNets, rows },
    discrepancies,
    aborted,
    nonConvergentRows,
    timingDependentRows,
    exhaustive,
  };
}
