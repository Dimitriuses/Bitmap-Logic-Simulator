# Quickstart: Validating the Editor Workflow

**Feature**: `002-editor-workflow` | **Date**: 2026-09-22

Scenarios map to the user stories and success criteria. Much of this feature is pure
geometry and pure state resolution, which is deliberate: those parts are checked headlessly
in one command, leaving the browser to verify only what genuinely needs a browser.

---

## Prerequisites

```sh
npm install
npm run build
npm run verify        # headless: baseline, stamps, geometry, rotation, keymap
npm run serve         # then open http://localhost:8000
```

Playwright, installed outside the repo, covers the interaction scenarios.

---

## Scenario 1 — Wires that connect (US1, SC-001, SC-002)

Headless, and the first thing to run.

| Check | Expectation |
| --- | --- |
| 45°, shallow and steep runs | exactly **1** net each — today they give 9, 5 and 5 |
| Horizontal and vertical runs | pixel-identical to the current output |
| Consecutive pixels from `walkConnected` | differ on one axis, by one |
| A→B versus B→A | same length, same endpoints, connected either way |

Then in the browser: drag the pencil fast diagonally across empty space and confirm the
wire count rises by exactly one. Speed matters — the bug only shows when pointer events
skip pixels, so drag faster than the event rate.

---

## Scenario 2 — Edit mode only edits (US2, SC-003)

1. Load any circuit and let it run. Note the cycle counter.
2. Press <kbd>E</kbd>.

**Expect**: the cycle counter stops. Leaving edit mode resumes it. Entering from an
already-paused circuit and leaving again leaves it paused.

3. In edit mode, click and right-click on lit and unlit wires.

**Expect**: no wire changes state, ever. Right-dragging with the pencil erases, and the
erased run is connected in the same way a drawn one is.

4. Press <kbd>Space</kbd> while editing.

**Expect**: it runs — editing live is still available, just no longer the default.

---

## Scenario 3 — Palette (US3, SC-008)

Headless: all 16 defaults pass the engine's wire test; cycling wraps both ways.

In the browser: scroll over the colour control and confirm the active colour steps one per
notch **and the canvas neither zooms nor pans**. Add a custom colour, reload, confirm it is
still there. Try to add `#202020` and confirm it is refused with a reason rather than
quietly brightened.

---

## Scenario 4 — Bus (US4, SC-004)

Headless, 80 cases: widths 1–16 across horizontal, vertical, 45°, shallow and steep runs.

**Expect**: exactly N nets every time. A merge shows up as N−1 and is the failure this
scenario exists to catch — a bus that looks right and is one wire.

In the browser: set the width by scrolling over the line tool, draw once, and confirm the
wire count rises by exactly the width shown.

---

## Scenario 5 — Selection and paste (US5, SC-005, SC-006, SC-007)

Headless first, because the expensive properties are cheap to check there:

| Check | Expectation |
| --- | --- |
| `rotateCW` ×4 | bit-identical to the original |
| A block with all four gate directions, rotated and committed | four gates, each behaving as the rotated direction, confirmed by driving them |
| Copy, then compare | document byte-identical |
| Paste, nudge 20×, rotate 2×, cancel | document byte-identical; **zero** recompiles |
| Paste, nudge, rotate, commit | **one** undo step, **one** recompile |

Then in the browser: select a region containing a gate, <kbd>Ctrl</kbd>+<kbd>X</kbd>,
<kbd>Ctrl</kbd>+<kbd>V</kbd>, nudge with the arrows, rotate 90°, <kbd>Enter</kbd>. Confirm
the gate count returns to its original value and the moved copy behaves like the original.
Then repeat and press <kbd>Escape</kbd> instead; confirm the document is untouched.

---

## Scenario 6 — Camera (US6)

Switch to the Paint.NET scheme. **Expect**: a plain notch pans vertically, Shift pans
horizontally, Ctrl zooms at the cursor — and in neither scheme does the browser's own page
zoom fire under Ctrl, or the page scroll under a plain notch. Switch back and confirm
classic behaves exactly as it does today, including the notch size. Reload and confirm the
choice stuck.

---

## Scenario 7 — Pointer nudging (US7, SC-011)

A browser cannot move the physical cursor, so the editor keeps its own pointer and the
arrows drive that. Check both halves:

1. In edit mode, pick the pencil, **hold the left button**, and press an arrow.

**Expect**: exactly one pixel is added in that direction, as if the mouse had moved one
pixel. Hold the arrow and it keeps going, faster the longer it is held.

2. Release, press an arrow a few times without any button held.

**Expect**: a marker moves one pixel per press. The physical cursor does not move — it
cannot — which is exactly why the marker is drawn.

3. Click without moving the mouse.

**Expect**: the click acts **where the marker is**, not where the physical cursor sits.

4. Move the real mouse.

**Expect**: the pointer snaps back to it and the marker disappears.

5. Press <kbd>Space</kbd>, in any state at all.

**Expect**: it pauses or resumes. There is no apply key, so Space is never overloaded —
worth checking with a paste floating, with a selection, and with neither.

---


## Scenario 8 — Key precedence (SC-009)

Exhaustive and headless: every key in the precedence table against every combination of
floating paste and selection, in both modes. The table in
[contracts/input.md](./contracts/input.md) is the expected-value table.

Worth confirming by hand afterwards, because it is the part users feel: with a paste
floating, <kbd>Escape</kbd> cancels the paste and does **not** open settings; with nothing
open, <kbd>Escape</kbd> opens settings as always.

---

## Scenario 9 — Nothing regressed (SC-010)

```sh
npm run verify
```

**Expect**: all 22 schematics still match their recorded counts, and the 21 stamp
assertions still pass. Then the browser regression suite from 001: simulate mode unchanged,
all existing shortcuts working, frame rates at their baselines.

Take the machine's load into account when reading frame rates — measurements on this
hardware have swung by 4× between runs depending on what else is resident. Compare against
a same-session A/B, not against numbers recorded on another day.

---

## Coverage

| Criterion | Scenario |
| --- | --- |
| SC-001 diagonal runs are one net | 1 |
| SC-002 axis-aligned unchanged | 1 |
| SC-003 no wire poking in edit mode | 2 |
| SC-004 bus of N gives N nets | 4 |
| SC-005 rotated gates behave | 5 |
| SC-006 cancelled paste is free | 5 |
| SC-007 commit costs one edit | 5 |
| SC-008 palette colours are valid | 3 |
| SC-009 key precedence | 8 |
| SC-010 schematics unchanged | 9 |
| SC-011 one arrow press, one pixel | 7 |
