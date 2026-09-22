// editor.ts — mode, active tool, and pointer routing.
//
// The left mouse button cannot both paint a pixel and pulse a wire, and guessing
// which the user meant would make the most common action unpredictable. So there
// is an explicit mode. In Simulate mode every handler here returns false and the
// existing, already-verified interaction runs untouched; only in Edit mode does
// the left button draw.
//
// Mode governs the left button and nothing else: pan, zoom, right-click and
// every keyboard shortcut behave identically either way.

import { isWireColor, WIRE_WHITE, type Rgba } from './colors.js';
import type { CircuitDocument } from './document.js';
import type { GateDirection } from './stamps.js';
import { eraser } from './tools/eraser.js';
import { line } from './tools/line.js';
import { pencil } from './tools/pencil.js';
import { picker } from './tools/picker.js';
import { crossoverStamp, gateStamp } from './tools/stamp.js';
import { NO_PREVIEW, type PixelPoint, type Tool, type ToolContext, type ToolId } from './tools/types.js';

export type EditorMode = 'simulate' | 'edit';

function buildTools(): Map<ToolId, Tool> {
  const all = [pencil(), line(), eraser(), picker(), gateStamp(), crossoverStamp()];
  return new Map(all.map((t) => [t.id, t]));
}

export class Editor {
  mode: EditorMode = 'simulate';
  direction: GateDirection = 'right';

  readonly #tools = buildTools();
  #toolId: ToolId = 'pencil';
  #color: Rgba = WIRE_WHITE;
  #doc: CircuitDocument | null = null;
  /** The tool currently mid-stroke, if any. */
  #active: Tool | null = null;
  #pointerId: number | null = null;

  /**
   * @param onCommit called after a stroke that changed pixels, so the host can
   *   recompile exactly once per stroke.
   */
  constructor(private readonly onCommit: () => void) {}

  get tool(): ToolId {
    return this.#toolId;
  }

  set tool(id: ToolId) {
    if (this.#tools.has(id)) this.#toolId = id;
  }

  get color(): Rgba {
    return this.#color;
  }

  get drawing(): boolean {
    return this.#active !== null;
  }

  setDocument(doc: CircuitDocument | null): void {
    this.#active = null;
    this.#pointerId = null;
    this.#doc = doc;
  }

  /**
   * Reject a colour the engine would read as insulation, rather than silently
   * correcting it — a user drawing "wire" that does not conduct has no way to
   * discover why.
   */
  setColor(color: Rgba): boolean {
    if (!isWireColor(color)) return false;
    this.#color = color;
    return true;
  }

  #context(): ToolContext | null {
    const doc = this.#doc;
    if (!doc) return null;
    return {
      doc,
      color: this.#color,
      direction: this.direction,
      setColor: (c) => {
        this.#color = c;
      },
    };
  }

  // ---------------------------------------------------------------------
  // Pointer routing. Returns true when the editor consumed the event.
  // ---------------------------------------------------------------------

  handlePointerDown(e: PointerEvent, p: PixelPoint): boolean {
    if (this.mode !== 'edit' || e.button !== 0) return false;
    const ctx = this.#context();
    const tool = this.#tools.get(this.#toolId);
    if (!ctx || !tool) return false;

    this.#active = tool;
    this.#pointerId = e.pointerId;
    // The editor frames the stroke, not the tool, so every tool yields exactly
    // one Edit and one recompile.
    if (tool.mutates) ctx.doc.beginStroke(tool.label(ctx));
    tool.down(p, ctx);
    return true;
  }

  handlePointerMove(e: PointerEvent, p: PixelPoint): boolean {
    if (!this.#active || e.pointerId !== this.#pointerId) return false;
    const ctx = this.#context();
    if (!ctx) return false;
    this.#active.move(p, ctx);
    return true;
  }

  handlePointerUp(e: PointerEvent, p: PixelPoint): boolean {
    if (!this.#active || e.pointerId !== this.#pointerId) return false;
    const ctx = this.#context();
    const tool = this.#active;
    this.#active = null;
    this.#pointerId = null;
    if (!ctx) return false;

    tool.up(p, ctx);
    if (tool.mutates) {
      const edit = ctx.doc.endStroke();
      // A stroke that changed nothing must not cost a recompile.
      if (edit) this.onCommit();
    }
    return true;
  }

  /** Abandon an in-progress stroke, e.g. on pointercancel. */
  cancel(): void {
    if (!this.#active) return;
    this.#active = null;
    this.#pointerId = null;
    const doc = this.#doc;
    if (doc) {
      const edit = doc.endStroke();
      if (edit) this.onCommit();
    }
  }

  previewAt(p: PixelPoint): ReadonlyMap<number, Rgba> {
    if (this.mode !== 'edit') return NO_PREVIEW;
    const ctx = this.#context();
    const tool = this.#tools.get(this.#toolId);
    if (!ctx || !tool) return NO_PREVIEW;
    return tool.preview(p, ctx);
  }
}
