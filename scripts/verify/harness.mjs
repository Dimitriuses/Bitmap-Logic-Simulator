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
