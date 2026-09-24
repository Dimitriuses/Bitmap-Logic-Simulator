// editor.ts — mode, tools, selection, paste and pointer routing.
//
// The left mouse button cannot both paint a pixel and pulse a wire, so there is
// an explicit mode. In Simulate mode every handler here returns false and the
// existing, already-verified interaction runs untouched. In Edit mode the editor
// owns *both* buttons: the left draws, the right erases, and nothing pokes wire
// state at all.

import { normaliseRect, type Rect } from './block.js';
import { EditorClipboard, type Floating } from './clipboard.js';
import { isWireColor, type Rgba } from './colors.js';
import type { CircuitDocument } from './document.js';
import { Palette } from './palette.js';
import type { GateDirection } from './stamps.js';
import { eraser } from './tools/eraser.js';
import { line } from './tools/line.js';
import { pencil } from './tools/pencil.js';
import { picker } from './tools/picker.js';
import { select } from './tools/select.js';
import { crossoverStamp, gateStamp } from './tools/stamp.js';
import {
  NO_PREVIEW,
  type Button,
  type PixelPoint,
  type Tool,
  type ToolContext,
  type ToolId,
} from './tools/types.js';

/**
 * Which mode the editor is in, and therefore what every input means.
 *
 * `analysis` is a READ-ONLY mode. It carries the selection so a region can be
 * chosen to study, and nothing else: no tool dispatch, no stroke, no paste.
 * That guarantee is a property of the mode rather than of individual handlers,
 * because a per-handler guarantee is satisfied by the handler nobody checked.
 */
export type EditorMode = 'simulate' | 'edit' | 'analysis';

/** Modes in which the editor owns the pointer rather than the simulation. */
export function ownsPointer(mode: EditorMode): boolean {
  return mode === 'edit' || mode === 'analysis';
}

export const MIN_BUS = 1;
export const MAX_BUS = 16;

/** A toolbar control that the wheel can adjust. */
export interface ToolParameter {
  readonly id: string;
  step(delta: number): void;
  describe(): string;
}

export class Editor {
  mode: EditorMode = 'simulate';
  direction: GateDirection = 'right';
  busWidth = 1;

  readonly palette: Palette;
  readonly clipboard = new EditorClipboard();

  readonly #tools: Map<ToolId, Tool>;
  #toolId: ToolId = 'pencil';
  #doc: CircuitDocument | null = null;

  /** The tool currently mid-stroke, and which button started it. */
  #active: Tool | null = null;
  #activeButton: Button = 'primary';
  #pointerId: number | null = null;

  /** Pointer offset within a floating block while it is being dragged. */
  #grabOffset: { dx: number; dy: number } | null = null;

  /**
   * @param onCommit called after anything that changed pixels, so the host can
   *   recompile exactly once per completed action.
   */
  constructor(
    private readonly onCommit: () => void,
    palette: Palette = new Palette()
  ) {
    this.palette = palette;
    this.#tools = new Map(
      [
        pencil(),
        line(),
        eraser(),
        picker(),
        gateStamp(),
        crossoverStamp(),
        select({
          setSelection: (rect) => this.clipboard.setSelection(rect),
          grabFloating: (p) => this.#grabFloating(p),
          dragFloating: (p) => this.#dragFloating(p),
          dropFloating: () => {
            this.#grabOffset = null;
          },
        }),
      ].map((t) => [t.id, t])
    );
  }

  get tool(): ToolId {
    return this.#toolId;
  }

  set tool(id: ToolId) {
    if (this.#tools.has(id)) this.#toolId = id;
  }

  get color(): Rgba {
    return this.palette.active;
  }

  get drawing(): boolean {
    return this.#active !== null;
  }

  get selection(): Rect | null {
    return this.clipboard.selection;
  }

  get floating(): Floating | null {
    return this.clipboard.floating;
  }

  setDocument(doc: CircuitDocument | null): void {
    this.#active = null;
    this.#pointerId = null;
    this.#grabOffset = null;
    this.clipboard.resetForDocument();
    this.#doc = doc;
  }

  /**
   * Reject a colour the engine would read as insulation, rather than silently
   * correcting it — a user drawing "wire" that does not conduct has no way to
   * discover why.
   */
  setColor(color: Rgba): boolean {
    return this.palette.add(color);
  }

  setBusWidth(n: number): void {
    this.busWidth = Math.min(MAX_BUS, Math.max(MIN_BUS, Math.round(n)));
  }

  /** The wheel-adjustable parameters, by the control that owns each. */
  parameters(): ToolParameter[] {
    return [
      {
        id: 'wire-color',
        step: (d) => this.palette.cycle(d),
        describe: () => `colour ${this.palette.activeIndex + 1}/${this.palette.colors.length}`,
      },
      {
        id: 'tool-line',
        step: (d) => this.setBusWidth(this.busWidth + Math.sign(d)),
        describe: () => (this.busWidth > 1 ? `bus of ${this.busWidth}` : 'single line'),
      },
    ];
  }

  #context(button: Button = 'primary'): ToolContext | null {
    const doc = this.#doc;
    if (!doc) return null;
    return {
      doc,
      color: this.palette.active,
      direction: this.direction,
      button,
      busWidth: this.busWidth,
      setColor: (c) => {
        if (isWireColor(c)) this.palette.add(c);
      },
    };
  }

  // ---------------------------------------------------------------------
  // Floating paste
  // ---------------------------------------------------------------------

  #grabFloating(p: PixelPoint): boolean {
    const f = this.clipboard.floating;
    if (!f) return false;
    const inside =
      p.x >= f.x && p.y >= f.y && p.x < f.x + f.block.width && p.y < f.y + f.block.height;
    if (!inside) return false;
    this.#grabOffset = { dx: p.x - f.x, dy: p.y - f.y };
    return true;
  }

  #dragFloating(p: PixelPoint): void {
    const g = this.#grabOffset;
    if (!g) return;
    this.clipboard.placeFloating(p.x - g.dx, p.y - g.dy);
  }

  // ---------------------------------------------------------------------
  // Clipboard actions, driven by resolveKey
  // ---------------------------------------------------------------------

  copy(): boolean {
    const doc = this.#doc;
    return doc ? this.clipboard.copy(doc) : false;
  }

  cut(): boolean {
    const doc = this.#doc;
    if (!doc || !this.clipboard.cut(doc)) return false;
    this.onCommit();
    return true;
  }

  clearRegion(): boolean {
    const doc = this.#doc;
    if (!doc || !this.clipboard.erase(doc)) return false;
    this.onCommit();
    return true;
  }

  /** Paste centred on the given bitmap point — usually the middle of the view. */
  paste(centreX: number, centreY: number): boolean {
    // A pending write may not exist in a read-only mode (MO-5).
    if (this.mode === 'analysis') return false;
    if (!this.clipboard.hasContent) return false;
    // Selecting the tool makes the block draggable straight away.
    if (this.clipboard.beginPaste(centreX, centreY)) {
      this.#toolId = 'select';
      return true;
    }
    return false;
  }

  commitPaste(): boolean {
    const doc = this.#doc;
    if (!doc) return false;
    const wrote = this.clipboard.commit(doc);
    if (wrote) this.onCommit();
    return wrote;
  }

  cancelPaste(): void {
    this.clipboard.cancel();
    this.#grabOffset = null;
  }

  rotatePaste(direction: 'cw' | 'ccw'): void {
    this.clipboard.rotateFloating(direction);
  }

  moveFloating(dx: number, dy: number): void {
    this.clipboard.moveFloating(dx, dy);
  }

  // ---------------------------------------------------------------------
  // Pointer nudging
  // ---------------------------------------------------------------------

  /**
   * Move the pointer to a pixel, the way a mouse move would.
   *
   * A browser cannot move the physical cursor, so the app keeps its own pointer
   * position and the arrow keys drive that. While a button is held this feeds
   * the active tool, which is what makes "hold the pencil and tap an arrow"
   * draw exactly one pixel — the precision case the mouse is bad at.
   *
   * Returns true when it fed a stroke, so the caller knows to repaint.
   */
  nudgeTo(p: PixelPoint): boolean {
    const tool = this.#active;
    if (!tool) return false;
    const ctx = this.#context(this.#activeButton);
    if (!ctx) return false;
    tool.move(p, ctx);
    return true;
  }

  // ---------------------------------------------------------------------
  // Pointer routing. Returns true when the editor consumed the event.
  // ---------------------------------------------------------------------

  handlePointerDown(e: PointerEvent, p: PixelPoint): boolean {
    if (this.mode === 'analysis') return this.#analysisPointerDown(e, p);
    if (this.mode !== 'edit') return false;
    if (e.button !== 0 && e.button !== 2) return false;

    const button: Button = e.button === 2 ? 'secondary' : 'primary';
    const tool = this.#tools.get(this.#toolId);
    const ctx = this.#context(button);
    if (!ctx || !tool) return false;

    // A tool that does nothing with the right button consumes it anyway: in
    // edit mode the right button must never fall through to wire toggling.
    if (button === 'secondary' && !tool.usesSecondary) return true;

    this.#active = tool;
    this.#activeButton = button;
    this.#pointerId = e.pointerId;
    if (tool.mutates) ctx.doc.beginStroke(tool.label(ctx));
    tool.down(p, ctx);
    return true;
  }

  /**
   * Analysis mode: the selection tool, and nothing else.
   *
   * Deliberately its own branch rather than a loosened edit-mode guard. Edit
   * mode dispatches whatever tool is selected, and any future tool added there
   * would silently become reachable here too. This names the one tool that is
   * allowed and refuses anything that could mutate, so the mode's promise does
   * not depend on remembering it later.
   */
  #analysisPointerDown(e: PointerEvent, p: PixelPoint): boolean {
    // Consume the right button without acting on it: in a mode that owns the
    // pointer it must never fall through to poking wire state.
    if (e.button === 2) return true;
    if (e.button !== 0) return false;

    const tool = this.#tools.get('select');
    const ctx = this.#context('primary');
    if (!tool || !ctx) return false;
    // Belt and braces: a mutating tool must never begin a stroke here, and if
    // `select` ever gained that flag this refuses rather than writing.
    if (tool.mutates) return true;

    this.#active = tool;
    this.#activeButton = 'primary';
    this.#pointerId = e.pointerId;
    tool.down(p, ctx);
    return true;
  }

  handlePointerMove(e: PointerEvent, p: PixelPoint): boolean {
    if (!this.#active || e.pointerId !== this.#pointerId) return false;
    const ctx = this.#context(this.#activeButton);
    if (!ctx) return false;
    this.#active.move(p, ctx);
    return true;
  }

  handlePointerUp(e: PointerEvent, p: PixelPoint): boolean {
    if (!this.#active || e.pointerId !== this.#pointerId) return false;
    const ctx = this.#context(this.#activeButton);
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
  cancelStroke(): void {
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

  /** Used by the select tool's host callbacks; exposed for the UI's hit tests. */
  rectFrom(ax: number, ay: number, bx: number, by: number): Rect | null {
    const doc = this.#doc;
    if (!doc) return null;
    return normaliseRect(ax, ay, bx, by, doc.width, doc.height);
  }
}
