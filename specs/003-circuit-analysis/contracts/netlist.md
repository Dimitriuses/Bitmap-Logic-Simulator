# Contract: Netlist Extraction

**Feature**: `003-circuit-analysis` | **Module**: `src/netlist.ts`

The one module that knows what a gate looks like. Everything downstream consumes its output
and never touches pixels.

```ts
export type NetId = number;

export interface NetInfo {
  readonly id: NetId;
  /** A pixel belonging to this net, for driving, probing and locating it. */
  readonly probe: { x: number; y: number };
  readonly pixelCount: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export interface GateInfo {
  readonly src: NetId;
  readonly dst: NetId;
  readonly direction: 'up' | 'down' | 'left' | 'right';
  /** Centre of the 3×3 pattern, in crop coordinates. */
  readonly at: { x: number; y: number };
}

export interface Netlist {
  readonly nets: readonly NetInfo[];
  readonly gates: readonly GateInfo[];
  readonly inputs: readonly NetId[];
  readonly outputs: readonly NetId[];
  readonly cut: readonly NetId[];
}

export type ExtractResult =
  | { ok: true; netlist: Netlist }
  | { ok: false; reason: string };

/**
 * Extract the netlist of a cropped circuit.
 * `image` must be the same pixels `circuit` was compiled from.
 */
export function extractNetlist(circuit: Circuit, image: ImageData): ExtractResult;
```

---

## Requirements

- **NL-1 — Connectivity comes from the engine, never re-derived.** Net identity is
  `circuit.wireAt(x, y)`, which already returns the engine's final label. No union-find, no
  relabelling. This removes the possibility of this feature disagreeing with the simulator
  about which pixels form one wire — the failure mode that would be hardest to notice.

- **NL-2 — Gate detection mirrors `detectGates` exactly**, including its flat-index
  behaviour at row ends, where reading `x+1` on the last column reaches column 0 of the next
  row. That quirk is deliberate in the engine and reproduced in `stamps.ts`; a detector that
  "fixes" it would disagree with the simulator on circuits whose wires touch the right
  border.

- **NL-3 — Self-check, and refuse on mismatch.** The number of gates detected must equal
  `circuit.gateCount`. On any mismatch `extractNetlist` returns `{ ok: false }` naming both
  counts. It must never return a netlist it is not sure of: every downstream answer —
  truth tables, discrepancies, simplifications — inherits its correctness from here, so a
  quiet divergence would produce confident wrong conclusions about the simulator itself.

  Verified in Phase 0 across all 22 bundled schematics: gate and net counts agreed exactly,
  including 45,004 gates on the 2048×2048 example.

- **NL-4 — Inputs are nets no gate drives.** This is the engine's own rule, the same one
  that makes click-to-drive work, not a separate heuristic.

- **NL-5 — Outputs are a suggestion.** The structural rule ("driven by a gate, feeds no
  gate") is computed and offered, but it is known to find nothing in real circuits — it
  reduced one of LogicShorter's fixtures from 46 gates to zero. When it finds no outputs,
  that is a warning to surface, not a result to act on.

- **NL-6 — Cut nets are identified and reported.** A net the selection boundary severed
  appears in both `inputs` and `cut`. The analysis is only valid relative to the boundary,
  and the user must be able to see where it fell.

- **NL-7 — Every net carries a probe pixel.** Downstream needs to drive a net
  (`setStateAt`) and read it back (from the rendered frame), and both need a coordinate.
  Without this the oracle cannot run.

- **NL-8 — Performance.** Extraction is one pass over the pixels plus one over the gates.
  Measured at 105 ms for the largest schematic; there is no need to restrict extraction to a
  selection, only analysis.

---

## Boundary semantics

Analysis runs on a **crop**, not on the whole document. That is what makes the boundary
principled rather than special-cased: in the crop, a net that used to be driven from outside
is driven by nothing, and the engine's existing definition of an input already covers it.

```
   whole document                    crop
   ┌──────────────────┐              ┌────────┐
   │   ──[>o─┐        │              │  ┐     │   the gate that drove this net
   │         ├──[>o── │    ──▶       │  ├──[>o│   is outside; in the crop the net
   │   ──────┘        │              │  ┘     │   is undriven, i.e. an input
   └──────────────────┘              └────────┘
```

- **NL-9** — The crop must be taken from the **document's source pixels**, never from
  `Circuit.frame`. The frame has inactive wires masked to `& 0x7F`, which is below the wire
  threshold, so cropping it would analyse a circuit with most of its wiring missing. This is
  the same hazard `CLAUDE.md` flags for the PNG encoder, in a new place.

- **NL-10** — A gate whose 3×3 pattern is partly outside the crop is not a gate. Its
  surviving pixels are wire, and the nets they belong to are cut nets. The tool reports this
  rather than silently analysing a circuit with a missing inverter.

---

## Verification

`scripts/verify/netlist.mjs`, run by `npm run verify`:

| Check | Expectation |
| --- | --- |
| All 22 schematics | extracted gate and net counts equal `Circuit.gateCount` / `wireCount` |
| Each of the four gate directions | one gate, correct `src`/`dst` nets |
| Crossover | no gate; the two nets stay distinct |
| Two gates driving one net | both appear with the same `dst` |
| A crop that bisects a gate | the gate is absent and its nets appear in `cut` |
| A deliberately corrupted detector | `extractNetlist` returns `ok: false` rather than a netlist |

That last row matters as much as the others: NL-3 is only worth having if it is known to
fire.
