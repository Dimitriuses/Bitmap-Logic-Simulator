# Contract: Geometry

**Feature**: `002-editor-workflow` | **Module**: `src/geometry.ts`

Pure functions. No DOM, no document, no circuit — which is what lets every rule below be
checked headlessly.

```ts
/** Visit every pixel of a 4-connected run from (x0,y0) to (x1,y1), inclusive. */
export function walkConnected(
  x0: number, y0: number, x1: number, y1: number,
  visit: (x: number, y: number) => void
): void;

/** Perpendicular offsets for the conductors of an N-wide bus along a given run. */
export function busOffsets(
  x0: number, y0: number, x1: number, y1: number, count: number
): readonly { dx: number; dy: number }[];
```

---

## `walkConnected`

- **G-1 — Four-connected.** Consecutive visited pixels differ on exactly one axis, by
  exactly one. The function must never advance both axes in a single step. This is the whole
  point: the engine joins wires only on the four cardinal sides, so a diagonal step leaves a
  gap that looks like a wire and is not one.
- **G-2 — Axis-aligned runs are unchanged.** A horizontal or vertical run must visit exactly
  the same pixels, in the same order, as the Bresenham implementation it replaces (FR-002).
  Satisfied naturally by stepping one axis per iteration: on an axis-aligned run the other
  axis never steps.
- **G-3 — Inclusive of both endpoints**, and starts at `(x0, y0)`.
- **G-4 — Deterministic.** The same arguments always produce the same sequence; the
  staircase never alternates between runs.
- **G-5 — Order-independent shape.** Walking B→A visits the same set of pixels as A→B. The
  order may differ; the set may not, or a line would change when drawn backwards.
- **G-6 — No allocation per pixel.** This runs inside pointer-move handling and inside bus
  drawing, where it is called `count` times per stroke.

### The defect this replaces

Measured against the shipped engine before the change:

| Run | Nets with Bresenham | Required |
| --- | --- | --- |
| 45°, (10,2) → (2,10) | 9 | 1 |
| shallow, (2,2) → (18,6) | 5 | 1 |
| horizontal, (2,2) → (18,2) | 1 | 1 |

Both the line tool and `BrushTool.move()`'s gap-filling used it, so fast diagonal pencil
drags produced broken wire too.

---

## `busOffsets`

- **G-7 — Pitch depends on the slope.** Axis-aligned runs use a pitch of 2; every other
  slope uses 3. A 4-connected staircase occupies two rows in some columns, so a pitch of 2
  lets neighbouring conductors touch on a diagonal.
- **G-8 — Offsets are perpendicular to the dominant axis.** Shallow runs (`|dx| ≥ |dy|`)
  offset vertically; steep runs offset horizontally. The bus then reads as parallel at any
  slope.
- **G-9 — The first conductor is the drawn line.** `busOffsets(..., n)[0]` is `{dx: 0, dy: 0}`,
  so a bus of 1 is exactly the plain line (FR-004 acceptance 4).
- **G-10 — Exactly `count` offsets**, all distinct.

### Verified

The pitch rule was checked exhaustively before implementation: for every width 1–16, across
horizontal, vertical, 45°, shallow and steep runs, drawing the bus and compiling it yields
**exactly N nets**, never N−1 from a merge. That is SC-004 discharged at design time.

```
pitch 2, 45 degrees          pitch 3, 45 degrees
  # #                          # #
  . # #   <- shared row          . # #
  # #     <- MERGED              . . .   <- clear gap
  . # #                        # #
```

---

## Verification

`scripts/verify/geometry.mjs`, run by `npm run verify`:

| Check | Expectation |
| --- | --- |
| Diagonal, shallow and steep runs | exactly 1 net each |
| Horizontal and vertical runs | pixel-identical to Bresenham |
| Every consecutive pair from `walkConnected` | differs on one axis by one |
| A→B versus B→A | same pixel set |
| Bus widths 1–16 × five slopes | exactly N nets, 80 cases |

All of it runs against the real `dist/simulator.js` with no browser.
