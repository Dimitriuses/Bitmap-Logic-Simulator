# Contract: Boolean Analysis and the Simulator Oracle

**Feature**: `003-circuit-analysis` | **Modules**: `src/boolean.ts`, `src/sequential.ts`,
`src/oracle.ts`, `src/analysis.ts`

---

## `src/boolean.ts` — expressions and truth tables

```ts
export type BooleanExpr =
  | { kind: 'const'; value: boolean }
  | { kind: 'var'; net: NetId }
  | { kind: 'not'; arg: BooleanExpr }
  | { kind: 'and'; args: readonly BooleanExpr[] }
  | { kind: 'or'; args: readonly BooleanExpr[] };

export function evaluate(e: BooleanExpr, env: ReadonlyMap<NetId, boolean>): boolean;

/** Build the expression a net carries, in terms of the netlist's inputs. */
export function expressionFor(netlist: Netlist, net: NetId): BooleanExpr;

export type RowStatus = 'settled' | 'nonConvergent' | 'timingDependent';

export interface TruthTable {
  readonly inputs: readonly NetId[];
  readonly outputs: readonly NetId[];
  readonly rows: readonly {
    readonly inputs: readonly boolean[];
    readonly outputs: readonly boolean[];
    readonly status: RowStatus;
  }[];
}

export const MAX_INPUTS = 16;
```

- **BA-1 — Pure.** No DOM, no engine, no document. The entire boolean layer is verifiable
  headlessly, which is why it is separated from everything that touches pixels.
- **BA-2 — Wired-OR is modelled, not approximated.** A net driven by several gates is the
  `or` of their outputs. Every non-inverter gate in this medium is built that way, so it is
  the single most important rule here.
- **BA-3 — An undriven net is a free variable**, not a constant. It holds whatever the user
  last set — the engine's own fallback, and what makes clicking a wire work.
- **BA-4 — Every gate is an inverter.** `expressionFor` a gate's destination is
  `not(expressionFor(its source))`. There is no other gate type to handle.
- **BA-5 — Cycles are refused here.** `expressionFor` must not recurse forever on feedback;
  it requires an acyclic netlist and throws otherwise. Feedback is `sequential.ts`'s job,
  and conflating the two would produce an infinite expansion instead of an error.
- **BA-6 — Size is checked before work starts.** Beyond `MAX_INPUTS` the table is refused
  with the count, before a single row is computed. The refusal must arrive instead of the
  freeze, not after it. Measured: 16 inputs is 65,536 rows and about 12 s of sweep; 20
  inputs would be over three minutes.
- **BA-7 — Equality is by evaluation.** Two expressions are equal when they agree on every
  row, never when their trees look alike. Every equality claim in this feature — including
  "this simplification is correct" — is made this way.

---

## `src/sequential.ts` — feedback

```ts
export interface SequentialModel {
  readonly stateNets: readonly NetId[];
  readonly nextState: ReadonlyMap<NetId, BooleanExpr>;
  readonly outputs: ReadonlyMap<NetId, BooleanExpr>;
}

/** Strongly connected components of the gate graph, Tarjan. */
export function components(netlist: Netlist): NetId[][];

/** Nets to cut so the graph becomes acyclic. Greedy, per component. */
export function feedbackNets(netlist: Netlist): NetId[];
```

- **SQ-1 — Components first, cycles never enumerated.** Tarjan is linear; enumerating every
  simple cycle is exponential and is one of the two reasons the reference implementation
  tops out at 46 gates. A combinational selection has no non-trivial components and costs
  one linear pass.
- **SQ-2 — Feedback is broken per component**, so independent latches do not multiply
  against each other.
- **SQ-3 — Small, not minimal.** Minimum feedback vertex set is NP-hard and unnecessary: one
  state variable too many costs one extra column in a table.
- **SQ-4 — Cutting is verified.** After removing `stateNets` the graph must be acyclic, and
  that is asserted rather than assumed.
- **SQ-5 — State nets are locatable**, carrying a probe pixel from the netlist, because a
  state variable the user cannot find on the canvas is not actionable.

---

## `src/oracle.ts` — checking the simulator

The reason this feature exists. The Delphi original is the reference implementation and is
not runnable headlessly, so the analysis is the only available second opinion about what a
circuit should do.

```ts
export interface Discrepancy {
  readonly inputs: readonly boolean[];
  readonly expected: readonly boolean[];
  readonly observed: readonly boolean[];
  readonly firstDivergentNet: NetId | null;
}

export interface SweepOptions {
  /** Cycles the output vector must hold steady before it counts as settled. */
  readonly stableWindow?: number;   // default 12
  readonly maxCycles?: number;      // default 4000
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export function sweep(
  circuit: Circuit, netlist: Netlist, expected: TruthTable, opts?: SweepOptions
): { discrepancies: Discrepancy[]; table: TruthTable };
```

- **OR-1 — Drive with `setStateAt`, observe through the rendered frame.** Both work on the
  engine's public surface and are already used by the existing verification suites: an
  input net is by definition undriven, so `StoreGateStatesToWires` does not clear it; and
  `render()` writes lit wires at source colour and unlit ones masked to `& 0x7F`, so a
  pixel's brightness *is* its net's state.
- **OR-2 — Settle by stability, not by a fixed count.** Step the circuit and watch the
  output vector; it has settled when unchanged for `stableWindow` cycles. Measured on
  inverter chains: 13 cycles at depth 1, 34 at depth 16 — shallow and fast.
- **OR-3 — Non-convergence is an outcome.** A circuit that never holds steady is reported
  `nonConvergent` for that row. It is never sampled and reported as a value. A ring
  oscillator has no truth table row, and pretending it does would hide precisely the
  evidence the AX investigation needs (research R8).
- **OR-4 — Re-assert inputs every cycle.** Cheap, and it removes any dependence on the
  assumption that nothing else rewrites an input net.
- **OR-5 — Discrepancies are reproducible.** Each carries the input combination, the
  expected value and the observed one, so it can be re-triggered by hand. A report that
  cannot be reproduced is not a bug report.
- **OR-6 — Agreement is reported explicitly.** An empty list means "the simulator matches
  the logic", and must be stated. For the AX register this is the more likely finding, and
  it must not arrive as silence.
- **OR-7 — Interruptible.** Above a few thousand rows the sweep reports progress and honours
  an abort signal. Measured: 0.19 ms per settled row, so 12 inputs is 0.8 s and 16 is 12 s.
- **OR-8 — Sequential sweeps (inputs × state).** For a selection with feedback the sweep
  sets the state nets as well as the inputs, and compares *next state* against
  `SequentialModel.nextState`, not a combinational output.
- **OR-9 — Repeatability check.** Because the engine's ramp carries deliberate jitter, a row
  is swept twice; if the two disagree the row is `timingDependent`, which is a finding in
  its own right and not a discrepancy to blame on the netlist.

---

## `src/analysis.ts` — orchestration

```ts
export interface AnalysisRequest {
  readonly doc: CircuitDocument;
  readonly rect: Rect;
  readonly markedOutputs?: readonly NetId[];
  readonly runOracle: boolean;
}

export function analyse(req: AnalysisRequest): AnalysisResult | AnalysisRefusal;
```

- **AN-1 — Orchestration only.** No algorithms of its own; it crops, extracts, classifies,
  builds, sweeps and assembles.
- **AN-2 — Refusals carry the number.** "Too many inputs" always says how many were found
  and what the limit is.
- **AN-3 — Partial results are returned.** Extraction can succeed while the table is refused
  for size; the caller gets the netlist and the reason, not a failure.
- **AN-4 — Results go stale on any document edit** and are marked, never silently shown
  against a circuit that has since changed.

---

## Verification

`scripts/verify/boolean.mjs` and `scripts/verify/oracle.mjs`:

| Check | Expectation |
| --- | --- |
| Each of the four gate directions | truth table matches the inverter |
| Crossover | two independent nets, no functional relationship |
| Two gates driving one net | the table matches their OR |
| An undriven net | appears as a free input, not a constant |
| A latch | reported sequential, exactly one state variable |
| A ring oscillator | every row `nonConvergent`, no values reported |
| Known-good circuits | sweep finds zero discrepancies, and says so |
| A deliberately wrong expected table | the discrepancy is found and names the row |

The last two are a pair: the oracle is only trustworthy if it is known both to stay quiet
when things agree and to speak up when they do not.
