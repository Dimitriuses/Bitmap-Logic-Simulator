// simulator.ts — core simulation engine.
//
// This is a port of BmpLogicSim150902/UMain.pas. Where the specification's
// pseudocode and UMain.pas disagree, UMain.pas wins. Divergences from the
// original are marked "PORT NOTE" and are deliberate; everything else is a
// literal translation, down to the evaluation order and the random table.

const WIRE_THRESHOLD = 224;

const RAISE_SPEED = 0.5;
const FALL_SPEED = 0.5;
const RANDOM_SPEED = 0.5;

const RANDOM_TABLE_SH = 12;
const RANDOM_TABLE_LENGTH = 1 << RANDOM_TABLE_SH;
const RANDOM_TABLE_MASK = RANDOM_TABLE_LENGTH - 1;

// Corner bits, as assembled by preprocessBitmap in UMain.pas:311-317.
const NW = 1;
const NE = 2;
const SE = 4;
const SW = 8;

/** A previously rendered frame, re-read to carry wire state across a reload. */
export interface PrevRender {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** setStateAt's `what`: force LOW, force HIGH, or toggle. */
export type Poke = '0' | '1' | 'x';

/**
 * UMain.pas:224 — a pixel is wire if any channel is >= 224. Everything
 * darker is insulation.
 */
export function isWire(r: number, g: number, b: number): boolean {
  return r >= WIRE_THRESHOLD || g >= WIRE_THRESHOLD || b >= WIRE_THRESHOLD;
}

/**
 * The 4096-entry table of random ramp increments (UMain.pas:123-138).
 *
 * The original builds the table once per process and re-randomises only the
 * read cursor at the top of every simulate() call. That is load-bearing: the
 * jitter is what breaks ties between gates in a ring oscillator or a latch,
 * and reusing a fixed table keeps it cheap.
 */
class RandomTable {
  private readonly table = new Float32Array(RANDOM_TABLE_LENGTH);
  private idx = 0;

  constructor() {
    for (let i = 0; i < RANDOM_TABLE_LENGTH; i++) {
      // random(10000) * (0.0001 * randomSpeed)  ->  [0 .. 0.49995]
      this.table[i] = ((Math.random() * 10000) | 0) * (0.0001 * RANDOM_SPEED);
    }
  }

  /** initRandomTable: re-seeds the read cursor, keeps the table. */
  reseed(): void {
    this.idx = (Math.random() * RANDOM_TABLE_LENGTH) | 0;
  }

  next(): number {
    const v = this.table[this.idx & RANDOM_TABLE_MASK];
    this.idx++;
    return v;
  }
}

/**
 * Union-find over wire labels.
 *
 * connectWires (UMain.pas:238) does a full linear relabel of the whole remap
 * table per union: every entry equal to remap[b] becomes remap[a]. That is
 * O(n) per union and the main scaling bottleneck of the original.
 *
 * PORT NOTE: this uses union-find instead, but reproduces the original labels
 * exactly rather than merely being equivalent. The trick is that the original
 * always relabels b's group to a's label, so we must always hang root(b) under
 * root(a) — no union by rank or size, which would pick the other root and
 * change the final label values. Path compression is safe (it never changes
 * which element is the root). Flattening at the end gives the same one-
 * indirection table the original maintains at all times.
 */
class WireUnion {
  private readonly parent: Int32Array;

  constructor(count: number) {
    this.parent = new Int32Array(count);
    for (let i = 0; i < count; i++) this.parent[i] = i;
  }

  find(x: number): number {
    const parent = this.parent;
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  }

  /** connectWires(a, b): b's group takes a's label. */
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }

  /** Produce the flat remap table the rest of the engine indexes into. */
  flatten(): Int32Array {
    const n = this.parent.length;
    const remap = new Int32Array(n);
    for (let i = 0; i < n; i++) remap[i] = this.find(i);
    return remap;
  }
}

// -----------------------------------------------------------------------
// Load pipeline
//
// These are the steps of preprocessBitmap (UMain.pas:257), run once per file
// load. They are free functions rather than methods so that the large
// intermediate tables — wireMap and the remap table, ~32 MB together on the
// 2048x2048 example — simply go out of scope when the constructor returns,
// instead of living on as nullable fields that every later read has to guard.
// -----------------------------------------------------------------------

interface WireLabels {
  readonly wireMap: Int32Array;
  readonly union: WireUnion;
}

/**
 * Steps 1 and 2: label horizontal runs, then merge labels that touch
 * vertically.
 */
function buildWireMap(imageData: ImageData): WireLabels {
  const bw = imageData.width;
  const bh = imageData.height;
  const px = imageData.data;
  const wireMap = new Int32Array(bw * bh);

  // Horizontal run labelling (UMain.pas:277-293). The counter is global, not
  // per row, so labels are unique across the whole bitmap.
  let actWireIdx = 0;
  for (let y = 0; y < bh; y++) {
    const row = y * bw;
    for (let x = 0; x < bw; x++) {
      const i = row + x;
      const p = i << 2;
      if (isWire(px[p], px[p + 1], px[p + 2])) {
        // Continue the run to the left, or start a new label.
        wireMap[i] = x > 0 && wireMap[i - 1] !== 0 ? wireMap[i - 1] : ++actWireIdx;
      } else {
        wireMap[i] = 0;
      }
    }
  }

  const union = new WireUnion(actWireIdx + 1);

  // Vertical merge (UMain.pas:299-305): s is the row above, d the row below.
  // connectWires(d[x], s[x]) — the lower row's label wins.
  for (let y = 1; y < bh; y++) {
    const above = (y - 1) * bw;
    const below = y * bw;
    for (let x = 0; x < bw; x++) {
      const a = wireMap[above + x];
      const b = wireMap[below + x];
      if (a !== 0 && b !== 0) union.union(b, a);
    }
  }

  return { wireMap, union };
}

interface GatePixels {
  readonly srcPx: number[];
  readonly dstPx: number[];
}

/**
 * Step 3: find "+" patterns. Crosses merge wires immediately (so later lookups
 * in this same scan see the merge); gates are recorded as raw pixel offsets
 * and resolved afterwards.
 */
function detectGates(wireMap: Int32Array, bw: number, bh: number, union: WireUnion): GatePixels {
  const n = wireMap.length;
  const srcPx: number[] = [];
  const dstPx: number[] = [];

  // The original indexes rows through pointers into one flat array, so reading
  // x+1 on the last column silently reads column 0 of the next row. Reproduced
  // here rather than "fixed", since it can (rarely) change which gates are
  // detected on circuits whose wires touch the right border. Only the
  // genuinely out-of-array read past the last row is clamped to 0.
  const at = (i: number): number => (i >= 0 && i < n ? wireMap[i] : 0);

  for (let y = 1; y <= bh - 2; y++) {
    const s = (y - 1) * bw; // row above
    const d = y * bw; // centre row
    const e = (y + 1) * bw; // row below

    for (let x = 1; x <= bw - 1; x++) {
      // Plus sign: dark centre, wire on all four cardinal neighbours.
      if (
        at(d + x) !== 0 ||
        at(d + x - 1) === 0 ||
        at(d + x + 1) === 0 ||
        at(s + x) === 0 ||
        at(e + x) === 0
      ) {
        continue;
      }

      let i = 0;
      if (at(s + x - 1) !== 0) i |= NW;
      if (at(s + x + 1) !== 0) i |= NE;
      if (at(e + x + 1) !== 0) i |= SE;
      if (at(e + x - 1) !== 0) i |= SW;

      switch (i) {
        case 0: // crossover: H and V pass through without connecting
          union.union(at(d + x - 1), at(d + x + 1));
          union.union(at(s + x), at(e + x));
          break;
        case NW | NE: // gate down: N -> S
          srcPx.push(x + (y - 1) * bw);
          dstPx.push(x + (y + 1) * bw);
          break;
        case NE | SE: // gate left: E -> W
          srcPx.push(x + 1 + y * bw);
          dstPx.push(x - 1 + y * bw);
          break;
        case SE | SW: // gate up: S -> N
          srcPx.push(x + (y + 1) * bw);
          dstPx.push(x + (y - 1) * bw);
          break;
        case SW | NW: // gate right: W -> E
          srcPx.push(x - 1 + y * bw);
          dstPx.push(x + 1 + y * bw);
          break;
        default:
          break; // any other corner combination is ignored
      }
    }
  }

  return { srcPx, dstPx };
}

interface GateWires {
  readonly src: Int32Array;
  readonly dst: Int32Array;
}

/** Resolve gate pixel offsets to final (flat) wire labels. */
function resolveGates(gates: GatePixels, wireMap: Int32Array, remap: Int32Array): GateWires {
  const n = wireMap.length;
  const count = gates.srcPx.length;

  const src = new Int32Array(count);
  const dst = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const sp = gates.srcPx[i];
    const dp = gates.dstPx[i];
    src[i] = sp >= 0 && sp < n ? remap[wireMap[sp]] : 0;
    dst[i] = dp >= 0 && dp < n ? remap[wireMap[dp]] : 0;
  }

  return { src, dst };
}

/** Compressed-sparse-row adjacency: the gates driving each wire. */
interface DriverGraph {
  readonly offset: Int32Array;
  readonly data: Int32Array;
}

/**
 * Step 4: link each gate to every gate driving its source wire.
 *
 * PORT NOTE: the original is an O(n^2) nested scan (UMain.pas:343-346). This
 * buckets gates by destination wire instead, which is O(n) and yields the
 * identical lists in the identical order (ascending gate index), because the
 * fill pass walks gates in order. Stored as CSR: gates sharing a source wire
 * share one bucket, so total memory is O(gates).
 */
function buildSourceGraph(gateDst: Int32Array, wires: number): DriverGraph {
  const count = gateDst.length;

  const offset = new Int32Array(wires + 1);
  for (let i = 0; i < count; i++) offset[gateDst[i] + 1]++;
  for (let w = 0; w < wires; w++) offset[w + 1] += offset[w];

  const data = new Int32Array(count);
  const cursor = offset.slice(0, wires);
  for (let i = 0; i < count; i++) data[cursor[gateDst[i]]++] = i;

  return { offset, data };
}

/**
 * Step 5: gate evaluation order, shuffled once at load (randomizePerm,
 * UMain.pas:389). The per-cycle reshuffle at UMain.pas:427 is commented out in
 * the original; spec.md shows it reshuffling every cycle, which is not what the
 * original does, so it is not done here either.
 */
function buildPerm(count: number): Int32Array {
  const perm = new Int32Array(count);
  for (let i = 0; i < count; i++) perm[i] = i;
  // The original's shuffle: swap each slot with a uniformly random slot.
  for (let i = 0; i < count; i++) {
    const j = (Math.random() * count) | 0;
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  return perm;
}

/**
 * Step 6: state carry-over. The previous *rendered* frame is re-read, so a wire
 * that was drawn bright comes back HIGH. Dimmed wires render at <= 0x7F per
 * channel, well under the 224 threshold, so they read back LOW. This is what
 * lets you edit the PNG in a paint program without resetting the running
 * circuit.
 */
function initStates(
  bw: number,
  bh: number,
  wireMap: Int32Array,
  remap: Int32Array,
  prevRender: PrevRender | null
): Uint8Array {
  const states = new Uint8Array(remap.length);
  if (!prevRender) return states;

  const pw = prevRender.width;
  const ph = prevRender.height;
  const prev = prevRender.data;

  // The original resizes prevBitmap to the new size against a black brush:
  // content is kept top-left, anything outside is black (i.e. not wire).
  const rows = Math.min(bh, ph);
  const cols = Math.min(bw, pw);
  for (let y = 0; y < rows; y++) {
    const row = y * bw;
    const prevRow = y * pw;
    for (let x = 0; x < cols; x++) {
      const i = row + x;
      if (wireMap[i] === 0) continue;
      const p = (prevRow + x) << 2;
      if (isWire(prev[p], prev[p + 1], prev[p + 2])) {
        states[remap[wireMap[i]]] = 1;
      }
    }
  }
  return states;
}

interface RenderTables {
  readonly pixelWire: Int32Array;
  readonly wirePixels: Int32Array;
  readonly wirePixelWire: Int32Array;
  readonly origU32: Uint32Array;
  readonly dimU32: Uint32Array;
  readonly frame: ImageData;
  readonly frameU32: Uint32Array;
  readonly wireCount: number;
}

/**
 * Precompute everything makeBitmapFromState needs so the per-frame loop touches
 * only wire pixels and does no indirection.
 *
 * Inactive colour is `orig and $7F7F7F` (UMain.pas:448) — a mask that clears
 * the top bit of each channel, not an arithmetic halving. 224 dims to 96, not
 * 112. spec.md's `(v & 0xFE) >> 1` is a different result; UMain wins.
 */
function buildRenderTables(
  imageData: ImageData,
  wireMap: Int32Array,
  remap: Int32Array
): RenderTables {
  const total = wireMap.length;
  const src = imageData.data;

  // Original, untouched — everything composites against this.
  const origBytes = new Uint8ClampedArray(src);
  const dimBytes = new Uint8ClampedArray(total * 4);

  const pixelWire = new Int32Array(total);
  const distinct = new Set<number>();
  let litPixels = 0;
  for (let i = 0; i < total; i++) {
    const w = wireMap[i] !== 0 ? remap[wireMap[i]] : 0;
    pixelWire[i] = w;
    if (w !== 0) {
      litPixels++;
      distinct.add(w);
    }

    const p = i << 2;
    // Channel-wise & 0x7F, so this stays correct regardless of endianness.
    dimBytes[p] = src[p] & 0x7f;
    dimBytes[p + 1] = src[p + 1] & 0x7f;
    dimBytes[p + 2] = src[p + 2] & 0x7f;
    dimBytes[p + 3] = 255;
  }

  // Only wire pixels are ever rewritten, so index them once.
  const wirePixels = new Int32Array(litPixels);
  const wirePixelWire = new Int32Array(litPixels);
  let k = 0;
  for (let i = 0; i < total; i++) {
    if (pixelWire[i] !== 0) {
      wirePixels[k] = i;
      wirePixelWire[k] = pixelWire[i];
      k++;
    }
  }

  // The frame buffer starts as the original: non-wire pixels are written here
  // once and never touched again, exactly like the original's composite
  // against `original`.
  const frame = new ImageData(new Uint8ClampedArray(origBytes), imageData.width, imageData.height);

  return {
    pixelWire,
    wirePixels,
    wirePixelWire,
    origU32: new Uint32Array(origBytes.buffer),
    dimU32: new Uint32Array(dimBytes.buffer),
    frame,
    frameU32: new Uint32Array(frame.data.buffer),
    wireCount: distinct.size,
  };
}

/**
 * A preprocessed circuit: wire map, gates, evaluation order and live state.
 *
 * Construction is the equivalent of preprocessBitmap (UMain.pas:257): it runs
 * the whole pipeline once per file load.
 */
export class Circuit {
  readonly width: number;
  readonly height: number;
  readonly frame: ImageData;

  /** Distinct wire nets and gates, as reported in the status bar. */
  readonly wireCount: number;
  readonly gateCount: number;

  cycle = 0;

  private readonly random = new RandomTable();

  /** Per-gate source wire, destination wire, digital state and analog ramp. */
  private readonly gateSrc: Int32Array;
  private readonly gateDst: Int32Array;
  private readonly gateState: Uint8Array;
  private readonly gateSlow: Float32Array;

  private readonly drivers: DriverGraph;
  private readonly perm: Int32Array;
  private readonly states: Uint8Array;

  private readonly pixelWire: Int32Array;
  private readonly wirePixels: Int32Array;
  private readonly wirePixelWire: Int32Array;
  private readonly origU32: Uint32Array;
  private readonly dimU32: Uint32Array;
  private readonly frameU32: Uint32Array;

  /**
   * @param imageData  decoded PNG
   * @param prevRender the previously rendered frame, used to carry wire state
   *                   across a reload (UMain.pas:358-365). Null on a cold load.
   */
  constructor(imageData: ImageData, prevRender: PrevRender | null = null) {
    this.width = imageData.width;
    this.height = imageData.height;

    const { wireMap, union } = buildWireMap(imageData);
    const gatePixels = detectGates(wireMap, this.width, this.height, union);

    // Every union has been made by now, so the flat table is final.
    const remap = union.flatten();

    const { src, dst } = resolveGates(gatePixels, wireMap, remap);
    this.gateSrc = src;
    this.gateDst = dst;
    this.gateCount = src.length;
    this.gateState = new Uint8Array(this.gateCount);
    // float32, matching Delphi's `single`.
    this.gateSlow = new Float32Array(this.gateCount);

    this.drivers = buildSourceGraph(dst, remap.length);
    this.perm = buildPerm(this.gateCount);
    this.states = initStates(this.width, this.height, wireMap, remap, prevRender);

    const tables = buildRenderTables(imageData, wireMap, remap);
    this.pixelWire = tables.pixelWire;
    this.wirePixels = tables.wirePixels;
    this.wirePixelWire = tables.wirePixelWire;
    this.origU32 = tables.origU32;
    this.dimU32 = tables.dimU32;
    this.frame = tables.frame;
    this.frameU32 = tables.frameU32;
    this.wireCount = tables.wireCount;

    this.loadGateStatesFromWires();
    this.simulate();
    this.render(); // preprocessBitmap ends with simulate; makeBitmapFromState
  }

  // ---------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------

  /** LoadGateStatesFromWires (UMain.pas:397): seed gates from their outputs. */
  loadGateStatesFromWires(): void {
    for (let i = 0; i < this.gateCount; i++) {
      const s = this.states[this.gateDst[i]] ? 1 : 0;
      this.gateState[i] = s;
      this.gateSlow[i] = s;
    }
  }

  /**
   * StoreGateStatesToWires (UMain.pas:404): clear every gate-driven wire, then
   * OR the driving gates back on.
   *
   * This is why manual clicks only stick on input wires: any wire a gate drives
   * is rewritten from scratch every cycle.
   */
  #storeGateStatesToWires(): void {
    const { gateDst, gateState, states } = this;
    const n = gateDst.length;
    for (let i = 0; i < n; i++) states[gateDst[i]] = 0;
    for (let i = 0; i < n; i++) if (gateState[i]) states[gateDst[i]] = 1;
  }

  /**
   * gateInput (UMain.pas:411): wired-OR of the gates driving the source wire if
   * there are any, otherwise the raw wire state. That fallback is what makes
   * user clicks work.
   */
  #gateInput(g: number): boolean {
    const s = this.gateSrc[g];
    const lo = this.drivers.offset[s];
    const hi = this.drivers.offset[s + 1];
    if (lo === hi) return this.states[s] !== 0;
    for (let k = lo; k < hi; k++) {
      if (this.gateState[this.drivers.data[k]]) return true;
    }
    return false;
  }

  /**
   * updateState (UMain.pas:140): a Schmitt trigger with an analog ramp.
   * slowState moves by raise/fallSpeed plus table jitter, and the digital state
   * flips only when the ramp saturates.
   */
  #updateState(g: number, newState: boolean): void {
    const slow = this.gateSlow;
    if (newState) {
      if (this.gateState[g] && slow[g] === 1) return;
      slow[g] = slow[g] + RAISE_SPEED + this.random.next();
      if (slow[g] >= 1) {
        slow[g] = 1;
        this.gateState[g] = 1;
      }
    } else {
      if (!this.gateState[g] && slow[g] === 0) return;
      slow[g] = slow[g] - FALL_SPEED - this.random.next();
      if (slow[g] <= 0) {
        slow[g] = 0;
        this.gateState[g] = 0;
      }
    }
  }

  /** One simulation cycle (UMain.pas:422). */
  simulate(): void {
    this.cycle++;
    this.random.reseed();

    const { perm } = this;
    const n = perm.length;
    for (let i = 0; i < n; i++) {
      const g = perm[i];
      // Every gate is an inverter.
      this.#updateState(g, !this.#gateInput(g));
    }

    this.#storeGateStatesToWires();
  }

  // ---------------------------------------------------------------------
  // Rendering & interaction
  // ---------------------------------------------------------------------

  /**
   * makeBitmapFromState (UMain.pas:438). Active wires keep their colour,
   * inactive wires are masked down. Non-wire pixels are never written.
   */
  render(): ImageData {
    const { wirePixels, wirePixelWire, states, frameU32, origU32, dimU32 } = this;
    for (let k = 0; k < wirePixels.length; k++) {
      const i = wirePixels[k];
      frameU32[i] = states[wirePixelWire[k]] ? origU32[i] : dimU32[i];
    }
    return this.frame;
  }

  /** The wire label under a bitmap pixel, or 0 for insulation / out of range. */
  wireAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixelWire[x + y * this.width];
  }

  /**
   * setStateAt (UMain.pas:519).
   *
   * PORT NOTE: the original flips Y here (`w.y := bh - w.y`, UMain.pas:558)
   * while rendering does not, so desktop picking hits the wrong row. Not
   * replicated — clicks here hit the wire you actually clicked on.
   *
   * @returns the wire that was touched, or 0 if the point was not on a wire.
   */
  setStateAt(x: number, y: number, what: Poke): number {
    const i = this.wireAt(Math.floor(x), Math.floor(y));
    if (i <= 0) return 0;
    if (what === '0') this.states[i] = 0;
    else if (what === '1') this.states[i] = 1;
    else this.states[i] = this.states[i] ? 0 : 1;
    return i;
  }
}
