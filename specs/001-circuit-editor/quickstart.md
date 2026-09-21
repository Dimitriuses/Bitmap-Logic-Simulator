# Quickstart: Validating the Circuit Editor

**Feature**: `001-circuit-editor` | **Date**: 2026-09-21

How to prove the feature works end to end. Scenarios map to the spec's user
stories and success criteria; each states what to run and what must be true
afterwards.

---

## Prerequisites

```sh
npm install
npm run build          # scripts/gen-examples.mjs + tsc -> dist/
npm run serve          # python -m http.server 8000, from the repository root
# open http://localhost:8000
```

HTTP is mandatory — a `file://` page cannot read pixels back out of an image.

Two harnesses already exist and both apply here:

- **Headless engine checks** — shim `globalThis.ImageData`, decode a PNG to raw
  RGBA with Pillow, import `dist/simulator.js` directly. Best for anything about
  wire/gate counts, because it needs no browser.
- **Playwright** — for anything involving pointer input, rendering or file access.
  Real Chrome and Edge are installed; Firefox and WebKit come from Playwright.

Known-good baselines, unchanged by this feature: `Flip Flop` = 20 gates,
`Enigma2` = 11 515 gates, `Flash Memory 256x12` = 2048×2048 / 45 004 gates.

---

## Scenario 0 — The document layer changed nothing (Phase A)

The architectural move lands before any UI. It must be invisible.

1. Run the full Playwright suite that verified the port.
2. Compile all 22 schematics under `projects/` headlessly and compare counts to
   the baselines.

**Expect**: every check that passed before still passes; every wire and gate count
identical. A single changed count means `compile()` is not feeding `Circuit` the
same pixels the old path did.

---

## Scenario 1 — Draw a wire, watch it conduct (US1, SC-004)

1. Open `projects/External_Shemes/Flip Flop.png`.
2. Switch to **Edit** mode, pencil tool, zoom in until pixels are comfortably large.
3. Note the wire count in the status bar.
4. Drag across the insulation separating two nets.

**Expect**:

- Painted pixels appear **during** the drag, before any recompile (FR-007, SC-002).
- On release, the wire count drops by exactly one — the two nets became one.
- The gate count is unchanged.
- Simulation never visibly resets; wires that were lit before are still lit (SC-004).
- Exactly one recompile occurs for the whole stroke (FR-009) — instrument
  `compile()` with a counter to confirm, rather than judging by eye.

Then erase a pixel mid-wire: the net splits, the wire count rises by one, and the
half no longer driven goes dark.

---

## Scenario 2 — Every stamp registers (US2, SC-007)

Run headlessly; it needs no browser and is the cheapest guard against the silent
failure mode described in [contracts/stamp-patterns.md](./contracts/stamp-patterns.md).

For each of the five patterns, build a small bitmap with the stamp plus a wire stub
on each cardinal side, compile, and assert:

| Pattern | Expected |
| --- | --- |
| `down`, `left`, `up`, `right` | `gateCount` +1, and driving the source stub drives the destination stub to the inverse |
| `crossover` | `gateCount` unchanged, and the H and V stubs remain separate nets |

**Expect**: 5/5. Check direction explicitly — a gate that counts but points the
wrong way passes a careless test and fails the user.

---

## Scenario 3 — Round-trip (US3, SC-005, FR-016)

Per browser, because encoder behaviour differs (research R3).

1. Open a schematic via **Open File** (needed for a handle).
2. Draw a change; note wire and gate counts.
3. Save.
4. Reload the page and reopen the same file.

**Expect**:

- Chrome/Edge: the file on disk is updated in place; counts match exactly.
- Firefox/Safari: a download is produced; opening it gives matching counts.
- The live-reload poller does **not** fire a reload in response to the app's own
  write (FR-014). Watch for a spurious recompile in the second or so after saving.
- On Safari, individual colour channels may come back off by one on colour-rich
  schematics. This is expected and documented; wire classification is unaffected, so
  counts must still match. If a *count* changes, that is a real bug.

Also confirm a bundled example loaded over HTTP offers download and not write —
there is no handle to write through (FH-2).

---

## Scenario 4 — Undo is exact (US4, SC-006)

1. Capture the document's pixels.
2. Draw a stroke; capture again.
3. Undo; capture a third time.

**Expect**: the third capture is **bit-identical** to the first — compare every
byte, not the counts, since two different bitmaps can share a wire count. Redo must
reproduce the second capture exactly. Drawing after an undo must clear the redo
stack (FR-017).

Then the memory bound (FR-018): on `Flash Memory 256x12`, draw twenty strokes and
confirm history growth is proportional to pixels touched, not to the 2048×2048
bitmap. Twenty full snapshots would be ~320 MB; the sparse diffs should be
kilobytes.

---

## Scenario 5 — Build something from nothing (SC-001)

The end-to-end proof, done by hand:

1. Load any schematic and erase a clear working area, or start from a blank PNG.
2. Draw an input wire, stamp an inverter, draw a wire from its output, stamp a
   second inverter, draw an output wire.
3. Leave Edit mode, and in Simulate mode left-click the input wire.

**Expect**: the first inverter's output goes LOW while held, the second returns
HIGH, and releasing restores both. A working two-gate chain built entirely in the
app, with no paint program involved.

---

## Scenario 6 — Editing aids (US5)

**Expect**: above the zoom threshold a pixel grid appears; the hovered pixel is
outlined; the outline marks the pixel a click actually modifies — verify by
clicking the outlined pixel and confirming *that* pixel changed (RO-3). At high
zoom, deriving the cursor from a canvas-pixel corner rather than the viewport
transform is off by one, and the symptom is exactly this: the paint lands one pixel
away from the outline.

The gate tool must preview its 3×3 pattern before committing.

---

## Scenario 7 — Nothing regressed

**Expect**: in **Simulate** mode the app behaves exactly as it does today —
left-click drives a wire HIGH, right-click toggles, middle-drag pans, wheel zooms
at the cursor, every keyboard shortcut works, and frame rates match the recorded
baselines (60 fps in Chrome/Edge/Firefox on circuits up to ~11 500 gates). Mode
must change the left button and nothing else (ED-1, ED-2).

Confirm also that the unsaved-changes guard fires when loading another circuit or
closing the tab with a dirty document (FR-015).

---

## Coverage

| Criterion | Scenario |
| --- | --- |
| SC-001 build a chain in-app | 5 |
| SC-002 responsive drawing | 1 |
| SC-003 recompile ≤250 ms | 1 (instrument `compile()`) |
| SC-004 state preserved | 1 |
| SC-005 save/reopen identical | 3 |
| SC-006 undo bit-exact | 4 |
| SC-007 every stamp registers | 2 |
