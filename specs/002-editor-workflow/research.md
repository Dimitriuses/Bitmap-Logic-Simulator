# Phase 0 Research: Editor Workflow

**Feature**: `002-editor-workflow` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

Ten questions had to be settled. Three were settled by measurement against the real
engine rather than by argument, and one of those turned up a defect in shipped code.

---

## R1. The line tool is broken, and so is the pencil's gap-filling

**Finding**: `CircuitDocument.line()` rasterises with Bresenham, which moves diagonally.
The engine connects wires only on the four cardinal sides. So a diagonal run is not a wire
— it is a row of isolated pixels that happens to look like one.

Measured against the shipped `dist/simulator.js`:

| Run | Nets produced | |
| --- | --- | --- |
| 45°, (10,2) → (2,10) | **9** | should be 1 |
| shallow, (2,2) → (18,6) | **5** | should be 1 |
| horizontal, (2,2) → (18,2) | 1 | correct |

This affects more than the line tool. `BrushTool.move()` calls the same `line()` to fill
the gap between pointer events, so any pencil drag fast enough to skip a pixel diagonally
lays down broken wire. The drawing looks continuous. It does not conduct. Nothing reports
an error, because a gap in a wire is not an error — it is just a different circuit.

**Decision**: Replace Bresenham with a 4-connected walk that never moves both axes in one
step, and route the pencil, the line tool and the bus through it.

```
Bresenham (today)          4-connected (required)
  # . . .                    # # . .
  . # . .                    . # # .
  . . # .                    . . # #
  . . . #                    . . . #
  4 nets                     1 net
```

The implementation advances one axis per iteration using the same error term, so an
axis-aligned run is byte-for-byte what it was before (FR-002) — the second axis simply
never steps. Verified: a horizontal run still produces the same pixel count and one net.

**Alternatives considered**: a "supercover" rasteriser that emits every cell the ideal line
passes through. It is 4-connected, but it also fattens the line at shallow angles, which
would change what the existing pencil does on nearly-horizontal drags. Rejected for that
side effect.

---

## R2. Rotation preserves gate behaviour for free

**Question**: US5 rotates a pasted block. Gates are corner patterns, so does rotating the
bitmap produce a valid gate, a broken one, or one pointing the wrong way?

**Finding**: a plain 90° bitmap rotation is exactly right, because the corner mask rotates
with it. `right` is `SW|NW`; rotating clockwise sends SW→NW and NW→NE, giving `NW|NE`,
which is `down` — and a rightward arrow turned a quarter turn clockwise does point down.

Verified end-to-end on the real engine by rotating each of the four gates, compiling, and
driving the source to confirm the output inverts on the expected side:

| Gate | Rotated CW | Gate count | Behaviour |
| --- | --- | --- | --- |
| right | down | 1 | drives S from N ✓ |
| down | left | 1 | drives W from E ✓ |
| left | up | 1 | drives N from S ✓ |
| up | right | 1 | drives E from W ✓ |

**Decision**: Rotate the pixels and nothing else. No gate-aware special casing, no lookup
of "what does this pattern become" — the geometry already encodes it. This removes what
looked like the riskiest part of US5.

---

## R3. Bus spacing: the obvious pitch is wrong for diagonals

**Question**: conductors need a gap or they merge into one net. One pixel of gap — pitch 2
— is the obvious answer and is what the spec's assumption started from.

**Finding**: pitch 2 is correct only for axis-aligned runs. A 4-connected diagonal staircase
occupies **two rows in some columns**, so two runs offset by 2 touch:

```
pitch 2, 45 degrees          pitch 3, 45 degrees
  # #                          # #
  . # #     <- row shared        . # #
  # #       <- MERGED            . . .   <- clear gap
  . # #                        # #
                                 . # #
```

**Decision**: pitch 2 when the run is axis-aligned, 3 otherwise. Offsets are applied
perpendicular to the dominant axis — vertically for shallow runs, horizontally for steep
ones — so the bus reads as parallel regardless of slope.

Verified exhaustively: for every width 1–16, across horizontal, vertical, 45°, shallow and
steep runs, the rule yields **exactly N nets** every time. That is SC-004 discharged at
design time rather than hoped for at implementation time.

**Alternatives considered**: always pitch 3. Simpler to state, and it wastes a pixel row on
the axis-aligned buses that are the common case, making tight schematics harder to draw.

---

## R4. The arrows move the pointer, not a cursor of their own

**First attempt**: the arrows drove a separate keyboard cursor and Space applied the tool
at it. That put Space in conflict with pause, which edit mode is supposed to keep, and the
conflict had to be arbitrated by a visibility rule: Space paints while the cursor is on
screen, pauses while it is not. It worked, and it was the subtlest rule in the design.

**Decision**: the arrows move the editor's *pointer* instead. While a button is held, a
nudge feeds the active tool exactly as a mouse move does — so holding the pencil and
tapping an arrow draws one pixel, which is the precision case the mouse is bad at and the
reason to want this at all.

**Why this is better**: there is no apply key, so Space is never overloaded and the
arbitration rule disappears. It is also how the user already works: you press the button
you would press anyway, and steer.

**The platform constraint, stated plainly**: a browser cannot move the operating system's
cursor. No API exists, and Pointer Lock only hides it and reports relative motion. So the
editor keeps its own pointer position and the physical cursor stays where it is. The two
can therefore diverge, which is the one genuinely confusing thing here, and the reason a
marker is drawn as soon as the arrows are used and removed the moment the real mouse
moves. Clicks act on the editor's pointer, so what the marker shows is what happens.

**Alternatives considered**:

- *Pointer Lock*, which hides the real cursor and would make the app's pointer the only
  one. It removes the divergence entirely and costs a mode the user has to enter and
  escape, over a marker that solves the same problem. Rejected as disproportionate.
- *Keeping the separate cursor and moving apply to Enter.* Enter is the paste-commit key
  and the platform's button-activation key; see KM-7.

---


## R5. One precedence order for the overloaded keys

Several features want Enter, Escape and the arrow keys. Rather than let each grab what it
can, there is one chain, innermost first:

| Key | Floating paste | Selection exists | Edit mode | Simulate mode |
| --- | --- | --- | --- | --- |
| Arrows | move the paste | move the pointer | move the pointer | — |
| Enter | commit the paste | — | — | — |
| Escape | cancel the paste | clear the selection | toggle settings | toggle settings |
| Delete | — | clear the region | — | — |
| Space | pause | pause | pause | pause |

Escape keeps its existing meaning only when nothing else is open, which matches how every
other application treats it. Space is deliberately constant across the whole table: R4
removed the apply key that used to compete for it. FR-026 is this table.

---


## R6. The clipboard stays inside the page

**Decision**: an in-memory `PixelBlock`, not the system clipboard.

**Rationale**: the async clipboard API can carry an image, but reading it needs a
permission prompt, writing needs a `ClipboardItem` with an encoded PNG, and Safari only
allows either from inside a user gesture with its own restrictions. All of that to make
Ctrl+C interoperate with a paint program — which is the workflow this editor exists to
replace. Not worth it; recorded as a possible later addition.

---

## R7. Routing the wheel: tool parameters versus the camera

Two features want the wheel: parameter scrubbing over a toolbar button (colour, bus width)
and the camera schemes.

**Decision**: the target element decides. A toolbar button may declare a parameter; while
the pointer is over one, the wheel adjusts it and the event is consumed. Over the canvas,
the wheel always belongs to the camera. They never contend because they are different
elements, and the toolbar sits outside the canvas.

The one trap is that a wheel listener must call `preventDefault` to stop the page scrolling
or, under Ctrl, the browser zooming — and a listener that wants to do that must be
registered with `{ passive: false }`. The canvas already does this; the toolbar buttons
must too, or Ctrl+wheel in the Paint.NET scheme will zoom the whole page.

---

## R8. A floating paste is editor state, not document state

**Decision**: the floating block lives in the editor and is drawn by the renderer's
overlay. The document learns about it only on Enter, as one stroke.

**Rationale**: it is the only model that makes cancellation free (SC-006 — a cancelled
paste must leave the document bit-identical) and keeps the cost at one recompile (SC-007).
Writing the block on every nudge would mean an edit and a recompile per arrow press, which
on a large schematic is a quarter-second per pixel of movement.

It also composes with what already exists: the overlay already draws pending edits and tool
previews, and a floating paste is the same kind of thing — pixels shown but not committed.

---

## R9. The default palette

**Decision**: sixteen colours, each with at least one channel ≥ 224, spanning the hue
circle with three softer tints at the end for annotation:

```
#FFFFFF  #FF0000  #FF8000  #FFFF00
#80FF00  #00FF00  #00FF80  #00FFFF
#0080FF  #0000FF  #8000FF  #FF00FF
#FF0080  #FFE0B0  #C0FFC0  #E0E0FF
```

**Rationale**: the engine's wire test is per-channel, not luminance — `#0000FF` is a
perfectly good wire despite being dark to the eye, which is why the bundled schematics use
saturated blue and green for buses. A palette organised by hue therefore costs nothing in
validity and is how these circuits are actually colour-coded.

Custom colours are appended and validated against the same test, and the whole palette
persists with the other editor preferences.

---

## R10. Pause on enter, restore on exit

**Decision**: entering edit mode records whether the simulation was running and pauses it;
leaving restores what was recorded. Space remains available throughout.

**Rationale**: "restore what it was" rather than "always resume" is what keeps the toggle
honest — entering edit mode from an already-paused circuit and leaving it should not start
the circuit running. This is one boolean, and the alternative produces a surprise exactly
once per user, permanently.

Note this supersedes 001's US1 framing, where edits landed in a running circuit. The
capability survives — it is now something the user opts into with Space rather than the
default. The state carry-over machinery that made it work is untouched.

---

## Resolved unknowns

Connectivity algorithm (R1), rotation semantics (R2), bus geometry (R3), the Space conflict
(R4), key precedence (R5), clipboard scope (R6), wheel routing (R7), paste model (R8),
palette (R9) and pause semantics (R10) are all closed.

Nothing is deferred. The Web Worker recompile from 001 R1 remains out of scope and
unaffected: this feature does not increase recompile frequency — the paste model
deliberately keeps it at one per committed action.
