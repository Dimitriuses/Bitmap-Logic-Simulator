# Quickstart: Validating Circuit Analysis

**Feature**: `003-circuit-analysis` | **Date**: 2026-09-23

Most of this feature is pure computation, which is deliberate: the boolean layer, the
minimiser and the graph algorithms are all verifiable in one headless command, leaving the
browser to check only the parts that genuinely need one.

---

## Prerequisites

```sh
npm install
npm run build
npm run verify        # baseline, stamps, geometry, rotate, keymap, + the new suites
npm run serve         # then open http://localhost:8000
```

Playwright, installed outside the repo, covers the interaction scenarios.

---

## Scenario 1 — The netlist matches the engine (US1, SC-010)

Headless, and the first thing to run. This is the foundation every other answer rests on.

| Check | Expectation |
| --- | --- |
| All 22 schematics | extracted gate and net counts equal the engine's own |
| Each of the four gate directions | one gate, correct source and destination nets |
| Crossover | no gate, two nets left distinct |
| Two gates on one net | both present with the same destination |
| A crop bisecting a gate | gate absent, its nets reported as cut |
| A deliberately corrupted detector | extraction **refuses** rather than returning a netlist |

That last row is the point of the self-check: it is only worth having if it is known to
fire.

---

## Scenario 2 — What a selection computes (US1, SC-001, SC-002, SC-003)

Headless for the algebra, then in the browser for the wiring.

**Expect** an inverter with stubs to produce the inverter truth table; a crossover to show
two nets with no functional relationship; and a net driven by two gates to produce their OR.

Then in the browser: select a small region, run analysis, and confirm the inputs, outputs and
cut nets are listed separately and the truth table is shown. Select a region containing no
gates and confirm it is reported as pure wiring rather than as an empty function.

---

## Scenario 3 — Checking the simulator (US2, SC-004)

The reason the feature exists.

1. Build a circuit whose behaviour is certain — a single inverter, then a two-inverter chain.
2. Run the check.

**Expect** zero discrepancies, **stated explicitly**. Silence is not an acceptable way to
report agreement.

3. Corrupt the expected table deliberately and re-run.

**Expect** the discrepancy to be found, and its report to name the input combination, the
expected value and the observed one — enough to reproduce by hand without the tool.

4. Point it at a ring oscillator.

**Expect** every row reported `nonConvergent`. No values. A truth table row for an
oscillator would be a fabrication, and would hide exactly the evidence this scenario exists
to find.

---

## Scenario 4 — Circuits with memory (US5, SC-005)

**Expect** a known latch to be reported sequential with exactly one state variable, that
variable to be locatable on the canvas, and the next-state function to show the hold
behaviour. Confirm the sweep compares next state over (inputs × state) rather than treating
the circuit as combinational.

Also confirm the cheap path: a purely combinational selection finds no non-trivial strongly
connected components and is not reported as sequential.

---

## Scenario 5 — Simplification (US3, SC-006)

Headless.

| Check | Expectation |
| --- | --- |
| Random functions, 2–10 variables | minimised expression agrees on all `2^n` rows |
| A doubled inverter pair | reported as reducible, with both costs shown |
| An already-minimal circuit | reported as already minimal, not offered an equal-cost swap |
| Every offered simplification | `verified` true — none is shown unverified |

Confirm the wording too: the result is described as *minimised*, never *optimal*. The
minimiser optimises sum-of-products while the number on screen is inverter cost, and those
are different objectives.

---

## Scenario 6 — Putting it back (US4, SC-007)

1. Simplify a small circuit and accept the replacement.

**Expect** it to arrive as a floating paste — positioned, previewed and committed exactly
like any other paste, and undone in one step.

2. Re-analyse the committed region.

**Expect** a truth table identical to the original's. This is the check that matters: a
replacement that compiles but computes something else is the worst outcome this feature can
produce.

3. Confirm every gate in the generated block is one the engine recognises, by comparing the
   block's compiled gate count against what the layout predicted.

---

## Scenario 7 — Interchange (US6, SC-009)

**Expect** an exported netlist to re-import with identical nets, gates and I/O
classification. Treat anything coming back from the Python tool as a suggestion to verify:
its 1-bit BMP reader disagrees with a reference decoder on the pixels, so three of its five
fixtures describe misread bitmaps.

---

## Scenario 8 — Limits and refusals (SC-008)

**Expect** a selection at 16 inputs to complete in roughly 12 seconds with progress shown
and the option to stop; and a selection beyond the limit to be **refused**, naming the input
count and the limit, before any work starts. A three-minute freeze is a worse answer than a
refusal, and the refusal has to arrive instead of it rather than after it.

Also: edit the document while a result is displayed and confirm the result is marked stale
rather than silently describing a circuit that no longer exists.

---

## Scenario 9 — The AX register (SC-011)

The motivating defect, and the first real use.

1. Open `projects/CPU/4bitCPU.png`. The scratch area at rows 565–754 holds a duplicate of the
   circuit and a simplified version of it.
2. Select the AX register, mark its outputs, and analyse.
3. Run the simulator check.

**One of three outcomes, and all three are useful:**

- **Discrepancies reported.** The simulator disagrees with the netlist. Since extraction is
  cross-checked against the engine's own counts, this points at the simulation, and the
  reported input combination reproduces it.
- **Agreement reported.** The simulator matches the logic, so the circuit does not do what
  its author intended — a circuit bug, and the truth table shows what it actually computes.
- **Non-convergent or timing-dependent rows.** The circuit's behaviour depends on the
  Schmitt-trigger ramp rather than on its netlist, which points at timing and is itself the
  diagnosis.

Record which one it was. This is a success criterion, not an optional follow-up.

---

## Scenario 10 — Nothing regressed (SC-010)

```sh
npm run verify
```

**Expect** all bundled schematics still compiling to their recorded counts and every existing
suite still passing. Then the browser regression suites from 001 and 002: simulate mode
unchanged, editing unchanged, shortcuts intact.

Read frame rates against a same-session A/B rather than numbers recorded on another day —
measurements on this hardware have swung by 4× depending on what else is resident.

---

## Coverage

| Criterion | Scenario |
| --- | --- |
| SC-001 gate truth tables | 2 |
| SC-002 crossover independence | 2 |
| SC-003 wired-OR | 2 |
| SC-004 analysis vs simulator | 3 |
| SC-005 latch is sequential | 4 |
| SC-006 simplifications verified | 5 |
| SC-007 replacement preserves behaviour | 6 |
| SC-008 limits and refusals | 8 |
| SC-009 netlist round-trip | 7 |
| SC-010 nothing regressed | 1, 10 |
| SC-011 AX register outcome recorded | 9 |
