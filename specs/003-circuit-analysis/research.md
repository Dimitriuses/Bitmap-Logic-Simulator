# Phase 0 Research: Circuit Analysis

**Feature**: `003-circuit-analysis` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

Ten questions. The two that carried real architectural risk were settled by prototyping
against the live engine rather than by argument, and both came back better than expected.

---

## R1. The netlist can be read off the public surface — no engine change

**Question**: analysis needs nets and gates, but `Circuit` keeps `gateSrc`, `gateDst` and the
driver graph private, and `CLAUDE.md` says `simulator.ts` is unchanged and stays that way.
Add accessors, or re-derive the netlist independently and risk diverging from the engine?

**Finding**: neither is necessary. `Circuit.wireAt(x, y)` is already public and returns the
engine's *own final net label* for a pixel. Net identity therefore needs no re-derivation at
all — no union-find, no relabelling, no possibility of disagreeing with the engine about
connectivity, which is the part most likely to drift.

Only gates have to be re-detected, and that detection can be checked against the engine's
independently computed `gateCount`.

Prototyped and run against every bundled schematic:

| | Result |
| --- | --- |
| Schematics tested | 22 |
| Gate count agreement | **22 / 22 exact** |
| Net count agreement | **22 / 22 exact** |
| Slowest extraction | 105 ms (Flash Memory, 2048×2048, 45,004 gates) |
| Typical extraction | under 60 ms |

**Decision**: extract observationally. Nets come from `wireAt`; gates are re-detected from
the source pixels by mirroring `detectGates`, including its flat-index behaviour at row
ends. The builder asserts its own gate count against `Circuit.gateCount` and refuses to
return a netlist if they disagree, so a future divergence fails loudly instead of producing
a plausible wrong answer.

**Alternatives considered**: adding read-only accessors to `simulator.ts`. It would work and
it would be a smaller diff, but the file's value is that it is reviewably untouched, and the
measured result shows nothing is gained by opening it.

---

## R2. Analyse a cropped sub-circuit, not the whole document

**Question**: how is a selection analysed when the `Circuit` it lives in is the whole
schematic?

**Decision**: build a *new* `Circuit` from the selection's pixels alone — exactly the crop
`PixelBlock`/`readBlock` already produces for the clipboard.

**Rationale**: this turns out to solve two problems with one move.

1. **Boundary semantics fall out for free.** A net that was driven from outside the selection
   is, in the crop, driven by nothing — and "driven by no gate" is already the engine's own
   definition of an input, the same rule that makes click-to-drive work. So the crop
   *defines* the boundary inputs correctly rather than needing a special rule.
2. **The oracle becomes cheap.** Driving the real simulator through every input combination
   (US2) means settling it thousands of times. On the whole document that is a 45,004-gate
   simulate and a 16 MB render per cycle; on a cropped selection it is a few dozen gates.

The cost is that the crop is a different circuit from the one on screen, and the user has to
understand that. The tool must therefore report the cut nets explicitly (FR-002) — a net cut
by the boundary is being treated as a free input, and if that was not intended the analysis
answers a different question than the one asked.

---

## R3. The simulator oracle: drive, settle, observe

**Question**: US2 requires comparing the analysis against the real simulator. How is a value
driven in, and how is one read out, given `states` is private?

**Decision**: drive with `setStateAt`, read by rendering and testing pixel brightness.

**Rationale**: both halves already work and are used by the existing verification suites.

- **Driving**: `setStateAt` sets a net's state, and `StoreGateStatesToWires` only clears nets
  that a gate drives. An input net — by definition undriven — holds whatever it was set to.
  This is the same mechanism that makes clicking a wire work.
- **Reading**: `render()` writes lit wires at their source colour and unlit ones masked to
  `& 0x7F`, so a pixel's brightness *is* the net's state. `stamps.mjs` and `rotate.mjs`
  already read circuit state this way.

**Settling** is detected by stability rather than by a fixed count: step the circuit and
watch the output vector; when it is unchanged for a window of cycles, it has settled.
Measured on inverter chains, which are the worst case for propagation depth:

| Chain depth | Gates | Cycles to settle |
| --- | --- | --- |
| 1 | 1 | 13 |
| 4 | 4 | 16 |
| 16 | 16 | 34 |
| 32 | 32 | 25 |

Settling is fast and shallow. A circuit that never stabilises — a ring oscillator — simply
never satisfies the stability window and is reported as non-convergent (FR-012), which is
the honest answer rather than sampling it at an arbitrary moment.

---

## R4. The input-count limit, measured

**Question**: FR-005 requires the tool to decline oversized selections with a real number.
What is the number?

**Measured**, at 0.19 ms per settled row:

| Inputs | Rows | Sweep time |
| --- | --- | --- |
| 8 | 256 | 0.05 s |
| 10 | 1,024 | 0.2 s |
| 12 | 4,096 | 0.8 s |
| 14 | 16,384 | 3.0 s |
| **16** | **65,536** | **12.2 s** |
| 20 | 1,048,576 | ~3.3 min |

**Decision**: 16 inputs is the hard limit, and above 12 the sweep runs with a progress
indication and stays interruptible. Beyond 16 the tool declines and says how many inputs it
found, because a silent three-minute freeze is a worse answer than a refusal.

The truth table itself is the binding constraint, not the minimiser: 2^16 rows is 65,536,
which is fine to hold and to minimise, while 2^20 is not.

---

## R5. The minimiser, and an honest limit on what it optimises

**Decision**: Quine–McCluskey — prime implicant generation by repeated adjacency merging,
then a greedy cover of the chart with essential implicants taken first.

**Rationale**: it is exact for the sizes that pass R4's limit, it is about 250 lines, and it
has no dependency. Espresso is faster and heuristic; at 16 inputs it buys nothing here.

**The honest limit**: Quine–McCluskey minimises a *sum of products* — fewest terms, fewest
literals. That is **not** the same as fewest inverters in a NOT + wired-OR basis, which is
what this medium actually costs (research R6 of the original project's cost model). A
minimal SOP is a good starting point and usually a good answer, but the tool must not claim
the result is optimal. It should report what it is: a minimised expression, and its measured
cost.

This matters because the whole point of the feature is gate count. Reporting "minimal" when
the metric being minimised is not the metric being reported would be a quiet lie.

---

## R6. Sequential circuits: components, not cycle enumeration

**Question**: LogicShorter breaks feedback with `nx.simple_cycles`, which enumerates *every*
simple cycle in the graph. That is exponential, and it is one of the two reasons its largest
processed circuit is 46 gates.

**Decision**: find strongly connected components with Tarjan's algorithm — linear time — and
break feedback only within each non-trivial component, greedily removing the highest-degree
node until that component is acyclic.

**Rationale**: a graph with no cycles has no non-trivial SCCs, so the common combinational
case costs one linear pass and stops. Feedback is handled component by component, so a
schematic full of independent latches does not produce a combinatorial explosion across
them. The result is not a guaranteed *minimum* feedback vertex set — that problem is
NP-hard — but it does not need to be: it needs to be small and fast, and a state variable
too many costs one extra column in a table.

This is a deliberate improvement on the reference implementation rather than a port of it.

---

## R7. Outputs cannot be inferred structurally, and there is evidence

**Question**: LogicShorter defines an output as a net that is driven by a gate and feeds no
gate. Is that good enough?

**Finding**: no, and its own fixtures show why. `circuit.bmp` reduces from **46 gates to
zero** because that rule found no outputs at all: every driven net also fed something, so
the entire circuit was dead logic and correctly optimised away to nothing.

In this project the problem is worse, because an "output" is very often *a wire a human
looks at* — a segment of a display, a lamp — which has no structural signature whatsoever.

**Decision**: infer outputs structurally as a starting suggestion, and let the user mark or
unmark any net (FR-003). The selection tool already gives a way to point at a region, so
marking a net is pointing at one of its pixels. The tool must also warn when it finds no
outputs, rather than proceeding to report that the circuit does nothing.

---

## R8. What the model cannot express, and saying so

`CLAUDE.md` records that the Schmitt-trigger ramp and its jitter are "load-bearing, not
decoration" — they are what break ties in ring oscillators and latches. A truth table has no
notion of time, so any circuit whose behaviour depends on propagation delay, on a race, or
on the jitter itself cannot be described by this analysis.

**Decision**: detect it rather than ignore it. A circuit that does not settle is reported as
non-convergent for that input combination. A selection whose result differs between repeated
sweeps is reported as timing-dependent. Neither is presented as a value.

**Why this matters for the motivating defect**: if the AX register turns out to be
timing-sensitive, the analysis will report non-convergence rather than a discrepancy — and
that is itself the diagnosis, pointing at the ramp rather than at the netlist. A tool that
silently returned a settled-looking answer would hide exactly the evidence being sought.

---

## R9. Netlist interchange with the Python tool

**Decision**: export in the shape of LogicShorter's `*_raw.json` — `nets`, `gates` with
`in_net`/`out_net`, and an `io` block — so its existing analysis can consume a selection
exported from here.

**Rationale**: cheap, and it hedges R4's ceiling: anything too large to analyse in the page
can still be exported and run through sympy offline.

**One caveat to record**: LogicShorter's own 1-bit BMP reader disagrees with a reference
decoder on the pixels (696 vs 100 wire pixels on `circuit.bmp`), so three of its five
fixtures describe misread bitmaps. Interchange should go *from* here *to* there. Results
coming back should be treated as suggestions to verify, not as ground truth.

---

## R10. Never apply a simplification unverified

**Question**: `circuit2_simplified.json` reports 28 gates reduced to 10, but the
reconstructed bitmap beside it compiles to **25**. Whatever the explanation — a cost estimate
reported as a realised count, or a reconstruction that is not what the simplifier described —
the two artefacts disagree.

**Decision**: every simplified expression is checked against the original truth table before
it is offered (FR-014), and every generated layout is compiled and re-analysed before it can
be committed (FR-018). A simplification that cannot be verified is not shown.

**Rationale**: a wrong simplifier is worse than no simplifier, because its output looks like
progress. The verification is cheap — the truth table already exists — and it converts the
entire class of "the simplifier had a bug" into a caught error.

---

## Resolved unknowns

Extraction strategy (R1), analysis scope (R2), the oracle mechanism (R3), the size limit
(R4), the minimiser and what it really optimises (R5), sequential handling (R6), output
inference (R7), the boundary of the model (R8), interchange (R9) and verification policy
(R10) are all closed.

Nothing is deferred into implementation. The one item carried as a known limitation rather
than a solved problem is R5: the tool minimises sum-of-products and reports inverter cost,
and these are not the same objective. That is stated in the UI, not hidden.
