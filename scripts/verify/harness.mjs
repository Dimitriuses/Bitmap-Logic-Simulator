// harness.mjs — run the compiled engine outside a browser.
//
// The project has no test framework by design, so verification scripts import
// dist/simulator.js directly and drive it against bitmaps built in memory. The
// only thing the engine needs from the DOM is ImageData, which is trivial to
// shim. Zero dependencies.
//
// Build first: `npm run build`.

import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Minimal stand-in for the browser's ImageData. */
export class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

if (!globalThis.ImageData) globalThis.ImageData = FakeImageData;

/** Import the compiled engine. Paths with spaces need a file:// URL on Windows. */
export async function loadEngine() {
  const entry = join(ROOT, 'dist', 'simulator.js');
  try {
    return await import(pathToFileURL(entry).href);
  } catch (err) {
    throw new Error(`Could not import ${entry}. Run "npm run build" first.\n${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Bitmap construction
// --------------------------------------------------------------------------

export const WIRE = [255, 255, 255];
export const INSULATION = [0, 0, 0];

/** A blank (all-insulation) bitmap. */
export function blank(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255;
  return new globalThis.ImageData(data, width, height);
}

export function put(image, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const p = (y * image.width + x) * 4;
  image.data[p] = r;
  image.data[p + 1] = g;
  image.data[p + 2] = b;
  image.data[p + 3] = 255;
}

export function get(image, x, y) {
  const p = (y * image.width + x) * 4;
  return [image.data[p], image.data[p + 1], image.data[p + 2]];
}

/** Draw an axis-aligned run of wire, inclusive of both ends. */
export function hLine(image, x0, x1, y, color = WIRE) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(image, x, y, color);
}

export function vLine(image, x, y0, y1, color = WIRE) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) put(image, x, y, color);
}

/**
 * Paint a 3x3 pattern with its centre at (cx, cy).
 * `rows` is three strings of three characters, '#' = wire, '.' = insulation.
 */
export function stamp(image, cx, cy, rows, color = WIRE) {
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      const ch = rows[dy][dx];
      put(image, cx - 1 + dx, cy - 1 + dy, ch === '#' ? color : INSULATION);
    }
  }
}

// --------------------------------------------------------------------------
// Loading real schematics (needs scripts/verify/decode.py + Pillow)
// --------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** Decode a PNG to ImageData by shelling out to the Pillow helper. */
export function loadPng(pngPath) {
  const out = join(tmpdir(), `blsim-${process.pid}-${Date.now()}.bin`);
  try {
    execFileSync('python', [join(ROOT, 'scripts', 'verify', 'decode.py'), pngPath, out], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const buf = readFileSync(out);
    const width = buf.readUInt32LE(0);
    const height = buf.readUInt32LE(4);
    const data = new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, width * height * 4);
    // Copy out of the file buffer so the caller owns the memory.
    return new globalThis.ImageData(new Uint8ClampedArray(data), width, height);
  } finally {
    try {
      unlinkSync(out);
    } catch {
      /* already gone */
    }
  }
}

// --------------------------------------------------------------------------
// Assertions
// --------------------------------------------------------------------------

let passed = 0;
let failed = 0;

export function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}${detail ? '  ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`);
  }
  return condition;
}

export function equal(label, actual, expected) {
  return check(label, actual === expected, `expected ${expected}, got ${actual}`);
}

export function summary(name) {
  console.log(`\n${name}: ${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exitCode = 1;
  return failed === 0;
}

/** Run a circuit for n cycles. */
export function run(circuit, cycles) {
  for (let i = 0; i < cycles; i++) circuit.simulate();
  return circuit;
}

// --------------------------------------------------------------------------
// Analysis fixtures (003-circuit-analysis)
// --------------------------------------------------------------------------
//
// Each returns { image, probes, ... } where `probes` maps a role to a pixel
// that lies on the net for that role. Probing by pixel rather than by net id
// keeps the fixtures independent of whatever labels the engine happens to
// assign.

/** Import any compiled module from dist/ by file name. */
export async function loadDist(name) {
  const entry = join(ROOT, 'dist', name);
  try {
    return await import(pathToFileURL(entry).href);
  } catch (err) {
    throw new Error(`Could not import ${entry}. Run "npm run build" first.\n${err.message}`);
  }
}

/** The 3x3 gate patterns, transcribed to match src/stamps.ts. */
export const GATE_PATTERNS = {
  down: ['###', '#.#', '.#.'],
  left: ['.##', '#.#', '.##'],
  up: ['.#.', '#.#', '###'],
  right: ['##.', '#.#', '##.'],
  crossover: ['.#.', '#.#', '.#.'],
};

/**
 * One gate of the given direction, centred at (4,4) in a 9x9 field, with a
 * stub on the source side and another on the destination side so both nets can
 * be driven and read away from the pattern itself.
 */
export function gateFixture(direction) {
  const image = blank(9, 9);
  stamp(image, 4, 4, GATE_PATTERNS[direction]);

  let probes;
  switch (direction) {
    case 'down':
      vLine(image, 4, 1, 3);
      vLine(image, 4, 5, 7);
      probes = { src: { x: 4, y: 1 }, dst: { x: 4, y: 7 } };
      break;
    case 'up':
      vLine(image, 4, 5, 7);
      vLine(image, 4, 1, 3);
      probes = { src: { x: 4, y: 7 }, dst: { x: 4, y: 1 } };
      break;
    case 'left':
      hLine(image, 5, 7, 4);
      hLine(image, 1, 3, 4);
      probes = { src: { x: 7, y: 4 }, dst: { x: 1, y: 4 } };
      break;
    case 'right':
      hLine(image, 1, 3, 4);
      hLine(image, 5, 7, 4);
      probes = { src: { x: 1, y: 4 }, dst: { x: 7, y: 4 } };
      break;
    default:
      throw new Error(`no such gate direction: ${direction}`);
  }
  return { image, probes, direction };
}

/**
 * A crossover. The engine unions left/right and top/bottom at a cornerless
 * plus, so this is two nets that cross and never meet -- and no gate.
 */
export function crossoverFixture() {
  const image = blank(9, 9);
  stamp(image, 4, 4, GATE_PATTERNS.crossover);
  hLine(image, 1, 3, 4);
  hLine(image, 5, 7, 4);
  vLine(image, 4, 1, 3);
  vLine(image, 4, 5, 7);
  return { image, probes: { h: { x: 1, y: 4 }, v: { x: 4, y: 1 } } };
}

/** Two gates driving one net: the wired-OR that the engine performs for free. */
export function wiredOrFixture() {
  const image = blank(15, 11);
  stamp(image, 4, 4, GATE_PATTERNS.down);
  stamp(image, 10, 4, GATE_PATTERNS.down);
  vLine(image, 4, 1, 3);
  vLine(image, 10, 1, 3);
  vLine(image, 4, 5, 7);
  vLine(image, 10, 5, 7);
  hLine(image, 4, 10, 7);
  return {
    image,
    probes: { a: { x: 4, y: 1 }, b: { x: 10, y: 1 }, out: { x: 7, y: 7 } },
  };
}

/**
 * Two inverters in a loop: a bistable latch. Exactly one feedback net once
 * cut, and its next state is its current state -- which is what "it holds"
 * looks like as a function.
 */
export function latchFixture() {
  const image = blank(20, 11);
  stamp(image, 4, 4, GATE_PATTERNS.right);
  stamp(image, 14, 4, GATE_PATTERNS.right);
  hLine(image, 5, 13, 4); // gate A out -> gate B in
  hLine(image, 15, 17, 4); // gate B out, around and back
  vLine(image, 17, 4, 8);
  hLine(image, 1, 17, 8);
  vLine(image, 1, 4, 8);
  hLine(image, 1, 3, 4);
  return { image, probes: { a: { x: 7, y: 4 }, b: { x: 2, y: 4 } } };
}

/** One inverter driving its own input: a one-stage ring oscillator. */
export function ringOscillatorFixture() {
  const image = blank(12, 11);
  stamp(image, 4, 4, GATE_PATTERNS.right);
  hLine(image, 5, 9, 4);
  vLine(image, 9, 4, 8);
  hLine(image, 1, 9, 8);
  vLine(image, 1, 4, 8);
  hLine(image, 1, 3, 4);
  return { image, probes: { loop: { x: 7, y: 4 } } };
}

/** Read a net's logical state out of a rendered frame at a pixel. */
export function stateAt(frame, x, y) {
  const p = (y * frame.width + x) << 2;
  return Math.max(frame.data[p], frame.data[p + 1], frame.data[p + 2]) >= 224;
}

/** The engine's net label under a probe point. */
export function netAt(circuit, point) {
  return circuit.wireAt(point.x, point.y);
}

/** Step a circuit until its probes hold steady, or give up. */
export function settle(circuit, points, window = 12, maxCycles = 500) {
  let last = null;
  let same = 0;
  let values = [];
  for (let i = 0; i < maxCycles; i++) {
    circuit.simulate();
    const frame = circuit.render();
    values = points.map((p) => stateAt(frame, p.x, p.y));
    const key = values.map((v) => (v ? '1' : '0')).join('');
    if (key === last) {
      if (++same >= window) return { values, settled: true };
    } else {
      same = 0;
      last = key;
    }
  }
  return { values, settled: false };
}
