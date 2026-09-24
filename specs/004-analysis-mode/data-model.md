# Data Model: Analysis Mode

**Feature**: [004-analysis-mode](./spec.md) · **Phase 1** · **Date**: 2026-09-24

Entities the feature introduces, and the invariants that make each one trustworthy. Types are
indicative; the binding statements are the invariants.

---

## EditorMode (extended)

```ts
type EditorMode = 'simulate' | 'edit' | 'analysis';
```

| Mode | Document can change | Owns the pointer | Simulation |
|------|--------------------|------------------|------------|
| `simulate` | no | no — clicks poke wires | runs |
| `edit` | **yes** | yes — both buttons draw | paused on entry, restored on exit |
| `analysis` | **no** | yes — drag selects only | paused on entry, restored on exit |

**Invariants**

- **M-1**: In `analysis`, no input path reaches `CircuitDocument`. This is a property of the
  whole mode, not of individual handlers — the check is that undo depth and the dirty flag are
  unchanged after exercising every key and gesture.
- **M-2**: The selection is shared across all three modes. Switching mode never clears it.
- **M-3**: `InputContext.mode` carries all three values, and `resolveKey` remains pure and total
  over them.
- **M-4**: A floating paste cannot exist in `analysis`. Entering the mode with one pending
  requires it to be committed or cancelled first.

---

## RecognisedGate

The output of reading the netlist algebraically. See [research.md](./research.md) §3.

```ts
type GateKind = 'NOT' | 'NAND' | 'AND' | 'OR' | 'NOR';

interface RecognisedGate {
  readonly kind: GateKind;
  readonly inputs: readonly NetId[];   // sources, in a deterministic order
  readonly output: NetId;
  readonly absorbed: readonly GateRef[]; // every engine gate this symbol stands for
}
```

**Invariants**

- **G-1**: Every gate in the netlist is either drawn faithfully or appears in exactly one
  `absorbed` list. Never zero, never two. *(FR-015a)*
- **G-2**: A net may only be absorbed when its fan-out is exactly 1. Absorbing a shared net
  would either duplicate a gate or drop a connection.
- **G-3**: Every `RecognisedGate` is verified before it is offered: evaluated against the
  expression of its `absorbed` gates over all `2^|inputs|` combinations. A mismatch means the
  symbol is discarded and its gates are drawn faithfully. *(FR-011c)*
- **G-4**: Recognition never changes what the circuit computes. It renames combinations; it is
  not the minimisation from feature 003. *(FR-011d)*

---

## Schematic

```ts
interface Schematic {
  readonly level: 'recognised' | 'faithful';
  readonly symbols: readonly Symbol[];    // gates, plus input and output terminals
  readonly edges: readonly Edge[];
  readonly bounds: Rect;
  readonly sourceRect: Rect;              // the selection it came from
}

interface Edge {
  readonly from: SymbolId;
  readonly to: SymbolId;
  readonly net: NetId;
  readonly isFeedback: boolean;           // true when the layout reversed it
  readonly points: readonly Point[];      // straight segments, bending at dummy nodes
}
```

**Invariants**

- **S-1**: Symbol and edge counts agree with the netlist exactly, at `faithful` level. *(FR-015)*
- **S-2**: `isFeedback` is set by the cycle-breaking pass, not guessed afterwards — an edge is
  feedback precisely because the layout had to reverse it to get a DAG.
- **S-3**: Deterministic. The same netlist and level produce an identical `Schematic`, including
  coordinates. No `Math.random`; every tie broken by id. *(FR-016)*
- **S-4**: Every symbol and edge carries enough information to find its pixels, and every net and
  gate can find its symbol. The correspondence is two-way. *(FR-018)*
- **S-5**: Both levels describe the same selection and are derived from one analysis, so
  switching between them never re-analyses. *(FR-011, scenario 1c)*

---

## Layout graph *(internal to `graph-layout.ts`)*

```ts
interface LayoutNode { id: number; layer: number; order: number; x: number; y: number;
                       isDummy: boolean; }
```

**Invariants**

- **L-1**: After cycle-breaking, the graph is acyclic. Asserted, not assumed.
- **L-2**: Every edge runs between adjacent layers, after dummy insertion.
- **L-3**: Layer 0 holds the inputs; the deepest layer holds the outputs. *(FR-012)*
- **L-4**: Every pass is a pure function of its input graph — no shared mutable state between
  passes, so each is independently verifiable.

---

## Label

```ts
interface Label {
  readonly anchor: Point;      // a pixel in the circuit, NOT a net id
  readonly name: string;
  readonly kind: 'net' | 'gate';
}
```

**Invariants**

- **B-1**: A label binds to a **coordinate**, never to a net id. Net ids are assigned per
  compile and change when the circuit is edited; a coordinate is what the user actually chose.
- **B-2**: Resolution asks the compiled circuit which net occupies the anchor. If none does, the
  label is **unresolved** — reported, never dropped and never reattached to a different net.
  *(FR-025)*
- **B-3**: A resolved label replaces the default identifier everywhere the item appears — lists,
  schematic, expressions, truth tables, discrepancies. One name, one source. *(FR-022)*
- **B-4**: Labels are never written into the circuit image, neither pixels nor metadata.
  *(FR-024c)*
- **B-5**: Where the sidecar file and the browser working copy disagree, the user is told and
  chooses. Neither silently wins. *(FR-024b)*

### LabelSet — the sidecar shape

```jsonc
{
  "format": "bitmap-logic-labels",
  "version": 1,
  "circuit": "4bitCPU.png",     // advisory: a hint, not a key
  "labels": [
    { "anchor": { "x": 542, "y": 634 }, "kind": "net", "name": "AX.hold" }
  ]
}
```

---

## StorageElement

```ts
interface StorageElement {
  readonly nets: readonly NetId[];          // the mutually reachable group
  readonly stateNets: readonly NetId[];     // what holds the value
  readonly writeNets: readonly NetId[];     // what can change it
  readonly restStates: readonly boolean[][];// assignments that reproduce themselves
  readonly powerOn: PowerOnFinding;
}
```

**Invariants**

- **E-1**: A storage element is a non-trivial strongly connected group with **more than one**
  rest state. A feedback group with exactly one rest state settles and is **not** storage.
  *(FR-027a)* This is what lets a report say "four register bits" instead of "19 state
  variables".
- **E-2**: Rest states are enumerated **per group**, not across the whole selection. Groups are
  small even when the selection's total state is far too wide to enumerate — this is what makes
  a real register analysable.
- **E-3**: Elements sharing control signals are reported as a group. *(FR-032)*
- **E-4**: A net belongs to at most one storage element. *(edge case: shared nets are reported
  as shared, never double-counted)*

### PowerOnFinding

```ts
type PowerOnFinding =
  | { kind: 'defined'; value: boolean[]; starts: number }
  | { kind: 'undefined'; distribution: Map<string, number>; starts: number }
  | { kind: 'neverSettles'; settled: number; starts: number };
```

**Invariants**

- **P-1**: Determined by **cold-starting repeatedly** — 20 by default — never from one run. The
  engine re-rolls gate order and jitter per compile, so each start is an independent sample.
  *(FR-029a)*
- **P-2**: `defined` requires **every** run to agree. One disagreement makes it `undefined`.
- **P-3**: `starts` is always reported alongside, because this is sampling. The wording is
  "defined across 20 starts", never "defined". *(FR-029b)*
- **P-4**: A pass on "holds and computes correctly" never implies a pass on "starts correctly".
  These are separate findings and the report keeps them separate. *(FR-031)*

---

## ClockCandidate

```ts
interface ClockCandidate {
  readonly net: NetId;
  readonly evidence:
    | { kind: 'oscillates'; period: number }
    | { kind: 'fansOutToStorage'; count: number };
  readonly rank: number;
}
```

**Invariants**

- **C-1**: Candidates come from **both** signals. Behavioural alone is blind to a hand-pulsed
  input; structural alone cannot see a generated clock. *(FR-033b)*
- **C-2**: Every candidate carries its evidence. Nothing is offered without a reason. *(FR-033a)*
- **C-3**: An oscillating candidate reports its observed period. *(FR-033c)*
- **C-4**: Candidates the structural signal cannot separate — a clock and a reset line both
  reach every bit — are presented at **equal rank**, not ordered arbitrarily. *(FR-033e)*
- **C-5**: The leading candidate is visually distinguished wherever inputs are listed or drawn.
  *(FR-033d)*
- **C-6**: The user's designation always overrides the ranking. *(FR-033)*

---

## Finding *(cross-cutting)*

Everything the analyser reports carries two flags, because both have been got wrong before:

```ts
interface Finding {
  readonly exhaustive: boolean;  // false when sampled
  readonly stale: boolean;       // true once the circuit changed underneath it
}
```

- **F-1**: A sampled finding is labelled as sampled, wherever it is shown. *(FR-036)*
- **F-2**: Every result derived from a selection is marked stale when the circuit changes.
  *(FR-037)*

---

## Relationships

```text
CircuitDocument ──crop──▶ Circuit ──extract──▶ Netlist
                                                  │
                        ┌─────────────────────────┼──────────────────────┐
                        ▼                         ▼                      ▼
                  RecognisedGate[]         StorageElement[]       ClockCandidate[]
                        │                         │
                        ▼                         ▼
                   Schematic  ◀──layout──   (feedback set, shared with sequential.ts)
                        │
                        ▼
                 schematic-view              Label[] ──resolve──▶ any Net or Gate
```

`Netlist` remains the single source of structural truth. Every entity above is derived from it,
and none is derived from the pixels independently — the same rule that keeps analysis from
disagreeing with simulation.
