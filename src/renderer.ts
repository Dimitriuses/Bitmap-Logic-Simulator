// renderer.ts — viewport maths and canvas presentation.
//
// The transforms are the ones from UMain.pas:470-478, kept in the same form so
// pan/zoom feels identical to the desktop original.

import type { PixelBlock, Rect } from './block.js';
import { toCss, type Rgba } from './colors.js';
import type { Circuit } from './simulator.js';

/** A point in either canvas (CSS pixel) space or bitmap space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

const MIN_ZOOM_EXP = -8;
const MAX_ZOOM_EXP = 6;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Pan/zoom state. `center` is an offset in bitmap pixels from the centre of the
 * bitmap; zoom is 2^zoomExp.
 */
export class Viewport {
  centerX = 0;
  centerY = 0;
  zoomExp = 0;
  bitmapWidth = 1;
  bitmapHeight = 1;
  canvasWidth = 1;
  canvasHeight = 1;

  get zoom(): number {
    return Math.pow(2, this.zoomExp);
  }

  /** toScreen: (w - bSize*0.5 - center) * zoom + cSize*0.5 */
  toScreen(worldX: number, worldY: number): Point {
    const z = this.zoom;
    return {
      x: (worldX - this.bitmapWidth * 0.5 - this.centerX) * z + this.canvasWidth * 0.5,
      y: (worldY - this.bitmapHeight * 0.5 - this.centerY) * z + this.canvasHeight * 0.5,
    };
  }

  /** toWorld: (s - cSize*0.5) / zoom + center + bSize*0.5 */
  toWorld(screenX: number, screenY: number): Point {
    const z = this.zoom;
    return {
      x: (screenX - this.canvasWidth * 0.5) / z + this.centerX + this.bitmapWidth * 0.5,
      y: (screenY - this.canvasHeight * 0.5) / z + this.centerY + this.bitmapHeight * 0.5,
    };
  }

  /**
   * Zoom keeping the world point under (screenX, screenY) fixed
   * (UMain.pas:542-547). deltaExp of 120/256 matches one Windows wheel notch.
   */
  zoomAt(screenX: number, screenY: number, deltaExp: number): void {
    const mx = screenX - this.canvasWidth * 0.5;
    const my = screenY - this.canvasHeight * 0.5;
    let z = this.zoom;
    this.centerX += mx / z;
    this.centerY += my / z;
    this.zoomExp = clamp(this.zoomExp + deltaExp, MIN_ZOOM_EXP, MAX_ZOOM_EXP);
    z = this.zoom;
    this.centerX -= mx / z;
    this.centerY -= my / z;
  }

  /** Middle-drag pan: center := center - delta/zoom (UMain.pas:552-555). */
  panBy(screenDX: number, screenDY: number): void {
    const z = this.zoom;
    this.centerX -= screenDX / z;
    this.centerY -= screenDY / z;
  }

  /** Centre the bitmap and scale it to fill the canvas with a small margin. */
  fit(margin = 0.94): void {
    this.centerX = 0;
    this.centerY = 0;
    const scale = Math.min(
      this.canvasWidth / this.bitmapWidth,
      this.canvasHeight / this.bitmapHeight
    );
    this.zoomExp = clamp(Math.log2(Math.max(scale, 1e-6) * margin), MIN_ZOOM_EXP, MAX_ZOOM_EXP);
  }
}

/** The page background, also the colour behind the bitmap on the canvas. */
const BACKDROP = '#0b0d11';

/**
 * Below this zoom a bitmap pixel is too small for grid lines to mean anything —
 * they would swamp the pixel they are meant to delimit.
 */
const GRID_MIN_ZOOM = 8;

/** What the editor asks the renderer to draw on top of the circuit. */
export interface Overlay {
  /** Pixels painted since the last compile, which the Circuit does not know about. */
  readonly pending: ReadonlyMap<number, Rgba>;
  /** What the active tool would write if committed now. */
  readonly preview: ReadonlyMap<number, Rgba>;
  /** Bitmap pixel under the pointer, or null. */
  readonly hover: Point | null;
  readonly showGrid: boolean;
  /** The selection marquee, in bitmap pixels. */
  readonly selection?: Rect | null;
  /** A paste that is floating over the document but not part of it. */
  readonly floating?: { block: PixelBlock; x: number; y: number } | null;
  /**
   * The app's pointer position, drawn only when the arrow keys have moved it
   * away from the physical cursor. A browser cannot move the real cursor, so
   * this marker is the only thing telling the user where clicks will land.
   */
  readonly cursor?: Point | null;
  /**
   * Pixels of a net being pointed at somewhere else — the net list, or the
   * schematic. Flat indices into the bitmap, as `pending` uses.
   *
   * A set rather than a map because every pixel is drawn in one colour: the
   * question it answers is "which pixels are this net", not "what colour are
   * they", and the net's own colours are still visible underneath.
   */
  readonly highlight?: ReadonlySet<number> | null;
}

/** The colour a highlighted net is washed with. Matches the schematic view. */
const HIGHLIGHT = '#f2705e';

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  return ctx;
}

/**
 * Draws a Circuit's frame buffer onto the visible canvas.
 *
 * The circuit is blitted into an offscreen canvas at 1:1, then stretched by the
 * viewport — the same two-step the original does with StretchDraw.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private circuit: Circuit | null = null;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = context2d(canvas);
    this.buffer = document.createElement('canvas');
    this.bufferCtx = context2d(this.buffer);
  }

  setCircuit(circuit: Circuit): void {
    this.circuit = circuit;
    this.buffer.width = circuit.width;
    this.buffer.height = circuit.height;
  }

  /** Size the backing store to the CSS box, accounting for device pixel ratio. */
  resize(viewport: Viewport): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    // The viewport works in CSS pixels so mouse coordinates need no scaling.
    viewport.canvasWidth = rect.width;
    viewport.canvasHeight = rect.height;
  }

  draw(viewport: Viewport): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const circuit = this.circuit;
    if (!circuit) return;

    this.bufferCtx.putImageData(circuit.frame, 0, 0);

    const topLeft = viewport.toScreen(0, 0);
    const bottomRight = viewport.toScreen(circuit.width, circuit.height);
    const d = this.dpr;
    const x = topLeft.x * d;
    const y = topLeft.y * d;
    const w = (bottomRight.x - topLeft.x) * d;
    const h = (bottomRight.y - topLeft.y) * d;

    // Nearest-neighbour while magnifying so single-pixel wires stay crisp;
    // smoothing only while shrinking, where it stops thin wires disappearing.
    ctx.imageSmoothingEnabled = viewport.zoom < 1;
    ctx.drawImage(this.buffer, x, y, w, h);
  }

  /**
   * Draw the editor's overlay on top of the circuit.
   *
   * Pending edits go here rather than into the circuit's frame buffer because
   * render() rewrites every wire pixel from `states` each cycle, so a freshly
   * erased wire would flicker back. Drawing to the visible canvas keeps the
   * document → circuit derivation strictly one way.
   */
  drawOverlay(viewport: Viewport, overlay: Overlay): void {
    const circuit = this.circuit;
    if (!circuit) return;
    const hasWork =
      overlay.pending.size > 0 ||
      overlay.preview.size > 0 ||
      overlay.hover !== null ||
      overlay.showGrid ||
      !!overlay.selection ||
      !!overlay.floating ||
      !!overlay.cursor ||
      (overlay.highlight?.size ?? 0) > 0;
    if (!hasWork) return; // costs nothing in simulate mode

    const { ctx } = this;
    const d = this.dpr;
    const zoom = viewport.zoom;
    const origin = viewport.toScreen(0, 0);
    // Screen position of bitmap pixel (x, y), in device pixels.
    const sx = (x: number) => (origin.x + x * zoom) * d;
    const sy = (y: number) => (origin.y + y * zoom) * d;
    const size = Math.max(zoom * d, 1);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    // Clip to the bitmap so overlay pixels never bleed past its edges.
    ctx.beginPath();
    ctx.rect(sx(0), sy(0), circuit.width * zoom * d, circuit.height * zoom * d);
    ctx.clip();

    const paint = (pixels: ReadonlyMap<number, Rgba>, alpha: number) => {
      if (pixels.size === 0) return;
      ctx.globalAlpha = alpha;
      for (const [index, color] of pixels) {
        const x = index % circuit.width;
        const y = (index / circuit.width) | 0;
        ctx.fillStyle = toCss(color);
        ctx.fillRect(sx(x), sy(y), size, size);
      }
      ctx.globalAlpha = 1;
    };

    paint(overlay.pending, 1);
    paint(overlay.preview, 0.55);

    // A net pointed at from elsewhere. Drawn over the rendered frame rather
    // than replacing it, so the wire's own lit/unlit state still reads through.
    if (overlay.highlight && overlay.highlight.size > 0) {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = HIGHLIGHT;
      for (const index of overlay.highlight) {
        const x = index % circuit.width;
        const y = (index / circuit.width) | 0;
        ctx.fillRect(sx(x), sy(y), size, size);
      }
      ctx.globalAlpha = 1;
    }

    if (overlay.showGrid && zoom >= GRID_MIN_ZOOM) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#8b93a3';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Only the visible span, so a 2048-wide bitmap does not cost 2048 lines.
      const left = Math.max(0, Math.floor(viewport.toWorld(0, 0).x));
      const top = Math.max(0, Math.floor(viewport.toWorld(0, 0).y));
      const right = Math.min(
        circuit.width,
        Math.ceil(viewport.toWorld(viewport.canvasWidth, viewport.canvasHeight).x) + 1
      );
      const bottom = Math.min(
        circuit.height,
        Math.ceil(viewport.toWorld(viewport.canvasWidth, viewport.canvasHeight).y) + 1
      );
      for (let x = left; x <= right; x++) {
        ctx.moveTo(sx(x), sy(top));
        ctx.lineTo(sx(x), sy(bottom));
      }
      for (let y = top; y <= bottom; y++) {
        ctx.moveTo(sx(left), sy(y));
        ctx.lineTo(sx(right), sy(y));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // A floating paste sits above the document but is not part of it, so it is
    // drawn here rather than written — that is what makes cancelling free.
    const floating = overlay.floating;
    if (floating) {
      floating.block.forEach((bx, by, color) => {
        ctx.fillStyle = toCss(color);
        ctx.fillRect(sx(floating.x + bx), sy(floating.y + by), size, size);
      });
      ctx.strokeStyle = '#f2765e';
      ctx.lineWidth = Math.max(1, d);
      ctx.setLineDash([6 * d, 4 * d]);
      ctx.strokeRect(
        sx(floating.x) + 0.5,
        sy(floating.y) + 0.5,
        floating.block.width * zoom * d,
        floating.block.height * zoom * d
      );
      ctx.setLineDash([]);
    }

    if (overlay.selection) {
      const s = overlay.selection;
      ctx.strokeStyle = '#5ec8f2';
      ctx.lineWidth = Math.max(1, d);
      ctx.setLineDash([5 * d, 3 * d]);
      ctx.strokeRect(sx(s.x) + 0.5, sy(s.y) + 0.5, s.width * zoom * d, s.height * zoom * d);
      ctx.setLineDash([]);
    }

    if (overlay.hover) {
      // Outline the pixel the viewport transform actually resolves to. Deriving
      // it from a canvas-pixel corner instead is off by one at high zoom,
      // because tile boundaries land on fractional canvas coordinates.
      ctx.strokeStyle = '#5ec8f2';
      ctx.lineWidth = Math.max(1, d);
      ctx.strokeRect(
        sx(overlay.hover.x) + 0.5,
        sy(overlay.hover.y) + 0.5,
        Math.max(size - 1, 1),
        Math.max(size - 1, 1)
      );
    }

    // Deliberately louder than the hover outline: it appears only when the
    // app's pointer has been nudged away from the physical cursor, and that
    // divergence is the one genuinely confusing thing about arrow nudging.
    if (overlay.cursor) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = Math.max(2, d * 2);
      const pad = Math.max(2, d * 2);
      ctx.strokeRect(
        sx(overlay.cursor.x) - pad,
        sy(overlay.cursor.y) - pad,
        size + pad * 2,
        size + pad * 2
      );
    }

    ctx.restore();
  }
}
