---

description: "Task list for the Analysis Mode feature"
---

# Tasks: Analysis Mode

**Input**: Design documents from `/specs/004-analysis-mode/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: No test framework, by constitution. Verification tasks map to numbered scenarios in
[quickstart.md](./quickstart.md). The plan's pure/impure split is what makes this tractable:
everything except `schematic-view.ts` and the UI files is a pure function of a `Netlist`, so
most of this feature is verified headlessly by `npm run verify` and the browser is reserved for
the mode, the canvas and the panel.

**Organization**: grouped by user story. The **delivery** order differs from the spec's
priorities — see *Implementation Strategy* for why US4 is built before US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no incomplete dependency
- **[Story]**: US1–US5
- Every task names an exact file path

---

## Phase 1: Setup

- [X] T001 Add analysis-mode fixtures to `scripts/verify/harness.mjs`: a two-inverter latch that settles to one state, a bistable six-inverter loop mirroring the 4-bit CPU's, a three-inverter ring oscillator, a NAND pair (two inverters into one net), an OR pattern (two NOT-nets into a NAND), a shared-fanout net that must NOT be absorbed, and a four-bit register sharing one write line — each returning the image plus probe coordinates.
- [X] T002 [P] Add a deterministic graph fixture builder to `scripts/verify/harness.mjs` that constructs `Netlist`-shaped objects directly, so layout and recognition can be tested without drawing pixels for every case.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the third mode. Every story is reached through it, and US1 *is* this phase's
user-visible half, so this is the only phase that both blocks everything and ships something.

**⚠️ CRITICAL**: T004 and T005 must land together. A mode whose key table is not verified is a
mode that silently edits.

- [X] T003 Extend `EditorMode` to `'simulate' | 'edit' | 'analysis'` in `src/editor.ts`, and extend `InputContext.mode` to match in `src/keymap.ts` (MO-1).
- [X] T004 Guard the editing actions in `src/keymap.ts`: `copy`, `cut`, `clearRegion`, `paste`, `commit` and `cancelPaste` resolve to `null` when `ctx.mode === 'analysis'` — a change to existing guards, several of which are currently unconditional (MO-3).
- [X] T005 Grow the exhaustive precedence table in `scripts/verify/keymap.mjs` to cover three modes, and assert that no editing action is reachable in analysis mode for any combination of floating/selection/key (MO-7, Scenario 1).
- [X] T006 Persist the third mode in `src/settings.ts` so the app reopens in the mode it was left in, and tolerate an unknown stored value by falling back to simulate.

**Checkpoint**: the mode exists and provably cannot write.

---

## Phase 3: User Story 1 - A mode that cannot change the circuit (Priority: P1) 🎯 MVP

**Goal**: a place to explore a working circuit with no risk of changing it.

**Independent Test**: enter analysis mode, attempt every editing gesture and shortcut; the
unsaved-changes flag and undo depth never move.

- [X] T007 [US1] Route pointer events for analysis mode in `src/editor.ts`: selection drag only, no tool dispatch, no stroke begun on either button (MO-2).
- [X] T008 [US1] Block floating pastes in analysis mode in `src/editor.ts` and `src/clipboard.ts`: entering the mode with one pending requires it committed or cancelled first (MO-5, edge case).
- [X] T009 [P] [US1] Add the three-way mode control and an analysis toolbar to `index.html`, with handles in `src/dom.ts` — analysis tools only, no drawing tool, colour, bus width or rotation control (MO-8).
- [X] T010 [P] [US1] Style the mode control and analysis toolbar in `css/style.css`.
- [X] T011 [US1] Wire mode switching in `src/ui.ts`: pause on entry, restore the previous run state on exit, preserve the selection across every transition (MO-4, MO-6; depends on T003, T009).
- [X] T012 [US1] Apply the no-focus rule to every analysis-mode control in `src/ui.ts` — `preventDefault` on `mousedown`, as the editor toolbar and status bar already do (MO-9).
- [X] T013 [US1] Move the analysis entry point out of edit mode: remove the Edit-mode button from `index.html` and retarget the `A` key and panel opening to analysis mode in `src/ui.ts` and `src/analysis-panel.ts` (FR-008).
- [X] T014 [US1] Verify Scenario 1 of [quickstart.md](./quickstart.md) in the browser: exercise every key in the key table and every pointer gesture in analysis mode, asserting `canUndo`, `canRedo` and the dirty flag are unchanged throughout (SC-001, SC-010).

**Checkpoint**: US1 is complete and demonstrable on its own. 16/16 browser checks on Chromium,
Edge, Firefox and WebKit; `npm run verify` green with the key table at 29 checks.

**Two things found while building this phase, recorded rather than smoothed over:**

1. **`ui.ts` conflated "is editing" with "owns the pointer".** `handlePointerMove` was gated on
   `mode === 'edit'`, so in analysis mode a drag never updated and a selection never grew past
   its first pixel. Seven call sites had the same conflation, including the overlay, which would
   not have drawn the selection either. Fixed by introducing `ownsPointer(mode)` in
   `src/editor.ts` and using it wherever the question is about the pointer rather than about
   editing. The read-only assertions passed throughout — it was the mode's *useful* half that
   was broken, not its safe half.

2. **Backspace navigated back in WebKit**, to `about:blank`, losing the page and any unsaved
   work. Edit mode maps Backspace to `clearRegion` and suppresses the default as a side effect
   of handling it; making the key inert in analysis mode let the browser's legacy behaviour
   through. `src/ui.ts` now calls `preventDefault` for Backspace whenever the user is not
   typing, whether or not the app does anything with it — the app owns that key in every mode.
   Found only because the exhaustive gesture sweep ran on all four browsers.

---

## Phase 4: User Story 2 - Read the selection as a schematic (Priority: P1)

**Goal**: turn a bitmap into a circuit diagram. The headline capability, and the one with no
input-count limit.

**Independent Test**: select a known gate arrangement; the diagram contains exactly the gates and
connections the netlist reports, and the same selection drawn twice is identical.

### Recognition (pure)

- [X] T015 [P] [US2] Create `src/gates.ts` with the base rule: a net driven by gates with sources `s₁…sₖ` is `NAND(s₁…sₖ)`, with `NOT` as the k=1 case (GR-1).
- [X] T016 [US2] Add the three absorption rules to `src/gates.ts` — NAND of NOT-nets → OR, NOT of a NAND → AND, NOT of an OR → NOR — each requiring the absorbed net to have fan-out exactly 1 (GR-2, GR-3).
- [X] T017 [US2] Add the conservation invariant to `src/gates.ts`: every gate is drawn or absorbed exactly once, asserted before a recognition result is returned (GR-4).
- [X] T018 [US2] Add per-symbol verification to `src/gates.ts`: evaluate each recognised symbol against the expression of the gates it absorbed over all `2^|inputs|` combinations, and discard any symbol that disagrees in favour of faithful gates (GR-5).
- [X] T019 [US2] Verify Scenario 2 of [quickstart.md](./quickstart.md) via a new `scripts/verify/gates.mjs`: conservation holds on all 22 bundled schematics, each of R2/R3/R4 is exercised, a fan-out-2 net is not absorbed, and **a deliberately corrupted absorption rule is caught and rejected rather than drawn** (depends on T015–T018).

### Layout (pure)

- [X] T020 [P] [US2] Create `src/graph-layout.ts` with cycle breaking, reusing `feedbackNets()` from `src/sequential.ts` so that a reversed edge and a feedback edge are the same fact (GL-2), and assert acyclicity afterwards (GL-3).
- [X] T021 [US2] Add longest-path layer assignment to `src/graph-layout.ts`, placing inputs at layer 0 and outputs at the deepest layer (GL-4).
- [X] T022 [US2] Add dummy-node insertion to `src/graph-layout.ts` so every edge spans adjacent layers and long edges can bend.
- [X] T023 [US2] Add crossing reduction to `src/graph-layout.ts` by iterated median ordering, with explicitly stable sorts and every tie broken by node id (GL-5).
- [X] T024 [US2] Add coordinate assignment to `src/graph-layout.ts`: even spacing within a layer, then relaxation toward neighbour medians to straighten long runs.
- [X] T025 [US2] Verify Scenario 3 of [quickstart.md](./quickstart.md) via a new `scripts/verify/graph-layout.mjs`: acyclicity after breaking, correct layering, **byte-identical coordinates when the same graph is laid out twice**, and a 250-node graph inside the time budget (SC-002; depends on T020–T024).

### The model (pure)

- [X] T026 [US2] Create `src/schematic.ts` building a `Schematic` from a `Netlist` at both levels, with symbol and edge counts equal to the netlist's at faithful level (SM-1) and both levels from one analysis (SM-2).
- [X] T027 [US2] Carry the two-way pixel correspondence in `src/schematic.ts`: every symbol and edge can name its pixels, every net and gate can name its symbol (SM-3).
- [X] T028 [US2] Handle crossovers as crossing-not-joining and cut nets as entering from the selection boundary, in `src/schematic.ts` (SM-4, SM-5).
- [X] T029 [US2] Verify Scenario 4 of [quickstart.md](./quickstart.md) via a new `scripts/verify/schematic.mjs`: counts match the netlist on every bundled schematic, and the 241-gate block produces a diagram without refusing on size (SC-003, SC-009).

### The stage (browser)

- [X] T030 [P] [US2] Create `src/schematic-view.ts` drawing a `Schematic` to canvas with its own `Viewport` instance, symbols per gate kind, and feedback edges visually distinguished (SV-1, FR-013).
- [X] T031 [US2] Add geometry hit testing to `src/schematic-view.ts` — against laid-out shapes, never pixels (SV-2).
- [X] T032 [P] [US2] Add the Pixels/Schematic view switch and the recognised/faithful level switch to `index.html`, `src/dom.ts` and `css/style.css` (FR-017).
- [X] T033 [US2] Wire the view switch in `src/ui.ts`, preserving each view's zoom and pan across switches (FR-017, SC-011; depends on T030, T032).
- [X] T034 [US2] Implement cross-highlighting in `src/ui.ts` and `src/renderer.ts`: pointing at a symbol highlights its pixels and the reverse (SV-3, FR-018).
- [X] T035 [US2] Mark a displayed schematic stale on any document change in `src/ui.ts` (SV-5, FR-037).
- [X] T036 [US2] Verify Scenario 5 of [quickstart.md](./quickstart.md) in the browser: a 250-gate selection draws inside 2 s, feedback is distinguishable, cameras survive the switch, the recognised view uses fewer symbols than the faithful one, and an edit marks it stale (SC-002, SC-005, SC-011, SC-003c).

**Checkpoint**: a circuit can be read as a circuit. `gates` 30/30, `graph-layout` 38/38,
`schematic` 51/51; 19/19 browser checks on Chromium, Edge, Firefox and WebKit.

**Numbers worth keeping**: across all 22 bundled schematics, recognition accounts for **96,932
gates** — every one exactly once — and draws them as **40,995 symbols** instead of 96,932. The
4-bit CPU's 241-gate block becomes **129 symbols**, laid out in **2 ms**; a 250-node graph lays
out in **7 ms** against a 2 s budget.

**Five defects found while building this phase, all by the verification rather than by eye:**

1. **Conservation caught double-counted gates.** Restoring a rejected fold un-hid nets the
   ascending sweep had not yet reached, so they were emitted twice — once by the restore and
   once when the sweep arrived. `recognise()` refused rather than returning a wrong diagram,
   which is the check working; the fix was an explicit `emitted` set.
2. **Reversing a self-loop leaves a self-loop.** `1 -> 1` reversed is `1 -> 1`, so cycle
   breaking never terminated the graph. Self-loops are now excluded from layering and drawn as
   a visible loop beside the node.
3. **A same-layer edge spun the dummy-insertion loop forever** — `step` was computed as 1 when
   `from` and `to` share a layer, so the loop never reached its end. It surfaced as
   `RangeError: Map maximum size exceeded`.
4. **The faithful view disagreed with its own contract.** It collapsed a net's k drivers into
   one NAND, which is already a recognition step — FR-011a asks for one symbol per *engine
   gate*, with the wired-OR drawn as a junction. The contract was right; the code was changed.
   This is why the recognised/faithful ratio is now 40,995 vs 96,932 rather than 40,995 vs
   44,355.
5. **Two layout bugs in the browser.** `#analysis-toolbar` sat in normal flow where `#toolbar`
   floats, pushing the canvas down; and the schematic canvas overlaid the whole stage,
   swallowing toolbar clicks. Both now mirror their pixel-view counterparts. A third, related:
   `display: block` beats the `hidden` attribute, so both canvases needed an explicit
   `[hidden] { display: none }` — the same trap the status bar readouts hit.

**One deferred-work note**: `fit()` needs the canvas's real size, and a hidden canvas measures
zero — which placed the first diagram off screen at a 1x1-viewport zoom. Fitting is now
deferred to the moment the view is actually shown.

---

## Phase 5: User Story 4 - Understand circuits that remember (Priority: P2)

**Goal**: report storage as storage, and say when its power-on state is undefined.

**Note**: ranked P2 in the spec but built here, ahead of US3 — this is the motivating defect and
it needs neither the schematic nor labels. See *Implementation Strategy*.

**Independent Test**: a latch is reported as one storage element with defined hold behaviour; the
4-bit CPU's six-inverter loop is reported as storage whose power-on state is undefined.

- [ ] T037 [P] [US4] Create `src/storage-elements.ts` identifying candidate groups from the non-trivial strongly connected components already computed by `src/sequential.ts`.
- [ ] T038 [US4] Enumerate rest states **per group** in `src/storage-elements.ts` — `2^|state|` per group, never across the selection — and classify a group as storage only when it has more than one (ST-1, ST-2, ST-3).
- [ ] T039 [US4] Report each element's holding nets and writing nets, and group elements that share control signals, in `src/storage-elements.ts` (ST-4, FR-032).
- [ ] T040 [US4] Implement power-on sampling in `src/storage-elements.ts`: 20 cold starts using whole-frame quiescence, classified as `defined` only on unanimity, `undefined` with a distribution otherwise, and never-settling counted separately with no held value (PO-1, PO-2, PO-3).
- [ ] T041 [US4] Carry the start count into every power-on finding in `src/storage-elements.ts`, so results read "defined across 20 starts" and never "defined" (PO-4, FR-029b).
- [ ] T042 [US4] Keep "holds correctly" and "starts correctly" as separate findings in `src/analysis.ts`, so a pass on the existing sequential sweep cannot imply a pass on power-on (PO-5, FR-031).
- [ ] T043 [US4] Present storage elements and power-on findings in `src/analysis-panel.ts`, stating an undefined power-on state plainly rather than as a footnote (FR-028).
- [ ] T044 [US4] Verify Scenarios 6 and 7 of [quickstart.md](./quickstart.md) via a new `scripts/verify/storage-elements.mjs`: a latch is storage, a single-rest-state loop is not, a four-bit register reports as grouped bits, and **the 4-bit CPU's six-inverter loop reports an undefined power-on state across 20 starts while simultaneously passing the 003 behavioural sweep** (SC-007).

**Checkpoint**: the question that started this investigation is answerable in the app.

---

## Phase 6: User Story 3 - Name what you are looking at (Priority: P2)

**Goal**: names, used everywhere, that survive editing the circuit.

**Independent Test**: name a net, then confirm the name replaces its coordinates in every view
that mentions it.

- [ ] T045 [P] [US3] Create `src/labels.ts` with labels anchored to a pixel coordinate rather than a net id, and resolution that asks the compiled circuit which net occupies the anchor (LB-1, LB-2).
- [ ] T046 [US3] Report a label whose anchor is no longer wire as **unresolved** in `src/labels.ts` — kept and shown, never deleted and never reattached to a nearby net (LB-3, FR-025).
- [ ] T047 [US3] Add a single naming function in `src/labels.ts` that every view calls, so a name replaces the default identifier in lists, schematic, expressions, tables and discrepancies (LB-4, FR-022).
- [ ] T048 [US3] Implement the browser working copy in `src/labels.ts`, keyed to the circuit, so names survive a reload without an explicit save (FR-024a).
- [ ] T049 [US3] Implement sidecar serialisation in `src/labels.ts` in the `bitmap-logic-labels` shape, refusing malformed input with a reason rather than partially reading it (LB-8).
- [ ] T050 [US3] Implement sidecar save and load in `src/fileHandler.ts` via a save picker with a suggested name, falling back to download — **not** a silent sibling write, which a file handle cannot do (LB-7).
- [ ] T051 [US3] Detect divergence between the sidecar and the working copy in `src/labels.ts` and prompt a choice in `src/ui.ts` rather than letting either win silently (LB-6, FR-024b).
- [ ] T052 [US3] Add the netlist list with grouped inputs, outputs, internal and cut nets, plus rename and clear controls, to `index.html`, `src/dom.ts` and `src/analysis-panel.ts` (FR-020, FR-021).
- [ ] T053 [US3] Carry names into netlist export and restore them on import in `src/netlist-json.ts` (FR-026).
- [ ] T054 [US3] Verify Scenario 10 of [quickstart.md](./quickstart.md) via a new `scripts/verify/labels.mjs` plus a browser pass: editing the pixels under an anchor leaves the label unresolved rather than moved, the saved PNG contains no label data, export/import round-trips byte-identically, malformed input is refused, and **names survive editing the `.png` externally and reloading** (SC-006, SC-012, SC-012a).

**Checkpoint**: findings read in the user's vocabulary.

---

## Phase 7: User Story 5 - Understand circuits driven by a clock (Priority: P3)

**Goal**: find the clock, highlight it, and describe behaviour edge by edge.

**Independent Test**: designate a clock on a known clocked circuit and step it; the reported
state sequence matches its intended behaviour.

- [ ] T055 [P] [US5] Create `src/clock.ts` with behavioural detection: hold inputs steady, run past the transient, and find nets whose series repeats with a stable period (CK-1, CK-3).
- [ ] T056 [US5] Add structural detection to `src/clock.ts`: free inputs ranked by how many storage elements they reach (CK-1; depends on T037).
- [ ] T057 [US5] Combine both signals into a ranked candidate list in `src/clock.ts`, each carrying its evidence, with indistinguishable candidates presented at equal rank rather than ordered (CK-2, CK-4).
- [ ] T058 [US5] Implement clock designation in `src/analysis.ts`, with the user's choice always overriding the ranking and nothing selected silently (CK-5, FR-033).
- [ ] T059 [US5] Highlight the leading candidate among the inputs wherever inputs are listed or drawn, in `src/analysis-panel.ts` and `src/schematic-view.ts` (CK-6, FR-033d).
- [ ] T060 [US5] Implement edge stepping in `src/oracle.ts` and `src/analysis.ts`: with a clock designated, produce a sequence of state transitions, N edges giving exactly N transitions (CK-7, FR-034).
- [ ] T061 [US5] Report non-repeatability in `src/analysis-panel.ts` when identical edge sequences differ across runs, rather than presenting one run's result (CK-8, FR-035).
- [ ] T062 [US5] Add the clock designation and stepping controls to `index.html`, `src/dom.ts` and `css/style.css`.
- [ ] T063 [US5] Verify Scenarios 8 and 9 of [quickstart.md](./quickstart.md) via a new `scripts/verify/clock.mjs` plus a browser pass: a ring oscillator is found behaviourally with its period, a hand-pulsed input structurally, a clock and a reset with equal fan-out come back at equal rank, and stepping N edges gives N transitions (SC-008, SC-008a, SC-008b).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T064 [US2] Implement the hand-off to Edit mode in `src/analysis-panel.ts` and `src/ui.ts`: a replacement is offered in analysis mode but applied only after an explicit switch, through the existing paste mechanism (MO-10, FR-009).
- [ ] T065 [P] Register the new suites in the `verify` script in `package.json`: `gates.mjs`, `graph-layout.mjs`, `schematic.mjs`, `storage-elements.mjs`, `labels.mjs`, `clock.mjs`.
- [ ] T066 [P] Document analysis mode in `README.md`: the three modes, the schematic and its two levels, naming, storage and power-on, and clocks.
- [ ] T067 [P] Update `CLAUDE.md`: that every driven net is already a NAND and recognition is algebra over the netlist rather than pixel matching; that absorption requires fan-out 1; that a storage element is a feedback group with more than one rest state; that power-on is sampled over 20 cold starts and worded as sampling; that a label anchors to a pixel and never to a net id; and that a file handle cannot write a sibling file.
- [ ] T068 Verify Scenario 11 of [quickstart.md](./quickstart.md): a replacement offered in analysis mode commits as one undo step only after an explicit switch to edit mode (depends on T064).
- [ ] T069 Verify Scenario 0 and Scenario 12 of [quickstart.md](./quickstart.md): `npm run verify` fully green with counts unchanged against the baseline, and all browser suites passing on Chromium, Edge, Firefox and WebKit.
- [ ] T070 Re-check the constitution: `npm run build` and `npx tsc --noEmit` clean, `package.json` dependencies still empty, and `src/simulator.ts` untouched.
- [ ] T071 Verify Scenario 13 of [quickstart.md](./quickstart.md) by hand, once: find a named signal in a 200-gate schematic within 15 seconds, and record the result here (SC-004).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → everything else.
- **US1 (3)** needs Phase 2 in full.
- **US2 (4)** needs Phase 2 for the mode; its pure modules need nothing else.
- **US4 (5)** needs Phase 2 and `src/sequential.ts`; independent of US2 and US3.
- **US3 (6)** needs Phase 2; its value spans US2 and US4, but neither depends on it.
- **US5 (7)** needs US4's storage elements (T037) for the structural signal.
- **Polish (8)** last, except T064 which needs only US2's panel work.

### User Story Dependencies

- **US1 (P1)**: Phase 2 only. The container everything else sits in.
- **US2 (P1)**: Phase 2. Its three pure layers — recognition, layout, model — depend only on the netlist.
- **US4 (P2)**: Phase 2. Fully independent of US2 and US3.
- **US3 (P2)**: Phase 2. Improves US2 and US4; required by neither.
- **US5 (P3)**: US4 for T056, otherwise self-contained.

### Parallel Opportunities

- **Phase 1**: T001 and T002 are the same file and must be sequential; T002 is marked [P] only against Phase 2.
- **US2**: recognition (T015–T019), layout (T020–T025) and the UI shell (T032) are three disjoint tracks that can proceed together; only `schematic.ts` (T026) needs the first two finished.
- **Across stories**: once Phase 2 lands, US2, US4 and US3 touch disjoint files — `gates.ts`/`graph-layout.ts`/`schematic.ts` versus `storage-elements.ts` versus `labels.ts` — and can be staffed in parallel.

---

## Parallel Example: User Story 2

```bash
# Three disjoint tracks, no shared files:
Task: "Create src/gates.ts with the NAND base rule"          # T015
Task: "Create src/graph-layout.ts with cycle breaking"       # T020
Task: "Add the view switch to index.html and src/dom.ts"     # T032

# Then sequentially, because they all consume the first two:
Task: "Build a Schematic from a Netlist"                     # T026
Task: "Draw a Schematic to canvas"                           # T030
```

---

## Implementation Strategy

### MVP scope

Phases 1–3: setup, the mode, and US1. That is a mode you can explore a circuit in without any
risk of changing it — small, independently demonstrable, and the guarantee everything else
relies on.

### Recommended delivery order differs from spec priority

The spec ranks US3 (labels) as P2 alongside US4 (memory), but **US4 is built first**. The
power-on finding is the reason this investigation exists, and its analysis needs neither the
schematic nor labels. Building it in phase 5 rather than after labels means the motivating
question is answerable as early as the machinery allows.

1. Phases 1–2 → the mode, with its key table verified.
2. US1 → **demonstrable**: a read-only mode.
3. US2 → the schematic. **The headline.**
4. **US4** → storage and power-on. **Answers the original question.**
5. US3 → labels, which make everything above readable.
6. US5 → clocks, then polish.

### Risk-ordered notes

- **T019 is the most important verification task in this feature.** Recognition is the one place
  a confident, wrong answer is easy to produce: a bad symbol looks authoritative and a reader
  has no reason to doubt it. Conservation (T017) and per-symbol verification (T018) are the
  defences, and T019's corrupted-rule case is what proves they fire — exactly as the
  corrupted-detector case does for netlist extraction in 003.

- **T023 carries a quiet hazard.** Crossing reduction is where nondeterminism creeps in
  unnoticed, through an unstable sort or an unbroken tie. Nothing fails; two runs simply differ,
  and only T025's double-layout comparison catches it.

- **T040 and T042 are the pair that must not be collapsed.** The 4-bit CPU's storage loop passes
  every behavioural check in feature 003 and still fails to reach a defined state in roughly
  three cold starts out of four. If power-on is folded into the existing sweep, or if a pass
  there is allowed to imply a pass here, the feature will confidently report the known defect as
  healthy — which is the exact failure it was built to prevent.

- **T005 must not lag T004.** A mode whose key table is changed but not re-verified is a mode
  that silently edits, and the failure is invisible until someone loses work.

- **T050 must not promise a silent sibling write.** A `FileSystemFileHandle` has no parent
  access; the UI has to say what it actually does.
