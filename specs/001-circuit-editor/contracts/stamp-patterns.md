# Contract: Stamp Patterns

**Feature**: `001-circuit-editor` | **Authority**: `detectGates` in
[src/simulator.ts](../../../src/simulator.ts), itself a port of `preprocessBitmap`
in `UMain.pas` (lines 310–332).

This contract is a transcription, not a derivation. If it ever disagrees with
`detectGates`, `detectGates` is right and this file is a bug.

## The engine's rule

For a candidate centre at `(x, y)`, the engine requires:

1. The centre pixel is **not** wire.
2. All four cardinal neighbours — N, S, E, W — **are** wire.
3. The four corners form a bitmask: `NW = 1`, `NE = 2`, `SE = 4`, `SW = 8`,
   each bit set when that corner is wire.

The mask selects behaviour. **Any mask not listed below is ignored entirely** — the
pattern simply is not a gate, with no error and no visual difference. That silence
is the reason this contract exists.

| Mask | Value | Behaviour | Source → Destination |
| --- | --- | --- | --- |
| — | 0 | Crossover: H and V cross without connecting | — |
| `NW\|NE` | 3 | Inverter pointing **down** | N → S |
| `NE\|SE` | 6 | Inverter pointing **left** | E → W |
| `SE\|SW` | 12 | Inverter pointing **up** | S → N |
| `SW\|NW` | 9 | Inverter pointing **right** | W → E |

A gate points *away* from its filled corners. Every gate is an inverter; there is
no other gate type.

## The five patterns

`#` = wire (active colour), `.` = insulation (black). Row order is top to bottom.

```
   down          left           up           right        crossover
  # # #         . # #         . # .         # # .         . # .
  # . #         # . #         # . #         # . #         # . #
  . # .         . # #         # # #         # # .         . # .
```

As literal data, indexed `[row][col]` with the centre at `[1][1]`:

| Pattern | Row 0 | Row 1 | Row 2 |
| --- | --- | --- | --- |
| `down` | `# # #` | `# . #` | `. # .` |
| `left` | `. # #` | `# . #` | `. # #` |
| `up` | `. # .` | `# . #` | `# # #` |
| `right` | `# # .` | `# . #` | `# # .` |
| `crossover` | `. # .` | `# . #` | `. # .` |

## Requirements on the implementation

- **SP-1** — `stamps.ts` MUST express these as literal 3×3 tables. It MUST NOT
  compute corners from a direction vector: that re-implements the engine's encoding
  a second time, in a second place, where it can drift.
- **SP-2** — A stamp writes all nine pixels, including the insulation ones. Writing
  only the wire pixels would leave a stale corner from whatever was underneath and
  silently produce a different gate, or none.
- **SP-3** — Writes MUST be clipped to the bitmap. A stamp near an edge writes only
  its in-bounds pixels and MUST NOT wrap to the next row.
- **SP-4** — Wire pixels take the active colour, which is guaranteed to satisfy
  `isWire`. Insulation pixels are written as opaque black (`#000000`).
- **SP-5** — A stamp is one `Edit` and triggers exactly one recompile.

## Verification

Each pattern must be shown to register with the engine — not merely to look right.
For every one of the five, stamp it onto a blank bitmap with a wire stub on each
cardinal side, compile, and assert:

| Pattern | Expected |
| --- | --- |
| `down`, `left`, `up`, `right` | `gateCount` increases by exactly 1 |
| `crossover` | `gateCount` unchanged; the H and V stubs remain **separate** nets |

For the four gates, additionally drive the source stub and confirm the destination
stub settles to the inverse, and confirm the direction is the one named — a gate
that increments the count but points the wrong way passes a naive test and fails
the user.

This is runnable headlessly with the existing harness: shim `globalThis.ImageData`,
build the bitmap as a `Uint8ClampedArray`, and import `dist/simulator.js` directly.
No browser needed. Satisfies **SC-007**.
