# Phase 1 Data Model: Circuit Editor

**Feature**: `001-circuit-editor` | **Date**: 2026-09-21 | **Plan**: [plan.md](./plan.md)

Entities are described by what they hold and what must stay true of them. Method
signatures live in [contracts/](./contracts/).

---

## CircuitDocument

The editable bitmap: the circuit as *source pixels*, independent of any simulation
state or rendering of it. This is the entity the feature introduces, and the one
the rest of the design hangs off.

| Field | Type | Meaning |
| --- | --- | --- |
| `width`, `height` | `number` | Bitmap dimensions, fixed for a document's lifetime |
| `pixels` | `ImageData` | The source pixels. Mutable. Never contains rendered/dimmed values |
| `history` | `EditHistory` | Undo/redo stack (below) |
| `pending` | `PendingEdits` | Pixels changed since the last compile (below) |
| `dirty` | `boolean` | True when `pixels` differs from what is on disk |
| `name` | `string` | Display name, carried from the `FileSource` |

**Invariants**

- **D1 — Source, never render.** `pixels` holds original colours only. The dimming
  `Circuit.render()` applies to inactive wires (`& 0x7F`) must never be written
  here. Violating this and then saving would drive every unlit wire below the 224
  threshold and silently destroy the circuit. This is the single most damaging
  mistake available in the feature.
- **D2 — Opaque.** Every pixel's alpha is 255. The engine reads only RGB, and PNG
  round-tripping is only reliably lossless for opaque pixels (research R3).
- **D3 — Dimensions are immutable.** Resizing a circuit is out of scope; a document
  is replaced wholesale, not resized.
- **D4 — `dirty` is set by any mutation and cleared only by a successful save** or
  by loading a fresh document.
- **D5 — One-way derivation.** A `Circuit` is compiled *from* a document. Nothing
  compiled ever writes back into `pixels`.

**Lifecycle**

```
decode PNG ──▶ new CircuitDocument
                   │
      mutate ◀─────┤ (tools write pixels, append to pending + history)
                   │
     compile ──────┤ new Circuit(pixels, prevRender)   — clears pending
                   │
        save ──────┘ toBlob → handle.createWritable() or download — clears dirty
```

---

## PendingEdits

Pixels painted since the last compile, so they can be shown before the circuit
that knows about them exists (research R2).

| Field | Type | Meaning |
| --- | --- | --- |
| `entries` | `Map<number, number>` | Pixel index → packed RGBA, in the renderer's native word order |

**Invariants**

- **P1** — Bounded by stroke length, never by bitmap size.
- **P2** — Cleared by a successful compile, at which point the compiled `Circuit`
  reproduces those pixels itself.
- **P3** — The renderer composites these *over* the circuit frame, so a pending
  pixel always wins over the stale compiled value.

---

## EditHistory and Edit

Stroke-granular undo (research R5).

### Edit

One user-visible change — a completed stroke, a stamp placement, or an erase.

| Field | Type | Meaning |
| --- | --- | --- |
| `label` | `string` | For the UI, e.g. `"pencil"`, `"gate ▸ right"` |
| `indices` | `Int32Array` | Pixel indices this edit touched, each appearing once |
| `before` | `Uint32Array` | Packed RGBA at each index before the edit |
| `after` | `Uint32Array` | Packed RGBA at each index after the edit |

**Invariants**

- **E1 — Parallel arrays.** `indices`, `before` and `after` have equal length.
- **E2 — Each pixel once.** A pixel scribbled over repeatedly within one stroke
  appears a single time, holding its *pre-stroke* value in `before`. Otherwise undo
  would only step back one scribble.
- **E3 — Symmetric.** Undo writes `before`, redo writes `after`. Neither re-runs
  tool logic, so undo cannot drift from what the tool actually did.
- **E4 — Empty edits are discarded.** A stroke that changed nothing (drawing the
  same colour over itself) never enters the stack.

### EditHistory

| Field | Type | Meaning |
| --- | --- | --- |
| `undoStack` | `Edit[]` | Oldest first |
| `redoStack` | `Edit[]` | Cleared whenever a new edit is pushed |
| `touchedPixels` | `number` | Running total across `undoStack`, for the cap |

**Invariants**

- **H1 — Bounded by pixels, not entries.** When `touchedPixels` exceeds the budget,
  the oldest entries are dropped. This satisfies FR-018 regardless of bitmap size:
  one 400-pixel stroke costs 400 pixels of history whether the schematic is 45×27
  or 2048×2048.
- **H2 — A new edit clears redo** (FR-017's third scenario).
- **H3 — Undo/redo trigger a compile**, because the bitmap changed and the running
  circuit must follow.

---

## Tool and ToolContext

A drawing behaviour translating pointer events into pixel writes. Tools are
interchangeable; the editor owns exactly one active tool.

| Tool | Behaviour |
| --- | --- |
| `pencil` | Paints the active colour along the pointer path |
| `line` | Paints a straight run from press to release |
| `eraser` | Paints the insulation colour |
| `picker` | Reads a pixel's colour into the active colour; writes nothing |
| `gate` | Stamps a 3×3 inverter in the active direction |
| `crossover` | Stamps the 3×3 no-corner pattern |

**Invariants**

- **T1 — Tools write through the document**, never into `Circuit`, and never touch
  simulation state.
- **T2 — Gap filling.** A pointer moving faster than one pixel per event must still
  produce a connected stroke (FR-001). Tools interpolate between successive points;
  anything else leaves dotted, non-conducting "wires" — a bug that would look like
  an engine fault.
- **T3 — Clipping.** Writes outside the bitmap are dropped, not wrapped. Relevant
  for stamps placed near an edge (FR/edge case).
- **T4 — One stroke, one edit.** A tool's activity between press and release
  produces exactly one `Edit` and exactly one compile.
- **T5 — The picker is read-only** and produces no `Edit`.

---

## EditorState

| Field | Type | Meaning |
| --- | --- | --- |
| `mode` | `'simulate' \| 'edit'` | Which behaviour the left button has (research R8) |
| `tool` | `ToolId` | Active tool |
| `color` | `number` | Active wire colour, packed RGBA |
| `direction` | `'up' \| 'down' \| 'left' \| 'right'` | For the gate stamp |
| `stroke` | `StrokeState \| null` | In-progress stroke, if any |

**Invariants**

- **S1 — Colour validity.** `color` must satisfy `isWire` — at least one channel
  ≥ 224 (FR-006, research R7). The default is opaque white; the eraser's colour is
  opaque black and is not user-selectable.
- **S2 — Mode governs the left button only.** Pan, zoom, keyboard shortcuts and
  right-click behave identically in both modes, so navigation never changes meaning.
- **S3 — Mode, tool, colour and direction persist** in `localStorage` alongside the
  existing settings.

---

## Relationships

```
FileSource ──decode──▶ CircuitDocument ──compile──▶ Circuit
                         │  ▲  │                      │
                         │  │  └──▶ PendingEdits ─────┼──▶ Renderer
                         │  │                         │    (composites pending
                         │  └── EditHistory           │     over the frame)
                         │        (Edit[])            │
                         │                            │
                  EditorState ──▶ Tool ───────────────┘
                                  (writes pixels only)
```

One `CircuitDocument` at a time. Loading another file replaces it wholesale, after
the unsaved-changes guard (FR-015).

---

## Changes to existing entities

| Entity | Change |
| --- | --- |
| `Circuit` ([src/simulator.ts](../../src/simulator.ts)) | **None.** Still compile-once and readonly; its `ImageData` now arrives from a document. Its fidelity to `UMain.pas` is the reason nothing here touches it. |
| `FileSource` ([src/fileHandler.ts](../../src/fileHandler.ts)) | Gains write capability on the `handle` origin: a read-write permission request and a `write()` that refreshes the poll stamp so the app never reloads its own write (research R4). |
| `Renderer` ([src/renderer.ts](../../src/renderer.ts)) | Gains an overlay pass after the circuit blit: pending edits, pixel grid, hover cursor, stamp preview. |
| `Settings` ([src/settings.ts](../../src/settings.ts)) | Gains the four `EditorState` preferences, validated on read like the existing ones. |
