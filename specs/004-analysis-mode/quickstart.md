# Quickstart: Analysis Mode

**Feature**: [004-analysis-mode](./spec.md) · **Phase 1** · **Date**: 2026-09-24

Runnable scenarios that prove the feature works end to end. Each maps to success criteria in the
spec and to contracts in [contracts/](./contracts/). Numbered so tasks can cite them.

## Prerequisites

```bash
npm install
npm run build          # gen-examples, then tsc
npm run verify         # the headless suites must be green BEFORE any browser work
npm run serve          # python -m http.server, from the repo root — HTTP is mandatory
```

Browser scenarios need Playwright, deliberately **not** a dependency of this repo. Install it
outside the project and point it at the served root.

---

## Scenario 0 — Nothing already working broke

**Run**: `npm run verify`

**Expect**: every suite from 001–003 green, counts unchanged against
`scripts/verify/baseline.json`. The key-precedence suite now covers three modes rather than two,
so its combination count grows — that is the only expected change to an existing suite.

This runs first, always. A feature this size touching `editor.ts`, `keymap.ts` and `ui.ts` has
every opportunity to break what 002 established.

---

## Scenario 1 — Analysis mode cannot write *(MO-2, SC-001, SC-010)*

**Run**: browser. Load any circuit, switch to Analysis mode.

**Do**: every key in the key table, and every pointer gesture — drag, right-drag, middle-drag,
wheel, arrows, Ctrl+C, Ctrl+X, Ctrl+V, Delete, Enter, Escape.

**Expect**:
- `doc.canUndo`, `doc.canRedo` and the dirty flag are **unchanged throughout**;
- a drag produces a selection and nothing else;
- the toolbar offers no drawing tool, colour, bus width or rotation control;
- entering pauses the simulation; leaving restores what was running.

**The check that matters**: not that each gesture was handled, but that the document is
provably untouched after all of them.

---

## Scenario 2 — Recognition is sound *(GR-4, GR-5, SC-003a, SC-003b)*

**Run**: `node scripts/verify/gates.mjs`

**Expect**:
- **Conservation**, on all 22 bundled schematics: gates drawn + gates absorbed equals
  `circuit.gateCount` exactly. Never zero, never twice.
- **Verification fires**: every recognised symbol re-evaluated against the gates it absorbed,
  over all its input combinations, agrees.
- **A deliberately corrupted rule is caught** — break one absorption rule and the affected
  symbols must be rejected and drawn faithfully, not shown.
- Two inverters driving one net come back as one NAND; the fixture set covers each of R2, R3
  and R4, and a fan-out-2 net is **not** absorbed.

The corrupted-rule case is what proves the check works, exactly as the corrupted-detector case
does for netlist extraction in 003.

---

## Scenario 3 — Layout is deterministic *(GL-3, GL-5, SC-002)*

**Run**: `node scripts/verify/graph-layout.mjs`

**Expect**:
- after cycle breaking, the graph is acyclic — asserted;
- inputs at layer 0, outputs at the deepest layer, every edge between adjacent layers;
- **laying out the same graph twice produces byte-identical coordinates**;
- a 250-gate graph lays out well inside the 2 s budget.

Determinism is the one most easily lost to an unstable sort in the crossing-reduction sweep, so
it is asserted directly rather than inferred.

---

## Scenario 4 — The diagram agrees with the netlist *(SM-1, SC-003, SC-009)*

**Run**: `node scripts/verify/schematic.mjs`

**Expect**: for every bundled schematic, the faithful diagram's symbol and edge counts equal the
netlist's gate and connection counts exactly. The 241-gate / 180-net / 19-state block from
`4bitCPU.png` produces a diagram without refusing on size — the case truth tables must refuse.

---

## Scenario 5 — The schematic on screen *(SV-1 … SV-5, SC-002, SC-005, SC-011)*

**Run**: browser. Analysis mode, select a region, switch to the schematic view.

**Expect**:
- a 250-gate selection draws in under 2 s;
- feedback connections are visually distinct from forward ones;
- crossovers cross without joining;
- pointing at a symbol highlights its pixels, and the reverse;
- switching to the pixel view and back **preserves both cameras**;
- the recognised view uses measurably fewer symbols than the faithful one;
- editing the circuit marks the diagram stale.

---

## Scenario 6 — Storage, not state variables *(ST-1 … ST-4)*

**Run**: `node scripts/verify/storage-elements.mjs`

**Expect**:
- a latch fixture is reported as **one storage element**, with the nets that hold it and the
  nets that write it;
- a feedback loop with exactly one rest state is **not** reported as storage;
- a multi-bit register reports as grouped bits, not one wide vector;
- the 19-state block resolves into small groups, each enumerable — the scaling claim, tested.

---

## Scenario 7 — Power-on, the motivating defect *(PO-1 … PO-5, SC-007)*

**Run**: `node scripts/verify/storage-elements.mjs` (the power-on section)

**Expect**, for the six-inverter storage loop at **x 542–551, y 634–645** in
`projects/CPU/4bitCPU.png`:
- across 20 cold starts, the power-on state is reported **undefined**;
- both rest states are named, with the observed distribution;
- runs that never settle are counted separately, with **no held value** presented;
- **and in the same run**, the behavioural sweep from 003 reports it as holding correctly.

That last point is the whole scenario. The circuit passes one check and fails the other, and the
report must show both without collapsing them — which is precisely what the current tooling
cannot do, and why it reports this circuit as healthy.

---

## Scenario 8 — Clock candidates *(CK-1 … CK-4, SC-008a)*

**Run**: `node scripts/verify/clock.mjs`

**Expect**:
- a ring-oscillator fixture is found **behaviourally**, with its observed period;
- a hand-pulsed input is found **structurally**, by storage fan-out;
- a clock and a reset line with equal fan-out come back at **equal rank**, not ordered;
- every candidate carries its evidence; none is selected silently.

---

## Scenario 9 — Clocked behaviour on screen *(CK-5 … CK-7, SC-008, SC-008b)*

**Run**: browser. Analysis mode on a clocked circuit.

**Expect**: the leading candidate is distinguishable among the inputs **without reading text**;
designating a different net overrides it; stepping N edges produces exactly N transitions, each
showing what changed.

---

## Scenario 10 — Labels *(LB-1 … LB-9, SC-006, SC-012, SC-012a)*

**Run**: `node scripts/verify/labels.mjs`, then browser.

**Expect**:
- a name replaces the default identifier in every view that mentions the item;
- **editing the pixels under an anchor leaves the label unresolved** — reported, not silently
  moved to a neighbouring net and not deleted;
- the saved PNG contains no label data;
- export/import round-trips, and a second export is byte-identical;
- malformed sidecar input is refused with a reason, not partially read;
- **names survive editing the `.png` in an external image editor and reloading** — the case that
  storing them inside the image would lose;
- divergent sidecar and working copy prompt a choice rather than one silently winning.

---

## Scenario 11 — Handing work back to Edit mode *(MO-10, FR-009)*

**Run**: browser. Analyse a reducible selection in Analysis mode and take the offered
replacement.

**Expect**: the offer is produced in Analysis mode but **not applied**; taking it switches to
Edit mode explicitly; the floating paste then behaves exactly as any other paste, committing on
Enter as one undo step and costing nothing to cancel.

---

## Scenario 12 — Cross-browser and constitution *(SC-002, gates)*

**Run**: the browser scenarios on Chromium, Edge, Firefox and WebKit; then:

```bash
npm run build && npx tsc --noEmit
node -e "console.log(require('./package.json').dependencies || {})"   # must be {}
git status --short -- src/simulator.ts                               # must be empty
```

**Expect**: all four browsers pass; typecheck clean; **zero runtime dependencies**;
`simulator.ts` untouched.

---

## Scenario 13 — The one that needs a human *(SC-004)*

**Run**: by hand, once. Open a 200-gate selection as a schematic with labels applied, and find a
specific named signal.

**Expect**: under 15 seconds.

Recorded here rather than dropped, because it cannot be automated alongside the rest and a
usability target that nobody measures is a usability target that was never set.
