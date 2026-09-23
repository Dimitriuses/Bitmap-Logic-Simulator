// ringing.mjs — which nets never stop moving, and where they are.
//
// determinism.mjs shows that circuits #6, #7 and #8 mostly fail to settle at
// all on a cold start -- unlike #1..#4, which settle reliably but into one of
// several permitted rest states. Those are different faults and want different
// fixes, so this one localises the second: it runs a circuit cold, lets the
// transient pass, and then reports every net still toggling, in full-image
// coordinates so they can be found on the canvas.
//
//   node scripts/verify/ringing.mjs [cluster] [--runs N]

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const S = await loadDist('sequential.js');

const CLUSTERS = {
  '1': { x: 563, y: 573, width: 53, height: 23 },
  '2': { x: 423, y: 576, width: 20, height: 23 },
  '3': { x: 463, y: 583, width: 46, height: 29 },
  '4': { x: 534, y: 587, width: 18, height: 23 },
  '5': { x: 205, y: 588, width: 74, height: 39 },
  '6': { x: 323, y: 593, width: 30, height: 85 },
  '7': { x: 371, y: 593, width: 32, height: 88 },
  '8': { x: 412, y: 623, width: 166, height: 133 },
};

const which = process.argv[2] ?? '8';
const rect = CLUSTERS[which];
if (!rect) throw new Error(`no cluster ${which}`);
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 8;

const SETTLE_CYCLES = 1200; // let the transient pass
const WATCH_CYCLES = 200; // then watch

const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));

const image = new globalThis.ImageData(
  new Uint8ClampedArray(rect.width * rect.height * 4),
  rect.width,
  rect.height
);
for (let y = 0; y < rect.height; y++) {
  for (let x = 0; x < rect.width; x++) {
    const s = ((y + rect.y) * source.width + (x + rect.x)) << 2;
    const d = (y * rect.width + x) << 2;
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

console.log(
  `cluster #${which}  x=${rect.x} y=${rect.y} ${rect.width}x${rect.height}  ` +
    `${ref.gateCount} gates  ${netlist.nets.length} nets`
);
console.log(`${RUNS} cold starts, ${SETTLE_CYCLES} cycles to settle then ${WATCH_CYCLES} watched\n`);

const read = (circuit, net) => {
  const d = circuit.frame.data;
  const p = (net.probe.y * circuit.width + net.probe.x) << 2;
  return Math.max(d[p], d[p + 1], d[p + 2]) >= 224;
};

// How often each net toggles, summed over runs, and in how many runs it rang.
const toggles = new Map(netlist.nets.map((n) => [n.id, 0]));
const rangInRuns = new Map(netlist.nets.map((n) => [n.id, 0]));
let quietRuns = 0;

for (let run = 0; run < RUNS; run++) {
  const c = new Circuit(image, null);
  for (let i = 0; i < SETTLE_CYCLES; i++) c.simulate();
  c.render();

  const last = new Map(netlist.nets.map((n) => [n.id, read(c, n)]));
  const runToggles = new Map(netlist.nets.map((n) => [n.id, 0]));

  for (let i = 0; i < WATCH_CYCLES; i++) {
    c.simulate();
    c.render();
    for (const n of netlist.nets) {
      const v = read(c, n);
      if (v !== last.get(n.id)) {
        runToggles.set(n.id, runToggles.get(n.id) + 1);
        last.set(n.id, v);
      }
    }
  }

  let anyRang = false;
  for (const [id, count] of runToggles) {
    if (count > 0) {
      toggles.set(id, toggles.get(id) + count);
      rangInRuns.set(id, rangInRuns.get(id) + 1);
      anyRang = true;
    }
  }
  if (!anyRang) quietRuns++;
}

const ringing = [...toggles.entries()]
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);

console.log(`${quietRuns}/${RUNS} runs went fully quiet.`);
console.log(`${ringing.length} of ${netlist.nets.length} nets toggled after settling.\n`);

if (ringing.length > 0) {
  console.log('  net    runs   toggles   where (full image)   size');
  console.log('  ----   ----   -------   ------------------   ----');
  for (const [id, count] of ringing.slice(0, 25)) {
    const info = netlist.nets.find((n) => n.id === id);
    const x = info.probe.x + rect.x;
    const y = info.probe.y + rect.y;
    console.log(
      `  ${String(id).padStart(4)}   ${String(rangInRuns.get(id)).padStart(2)}/${RUNS}` +
        `   ${String(count).padStart(7)}   (${String(x).padStart(4)},${String(y).padStart(4)})` +
        `             ${String(info.pixelCount).padStart(4)}px`
    );
  }
  if (ringing.length > 25) console.log(`  … and ${ringing.length - 25} more`);

  // Where are they? A tight cluster points at one sub-circuit; a spread means
  // the whole thing is ringing.
  const xs = ringing.map(([id]) => netlist.nets.find((n) => n.id === id).probe.x + rect.x);
  const ys = ringing.map(([id]) => netlist.nets.find((n) => n.id === id).probe.y + rect.y);
  console.log(
    `\n  bounding box of the ringing nets: ` +
      `x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}` +
      `  (the whole crop is x ${rect.x}..${rect.x + rect.width - 1}, ` +
      `y ${rect.y}..${rect.y + rect.height - 1})`
  );

  // Is the ringing set inside a feedback loop? If so, say which.
  const state = S.feedbackNets(netlist);
  const inLoop = ringing.filter(([id]) => state.includes(id));
  console.log(
    `  ${inLoop.length} of the ringing nets are cut points of a feedback loop ` +
      `(${state.length} state variable(s) in total)`
  );
}
