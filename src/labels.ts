// labels.ts — names for nets, that survive the circuit changing.
//
// A LABEL IS BOUND TO A PIXEL, NEVER TO A NET ID.
//
// Net ids are assigned per compile. Draw one pixel and the whole labelling can
// shift, so a name bound to an id would quietly end up on a different wire —
// the worst kind of failure here, because the name still looks right. A
// coordinate is stable, and it is also what the user actually chose: they
// clicked a place on the circuit.
//
// Resolving a label is therefore a question, not an assumption: which net
// occupies this pixel now? The answer may be "none", and when it is, the label
// is reported as UNRESOLVED — kept, shown, and neither deleted nor reattached
// to whatever net happens to be nearest. Both of those would be lies about what
// the user meant.
//
// TWO STORES, AND NEITHER WINS SILENTLY:
//
//   sidecar        `<circuit>.labels.json`, the portable record. Commits to
//                  git, survives editing the .png in any paint program, follows
//                  the project to another machine.
//   working copy   browser storage, so a forgotten save never costs work.
//
// Labels are never written into the image. Not into its pixels, and not into
// its metadata either: an ordinary open-modify-save by an image editor silently
// drops a PNG text chunk, and editing the .png externally is exactly how
// circuits in this project are worked on.

import type { Circuit } from './simulator.js';
import type { NetId } from './netlist.js';

export type LabelKind = 'net' | 'gate';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Label {
  /** A pixel in DOCUMENT coordinates. Never a net id. */
  readonly anchor: Point;
  readonly name: string;
  readonly kind: LabelKind;
}

export interface Resolution {
  /** Labels that currently sit on a net, by that net's id in this compile. */
  readonly byNet: ReadonlyMap<NetId, Label>;
  /** Anchored inside the region, but no net is there any more. */
  readonly unresolved: readonly Label[];
  /** Anchored outside the region being looked at. Not a problem, just elsewhere. */
  readonly outside: readonly Label[];
}

const STORAGE_PREFIX = 'blsim.labels.';
export const SIDECAR_FORMAT = 'bitmap-logic-labels';
export const SIDECAR_VERSION = 1;

const anchorKey = (p: Point): string => `${p.x},${p.y}`;

/**
 * Resolve labels against a compiled circuit.
 *
 * `origin` is the top-left of the region `circuit` was compiled from, so that
 * document-space anchors can be asked about a cropped selection. A label
 * outside the region is not unresolved — it is simply somewhere else.
 */
export function resolveLabels(
  labels: readonly Label[],
  circuit: Circuit,
  origin: Point = { x: 0, y: 0 }
): Resolution {
  const byNet = new Map<NetId, Label>();
  const unresolved: Label[] = [];
  const outside: Label[] = [];

  for (const label of labels) {
    const x = label.anchor.x - origin.x;
    const y = label.anchor.y - origin.y;
    if (x < 0 || y < 0 || x >= circuit.width || y >= circuit.height) {
      outside.push(label);
      continue;
    }
    const net = circuit.wireAt(x, y);
    if (net === 0) {
      // The pixel is no longer wire. Say so; do not guess.
      unresolved.push(label);
      continue;
    }
    // First label wins for a net, deterministically by anchor, so two names on
    // one net cannot depend on insertion order.
    const existing = byNet.get(net);
    if (!existing || anchorKey(label.anchor) < anchorKey(existing.anchor)) {
      byNet.set(net, label);
    }
  }

  return { byNet, unresolved, outside };
}

/**
 * The one naming function every view calls.
 *
 * There is exactly one of these so that a name cannot appear in the netlist
 * list but not in the truth table, which is how "the name is used everywhere"
 * quietly stops being true.
 */
export function makeNamer(resolution: Resolution): (net: NetId) => string | null {
  return (net) => resolution.byNet.get(net)?.name ?? null;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class LabelStore {
  #labels = new Map<string, Label>();

  constructor(readonly circuitName: string) {}

  get labels(): Label[] {
    return [...this.#labels.values()].sort(
      (a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x
    );
  }

  get size(): number {
    return this.#labels.size;
  }

  /** Name the net at this pixel. An empty name clears it. */
  set(anchor: Point, name: string, kind: LabelKind = 'net'): void {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.#labels.delete(anchorKey(anchor));
      return;
    }
    this.#labels.set(anchorKey(anchor), { anchor: { x: anchor.x, y: anchor.y }, name: trimmed, kind });
  }

  clear(anchor: Point): void {
    this.#labels.delete(anchorKey(anchor));
  }

  clearAll(): void {
    this.#labels.clear();
  }

  replaceAll(labels: readonly Label[]): void {
    this.#labels.clear();
    for (const l of labels) this.#labels.set(anchorKey(l.anchor), l);
  }

  resolve(circuit: Circuit, origin?: Point): Resolution {
    return resolveLabels(this.labels, circuit, origin);
  }

  // --- browser working copy

  /**
   * Save to browser storage.
   *
   * Wrapped, because storage throws in a private window and on a blocked
   * origin, and losing the page over a convenience cache would be absurd.
   */
  saveLocal(): boolean {
    try {
      localStorage.setItem(STORAGE_PREFIX + this.circuitName, this.toJson());
      return true;
    } catch {
      return false;
    }
  }

  loadLocal(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + this.circuitName);
      if (!raw) return false;
      const parsed = parseSidecar(raw);
      if (!parsed.ok) return false;
      this.replaceAll(parsed.labels);
      return true;
    } catch {
      return false;
    }
  }

  static peekLocal(circuitName: string): Label[] | null {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + circuitName);
      if (!raw) return null;
      const parsed = parseSidecar(raw);
      return parsed.ok ? parsed.labels : null;
    } catch {
      return null;
    }
  }

  // --- sidecar

  toJson(): string {
    return `${JSON.stringify(
      {
        format: SIDECAR_FORMAT,
        version: SIDECAR_VERSION,
        circuit: this.circuitName,
        labels: this.labels.map((l) => ({
          anchor: { x: l.anchor.x, y: l.anchor.y },
          kind: l.kind,
          name: l.name,
        })),
      },
      null,
      2
    )}\n`;
  }

  /** The name a sidecar should be offered under. */
  get sidecarName(): string {
    return `${this.circuitName.replace(/\.png$/i, '')}.labels.json`;
  }
}

export type ParseResult =
  | { readonly ok: true; readonly labels: Label[]; readonly circuit: string | null }
  | { readonly ok: false; readonly reason: string };

/** Read a sidecar, validating rather than trusting. */
export function parseSidecar(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `not valid JSON: ${(err as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not an object' };

  const j = raw as Record<string, unknown>;
  if (j.format !== SIDECAR_FORMAT) {
    return { ok: false, reason: `unknown format: ${String(j.format)}` };
  }
  if (j.version !== SIDECAR_VERSION) {
    return { ok: false, reason: `unsupported version: ${String(j.version)}` };
  }
  if (!Array.isArray(j.labels)) return { ok: false, reason: 'missing labels' };

  const labels: Label[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of j.labels.entries()) {
    const e = entry as Record<string, unknown>;
    const anchor = e?.anchor as Record<string, unknown> | undefined;
    if (typeof anchor?.x !== 'number' || typeof anchor?.y !== 'number') {
      return { ok: false, reason: `label ${i}: anchor is not a point` };
    }
    if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) {
      return { ok: false, reason: `label ${i}: anchor is not whole pixels` };
    }
    if (typeof e.name !== 'string' || e.name.trim() === '') {
      return { ok: false, reason: `label ${i}: name is missing or empty` };
    }
    const kind = e.kind === 'gate' ? 'gate' : 'net';
    const key = `${anchor.x},${anchor.y}`;
    if (seen.has(key)) return { ok: false, reason: `two labels share the anchor ${key}` };
    seen.add(key);
    labels.push({ anchor: { x: anchor.x, y: anchor.y }, name: e.name.trim(), kind });
  }

  labels.sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
  return {
    ok: true,
    labels,
    // Advisory only — a hint for the user, never a key that blocks loading.
    circuit: typeof j.circuit === 'string' ? j.circuit : null,
  };
}

/** Do two label sets differ? Used to ask rather than to pick a winner. */
export function labelsDiffer(a: readonly Label[], b: readonly Label[]): boolean {
  if (a.length !== b.length) return true;
  const key = (l: Label) => `${l.anchor.x},${l.anchor.y},${l.kind},${l.name}`;
  const setA = new Set(a.map(key));
  return b.some((l) => !setA.has(key(l)));
}
