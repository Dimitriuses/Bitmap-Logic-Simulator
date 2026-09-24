# Contract: Gate Recognition, Layout and the Schematic

**Modules**: `src/gates.ts`, `src/graph-layout.ts`, `src/schematic.ts`, `src/schematic-view.ts`

All four are derived from `Netlist`. None reads pixels. That is the rule that keeps a diagram
from disagreeing with the simulation it claims to depict.

---

## Recognition — `gates.ts`

### GR-1 — Every driven net is already a NAND

For a net driven by gates with sources `s₁ … sₖ`:

```
N = ¬s₁ ∨ … ∨ ¬sₖ = ¬(s₁ ∧ … ∧ sₖ) = NAND(s₁ … sₖ)
```

`NOT` is the `k = 1` case. This is the base rule; everything else is absorption.

### GR-2 — The absorption rules

| Rule | Pattern | Becomes |
|------|---------|---------|
| R2 | a NAND whose every source is a NOT-net of fan-out 1 | `OR` of those NOTs' sources |
| R3 | a NOT whose single source is a NAND-net of fan-out 1 | `AND` |
| R4 | a NOT whose single source is an OR-net of fan-out 1 | `NOR` |

### GR-3 — Fan-out 1 is required for absorption

A net may be absorbed only when exactly one thing reads it. Absorbing a shared net would either
duplicate a gate or silently drop a connection another part of the circuit depends on.

### GR-4 — Conservation

Every gate in the netlist is drawn faithfully **or** appears in exactly one symbol's `absorbed`
list. Never zero, never twice. This is checkable as a hard equality against every bundled
schematic, and it is the invariant most likely to break as rules are added.

### GR-5 — Verified before offered

Each recognised symbol is evaluated against the expression of the gates it absorbed, over all
`2^|inputs|` combinations. A symbol that disagrees is discarded and its gates are drawn
faithfully. A wrong symbol is worse than no symbol, because it looks authoritative.

### GR-6 — Recognition is not simplification

The circuit's function is unchanged. This is a *reading* of the netlist. Feature 003's
`minimise.ts` changes circuits; this does not, and the two must not be confused.

### GR-7 — Deterministic

Same netlist, same recognition, including the order of each symbol's inputs.

---

## Layout — `graph-layout.ts`

### GL-1 — Five pure passes

Break cycles → assign layers → insert dummies → reduce crossings → assign coordinates. Each is a
pure function of its input graph, so each is independently verifiable.

### GL-2 — Cycle breaking reuses the feedback set

The edges reversed to obtain a DAG come from `feedbackNets()` in `sequential.ts`. An edge is
feedback *because* the layout had to reverse it — the visual requirement and the algorithmic
step are the same fact, not two guesses that might disagree.

### GL-3 — Acyclic after breaking

Asserted, not assumed. A cycle surviving into layering would loop forever.

### GL-4 — Flow direction

Layer 0 holds inputs; the deepest layer holds outputs; every edge runs between adjacent layers
after dummy insertion.

### GL-5 — Deterministic, and this is the easy one to lose

No `Math.random`. Every tie broken by node id. Every sort explicitly stable. The crossing
reduction sweep is where nondeterminism creeps in unnoticed, so the check is direct: lay the
same graph out twice and compare coordinates exactly.

### GL-6 — Scale

A 250-gate graph lays out in well under the 2 s budget for the whole schematic.

---

## The model — `schematic.ts`

### SM-1 — Agreement with the netlist

At `faithful` level, symbol and edge counts equal the netlist's gate and connection counts
exactly. A diagram that disagrees is not shown.

### SM-2 — One analysis, two levels

Both levels come from a single analysis. Switching between them never re-analyses.

### SM-3 — Two-way correspondence

Every symbol and edge can name its pixels; every net and gate can name its symbol. Neither
direction is approximate.

### SM-4 — Crossovers cross

A crossover is drawn as two signals crossing without joining, reflecting that the engine unions
left/right and top/bottom separately at a cornerless plus.

### SM-5 — Cut nets enter from the boundary

Nets severed by the selection edge are drawn entering from that edge and are marked cut, because
the analysis is only true relative to where the box was drawn.

---

## Rendering — `schematic-view.ts`

### SV-1 — Own camera

A second `Viewport` instance, giving the schematic its own zoom and pan. Switching views
preserves both cameras.

### SV-2 — Hit testing against geometry

Against the laid-out shapes, never against pixels.

### SV-3 — Cross-highlighting

Pointing at a symbol highlights its pixels in the circuit; pointing at the circuit highlights
its symbol. Both directions work from the same correspondence (SM-3).

### SV-4 — Large diagrams are navigable

Never refused on size, never silently truncated.

### SV-5 — Staleness is visible

A diagram whose circuit has changed says so.

---

## Verification

| Contract | How |
|----------|-----|
| GR-1 … GR-3, GR-6, GR-7 | `scripts/verify/gates.mjs` — the fixture set plus every bundled schematic |
| **GR-4** | `gates.mjs` — hard equality: gates drawn + gates absorbed = `circuit.gateCount`, on all 22 schematics |
| **GR-5** | `gates.mjs` — every recognised symbol re-evaluated against its absorbed gates; plus a deliberately corrupted rule must be caught |
| GL-1 … GL-6 | `scripts/verify/graph-layout.mjs` — layering, acyclicity, determinism by double-layout comparison, timing |
| SM-1 … SM-5 | `scripts/verify/schematic.mjs` — counts against the netlist for every bundled schematic |
| SV-1 … SV-5 | Browser: camera persistence across the toggle, hit testing, cross-highlight, a 241-gate diagram, staleness |
