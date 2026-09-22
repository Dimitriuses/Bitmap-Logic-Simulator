// rotate.mjs — rotating a pasted block must not break the gates inside it.
//
// It turns out it cannot: the engine reads a gate's direction from which two
// corners are wire, and those corners rotate with the pixels. So a plain bitmap
// rotation turns a rightward inverter into a downward one all by itself. This
// checks that property holds rather than assuming it, and that the transform
// itself is exact.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  blank,
  check,
  equal,
  get,
  hLine,
  loadEngine,
  put,
  ROOT,
  stamp,
  summary,
  vLine,
  WIRE,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { PixelBlock } = await import(pathToFileURL(join(ROOT, 'dist', 'block.js')).href);

const STAMPS = {
  down: ['###', '#.#', '.#.'],
  left: ['.##', '#.#', '.##'],
  up: ['.#.', '#.#', '###'],
  right: ['##.', '#.#', '##.'],
};
const FLOW = {
  down: { src: 'N', dst: 'S' },
  left: { src: 'E', dst: 'W' },
  up: { src: 'S', dst: 'N' },
  right: { src: 'W', dst: 'E' },
};
const ROTATED_CW = { right: 'down', down: 'left', left: 'up', up: 'right' };

const C = 10;
const FAR = 5;
const ends = {
  N: { x: C, y: C - FAR },
  S: { x: C, y: C + FAR },
  W: { x: C - FAR, y: C },
  E: { x: C + FAR, y: C },
};

function gateBitmap(pattern) {
  const img = blank(21, 21);
  vLine(img, C, C - FAR, C - 1);
  vLine(img, C, C + 1, C + FAR);
  hLine(img, C - FAR, C - 1, C);
  hLine(img, C + 1, C + FAR, C);
  stamp(img, C, C, pattern);
  return img;
}

/** Wrap an ImageData in a PixelBlock the way CircuitDocument.readBlock would. */
function toBlock(img) {
  const pixels = new Uint32Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = get(img, x, y);
      pixels[y * img.width + x] = (((r << 24) | (g << 16) | (b << 8) | 255) >>> 0);
    }
  }
  return new PixelBlock(img.width, img.height, pixels);
}

function toImage(block) {
  const img = blank(block.width, block.height);
  block.forEach((x, y, c) => put(img, x, y, [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255]));
  return img;
}

const lit = (circuit, side) => {
  const d = circuit.frame.data;
  const p = (ends[side].y * circuit.width + ends[side].x) * 4;
  return Math.max(d[p], d[p + 1], d[p + 2]) >= 224;
};

console.log('Block rotation\n');

// Four quarter turns must return the original, bit for bit. Cheapest possible
// check that the transform is exact, and the first thing that would break.
for (const [dir, pattern] of Object.entries(STAMPS)) {
  const original = toBlock(gateBitmap(pattern));
  let spun = original;
  for (let i = 0; i < 4; i++) spun = spun.rotateCW();
  const identical =
    spun.width === original.width &&
    spun.height === original.height &&
    spun.pixels.every((v, i) => v === original.pixels[i]);
  check(`  ${dir}: rotateCW x4 is the identity`, identical);
}

// CW then CCW must also be the identity.
{
  const original = toBlock(gateBitmap(STAMPS.right));
  const thereAndBack = original.rotateCW().rotateCCW();
  check(
    '  rotateCW then rotateCCW is the identity',
    thereAndBack.pixels.every((v, i) => v === original.pixels[i])
  );
}

// Dimensions swap on a non-square block.
{
  const b = new PixelBlock(7, 3, new Uint32Array(21));
  const r = b.rotateCW();
  check('  dimensions swap', r.width === 3 && r.height === 7, `${r.width}x${r.height}`);
}

console.log('\nRotated gates still behave\n');

for (const [dir, pattern] of Object.entries(STAMPS)) {
  const want = ROTATED_CW[dir];
  const { src, dst } = FLOW[want];

  const rotated = toImage(toBlock(gateBitmap(pattern)).rotateCW());
  const idle = new Circuit(rotated, null);
  equal(`  ${dir} -> ${want}: gate count`, idle.gateCount, 1);

  for (let i = 0; i < 40; i++) idle.simulate();
  idle.render();
  check(`  ${dir} -> ${want}: src LOW drives ${dst} HIGH`, lit(idle, dst));

  const driven = new Circuit(toImage(toBlock(gateBitmap(pattern)).rotateCW()), null);
  for (let i = 0; i < 40; i++) {
    driven.setStateAt(ends[src].x, ends[src].y, '1');
    driven.simulate();
  }
  driven.render();
  check(`  ${dir} -> ${want}: src HIGH drives ${dst} LOW`, !lit(driven, dst));
}

summary('rotate');
