---

description: "Task list for the Circuit Analysis feature"
---

# Tasks: Circuit Analysis

**Input**: Design documents from `/specs/003-circuit-analysis/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: No test framework, by constitution. Verification tasks map to numbered scenarios
in [quickstart.md](./quickstart.md). An unusually large share of this feature is pure —
netlist extraction, boolean algebra, the minimiser, the graph algorithms — so those are
verified headlessly by `npm run verify`, and the browser is reserved for the panel and the
paste.

**Organization**: Grouped by user story, in the spec's priority order. See *Implementation
Strategy* for why the recommended **delivery** order differs — the motivating defect needs
US5, which the spec ranks P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no incomplete dependency
- **[Story]**: US1–US6
- Every task names an exact file path

---

## Phase 1: Setup

- [ ] T001 Add analysis fixtures and probe helpers to `scripts/verify/harness.mjs`: each of the four gate directions with wire stubs, a crossover, a pair of gates driving one net, a latch and a ring oscillator, each returning the image plus the probe coordinates, and a helper that reads a net's state from a rendered frame.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The netlist and the boolean type. Every story consumes both.

**⚠️ CRITICAL**: No user story can begin until this phase is complete, and T008 is what makes
it trustworthy.

- [ ] T002 [P] Declare `NetId`, `NetInfo`, `GateInfo`, `Netlist` and `ExtractResult` in `src/netlist.ts` per [contracts/netlist.md](./contracts/netlist.md).
- [ ] T003 [P] Create `src/boolean.ts` with the `BooleanExpr` union and a total `evaluate` over an environment (BA-1, BA-3).
- [ ] T004 [P] Add a source-pixel crop helper to `src/document.ts` returning an `ImageData` for a rect — read from `pixels`, never from `Circuit.frame`, whose inactive wires are masked below the wire threshold (NL-9).
- [ ] T005 Implement `extractNetlist` in `src/netlist.ts`: net identity from `Circuit.wireAt`, gates re-detected mirroring `detectGates` including its flat-index behaviour at row ends (NL-1, NL-2; depends on T002).
- [ ] T006 Add the self-check to `src/netlist.ts`: the detected gate count must equal `Circuit.gateCount`, and on mismatch return `ok: false` naming both counts rather than a netlist (NL-3).
- [ ] T007 Classify nets in `src/netlist.ts` — inputs as nets no gate drives, a structural output suggestion, and cut nets reported separately — and attach a probe pixel to every net (NL-4 … NL-7).
- [ ] T008 Verify Scenario 1 of `specs/003-circuit-analysis/quickstart.md` via a new `scripts/verify/netlist.mjs`: all bundled schematics agree with the engine on gate and net counts, each gate direction resolves the right source and destination, a crossover yields no gate, a crop bisecting a gate reports it as cut, and a deliberately corrupted detector causes a refusal (depends on T005–T007).

**Checkpoint**: The netlist is trustworthy, and known to refuse when it is not.

---

## Phase 3: User Story 1 - See what a piece of circuit computes (Priority: P1) 🎯 MVP

**Goal**: Select a region and get its inputs, outputs and truth table.

**Independent Test**: Select a region containing a known gate arrangement; the reported truth
table matches the gate's definition.

- [ ] T009 [US1] Implement `expressionFor` in `src/boolean.ts`: every gate an inverter, a net with several drivers their wired-OR, an undriven net a free variable, and a cyclic netlist a thrown error rather than infinite expansion (BA-2 … BA-5).
- [ ] T010 [US1] Build truth tables in `src/boolean.ts`, checking `MAX_INPUTS` before any row is computed so the refusal arrives instead of the freeze (BA-6, T1, T3).
- [ ] T011 [US1] Create `src/analysis.ts` with `analyse()`: crop, extract, classify, build, assemble — orchestration only, with refusals that carry the input count and the limit (AN-1 … AN-3).
- [ ] T012 [P] [US1] Add the analysis panel to `index.html` and its handles to `src/dom.ts`: input, output and cut-net lists, the truth table, a result area and the action buttons.
- [ ] T013 [P] [US1] Style the panel, the truth table and its warning states in `css/style.css`.
- [ ] T014 [US1] Wire "Analyse selection" through `src/editor.ts` and `src/ui.ts`, disabled when there is no selection (FR-001; depends on T011, T012).
- [ ] T015 [US1] Let the user mark and unmark output nets in `src/editor.ts`, seeded from the structural suggestion and warning when that suggestion is empty (FR-003, NL-5).
- [ ] T016 [US1] Mark a displayed result stale on any document edit in `src/ui.ts`, rather than letting it describe a circuit that no longer exists (A1, FR-020).
- [ ] T017 [US1] Verify Scenario 2 of `specs/003-circuit-analysis/quickstart.md` via `scripts/verify/boolean.mjs`: each gate direction's truth table, a crossover as two unrelated nets, a wired-OR pair, an undriven net as a free input, and a gateless region reported as pure wiring.

**Checkpoint**: The tool can answer "what does this compute". Demonstrable on its own.

---

## Phase 4: User Story 2 - Settle whether the circuit or the simulator is wrong (Priority: P1)

**Goal**: Drive the real simulator through every input combination and diff it against the
analysis.

**Independent Test**: A single inverter reports agreement; a deliberately corrupted expected
table reports the disagreeing row with reproducing inputs.

- [ ] T018 [US2] Create `src/oracle.ts` with `sweep()`, driving input nets via `Circuit.setStateAt` at their probe pixels and re-asserting every cycle (OR-1, OR-4; depends on T007, T010).
- [ ] T019 [US2] Implement settle-by-stability in `src/oracle.ts`: step until the output vector holds for a window, and report `nonConvergent` rather than sampling a circuit that never settles (OR-2, OR-3, T2).
- [ ] T020 [US2] Read net states in `src/oracle.ts` from the rendered frame at each net's probe pixel, where a lit wire keeps its source colour and an unlit one is masked to `& 0x7F` (OR-1).
- [ ] T021 [US2] Diff observed against analytic in `src/oracle.ts`, emitting `Discrepancy` records carrying the input combination, expected and observed values, and a best-effort first divergent net (OR-5, D1, D3).
- [ ] T022 [US2] Add the repeatability check in `src/oracle.ts`: sweep each row twice and mark disagreement `timingDependent`, since the engine's ramp carries deliberate jitter (OR-9).
- [ ] T023 [US2] Add progress reporting and abort to `src/oracle.ts` and surface them in `src/ui.ts` above a few thousand rows (OR-7).
- [ ] T024 [US2] Report agreement explicitly in the panel in `src/ui.ts` — "the simulator matches the logic" is the likely finding and must not arrive as silence (OR-6, D2, FR-011).
- [ ] T025 [US2] Verify Scenario 3 of `specs/003-circuit-analysis/quickstart.md` via `scripts/verify/oracle.mjs`: known circuits report zero discrepancies and say so, a corrupted expected table produces a located discrepancy, and a ring oscillator reports every row non-convergent with no values.

**Checkpoint**: The differential oracle works. This is the capability the feature was asked for.

---

## Phase 5: User Story 3 - Find out whether it could be smaller (Priority: P2)

**Goal**: A minimised expression per output, costed in inverters.

**Independent Test**: A doubled inverter pair is reported reducible, with both costs shown.

- [ ] T026 [P] [US3] Create `src/minimise.ts` and generate prime implicants by repeated adjacency merging over a fixed variable order (MN-1, MN-5).
- [ ] T027 [US3] Cover the implicant chart in `src/minimise.ts` — essentials first, then greedy — handling all-minterms and no-minterms as `const` rather than a degenerate cover (MN-1, MN-4).
- [ ] T028 [US3] Add the self-check to `src/minimise.ts`: the minimised expression must agree with the input minterms on all rows before it is returned (MN-3).
- [ ] T029 [P] [US3] Create `src/cost.ts` with `inverterCost` and `netlistCost` in the NOT + wired-OR basis, where OR is free and AND and shared positive literals are not (CO-1, CO-2).
- [ ] T030 [US3] Produce a `Simplification` in `src/analysis.ts`, verified against the original truth table before it is returned, carrying both the original and minimised cost (S1, CO-3).
- [ ] T031 [US3] Present the result in `src/ui.ts` as **minimised**, never "optimal" — the minimiser optimises sum-of-products while the number shown is inverter cost — and report no-improvement plainly (S3, S4, CO-4).
- [ ] T032 [US3] Verify Scenario 5 of `specs/003-circuit-analysis/quickstart.md` via `scripts/verify/minimise.mjs`: random functions of 2–10 variables agree on all rows, constants come back as constants, an already-minimal function claims no improvement, and `inverterCost` is 1 for each gate and 2 for a wired-OR pair.

---

## Phase 6: User Story 4 - Put the simplified circuit back (Priority: P2)

**Goal**: Lay out the minimised expression and offer it as a floating paste.

**Independent Test**: Commit a replacement and confirm the region re-analyses to the original
truth table.

- [ ] T033 [US4] Create `src/layout.ts`, placing inverters from the literal patterns in `src/stamps.ts` and routing with `walkConnected` from `src/geometry.ts` (LY-1, LY-2).
- [ ] T034 [US4] Emit the layout as a `PixelBlock` in `src/layout.ts`, deterministically for a given expression (LY-3, LY-5), failing with a reason rather than emitting something malformed (LY-6).
- [ ] T035 [US4] Compile and re-analyse the generated block inside `src/layout.ts` before returning success, comparing its truth table against the original — a layout that fails this is not offered (LY-4, FR-017, FR-018).
- [ ] T036 [US4] Offer an accepted layout through the existing floating-paste mechanism in `src/editor.ts`, so it is positioned, committed and undone like any other paste (FR-016).
- [ ] T037 [US4] Verify Scenario 6 of `specs/003-circuit-analysis/quickstart.md`: the replacement commits as one undo step, re-analyses to the same truth table, and its compiled gate count matches what the layout predicted.

---

## Phase 7: User Story 5 - Analyse circuits that have memory (Priority: P3)

**Goal**: Report a selection with feedback as sequential, with state variables and next-state
functions.

**Independent Test**: A known latch is reported sequential with exactly one state variable.

**Note**: ranked P3 in the spec, but the AX register is sequential — see *Implementation
Strategy*.

- [ ] T038 [P] [US5] Create `src/sequential.ts` with Tarjan strongly connected components over the gate graph, so the common combinational case costs one linear pass and cycles are never enumerated (SQ-1).
- [ ] T039 [US5] Choose feedback nets greedily per component in `src/sequential.ts` and assert the graph is acyclic after the cut (SQ-2, SQ-3, SQ-4, Q1).
- [ ] T040 [US5] Build next-state and output functions in `src/sequential.ts` in terms of inputs and current state, each state net carrying its probe pixel so it can be found on the canvas (SQ-5, Q2, FR-008).
- [ ] T041 [US5] Detect feedback in `src/analysis.ts` and route to the sequential path, reporting the selection's kind rather than analysing it as combinational (FR-007).
- [ ] T042 [US5] Extend `sweep()` in `src/oracle.ts` to sweep inputs × current state and compare next state rather than a combinational output (OR-8, Q4).
- [ ] T043 [US5] Verify Scenario 4 of `specs/003-circuit-analysis/quickstart.md`: a latch is sequential with one locatable state variable whose next-state function shows the hold behaviour, and a combinational selection finds no non-trivial component.

---

## Phase 8: User Story 6 - Exchange netlists with the Python tool (Priority: P3)

**Goal**: Export a selection's netlist as JSON and read one back.

**Independent Test**: An exported netlist re-imports with identical nets, gates and I/O.

- [ ] T044 [P] [US6] Create `src/netlist-json.ts` with export in LogicShorter's `*_raw.json` shape — `nets`, `gates` with `in_net`/`out_net`, and an `io` block (IX-1).
- [ ] T045 [US6] Implement import in `src/netlist-json.ts`, validating the shape and round-tripping losslessly (IX-2).
- [ ] T046 [US6] Add export and import controls to `index.html`, `src/dom.ts` and `src/ui.ts`, noting in the UI that imported results are suggestions to verify rather than ground truth (IX-3).
- [ ] T047 [US6] Verify Scenario 7 of `specs/003-circuit-analysis/quickstart.md`: nets, gates and I/O classification survive a round-trip unchanged.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T048 [P] Document analysis in `README.md`: what it answers, how to select and mark outputs, the input limit, and that it models steady-state logic only.
- [ ] T049 [P] Update `CLAUDE.md`: that `wireAt` is the authority on connectivity and is never re-derived, that the netlist self-checks against `gateCount` and refuses on mismatch, that a crop must come from `doc.pixels` and never from `Circuit.frame`, and that results are "minimised" and never "optimal".
- [ ] T050 [P] Register the new suites in the `verify` script in `package.json`: `netlist.mjs`, `boolean.mjs`, `minimise.mjs`, `oracle.mjs`.
- [ ] T051 Verify Scenario 8 of `specs/003-circuit-analysis/quickstart.md`: a 16-input selection completes with progress and can be stopped, a larger one is refused with the count before any work starts, and an edit marks a displayed result stale.
- [ ] T052 Verify Scenario 9 of `specs/003-circuit-analysis/quickstart.md` — the AX register in `projects/CPU/4bitCPU.png` — and record in this file which of the three outcomes occurred: a reported simulator discrepancy with reproducing inputs, agreement meaning the circuit is at fault, or non-convergent rows pointing at timing (SC-011).
- [ ] T053 Verify Scenario 10 of `specs/003-circuit-analysis/quickstart.md`: `npm run verify` fully green, and the 001 and 002 browser suites still passing on Chrome, Edge, Firefox and WebKit.
- [ ] T054 Re-check the constitution: `npm run build` and `npx tsc --noEmit` clean, `package.json` dependencies still empty, and `src/simulator.ts` untouched.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → everything else.
- **US1 (3)** needs Phase 2 in full.
- **US2 (4)** needs US1's truth table (T010) and the netlist's probe pixels (T007).
- **US3 (5)** needs US1's truth table; independent of US2.
- **US4 (6)** needs US3's minimised expression.
- **US5 (7)** needs Phase 2; extends US2's sweep in T042.
- **US6 (8)** needs only Phase 2.
- **Polish (9)** last.

### User Story Dependencies

- **US1 (P1)**: Phase 2 only. The foundation everything else reads.
- **US2 (P1)**: US1. The analytic table is what it diffs against.
- **US3 (P2)**: US1. Disjoint from US2, so the two can proceed in parallel.
- **US4 (P2)**: US3. The largest single piece of work in the feature.
- **US5 (P3)**: Phase 2, plus US2 for T042. Everything else in it is self-contained.
- **US6 (P3)**: Phase 2 only. Fully independent of every other story.

### Parallel Opportunities

- **Phase 2**: T002, T003 and T004 are three separate files with no interdependencies.
- **US1**: T012 and T013 alongside T009/T010.
- **US3**: T026 and T029 together.
- **Across stories**: once US1 lands, US3, US5 and US6 touch disjoint files from US2 and from
  each other — `minimise.ts`/`cost.ts`, `sequential.ts`, `netlist-json.ts` — so they can be
  staffed in parallel.

---

## Parallel Example: Phase 2

```bash
# Three independent files, no shared state:
Task: "Declare the netlist types in src/netlist.ts"
Task: "Create src/boolean.ts with BooleanExpr and evaluate"
Task: "Add a source-pixel crop helper to src/document.ts"

# Then sequentially, because they all edit src/netlist.ts:
Task: "Implement extractNetlist"
Task: "Add the gate-count self-check"
Task: "Classify inputs, outputs and cut nets"
Task: "Verify against every bundled schematic"
```

---

## Implementation Strategy

### MVP scope

Phases 1–4: setup, the netlist and boolean foundation, US1 and US2. That is a tool that can
tell you what a circuit computes and whether the simulator agrees — the feature's stated
purpose, and everything needed to start on the reported defect for a *combinational*
selection.

### Recommended delivery order differs from the spec's priorities

The spec ranks US5 (sequential) as P3 because a combinational-only tool is already useful.
But **the AX register is a register — it has memory** — so the motivating defect needs US1,
US2 *and* US5. If closing that investigation is the goal, build Phase 7 immediately after
Phase 4 and leave US3 and US4 until afterwards:

1. Phases 1–2 → netlist, proven against every schematic.
2. US1 → truth tables. **Demonstrable.**
3. US2 → the oracle. **The capability that was asked for.**
4. **US5** → sequential, which is what makes the AX register analysable.
5. → run T052 and record the outcome.
6. US3, US4 → minimisation and replacement, the original project's purpose.
7. US6, polish.

### Risk-ordered notes

- **T006 is the most important task in the feature.** Everything downstream — truth tables,
  discrepancies, conclusions about the simulator itself — inherits its correctness from the
  netlist. Without the self-check, a divergence from `detectGates` would produce confident
  wrong conclusions about the engine, which is the exact opposite of what this tool is for.
  T008's corrupted-detector case is what proves the check fires.
- **T004 carries a known hazard.** Cropping from `Circuit.frame` instead of `doc.pixels`
  would analyse a circuit with most of its wiring missing, because inactive wires are masked
  below the wire threshold. This is the same trap `CLAUDE.md` flags for the PNG encoder, in
  a new place.
- **T035 is what stands between a helpful tool and a destructive one.** Layout is the only
  module that writes a circuit; everything else is read-only analysis whose worst failure is
  a wrong report.
- **T019 must not "helpfully" settle an oscillator.** Reporting a sampled value for a
  circuit that never stabilises would hide precisely the evidence the AX investigation is
  looking for.

---

## Notes

- `[P]` means a different file with no incomplete dependency.
- `src/simulator.ts` is not modified by any task here. It is read through `wireAt`,
  `gateCount`, `wireCount`, `setStateAt`, `simulate` and `render`, all already public.
- Commit per task or logical group; each checkpoint is a safe stopping point.
