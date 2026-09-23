// ring-pulse.mjs — does driving the storage loop resolve it?
//
// ring-structure.mjs found the ringing spot is a loop of SIX inverters, which
// is even, so it is a latch and not a ring oscillator: its two stable states
// are the alternating patterns 010101 and 101010.
//
// But a cold start sets every net to 0, and 000000 is neither of those. From
// there every gate in the loop wants to invert at once, the loop enters the
// symmetric all-equal oscillation, and only the engine's analog jitter can
// break the tie. ringing.mjs measured that tie surviving 1200 cycles in 4 of
// 5 runs.
//
// If that is the explanation, the prediction is specific and testable: the
// loop has two gates driving into it from outside (wired-OR, so they can only
// force HIGH). Assert one of them and the symmetry is broken by construction
// rather than by luck -- and the loop must then settle, every time, to the
// same value.
//
//   node scripts/verify/ring-pulse.mjs [--runs N]

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');

const RECT = { x: 412, y: 623, width: 166, height: 133 };
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 12;

const SETTLE = 800;
const WATCH = 150;

// The six nets of the loop, and the two that drive into it, from
// ring-structure.mjs.
const LOOP = [279, 82, 83, 192, 191, 190];
const DRIVERS = [42, 46];

const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
const image = new globalThis.ImageData(
  new Uint8ClampedArray(RECT.width * RECT.height * 4),
  RECT.width,
  RECT.height
);
for (let y = 0; y < RECT.height; y++) {
  for (let x = 0; x < RECT.width; x++) {
    const s = ((y + RECT.y) * source.width + (x + RECT.x)) << 2;
    const d = (y * RECT.width + x) << 2;
    image.data[d] = source.data[s];
    image.data[d + 1] = source.data[s + 1];
    image.data[d + 2] = source.data[s + 2];
    image.data[d + 3] = 255;
  }
}

const ref = new Circuit(image, null);
const r = extractNetlist(ref, image);
if (!r.ok) throw new Error(r.reason);
const netlist = r.netlist;

const probe = (id) => netById(netlist, id)?.probe ?? null;
const readNet = (c, id) => {
  const p = probe(id);
  if (!p) return false;
  const d = c.frame.data;
  const i = (p.y * c.width + p.x) << 2;
  return Math.max(d[i], d[i + 1], d[i + 2]) >= 224;
};
const loopWord = (c) => LOOP.map((id) => (readNet(c, id) ? '1' : '0')).join('');

/** Is the loop quiet, and what is it holding? */
function observe(c) {
  const before = loopWord(c);
  let moved = 0;
  let last = before;
  for (let i = 0; i < WATCH; i++) {
    c.simulate();
    c.render();
    const now = loopWord(c);
    if (now !== last) moved++;
    last = now;
  }
  return { word: last, moved, quiet: moved === 0 };
}

for (const id of DRIVERS) {
  const p = probe(id);
  console.log(
    `driver net ${id} probe at image (${p ? p.x + RECT.x : '?'},${p ? p.y + RECT.y : '?'})` +
      `  ${netlist.inputs.includes(id) ? '(undriven input)' : '(driven by a gate)'}`
  );
}
console.log(
  `\nloop nets ${LOOP.join(', ')} at ` +
    LOOP.map((id) => {
      const p = probe(id);
      return `(${p.x + RECT.x},${p.y + RECT.y})`;
    }).join(' ') +
    '\n'
);

// -------------------------------------------------------------------
// A. Cold start, no intervention.
// -------------------------------------------------------------------

{
  const words = new Map();
  let ringing = 0;
  for (let run = 0; run < RUNS; run++) {
    const c = new Circuit(image, null);
    for (let i = 0; i < SETTLE; i++) c.simulate();
    c.render();
    const o = observe(c);
    if (!o.quiet) ringing++;
    words.set(o.word, (words.get(o.word) ?? 0) + 1);
  }
  console.log('A. cold start, nothing driven');
  console.log(`   ${ringing}/${RUNS} runs still ringing after ${SETTLE} cycles`);
  console.log(`   ${words.size} distinct loop words: ${[...words.entries()].map(([w, n]) => `${w}×${n}`).join(' ')}\n`);
}

// -------------------------------------------------------------------
// B. Cold start, then hold a driver HIGH.
// -------------------------------------------------------------------
//
// The drivers reach the loop through a wired-OR, so they can only force a net
// high. If the symmetric tie is the problem, this must resolve it every time.

for (const driver of DRIVERS) {
  const p = probe(driver);
  if (!p) continue;
  const words = new Map();
  let ringing = 0;

  for (let run = 0; run < RUNS; run++) {
    const c = new Circuit(image, null);
    for (let i = 0; i < SETTLE; i++) {
      c.setStateAt(p.x, p.y, '1');
      c.simulate();
    }
    c.render();
    const o = observe(c);
    if (!o.quiet) ringing++;
    words.set(o.word, (words.get(o.word) ?? 0) + 1);
  }
  console.log(`B. net ${driver} held HIGH throughout`);
  console.log(`   ${ringing}/${RUNS} runs still ringing`);
  console.log(`   ${words.size} distinct loop words: ${[...words.entries()].map(([w, n]) => `${w}×${n}`).join(' ')}\n`);
}

// -------------------------------------------------------------------
// C. A pulse: drive it, then let go. This is what a load line does.
// -------------------------------------------------------------------

for (const driver of DRIVERS) {
  const p = probe(driver);
  if (!p) continue;
  const words = new Map();
  let ringing = 0;

  for (let run = 0; run < RUNS; run++) {
    const c = new Circuit(image, null);
    for (let i = 0; i < 120; i++) {
      c.setStateAt(p.x, p.y, '1');
      c.simulate();
    }
    // release
    for (let i = 0; i < SETTLE; i++) c.simulate();
    c.render();
    const o = observe(c);
    if (!o.quiet) ringing++;
    words.set(o.word, (words.get(o.word) ?? 0) + 1);
  }
  console.log(`C. net ${driver} pulsed HIGH for 120 cycles, then released`);
  console.log(`   ${ringing}/${RUNS} runs still ringing`);
  console.log(`   ${words.size} distinct loop words: ${[...words.entries()].map(([w, n]) => `${w}×${n}`).join(' ')}\n`);
}
