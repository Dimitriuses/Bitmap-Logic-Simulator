// analysis.ts — orchestration only.
//
// Crops, extracts, classifies, builds, sweeps and assembles. No algorithms of
// its own: every one lives in a module that can be checked without a browser.

import type { Rect } from './block.js';
import {
  equivalent,
  evaluate,
  expressionFor,
  MAX_INPUTS,
  truthTable,
  type BooleanExpr,
  type TruthTable,
} from './boolean.js';
import { inverterCost, netlistCost } from './cost.js';
import type { CircuitDocument } from './document.js';
import { minimise, mintermsOf } from './minimise.js';
import { extractNetlist, type NetId, type Netlist } from './netlist.js';
import { sweep, sweepSequential, type Discrepancy, type SweepOptions } from './oracle.js';
import { analyseSequential, isSequential, type SequentialModel } from './sequential.js';
import { analyseStorage, type StorageReport } from './storage-elements.js';
import { findClockCandidates, type ClockCandidate } from './clock.js';
import { Circuit } from './simulator.js';

export interface Simplification {
  readonly minimised: ReadonlyMap<NetId, BooleanExpr>;
  readonly originalCost: number;
  readonly minimisedCost: number;
  /** Checked against the original truth table. Never false when shown. */
  readonly verified: boolean;
  readonly improved: boolean;
}

export interface AnalysisResult {
  readonly kind: 'combinational' | 'sequential';
  readonly rect: Rect;
  readonly netlist: Netlist;
  readonly circuit: Circuit;
  readonly inputs: readonly NetId[];
  readonly outputs: readonly NetId[];
  readonly expressions: ReadonlyMap<NetId, BooleanExpr>;
  readonly table: TruthTable | null;
  readonly sequential: SequentialModel | null;
  /**
   * Storage, and whether it starts from a known value.
   *
   * Deliberately separate from `discrepancies`. Those answer "does it hold and
   * compute correctly once started"; this answers "does it start correctly".
   * A pass on one says nothing about the other, and the two are kept apart all
   * the way to the screen so that they cannot be read as one (FR-031).
   */
  readonly storage: StorageReport | null;
  /** Ranked clock candidates, each with its evidence. Never auto-designated. */
  readonly clocks: readonly ClockCandidate[];
  /** The net the user designated, if any. */
  readonly clock: number | null;
  readonly discrepancies: readonly Discrepancy[];
  readonly oracleRan: boolean;
  readonly nonConvergentRows: number;
  readonly timingDependentRows: number;
  readonly simplification: Simplification | null;
  /** Set when something prevented part of the analysis but not all of it. */
  readonly notes: readonly string[];
  stale: boolean;
}

export type AnalysisOutcome =
  | { readonly ok: true; readonly result: AnalysisResult }
  | { readonly ok: false; readonly reason: string; readonly inputCount?: number };

export interface AnalysisRequest {
  readonly doc: CircuitDocument;
  readonly rect: Rect;
  /** User-marked outputs; overrides the structural suggestion when present. */
  readonly markedOutputs?: readonly NetId[];
  readonly runOracle?: boolean;
  /** Cold-start the selection repeatedly to see whether its memory starts defined. */
  readonly runPowerOn?: boolean;
  /** A net the user has designated as the clock; overrides any ranking. */
  readonly clock?: number | null;
  readonly simplify?: boolean;
  readonly sweepOptions?: SweepOptions;
}

/** Compile a selection into a standalone circuit and describe what it computes. */
export function analyse(req: AnalysisRequest): AnalysisOutcome {
  const { doc, rect } = req;
  if (rect.width <= 0 || rect.height <= 0) {
    return { ok: false, reason: 'Select a region first.' };
  }

  // Source pixels, never the rendered frame.
  const image = doc.cropImage(rect);
  const circuit = new Circuit(image, null);

  const extracted = extractNetlist(circuit, image);
  if (!extracted.ok) return { ok: false, reason: extracted.reason };
  const netlist = extracted.netlist;

  const notes: string[] = [];
  const inputs = [...netlist.inputs];
  const outputs = req.markedOutputs?.length ? [...req.markedOutputs] : [...netlist.outputs];

  if (netlist.gates.length === 0) {
    notes.push('No gates in this region — it is wiring only.');
  }
  if (outputs.length === 0) {
    notes.push(
      'No outputs found. Structural inference only spots nets that feed nothing; ' +
        'mark the nets you care about.'
    );
  }
  if (netlist.cut.length > 0) {
    notes.push(
      `${netlist.cut.length} net(s) are cut by the selection edge and are being treated ` +
        'as free inputs.'
    );
  }

  const sequential = isSequential(netlist);

  if (sequential) {
    const model = analyseSequential(netlist, outputs);
    const storage = analyseStorage(netlist, req.runPowerOn === false ? null : image);
    if (storage.elements.length > 0) {
      notes.push(
        `${storage.elements.length} storage element(s) in ` +
          `${storage.groups.length} group(s).`
      );
    }
    if (storage.settlingLoops > 0) {
      notes.push(
        `${storage.settlingLoops} feedback loop(s) settle to a single state — loops, not memory.`
      );
    }

    // Candidates, never a designation: the structural signal cannot tell a
    // clock from a reset, so choosing one here would be a guess wearing a
    // result's clothes.
    const clocks = findClockCandidates(
      netlist,
      req.runPowerOn === false ? null : image,
      storage.elements
    );
    notes.push(
      `Feedback found: ${model.stateNets.length} state variable(s). Analysed as a ` +
        'sequential circuit.'
    );

    let discrepancies: readonly Discrepancy[] = [];
    let nonConvergent = 0;
    let ran = false;
    const width = inputs.length + model.stateNets.length;
    if (req.runOracle && width <= MAX_INPUTS) {
      const r = sweepSequential(
        circuit, netlist, inputs, model.stateNets, model.nextState, evaluate, req.sweepOptions
      );
      discrepancies = r.discrepancies;
      nonConvergent = r.nonConvergentRows;
      ran = true;
    } else if (req.runOracle) {
      notes.push(`Not swept: ${width} inputs plus state exceeds the limit of ${MAX_INPUTS}.`);
    }

    return {
      ok: true,
      result: {
        kind: 'sequential', rect, netlist, circuit, inputs, outputs,
        expressions: model.outputs, table: null, sequential: model, storage,
        clocks, clock: req.clock ?? null,
        discrepancies, oracleRan: ran, nonConvergentRows: nonConvergent,
        timingDependentRows: 0, simplification: null, notes, stale: false,
      },
    };
  }

  // --- combinational
  if (inputs.length > MAX_INPUTS) {
    return {
      ok: false,
      reason: `${inputs.length} inputs exceeds the limit of ${MAX_INPUTS}. Select a smaller region.`,
      inputCount: inputs.length,
    };
  }

  const expressions = new Map<NetId, BooleanExpr>();
  for (const o of outputs) expressions.set(o, expressionFor(netlist, o));

  const built = truthTable(inputs, outputs, expressions);
  if (!built.ok) return { ok: false, reason: built.reason, inputCount: built.inputCount };
  const table = built.table;

  let discrepancies: readonly Discrepancy[] = [];
  let nonConvergent = 0;
  let timingDependent = 0;
  let ran = false;
  if (req.runOracle && outputs.length > 0) {
    const r = sweep(circuit, netlist, table, req.sweepOptions);
    discrepancies = r.discrepancies;
    nonConvergent = r.nonConvergentRows;
    timingDependent = r.timingDependentRows;
    ran = true;
    if (r.aborted) notes.push('Sweep stopped early.');
  }

  const simplification = req.simplify ? simplify(table, expressions, netlist, inputs) : null;

  return {
    ok: true,
    result: {
      kind: 'combinational', rect, netlist, circuit, inputs, outputs, expressions,
      table, sequential: null, storage: null, clocks: [], clock: null,
      discrepancies, oracleRan: ran,
      nonConvergentRows: nonConvergent, timingDependentRows: timingDependent,
      simplification, notes, stale: false,
    },
  };
}

/**
 * Minimise each output and cost the result.
 *
 * Nothing is returned unverified: a wrong simplifier is worse than none,
 * because its output looks like progress. The check is cheap — the truth table
 * already exists.
 */
function simplify(
  table: TruthTable,
  original: ReadonlyMap<NetId, BooleanExpr>,
  netlist: Netlist,
  inputs: readonly NetId[]
): Simplification | null {
  if (table.outputs.length === 0) return null;

  const minimised = new Map<NetId, BooleanExpr>();
  let verified = true;

  table.outputs.forEach((net, column) => {
    const before = original.get(net);
    try {
      const m = minimise({ variables: inputs, minterms: mintermsOf(table.rows, column) });
      minimised.set(net, m);
      if (!before || !equivalent(before, m, inputs)) verified = false;
    } catch {
      // The minimiser caught itself. Keep the original expression and say so
      // rather than offering something that failed its own check.
      if (before) minimised.set(net, before);
      verified = false;
    }
  });

  let minimisedCost = 0;
  for (const e of minimised.values()) minimisedCost += inverterCost(e);
  const originalCost = netlistCost(netlist);

  return {
    minimised,
    originalCost,
    minimisedCost,
    verified,
    improved: verified && minimisedCost < originalCost,
  };
}
