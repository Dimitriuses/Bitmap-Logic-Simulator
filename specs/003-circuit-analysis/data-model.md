# Phase 1 Data Model: Circuit Analysis

**Feature**: `003-circuit-analysis` | **Date**: 2026-09-23 | **Plan**: [plan.md](./plan.md)

Entities this feature adds. Signatures live in [contracts/](./contracts/). Nothing in
[001](../001-circuit-editor/data-model.md) or [002](../002-editor-workflow/data-model.md)
changes.

---

## Netlist

What a selection contains, in engine terms. Built by observation from a cropped `Circuit`.

| Field | Type | Meaning |
| --- | --- | --- |
| `nets` | `NetInfo[]` | Every net present in the crop |
| `gates` | `GateInfo[]` | Every inverter, as a source/destination net pair |
| `inputs` | `netId[]` | Nets no gate drives |
| `outputs` | `netId[]` | Nets the user marked, or the structural suggestion |
| `cut` | `netId[]` | Nets the selection boundary severed |

**Invariants**

- **N1 — The engine is the authority on connectivity.** Net labels come from
  `Circuit.wireAt`, never from a second union-find. There is no code path in which this
  feature can disagree with the simulator about which pixels form one wire.
- **N2 — The builder self-checks.** The number of gates it detects must equal the crop's
  `Circuit.gateCount`. On mismatch it returns no netlist and reports the discrepancy. A
  plausible-but-wrong netlist is the most damaging thing this feature could produce, and
  this is the check that makes that class of bug loud instead of silent.
- **N3 — Cut nets are reported, not absorbed.** A net severed by the boundary appears as an
  input *and* in `cut`, because the analysis is only valid relative to that boundary and the
  user has to be able to see where it was drawn.
- **N4 — Outputs are a suggestion until marked.** Structural inference ("driven, feeds
  nothing") is a starting point that is known to find nothing in real circuits (research
  R7), so `outputs` is user-overridable and an empty inference is a warning.
- **N5 — A net driven by several gates is their wired-OR.** That is how every non-inverter
  gate in this medium is built, so it is modelled, not approximated.
- **N6 — An undriven net is a free input**, holding whatever the user last set. This is the
  same fallback that makes click-to-drive work; treating it as a constant would fabricate a
  function the circuit does not compute.

---

## BooleanExpr

A boolean function over named nets. An immutable tree.

| Variant | Carries |
| --- | --- |
| `const` | `true` or `false` |
| `var` | net id |
| `not` | one child |
| `and` | children |
| `or` | children |

**Invariants**

- **B1 — Pure and side-effect free.** No DOM, no engine, no document. This is what lets the
  whole boolean layer be verified headlessly.
- **B2 — Structural equality is decidable by evaluation**, not by tree shape: two
  expressions are equal when they agree on every input combination. All equality claims in
  this feature are made that way.
- **B3 — Evaluation is total.** Every variable has a value in every row of a truth table, so
  evaluation cannot fail.

---

## TruthTable

| Field | Type | Meaning |
| --- | --- | --- |
| `inputs` | `netId[]` | Column order, fixed |
| `outputs` | `netId[]` | Column order, fixed |
| `rows` | `Row[]` | `2^inputs.length` entries |

Each `Row` carries the input combination, the output values, and a status: `settled`,
`nonConvergent`, or `timingDependent`.

**Invariants**

- **T1 — Complete.** Exactly `2^n` rows; no sampling, no shortcuts.
- **T2 — A row that did not settle carries no value.** Non-convergence is a status, never a
  zero. A ring oscillator has no truth table row, and saying it has one would hide exactly
  the evidence the AX investigation is after (research R8).
- **T3 — Bounded by construction.** `n ≤ 16`, enforced before any row is computed, because
  the refusal has to come before the freeze, not after it.
- **T4 — Column order is stable**, so two tables for the same selection can be compared row
  by row.

---

## Discrepancy

One input combination where the analysis and the simulator disagree. The output of US2.

| Field | Type | Meaning |
| --- | --- | --- |
| `inputs` | `boolean[]` | The combination that triggers it |
| `expected` | `boolean[]` | What the netlist says |
| `observed` | `boolean[]` | What the simulator did |
| `firstDivergentNet` | `netId \| null` | Where the two first differ, if it can be localised |

**Invariants**

- **D1 — Reproducible by hand.** A discrepancy that cannot be re-triggered from its own
  report is not a useful bug report; the input combination is mandatory.
- **D2 — Agreement is a result too.** An empty discrepancy list is reported explicitly as
  "the simulator matches the logic", because that is the more likely finding for the AX
  register and it must not arrive as silence (FR-011).
- **D3 — Localisation is best-effort.** `firstDivergentNet` narrows the search when the
  internal nets can be compared, and is null when they cannot. It is never guessed.

---

## Simplification

| Field | Type | Meaning |
| --- | --- | --- |
| `original` | `BooleanExpr` per output | As extracted |
| `minimised` | `BooleanExpr` per output | After Quine–McCluskey |
| `originalCost` | `number` | Inverters, as drawn |
| `minimisedCost` | `number` | Inverters, as minimised |
| `verified` | `boolean` | Checked against the original truth table |

**Invariants**

- **S1 — Never offered unverified.** `verified` must be true before a simplification is
  shown at all. A wrong simplifier is worse than none, because its output looks like
  progress (research R10).
- **S2 — Cost is in inverters, with wired-OR free.** That is what this medium charges; a
  literal count would be a different and less useful number.
- **S3 — "Minimal" is not claimed.** Quine–McCluskey minimises sum-of-products; the number
  reported is inverter cost. These are different objectives, and the UI says so rather than
  implying optimality (research R5).
- **S4 — No improvement is a valid answer**, stated as such rather than dressed up as an
  equal-cost alternative.

---

## SequentialModel

Present only when the gate graph has feedback.

| Field | Type | Meaning |
| --- | --- | --- |
| `stateNets` | `netId[]` | Nets cut to break feedback |
| `nextState` | `BooleanExpr` per state net | In terms of inputs and current state |
| `outputs` | `BooleanExpr` per output | In terms of inputs and current state |

**Invariants**

- **Q1 — Cutting makes it acyclic.** After removing `stateNets` the gate graph has no
  cycles; this is checked, not assumed.
- **Q2 — State nets are locatable.** Each carries a canvas position, because "net 47 is your
  state variable" is useless if the user cannot find net 47.
- **Q3 — Small, not minimal.** The feedback vertex set is chosen greedily per strongly
  connected component. Minimum FVS is NP-hard and not worth it: one extra state variable
  costs one extra column.
- **Q4 — The oracle adapts.** For a sequential selection the simulator check sweeps
  (inputs × current state) and compares next state, not a combinational output.

---

## AnalysisResult

Everything produced for one selection.

| Field | Type | Meaning |
| --- | --- | --- |
| `netlist` | `Netlist` | |
| `kind` | `'combinational' \| 'sequential'` | |
| `table` | `TruthTable \| null` | |
| `sequential` | `SequentialModel \| null` | |
| `discrepancies` | `Discrepancy[]` | Empty means agreement |
| `simplification` | `Simplification \| null` | |
| `stale` | `boolean` | The document changed underneath it |

**Invariants**

- **A1 — Stale results are marked, never silently shown.** Any edit to the document
  invalidates the result; describing a circuit that no longer exists is worse than showing
  nothing (FR-020).
- **A2 — A result names the selection it describes**, so it cannot be read against the wrong
  region.
- **A3 — Partial results are legitimate.** Extraction can succeed while the truth table is
  refused for size; the entity carries nulls rather than failing whole.

---

## Relationships

```
Selection ──crop──▶ Circuit (sub) ──▶ Netlist ──┬──▶ BooleanExpr ──▶ TruthTable
                         │                      │                        │
                         │                      └──▶ SequentialModel      │
                         │                                                ▼
                         └──────── oracle sweep ──────────────────▶ Discrepancy[]
                                                                          │
                              TruthTable ──▶ minimise ──▶ Simplification ─┘
                                                   │
                                                   └──▶ layout ──▶ PixelBlock ──▶ paste
```

One `AnalysisResult` at a time. It belongs to a selection and dies with the document.

---

## Changes to existing entities

| Entity | Change |
| --- | --- |
| `Circuit` ([src/simulator.ts](../../src/simulator.ts)) | **None.** Read through `wireAt`, `gateCount`, `wireCount`, `setStateAt`, `simulate` and `render` — all already public. |
| `CircuitDocument` ([src/document.ts](../../src/document.ts)) | May gain a convenience for producing an `ImageData` crop; `readBlock` already produces the pixels. |
| `Editor` ([src/editor.ts](../../src/editor.ts)) | Gains the analysis invocation and the set of user-marked output nets. |
| `PixelBlock` ([src/block.ts](../../src/block.ts)) | Unchanged — a generated layout is an ordinary block and pastes like any other. |
