# Research: Analysis Mode

**Feature**: [004-analysis-mode](./spec.md) · **Date**: 2026-09-24

Phase 0. Every unknown in the plan's Technical Context is resolved here, plus the three
algorithmic questions the feature turns on: how to lay out a schematic, how to recognise gates
in a medium that only has inverters, and how to decide what is memory.

---

## 1. A third mode

**Decision**: extend `EditorMode` to `'simulate' | 'edit' | 'analysis'` and extend
`InputContext.mode` in [src/keymap.ts](../../src/keymap.ts) to match.

**Rationale**: the mode already exists as a concept and is already the thing that decides
whether the document can change. Adding a third value keeps one mechanism rather than bolting a
parallel "read-only flag" beside it, which would immediately raise the question of what happens
when the two disagree.

**The part that needs care**: `resolveKey` is pure, total, and verified exhaustively — currently
48 state/key combinations. Adding a mode multiplies that table by 1.5, and the verification
must grow with it, not after it. The editing actions (`copy`, `cut`, `clearRegion`, `paste`,
`commit`, `cancelPaste`) must return `null` in analysis mode, which is a change to the *guard*,
not a new branch: they become conditional on `ctx.mode === 'edit'` where today several are
unconditional.

**Alternatives considered**:

- *A read-only flag orthogonal to mode.* Rejected: two sources of truth about whether writing is
  allowed, and nothing forces them to agree.
- *A separate page or view outside the editor.* Rejected: the selection is shared across modes
  (FR-005), and the analysis works on the live document.

---

## 2. Schematic layout

**Decision**: a layered (Sugiyama-style) layout, hand-rolled, in five passes:

1. **Break cycles** — reuse `feedbackNets()` from [src/sequential.ts](../../src/sequential.ts) to
   pick a feedback set, and reverse those edges. The reversed edges are exactly the ones drawn
   as feedback (FR-013), so cycle-breaking and the visual requirement are the same step.
2. **Assign layers** — longest-path layering over the resulting DAG. Inputs land at layer 0,
   outputs at the deepest layer, which satisfies FR-012 for free.
3. **Insert dummy nodes** for edges spanning more than one layer, so every edge becomes a
   segment between adjacent layers and long edges can bend.
4. **Reduce crossings** — iterated median/barycentre ordering, sweeping down then up a fixed
   number of times.
5. **Assign coordinates** — evenly space within a layer, then a few relaxation passes pulling
   each node toward the median of its neighbours to straighten long runs.

**Rationale**: it is the standard answer for directed graphs that have a natural flow direction,
which a logic circuit does. Every pass is `O(V + E)` or a small constant number of sweeps over
it, so a 241-gate block is trivial. All five passes are pure functions over a graph, which means
they are verifiable in the existing headless harness rather than needing a browser.

**Determinism** (FR-016) is a design constraint on every pass: no `Math.random`, and every tie
broken by node id. This is easy to get wrong in the crossing-reduction sweep, where an
unstable sort silently reintroduces nondeterminism — the sort must be explicitly stable and
tie-broken.

**Alternatives considered**:

- *Force-directed layout.* Rejected: not deterministic without careful seeding, has no notion of
  signal direction, and produces the "hairball" that makes large graphs unreadable — the exact
  failure this feature exists to fix.
- *A layout library.* Rejected by the constitution: no runtime dependencies.
- *Orthogonal/routed layout with proper wire routing.* Deferred. Layered layout with straight
  segments and bends at dummy nodes is enough to read a circuit; full orthogonal routing is a
  much larger problem and is not required by any acceptance scenario.

---

## 3. Gate recognition

**Decision**: recognise gates by algebra over the netlist, not by pixel patterns. The medium has
exactly one gate and one implicit operation, and that is enough to derive everything:

> Every gate is an inverter. A net driven by several gates is their **wired-OR**.

So for a net `N` driven by gates whose sources are `s₁ … sₖ`:

```
N  =  ¬s₁ ∨ ¬s₂ ∨ … ∨ ¬sₖ  =  ¬(s₁ ∧ s₂ ∧ … ∧ sₖ)  =  NAND(s₁ … sₖ)
```

**Every driven net is already a NAND of its drivers' sources**, with `NOT` as the `k = 1` case.
From that, three absorption rules:

| Rule | Pattern | Becomes |
|------|---------|---------|
| R1 | net driven by k gates | `NAND(s₁…sₖ)`, or `NOT(s₁)` when k = 1 |
| R2 | a NAND whose every source is a NOT-net used nowhere else | `OR` of those NOTs' sources |
| R3 | a NOT whose single source is a NAND-net used nowhere else | `AND` |
| R4 | a NOT whose single source is an OR-net used nowhere else | `NOR` |

R2 follows because `NAND(¬t₁, ¬t₂) = ¬(¬t₁ ∧ ¬t₂) = t₁ ∨ t₂`.

**"Used nowhere else" is load-bearing.** Absorption is only sound when the absorbed net has a
fan-out of exactly one; otherwise the symbol would either duplicate a gate or drop a connection
that some other part of the circuit depends on. FR-015a — every gate accounted for exactly once
— is what this protects.

**Verification before display** (FR-011c): each recognised symbol is checked by evaluating it
against the expression of the gates it absorbed, over every input combination of that symbol.
Symbols have a handful of inputs, so this is cheap and exact. A symbol that fails is not drawn;
its gates are drawn faithfully instead. This is the same discipline as `layout.ts` in feature
003 — reasoned structure is not evidence, so it is checked.

**Rationale**: pixel-pattern matching would be a second, independent opinion about what the
circuit is, and it could disagree with the netlist. Deriving from the netlist means recognition
cannot contradict simulation — the same reason `netlist.ts` takes net identity from
`Circuit.wireAt` rather than re-deriving it.

**Alternatives considered**:

- *Recognise by pixel template.* Rejected as above.
- *Recognise higher-level blocks (adders, decoders).* Explicitly out of scope in the spec.
- *Recognise only, with no faithful view.* Rejected during clarification: a surprising symbol
  would have nothing to check against.

---

## 4. Storage elements and power-on

**Decision**: a **storage element is a non-trivial strongly connected group of gates that has
more than one rest state** for the current input assignment (FR-027a). A feedback group with
exactly one rest state settles, and is not memory.

Rest states are found by the method already proven in feature 003: enumerate assignments of the
group's state nets and keep those that reproduce themselves under the next-state functions. That
is `2^|state|` per group, which is affordable **per group** even when the whole selection's state
is far too wide — 19 state variables across a block is intractable as one table, but as five
groups of two to four it is nothing.

**This is the key scaling insight of the feature**: the existing analysis treats state as one
19-wide vector; treating it as independent groups is what makes a real register analysable.

**Power-on** (FR-029a/b): cold-start the compiled selection **20 times** and record where each
run lands, using whole-frame quiescence — the settle test already in
[src/oracle.ts](../../src/oracle.ts). A state is *defined* only if every run agrees; otherwise
it is *undefined* and the distribution is reported; runs that never settle are counted
separately.

**Rationale, and why 20**: this session established that the engine re-rolls gate evaluation
order (`buildPerm`) and the jitter table on every `Circuit` construction, so each cold start is
an independent sample. The known failure in `4bitCPU.png` appeared in roughly three runs in four,
so a handful of starts would catch it; 20 makes a rarer split visible while staying fast. The
result is sampling and the spec requires it to be worded as such — "defined across 20 starts",
never "defined".

**Alternatives considered**:

- *One cold start.* Rejected: it is precisely what makes the current tooling report these
  circuits as healthy.
- *Seed a consistent state then release* — what `sweepSequential` does today. Kept for "does it
  hold and compute correctly", but it cannot answer "does it start correctly", and FR-031
  forbids letting a pass on the first imply a pass on the second.
- *Deterministic seeding of the engine's RNG.* Rejected: it would change `simulator.ts`, which
  is off limits, and it would also destroy the very property being measured.

---

## 5. Clock detection

**Decision**: two independent signals, combined into a ranked list (FR-033b).

- **Behavioural** — hold the selection's inputs steady, run it, and record each net's value per
  cycle. A net whose series repeats with a stable period `p` is a candidate, reported with `p`.
  This catches the **ring oscillator**, which is how a clock is actually built in this medium:
  an odd-length loop of inverters has no rest state and free-runs.
- **Structural** — for each free input, count the storage elements it reaches. A high count is a
  candidate.

Ranked oscillators first, then by storage fan-out, ties presented together.

**Rationale**: neither signal alone is sufficient, and the failure modes are opposite. A purely
structural search cannot see a generated clock at all, and a purely behavioural one cannot see a
clock the user pulses by hand, because a held input never toggles. The structural signal also
cannot distinguish a clock from a reset or enable line — both reach every bit — which is why
FR-033e requires presenting them as equally ranked rather than choosing.

**Period detection**: record `N` cycles of each net into a bit series and find the smallest `p`
where the tail repeats. Straightforward and cheap; the only care needed is to discard the
transient before measuring, which reuses the settle machinery.

**Alternatives considered**:

- *Require the user to designate a clock with no suggestion.* Rejected: the user asked
  explicitly for recognition and highlighting.
- *Pick a clock automatically with no confirmation.* Rejected: the structural signal cannot tell
  a clock from a reset, so silent selection would be confidently wrong on exactly the circuits
  that matter.

---

## 6. Labels: anchoring and storage

**Decision**: a label binds a **name to a pixel coordinate**, not to a net id. Resolving a label
means asking the compiled circuit which net currently occupies that pixel.

**Rationale**: net ids are assigned per compile and change whenever the circuit is edited, so a
label bound to an id would silently follow a different wire after a stroke. A coordinate is
stable and means something to the user, who chose it by clicking. When the pixel is no longer
wire, the label resolves to nothing and is reported as unresolved (FR-025) rather than dropped
or reattached.

**Storage**: a sidecar `*.labels.json` as the portable record, plus a browser working copy
(FR-024, FR-024a).

**A constraint that must be recorded**: a `FileSystemFileHandle` gives **no access to its parent
directory** — there is no `handle.getParent()`, and `resolve()` needs a directory handle to
resolve against. So the app *cannot* silently write `4bitCPU.labels.json` beside
`4bitCPU.png` from the circuit's own handle. Saving a sidecar therefore means one of:

- `showSaveFilePicker({ suggestedName: '<circuit>.labels.json' })` — one dialog per save, works
  wherever the circuit save already works;
- a download, everywhere else, exactly as the PNG save already falls back;
- loading is an ordinary file pick or drag-and-drop.

This does not weaken the decision — the browser working copy carries the everyday case, and the
sidecar is the deliberate, portable artefact — but the plan must not imply a silent sibling
write that the platform does not permit.

**Alternatives considered**:

- *PNG text metadata.* Rejected on evidence during clarification: an ordinary open-modify-save by
  an image editor silently drops the chunk, and editing the PNG externally is this project's core
  live-reload workflow. It would also need hand-splicing chunks, since the app encodes through a
  canvas.
- *A directory handle via `showDirectoryPicker`.* Viable and would permit true sibling writes,
  but asks for far broader permission than the feature needs. Noted as a possible later
  refinement, not taken now.

---

## 7. Rendering the schematic

**Decision**: draw to a canvas, with a second `Viewport` instance for its own zoom and pan
(FR-017). Hit testing against the laid-out geometry, not against pixels.

**Rationale**: `Viewport` is a plain class with no dependency on the circuit or the renderer —
`toScreen`/`toWorld` are pure coordinate maths — so a second instance is free and inherits the
existing, already-verified camera behaviour including both wheel schemes. Canvas also keeps the
schematic on the same footing as the pixel view for panning a large diagram.

**Alternatives considered**:

- *SVG/DOM nodes per gate.* Attractive for hit testing and accessibility, but a 241-gate diagram
  is ~700 DOM nodes plus edges, and it introduces a second rendering model alongside the canvas
  the app already has. Rejected for consistency and for large-diagram performance.
- *Reusing the existing renderer.* Rejected: it draws bitmap pixels with a tile cache; a
  schematic is vector geometry with different invalidation. Sharing the `Viewport` is the right
  level of reuse.

---

## 8. Where the analysis entry point moves

**Decision**: the Edit-mode toolbar button and the `A` key binding move to Analysis mode
(FR-008). The existing analysis panel is reused as-is, retargeted.

**The tension the spec resolved** (FR-009): the panel can offer a minimised circuit as a
floating paste, which writes. In analysis mode the offer is produced but not applied — taking it
switches the user to Edit mode explicitly, and the existing verified paste mechanism applies it
there. Analysis mode itself never writes, so the read-only guarantee stays absolute rather than
"absolute except one button".

---

## Summary of decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Third mode | Extend `EditorMode` and `InputContext`; grow the key table's verification with it |
| 2 | Schematic layout | Hand-rolled layered layout, five pure passes, deterministic by construction |
| 3 | Gate recognition | Algebraic over the netlist: every driven net is a NAND; three absorption rules; verified before display |
| 4 | Storage & power-on | Storage = feedback group with >1 rest state; per-group enumeration; 20 cold starts, reported as sampling |
| 5 | Clock detection | Behavioural (period) + structural (fan-out to storage), ranked with reasons |
| 6 | Labels | Anchored to a pixel; sidecar file + browser working copy; no silent sibling write is possible |
| 7 | Rendering | Canvas with a second `Viewport`; hit test against geometry |
| 8 | Entry point | Moves out of Edit mode; replacement hands back to Edit mode explicitly |

No NEEDS CLARIFICATION markers remain.
