// ring-isolate.mjs — is the oscillation intrinsic to the loop, or driven in?
//
// Two experiments, both designed around a lesson this investigation already
// paid for once: a gate-driven net CANNOT be held with setStateAt, because
// #gateInput reads the driving gate rather than the wire and
// StoreGateStatesToWires rewrites the wire every cycle. State is seeded
// through loadGateStatesFromWires and then released -- never held.
//
//   1. Cut the loop out into a circuit of its own and cold-start it. If it
//      still rings with nothing outside it, the loop itself is the fault. If
//      it goes quiet, the ringing is driven in from elsewhere and the box
//      ring-structure.mjs pointed at is a symptom, not a cause.
//
//   2. Seed the full cluster into each of the loop's two alternating patterns
//      and release it. A 6-inverter loop is even, so both are stable states;
//      if it cannot hold one, something outside is fighting it.
//
//   node scripts/verify/ring-isolate.mjs [--runs N]

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 12;

const FULL = { x: 412, y: 623, width: 166, height: 133 }; // cluster #8
const BOX = { x: 538, y: 628, width: 19, height: 23 }; // just the loop

const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));

function crop(r) {
  const out = new globalThis.ImageData(
    new Uint8ClampedArray(r.width * r.height * 4),
    r.width,
    r.height
  );
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const s = ((y + r.y) * source.width + (x + r.x)) << 2;
      const d = (y * r.width + x) << 2;
      out.data[d] = source.data[s];
      out.data[d + 1] = source.data[s + 1];
      out.data[d + 2] = source.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

const readAt = (c, p) => {
  const d = c.frame.data;
  const i = (p.y * c.width + p.x) << 2;
  return Math.max(d[i], d[i + 1], d[i + 2]) >= 224;
};

/** Run and report whether anything at all is still moving. */
function runAndWatch(c, netlist, settleCycles, watchCycles) {
  for (let i = 0; i < settleCycles; i++) c.simulate();
  c.render();
  const last = new Map(netlist.nets.map((n) => [n.id, readAt(c, n.probe)]));
  let movers = new Set();
  for (let i = 0; i < watchCycles; i++) {
    c.simulate();
    c.render();
    for (const n of netlist.nets) {
      const v = readAt(c, n.probe);
      if (v !== last.get(n.id)) {
        movers.add(n.id);
        last.set(n.id, v);
      }
    }
  }
  return { movers, quiet: movers.size === 0 };
}

// -------------------------------------------------------------------
// 1. The loop, on its own.
// -------------------------------------------------------------------

console.log(`=== 1. the loop cut out on its own (x ${BOX.x}..${BOX.x + BOX.width - 1}, ` +
  `y ${BOX.y}..${BOX.y + BOX.height - 1})\n`);

const boxImage = crop(BOX);
{
  const ref = new Circuit(boxImage, null);
  const r = extractNetlist(ref, boxImage);
  if (!r.ok) {
    console.log(`  REFUSED: ${r.reason}\n`);
  } else {
    console.log(
      `  ${ref.gateCount} gates, ${r.netlist.nets.length} nets, ` +
        `${r.netlist.inputs.length} free inputs, ${r.netlist.cut.length} cut by the crop`
    );
    let ringing = 0;
    const outcomes = new Map();
    for (let run = 0; run < RUNS; run++) {
      const c = new Circuit(boxImage, null);
      const o = runAndWatch(c, r.netlist, 800, 150);
      if (!o.quiet) ringing++;
      const word = r.netlist.nets.map((n) => (readAt(c, n.probe) ? '1' : '0')).join('');
      outcomes.set(word, (outcomes.get(word) ?? 0) + 1);
    }
    console.log(`  ${ringing}/${RUNS} cold starts still ringing`);
    console.log(`  ${outcomes.size} distinct settled state(s)`);
    console.log(
      ringing === 0
        ? '  => the loop is STABLE in isolation: the ringing is driven in from outside\n'
        : '  => the loop rings on its own: the fault is intrinsic to it\n'
    );
  }
}

// -------------------------------------------------------------------
// 2. Seed the loop properly, in the full cluster, and let go.
// -------------------------------------------------------------------

console.log('=== 2. the full cluster, seeded into each alternating pattern\n');

const fullImage = crop(FULL);
const ref = new Circuit(fullImage, null);
const rr = extractNetlist(ref, fullImage);
if (!rr.ok) throw new Error(rr.reason);
const netlist = rr.netlist;

const LOOP = [279, 82, 83, 192, 191, 190];
const loopWord = (c) =>
  LOOP.map((id) => (readAt(c, netById(netlist, id).probe) ? '1' : '0')).join('');

// Every net as a function of the loop nets, so the whole circuit can be put
// into a state consistent with a chosen loop pattern rather than a stale one.
const treatAsInput = new Set([...LOOP, ...netlist.inputs]);
const seedExpr = new Map();
for (const n of netlist.nets) {
  try {
    seedExpr.set(n.id, B.expressionFor(netlist, n.id, { treatAsInput }));
  } catch {
    /* still cyclic after the cut; the engine resolves it */
  }
}

for (const pattern of ['101010', '010101']) {
  let held = 0;
  let ringing = 0;
  const ends = new Map();

  for (let run = 0; run < RUNS; run++) {
    const c = new Circuit(fullImage, null);

    const env = new Map();
    for (const i of netlist.inputs) env.set(i, false);
    LOOP.forEach((id, b) => env.set(id, pattern[b] === '1'));

    for (const n of netlist.nets) {
      const e = seedExpr.get(n.id);
      const v = e ? B.evaluate(e, env) : (env.get(n.id) ?? false);
      c.setStateAt(n.probe.x, n.probe.y, v ? '1' : '0');
    }
    c.loadGateStatesFromWires();

    const o = runAndWatch(c, netlist, 400, 150);
    if (!o.quiet) ringing++;
    const end = loopWord(c);
    if (end === pattern && o.quiet) held++;
    ends.set(end, (ends.get(end) ?? 0) + 1);
  }

  console.log(`  seeded ${pattern}:`);
  console.log(`    ${held}/${RUNS} held it and went quiet`);
  console.log(`    ${ringing}/${RUNS} still ringing`);
  console.log(`    ended at: ${[...ends.entries()].map(([w, n]) => `${w}×${n}`).join(' ')}\n`);
}
