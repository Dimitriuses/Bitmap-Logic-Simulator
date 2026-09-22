# Phase 1 Data Model: Editor Workflow

**Feature**: `002-editor-workflow` | **Date**: 2026-09-22 | **Plan**: [plan.md](./plan.md)

Entities added or changed by this feature. Signatures live in
[contracts/](./contracts/); 001's entities ([data-model.md](../001-circuit-editor/data-model.md))
are unchanged unless listed at the end.

---

## PixelBlock

A detached rectangle of pixels. One type serves three jobs: what a selection captures, what
the clipboard holds, and what floats during a paste.

| Field | Type | Meaning |
| --- | --- | --- |
| `width`, `height` | `number` | Size in bitmap pixels |
| `pixels` | `Uint32Array` | Packed Rgba, row-major, `width * height` entries |

**Invariants**

- **B1 — Self-contained.** A block holds no reference to the document it came from. Cutting
  the region it was copied from, or loading another circuit, must not change it.
- **B2 — Opaque.** Every entry has alpha 255, like the document it will be written into.
- **B3 — Rotation is a pure pixel transform.** Rotating 90° transposes and reverses; it does
  **not** inspect or rewrite gate patterns. It does not need to: the corner mask rotates with
  the pixels, so a `right` gate becomes a `down` gate of its own accord (research R2).
- **B4 — Rotation swaps the dimensions**; a 7×3 block becomes 3×7.
- **B5 — Rotating four times returns the original**, bit for bit. This is the cheapest
  available check that the transform is exact.

---

## Selection

A rectangle over the document. At most one exists.

| Field | Type | Meaning |
| --- | --- | --- |
| `x`, `y` | `number` | Top-left, in bitmap pixels |
| `width`, `height` | `number` | Always positive |

**Invariants**

- **S1 — Normalised.** Dragging up and to the left yields the same rectangle as dragging
  down and to the right; width and height are never negative.
- **S2 — Clipped to the bitmap.** A drag that leaves the canvas selects only what exists.
- **S3 — A zero-area selection is no selection** and is discarded rather than kept as an
  empty rectangle.
- **S4 — Selection alone changes nothing.** Only copy, cut, delete and paste act.

---

## FloatingPaste

A `PixelBlock` positioned over the document and not yet part of it.

| Field | Type | Meaning |
| --- | --- | --- |
| `block` | `PixelBlock` | The pixels, after any rotation |
| `x`, `y` | `number` | Top-left, in bitmap pixels |

**Invariants**

- **F1 — Editor state, not document state.** Nothing is written until it is confirmed, which
  is what makes cancelling free (SC-006) and keeps the cost at one recompile (SC-007). It is
  drawn by the renderer's overlay, alongside pending edits and tool previews.
- **F2 — Confirming writes the whole rectangle**, insulation included (FR-020). A
  transparent paste would leave fragments of whatever was underneath showing through a
  cut-and-paste, which is worse than either alternative.
- **F3 — Clipped on commit.** A block hanging off the edge writes only its in-bounds pixels;
  it never wraps to the next row.
- **F4 — One edit, one recompile.** However far it was nudged or however often it was
  rotated, committing costs exactly one undo step.
- **F5 — At most one exists.** A second paste replaces the first only after the first is
  resolved; pasting while one floats is ignored.
- **F6 — Discarded with the document.** Loading another circuit drops it, behind the
  existing unsaved-changes guard.

---

## Palette

| Field | Type | Meaning |
| --- | --- | --- |
| `defaults` | `readonly Rgba[]` | The 16 built-ins, fixed |
| `custom` | `Rgba[]` | User additions, in the order added |
| `activeIndex` | `number` | Position in the concatenation of the two |

**Invariants**

- **P1 — Every entry is a wire colour.** Defaults and custom alike must pass the engine's
  own test: at least one channel ≥ 224. An entry that fails is refused with a reason rather
  than silently corrected — wire that does not conduct looks exactly like wire that does.
- **P2 — No duplicates.** Adding a colour already present moves the selection to it instead
  of appending.
- **P3 — Cycling wraps** in both directions and never lands outside the list.
- **P4 — Defaults are not removable**, so the palette can never be emptied into an
  unusable state.
- **P5 — Custom entries and the active index persist** with the other editor preferences.

---

## ToolParameter

What a toolbar control exposes to the wheel. Two exist: the active colour and the bus width.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Which control owns it |
| `step` | `(delta: number) => void` | Advance by wheel notches, sign-carrying |
| `describe` | `() => string` | What to show after a change |

**Invariants**

- **T1 — Bounded.** Stepping never leaves the valid range: the palette wraps (P3), the bus
  width clamps to 1–16.
- **T2 — The wheel is consumed.** A notch over a parameter control must not also scroll the
  page or reach the camera, which means `preventDefault` and therefore a listener registered
  `{ passive: false }` (research R7).
- **T3 — Controls without a parameter ignore the wheel** entirely; the canvas must not react
  on their behalf.

---

## KeyboardCursor

| Field | Type | Meaning |
| --- | --- | --- |
| `x`, `y` | `number` | Bitmap pixel |
| `active` | `boolean` | Whether it is driving and visible |

**Invariants**

- **K1 — Activated by an arrow key** in edit mode, and visible exactly while active. This is
  what resolves the Space conflict (research R4): if the cursor is on screen, Space applies
  the tool; if it is not, Space pauses, as it always has.
- **K2 — Yields to the pointer.** Moving the mouse over the canvas deactivates it.
- **K3 — One pixel per press**, with auto-repeat that accelerates while held.
- **K4 — Clamped to the bitmap.**
- **K5 — Applying uses the same path as a pointer click**, so a keyboard-drawn stroke is
  indistinguishable from a mouse-drawn one, including in undo.

---

## CameraScheme

`'classic' | 'paint'`. Which wheel behaviour is in effect over the canvas.

| Scheme | Wheel | Shift+wheel | Ctrl+wheel |
| --- | --- | --- | --- |
| `classic` | zoom at cursor | zoom at cursor | zoom at cursor |
| `paint` | pan vertically | pan horizontally | zoom at cursor |

**Invariants**

- **C1 — Neither scheme lets the browser act.** Page scroll and, under Ctrl, browser zoom
  must both be suppressed.
- **C2 — Zoom is always at the cursor**, in whichever scheme reaches it, so the two agree
  about the one thing they share.
- **C3 — Persisted** with the other editor preferences.

---

## Changes to existing entities

| Entity | Change |
| --- | --- |
| `Circuit` ([src/simulator.ts](../../src/simulator.ts)) | **None.** Still frozen. |
| `CircuitDocument` ([src/document.ts](../../src/document.ts)) | `line()` routed through the 4-connected walk (FR-001). Gains `readBlock(selection)` and `writeBlock(block, x, y)`, both honouring the existing stroke framing so a paste is one `Edit`. |
| `EditorState` ([src/editor.ts](../../src/editor.ts)) | Gains `selection`, `floating`, `cursor`, `busWidth`, `cameraScheme`, and the palette's active colour replaces the single stored colour. |
| `Overlay` ([src/renderer.ts](../../src/renderer.ts)) | Gains the selection marquee, the floating paste, and the keyboard cursor. The existing pending/preview/hover/grid members are unchanged. |
| `EditorPrefs` ([src/settings.ts](../../src/settings.ts)) | Gains `customColors`, `activeColorIndex`, `busWidth`, `cameraScheme`; all validated on read as the existing ones are. |
| `Tool` ([src/tools/types.ts](../../src/tools/types.ts)) | Gains an optional secondary-button behaviour, so the pencil can erase on right-drag without a second tool. |
