# Contract: Storage Elements, Power-On and Clocks

**Modules**: `src/storage-elements.ts`, `src/clock.ts`

This is where the feature answers the question that started the investigation. The contracts are
written to make one specific failure impossible: reporting a memory circuit as working when its
power-on state is undefined.

---

## Storage — `storage-elements.ts`

### ST-1 — Definition

A storage element is a non-trivial strongly connected group of gates with **more than one rest
state** for the current input assignment.

### ST-2 — Feedback alone is not memory

A feedback group with exactly one rest state settles, and is reported as a circuit with a loop —
not as storage. Getting this wrong is how "four register bits" becomes "19 state variables".

### ST-3 — Rest states are enumerated per group

`2^|state|` **per group**, never across the whole selection. Groups are small even when the
selection's total state is hopeless: 19 state variables is intractable as one table and trivial
as five groups of two to four. This is the scaling insight the feature depends on.

### ST-4 — Grouping

Elements sharing control signals are reported together. A net belongs to at most one element;
genuinely shared nets are reported as shared, never counted twice.

---

## Power-on

### PO-1 — Repeated cold starts, never one

Determined by cold-starting the compiled selection **20 times** by default and recording where
each lands, using whole-frame quiescence. The engine re-rolls gate evaluation order and its
jitter table on every `Circuit` construction, so each start is an independent sample.

### PO-2 — `defined` requires unanimity

Every run must agree. One disagreement makes the finding `undefined`, with the distribution
reported.

### PO-3 — Never settling is its own finding

Runs that fail to settle are counted and reported separately, and no held value is presented for
them. A circuit that keeps changing has no steady-state answer.

### PO-4 — The count is part of the result

Always reported as "defined across N starts". This is sampling, and the wording must say so —
"defined" alone would claim a proof the method cannot provide.

### PO-5 — Holding is not starting

A pass on "holds and computes correctly" never implies a pass on "starts correctly". The
existing `sweepSequential` answers the first — it seeds a consistent state before releasing, so
it *cannot* see the second. Both findings are reported, separately, and the UI may not collapse
them.

> This is the contract that catches the known defect. The 4-bit CPU's six-inverter storage loop
> passes every behavioural check in feature 003 and still fails to reach a defined state in
> roughly three cold starts out of four.

---

## Clocks — `clock.ts`

### CK-1 — Two signals, because each is blind to the other's case

- **Behavioural**: hold inputs steady, run, and find nets whose series repeats with a stable
  period. Catches the ring oscillator — an odd-length inverter loop — which is how a clock is
  actually built in this medium.
- **Structural**: free inputs that fan out to many storage elements. Catches a clock pulsed by
  hand, which a behavioural search cannot see because a held input never toggles.

### CK-2 — Evidence, always

Every candidate carries the reason it was chosen. Nothing is offered without one.

### CK-3 — Period reported

A candidate found by oscillation reports its observed period, measured after the transient has
passed.

### CK-4 — Equal rank when indistinguishable

The structural signal cannot tell a clock from a reset or enable line — both reach every bit.
Such candidates are presented at equal rank rather than ordered arbitrarily, because an
arbitrary order reads as a judgement.

### CK-5 — Never silent

No net is designated as the clock without the user confirming. The user's choice always
overrides the ranking.

### CK-6 — Highlighted among the inputs

The leading candidate is visually distinguished wherever inputs are listed or drawn, so the
clock is identifiable at a glance rather than by reading.

### CK-7 — Stepping

With a clock designated, behaviour is a sequence of states across edges. Stepping N edges
produces exactly N transitions, each showing what changed.

### CK-8 — Non-repeatability is a finding

If the same edge sequence produces different results across runs, that is reported — not
resolved by presenting one run's answer.

---

## Verification

| Contract | How |
|----------|-----|
| ST-1, ST-2 | `scripts/verify/storage-elements.mjs` — a latch is storage; a settling feedback loop is not |
| ST-3, ST-4 | `storage-elements.mjs` — a multi-bit register reports as grouped bits, not one wide vector |
| **PO-1, PO-2** | `storage-elements.mjs` — 20 cold starts of the known 4-bit CPU loop report `undefined` with both rest states |
| PO-3 | `storage-elements.mjs` — a ring oscillator reports never-settling, with no held value |
| **PO-5** | `storage-elements.mjs` — the same circuit passes the 003 behavioural sweep *and* reports an undefined power-on state, in one run, proving the two findings do not collapse |
| CK-1, CK-3 | `scripts/verify/clock.mjs` — a ring-oscillator fixture is found behaviourally, with its period |
| CK-2, CK-4 | `clock.mjs` — a clock and a reset with equal fan-out come back at equal rank |
| CK-5, CK-6, CK-7 | Browser: designation, highlighting among inputs, stepping |
| CK-8 | `clock.mjs` — repeated identical edge sequences compared |
