// schematic-view.ts — drawing a Schematic, and pointing at it.
//
// A second rendering path alongside renderer.ts, which blits a tile-cached
// bitmap. A schematic is vector geometry with different invalidation, so the
// two share the thing worth sharing — the Viewport class, whose toScreen and
// toWorld are pure coordinate maths — and nothing else.
//
// Hit testing is against the laid-out geometry, never against pixels. The
// diagram is not an image of the circuit; it is a set of shapes that know which
// nets they stand for.

import { Viewport, type Point } from './renderer.js';
import type { NetId } from './netlist.js';
import type { Schematic, SchematicSymbol } from './schematic.js';

/** Half-extents of a gate body, in schematic units. */
const BODY_W = 30;
const BODY_H = 30;
const TERMINAL_R = 7;
/** Slack around a shape when deciding whether the pointer is on it. */
const HIT_SLOP = 6;

export interface SchematicHighlight {
  /** Nets to draw as highlighted, usually because the pixel view is hovered. */
  readonly nets?: ReadonlySet<NetId>;
  readonly symbolId?: number | null;
  /** True once the circuit changed under this diagram. */
  readonly stale?: boolean;
}

export interface SchematicHit {
  readonly symbol: SchematicSymbol | null;
  readonly net: NetId | null;
}

/** Matches the page background in css/style.css, so the two views agree. */
const BACKGROUND_CSS = '#0b0d11';
const INK = '#d7dde8';
const DIM = '#8b93a3';
const ACCENT = '#5ec8f2';
const FEEDBACK = '#e0b558';
const HOT = '#f2705e';

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  return ctx;
}

export class SchematicView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private schematic: Schematic | null = null;
  private dpr = 1;

  /** Its own camera, so switching views does not lose either one's position. */
  readonly viewport = new Viewport();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = context2d(canvas);
  }

  setSchematic(schematic: Schematic | null): void {
    this.schematic = schematic;
    if (!schematic) return;
    // The viewport thinks in "bitmap" units; for a schematic those are layout
    // units, with a margin so symbols at the edge are not clipped.
    this.viewport.bitmapWidth = Math.max(1, schematic.width + BODY_W * 2);
    this.viewport.bitmapHeight = Math.max(1, schematic.height + BODY_H * 2);
  }

  get current(): Schematic | null {
    return this.schematic;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.viewport.canvasWidth = rect.width;
    this.viewport.canvasHeight = rect.height;
  }

  /** Fit the whole diagram in view. */
  fit(): void {
    this.viewport.fit();
  }

  draw(highlight: SchematicHighlight = {}): void {
    const { ctx } = this;
    this.resize();

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BACKGROUND_CSS;
    ctx.fillRect(0, 0, this.viewport.canvasWidth, this.viewport.canvasHeight);

    const s = this.schematic;
    if (!s) {
      ctx.fillStyle = DIM;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Select a region and analyse it to see its schematic.',
        this.viewport.canvasWidth / 2,
        this.viewport.canvasHeight / 2
      );
      ctx.restore();
      return;
    }

    const hotNets = highlight.nets ?? new Set<NetId>();
    const zoom = this.viewport.zoom;

    // --- edges first, so symbols sit on top of them
    ctx.lineWidth = Math.max(1, 1.4 * zoom);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const e of s.edges) {
      const hot = hotNets.has(e.net);
      ctx.strokeStyle = hot ? HOT : e.isFeedback ? FEEDBACK : DIM;
      // Feedback is dashed as well as coloured: colour alone is not a signal
      // everyone can read.
      ctx.setLineDash(e.isFeedback ? [6 * zoom, 4 * zoom] : []);
      ctx.beginPath();
      e.points.forEach((p, i) => {
        const q = this.viewport.toScreen(p.x + BODY_W, p.y + BODY_H);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // --- symbols
    const showLabels = zoom > 0.45;
    for (const sym of s.symbols) {
      const hot = hotNets.has(sym.net) || highlight.symbolId === sym.id;
      this.#drawSymbol(sym, hot, showLabels);
    }

    // A diagram describing a circuit that no longer exists says so, rather
    // than looking authoritative (SV-5).
    if (highlight.stale) {
      ctx.fillStyle = FEEDBACK;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('The circuit has changed since this was drawn. Analyse again.', 12, 12);
    }

    ctx.restore();
  }

  #drawSymbol(sym: SchematicSymbol, hot: boolean, showLabels: boolean): void {
    const { ctx } = this;
    const c = this.viewport.toScreen(sym.x + BODY_W, sym.y + BODY_H);
    const zoom = this.viewport.zoom;
    const w = BODY_W * zoom;
    const h = BODY_H * zoom;

    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.strokeStyle = hot ? HOT : INK;
    ctx.fillStyle = BACKGROUND_CSS;

    if (sym.kind === 'input' || sym.kind === 'output') {
      const r = TERMINAL_R * zoom;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = hot ? HOT : sym.kind === 'input' ? ACCENT : '#6fd08c';
      ctx.fill();
      if (showLabels) {
        ctx.fillStyle = hot ? HOT : DIM;
        ctx.font = `${Math.max(9, 11 * zoom)}px ui-monospace, monospace`;
        ctx.textAlign = sym.kind === 'input' ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(sym.label, c.x + (sym.kind === 'input' ? -r - 4 : r + 4), c.y);
      }
      return;
    }

    // Gate body: a rectangle with the kind written in it, plus the bubble that
    // marks an inverting output. Deliberately not the ANSI curved shapes —
    // at 130 symbols a legible label beats a silhouette.
    const half = w * 0.5;
    const halfH = h * 0.42;
    ctx.beginPath();
    ctx.rect(c.x - half, c.y - halfH, w, halfH * 2);
    ctx.fillStyle = '#1e2430';
    ctx.fill();
    ctx.stroke();

    const inverting = sym.kind === 'NOT' || sym.kind === 'NAND' || sym.kind === 'NOR';
    if (inverting) {
      ctx.beginPath();
      ctx.arc(c.x + half + 3 * zoom, c.y, 3 * zoom, 0, Math.PI * 2);
      ctx.fillStyle = BACKGROUND_CSS;
      ctx.fill();
      ctx.stroke();
    }

    if (showLabels) {
      ctx.fillStyle = hot ? HOT : INK;
      ctx.font = `${Math.max(8, 10 * zoom)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sym.label, c.x, c.y);
    }
  }

  /**
   * What is under this canvas point.
   *
   * Geometry, not pixels: each symbol's box is tested directly, then each edge
   * segment by distance. Nearest wins, so overlapping shapes resolve the way a
   * user expects rather than by draw order.
   */
  hitTest(canvasX: number, canvasY: number): SchematicHit {
    const s = this.schematic;
    if (!s) return { symbol: null, net: null };

    const world = this.viewport.toWorld(canvasX, canvasY);
    const wx = world.x - BODY_W;
    const wy = world.y - BODY_H;

    for (const sym of s.symbols) {
      const halfW = sym.kind === 'input' || sym.kind === 'output' ? TERMINAL_R : BODY_W * 0.5;
      const halfH = sym.kind === 'input' || sym.kind === 'output' ? TERMINAL_R : BODY_H * 0.42;
      if (
        wx >= sym.x - halfW - HIT_SLOP &&
        wx <= sym.x + halfW + HIT_SLOP &&
        wy >= sym.y - halfH - HIT_SLOP &&
        wy <= sym.y + halfH + HIT_SLOP
      ) {
        return { symbol: sym, net: sym.net };
      }
    }

    let best: { net: NetId; d: number } | null = null;
    for (const e of s.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const d = distanceToSegment(wx, wy, e.points[i - 1], e.points[i]);
        if (d <= HIT_SLOP && (!best || d < best.d)) best = { net: e.net, d };
      }
    }
    return { symbol: null, net: best ? best.net : null };
  }
}

function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
