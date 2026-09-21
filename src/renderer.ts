// renderer.ts — viewport maths and canvas presentation.
//
// The transforms are the ones from UMain.pas:470-478, kept in the same form so
// pan/zoom feels identical to the desktop original.

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
}
