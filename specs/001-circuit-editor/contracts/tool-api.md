# Contract: Tools and Editor

**Feature**: `001-circuit-editor` | **Modules**: `src/tools/*.ts`, `src/editor.ts`,
plus the renderer overlay

---

## `src/tools/types.ts` — the Tool interface

```ts
export type ToolId = 'pencil' | 'line' | 'eraser' | 'picker' | 'gate' | 'crossover';

/** A point in bitmap pixel coordinates, already floored. */
export interface PixelPoint { readonly x: number; readonly y: number }

export interface ToolContext {
  readonly doc: CircuitDocument;
  /** Active wire colour; guaranteed to satisfy isWire (S1). */
  readonly color: Rgba;
  readonly direction: 'up' | 'down' | 'left' | 'right';
  /** Picker reports its result here. */
  setColor(color: Rgba): void;
}

export interface Tool {
  readonly id: ToolId;
  /** Label for the Edit this tool produces, e.g. "gate ▸ right". */
  label(ctx: ToolContext): string;
  /** True when the tool writes pixels. False for the picker (T5). */
  readonly mutates: boolean;

  down(p: PixelPoint, ctx: ToolContext): void;
  move(p: PixelPoint, ctx: ToolContext): void;
  up(p: PixelPoint, ctx: ToolContext): void;

  /** Pixels this tool would write if committed now, for the hover preview. */
  preview(p: PixelPoint, ctx: ToolContext): ReadonlyMap<number, Rgba>;
}
```

**Requirements**

- **TL-1 — Pixels only.** A tool may call `doc.set` / `doc.line` and `ctx.setColor`.
  It must not touch `Circuit`, simulation state, the viewport or the DOM (T1).
- **TL-2 — Connected strokes.** `move` must interpolate from the previous point, so
  a fast pointer cannot leave gaps (T2, FR-001). A dotted "wire" does not conduct
  and reads as an engine fault.
- **TL-3 — Stroke framing is the editor's job**, not the tool's. The editor calls
  `beginStroke` before `down` and `endStroke` after `up`, guaranteeing one `Edit`
  and one recompile per stroke (T4).
- **TL-4 — `preview` is pure.** It must not mutate anything; it is called on every
  pointer move.
- **TL-5 — Stamps ignore `move`.** `gate` and `crossover` commit on `down` and are
  not drag-extended.
- **TL-6 — `line` previews continuously** between press point and current point, so
  the user sees the run before releasing.

---

## `src/editor.ts` — mode and routing

```ts
export type EditorMode = 'simulate' | 'edit';

export class Editor {
  mode: EditorMode;
  tool: ToolId;
  color: Rgba;
  direction: 'up' | 'down' | 'left' | 'right';

  /**
   * Route a pointer event. Returns true when the editor consumed it, false to
   * let the existing simulate-mode handling run.
   */
  handlePointerDown(e: PointerEvent, world: PixelPoint): boolean;
  handlePointerMove(e: PointerEvent, world: PixelPoint): boolean;
  handlePointerUp(e: PointerEvent, world: PixelPoint): boolean;

  /** Rejects a colour the engine would read as insulation (S1, FR-006). */
  setColor(color: Rgba): boolean;

  previewAt(p: PixelPoint): ReadonlyMap<number, Rgba>;
}
```

**Requirements**

- **ED-1 — Mode governs the left button only** (S2). Middle-drag pan, wheel zoom,
  right-click toggle and every keyboard shortcut behave identically in both modes.
  Navigation must never change meaning.
- **ED-2 — Simulate mode is untouched.** With `mode === 'simulate'` every handler
  returns false and the existing, already-verified interaction runs unchanged.
- **ED-3 — Recompile on `up`**, never on `move` (FR-009).
- **ED-4 — Colour validation** rejects and reports rather than silently correcting,
  so the user learns why a colour is unavailable.
- **ED-5 — Touch.** Editing targets pointer input; existing touch pan/pinch/tap must
  not regress. In edit mode a single touch drag may draw, but pinch-to-zoom keeps
  priority the moment a second finger lands.

---

## Renderer overlay

Drawn after the circuit blit, in this order:

1. **Pending edits** — pixels painted since the last compile, composited over the
   frame so drawing appears within one frame (P3, FR-007, SC-002).
2. **Pixel grid** — one-pixel lines on bitmap-pixel boundaries, only above a zoom
   threshold where they are legible (FR-020).
3. **Tool preview** — the result of `previewAt`, at reduced opacity.
4. **Hover cursor** — an outline around the pixel a click would affect (FR-019).

**Requirements**

- **RO-1** — The overlay never writes into `Circuit.frame` or the document; it draws
  to the visible canvas only.
- **RO-2** — The grid threshold must be the point at which a bitmap pixel is large
  enough for grid lines not to swamp it; below it, the grid is not drawn at all.
- **RO-3** — The cursor outline must mark the pixel `toWorld()` actually resolves
  to. Deriving it from a canvas-pixel corner instead is off by one at high zoom,
  because tile boundaries fall on fractional canvas coordinates.
- **RO-4** — The overlay costs nothing in simulate mode with no pending edits.
