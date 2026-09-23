# Implementation Plan: Circuit Analysis

**Branch**: `003-circuit-analysis` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-circuit-analysis/spec.md`

## Summary

Tell the user what a selected piece of circuit actually computes, check the simulator against
that answer, and offer a smaller equivalent.

The shape of the work changed twice during Phase 0, both times for the better. Extraction
turned out to need **no change to the engine and no re-derivation of connectivity**:
`Circuit.wireAt` is public and already returns the engine's own net labels, so only gates are
re-detected, and that detection self-checks against `Circuit.gateCount` — verified exact on
all 22 schematics. And analysis runs on a **cropped sub-circuit** built from the selection,
which makes boundary inputs fall out of the engine's existing "undriven net is an input" rule
instead of needing special handling, and makes the simulator oracle cheap enough to sweep
65,536 input combinations in 12 seconds.

What is genuinely new here is the analysis layer: truth tables, boolean expression
construction, a Quine–McCluskey minimiser, a cost model in inverters, feedback handling via
strongly connected components, and a differential check between the analysis and the running
simulator. That last one is the reason the feature was asked for — it is the only available
oracle for deciding whether the AX register defect lives in the circuit or in the simulator.

`simulator.ts` is not modified.

## Technical Context

**Language/Version**: TypeScript 5.9, ES2022, plain `tsc`. No bundler.

**Primary Dependencies**: None at runtime. `typescript` remains the only devDependency. The
minimiser is written rather than imported, because there is no sympy for the browser and the
constitution forbids adding one.

**Storage**: No new persistence beyond the existing editor preferences. Netlist export/import
is a file the user chooses, in the shape of LogicShorter's `*_raw.json`.

**Testing**: The existing zero-dependency harness in `scripts/verify/`, extended with
analysis suites; Playwright, outside the repo, for the interaction.

**Target Platform**: Chrome, Edge, Firefox, Safari. Analysis is pure computation and runs
anywhere the app does.

**Performance Goals**: Netlist extraction under ~100 ms for the largest bundled schematic
(measured: 105 ms at 45,004 gates). Truth table and simulator sweep within a few seconds up
to 12 inputs, and under ~15 s at the 16-input limit, with progress shown and the sweep
interruptible.

**Constraints**: Simulation semantics frozen. `simulator.ts` untouched. No runtime
dependency. The analysis models steady-state logic only — timing, races and the
Schmitt-trigger jitter are outside it by construction, and must be reported as such rather
than approximated.

**Scale/Scope**: Selections up to 16 inputs and a few hundred gates. Explicitly *not* whole
schematics: the feature declines rather than attempting 45,004 gates.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[.specify/memory/constitution.md](../../.specify/memory/constitution.md) remains an unfilled
template, so the operative constraints are the ones `CLAUDE.md` records.

| Gate | Status | Notes |
| --- | --- | --- |
| Simplicity / YAGNI | **PASS** | Quine–McCluskey rather than Espresso; SCC + greedy FVS rather than exact minimum feedback vertex set; observational extraction rather than a second netlist builder. Each rejects the more elaborate option because the measured sizes do not need it. |
| No frameworks | **PASS** | Tables and results are plain DOM; no charting or UI library. |
| No bundler / `tsc` only | **PASS** | New modules compile with the existing invocation. |
| No runtime dependencies | **PASS** | Nothing added. The minimiser is ~250 lines precisely so that sympy is not needed. |
| Client-side only | **PASS** | Analysis is computation in the page. Export writes a file the user chooses. |
| Simulation fidelity | **PASS** | `simulator.ts` untouched. Extraction *reads* `wireAt`, and asserts agreement with `gateCount`, so the engine remains the authority on both connectivity and gate count. |

**Result (pre-Phase 0)**: no violations.

**Re-check (post-Phase 1 design)**: still passing, and Phase 0 removed work rather than
adding it. R1 eliminated a whole netlist builder and the risk of it diverging from the
engine; R2 eliminated special-case boundary logic by reusing the crop the clipboard already
produces. No new dependency, module boundary or build step was introduced by Phase 1.

The one item carried forward as a stated limitation rather than a solved problem is R5: the
minimiser optimises sum-of-products while the cost is reported in inverters. These are not
the same objective, and the UI says so rather than claiming optimality.

## Project Structure

### Documentation (this feature)

```text
specs/003-circuit-analysis/
├── spec.md              # 6 user stories, 21 FRs, 11 success criteria
├── plan.md              # This file
├── research.md          # Phase 0 — 10 decisions, 2 settled by prototype
├── data-model.md        # Phase 1 — entities and invariants
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/           # Phase 1
│   ├── netlist.md       #   extraction, boundary classification, self-check
│   ├── analysis.md      #   truth tables, expressions, sequential, the oracle
│   └── simplify.md      #   minimiser, cost model, layout, verification
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
index.html               # + analysis panel: I/O list, truth table, result, actions
css/style.css            # + panel, table, discrepancy highlighting

src/
├── simulator.ts         # UNCHANGED
├── netlist.ts           # NEW — observational extraction + boundary classification
├── boolean.ts           # NEW — expression tree, evaluation, truth tables
├── minimise.ts          # NEW — Quine–McCluskey + greedy cover
├── cost.ts              # NEW — inverter cost in the NOT + wired-OR basis
├── sequential.ts        # NEW — Tarjan SCC + greedy feedback vertex set
├── oracle.ts            # NEW — drive/settle/observe the real simulator
├── analysis.ts          # NEW — orchestration: selection -> AnalysisResult
├── layout.ts            # NEW — expression -> PixelBlock of real gates
├── netlist-json.ts      # NEW — export/import in LogicShorter's schema
├── document.ts          # + cropToBlock helper if readBlock needs it
├── editor.ts            # + analysis invocation, marked-output overrides
├── ui.ts                # + panel wiring, progress, staleness
└── dom.ts               # + the new elements

scripts/verify/
├── netlist.mjs          # NEW — extraction agrees with the engine on all schematics
├── boolean.mjs          # NEW — truth tables for known gates, wired-OR, crossover
├── minimise.mjs         # NEW — minimiser correctness by exhaustive re-evaluation
└── oracle.mjs           # NEW — analysis vs simulator on known circuits
```

**Structure Decision**: The flat `src/` layout continues. The split above is by *what each
module knows about*, which keeps the pure parts pure and therefore checkable headlessly:

| Module | Depends on | Why it is separate |
| --- | --- | --- |
| `boolean.ts`, `minimise.ts`, `cost.ts` | nothing | No DOM, no engine. Verified exhaustively without a browser. |
| `sequential.ts` | nothing | Graph algorithms over plain arrays. |
| `netlist.ts` | `Circuit` (read-only) | The only module that knows how gates look. |
| `oracle.ts` | `Circuit` | The only module that *runs* the simulator. |
| `layout.ts` | `stamps.ts`, `block.ts` | Reuses the existing gate patterns and paste block. |
| `analysis.ts` | all of the above | Orchestration only; no algorithms of its own. |

Dependency direction stays one way, and nothing new points at the engine except through its
public surface:

```
CircuitDocument ──crop──▶ Circuit (sub) ──▶ netlist.ts ──▶ analysis.ts ──▶ UI
                              │                                 ▲
                              └────── oracle.ts ────────────────┤
                                                                │
                    boolean.ts · minimise.ts · cost.ts · sequential.ts
                                                                │
                                          layout.ts ──▶ PixelBlock ──▶ existing paste
```

## Complexity Tracking

> No Constitution Check violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| *(none)* | — | — |

## Implementation Phases

**Phase A — Netlist (US1 foundation).** `netlist.ts`: nets from `wireAt`, gates re-detected
and self-checked against `gateCount`, boundary classification from the crop. *Verify: exact
agreement on all 22 schematics — already demonstrated by the Phase 0 prototype, so this is
promoting a proven approach rather than discovering one.*

**Phase B — Boolean core (US1).** `boolean.ts` and the truth table: build an expression per
output by walking the netlist, modelling wired-OR and the undriven-net fallback. *Verify:
each of the four gate directions, the crossover, and a wired-OR pair.*

**Phase C — The oracle (US2).** `oracle.ts`: drive every input combination through the real
simulator, settle by stability window, observe via the rendered frame, diff against Phase B.
**This is the phase that addresses the motivating defect** and is worth landing before
anything about simplification.

**Phase D — Sequential (US5).** `sequential.ts`: Tarjan SCC, greedy feedback vertices,
next-state functions. Needed before the AX register — a register bit has memory — so in
practice C and D are used together for the defect.

**Phase E — Minimiser and cost (US3).** `minimise.ts`, `cost.ts`, with verification against
the original truth table built in.

**Phase F — Layout and replacement (US4).** `layout.ts`: expression to a `PixelBlock` of real
gates, offered through the existing floating paste. The largest single piece of work, and the
easiest to defer.

**Phase G — Interchange (US6)** and **Phase H — polish**.

A+B+C is the minimum that delivers the feature's stated purpose. E+F are the original
project's purpose and can follow.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Gate re-detection drifts from `detectGates` | A plausible but wrong netlist — the worst failure mode here | The builder asserts its count against `Circuit.gateCount` and refuses to return a netlist on disagreement (R1) |
| The crop changes the circuit being analysed | The user is answered about a different circuit than they asked about | Cut nets are reported explicitly, not silently promoted to inputs (FR-002) |
| A sweep freezes the page | Unusable on anything near the limit | Hard 16-input ceiling, measured at 12.2 s; progress and interruption above 12 (R4) |
| Simplification is wrong | Worse than no simplification, because it looks like progress | Every expression verified against the truth table before being offered; every layout compiled and re-analysed before commit (R10) |
| Timing-dependent circuits given a confident answer | Hides the very evidence the AX investigation needs | Non-convergence is a reported outcome, never a value (R8) |
| Structural output inference finds nothing | Silently reports that a circuit does nothing — observed in the reference project, 46 gates to zero | Inference is a suggestion; the user can mark outputs, and "no outputs found" is a warning (R7) |
