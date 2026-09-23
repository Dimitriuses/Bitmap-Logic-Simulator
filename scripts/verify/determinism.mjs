// determinism.mjs — does the same circuit settle the same way twice?
//
// The question behind the AX register: why does it work on some runs and not
// on others? The analysis says every circuit in the scratch area agrees with
// its own logic, so the logic is not the variable. This measures the thing
// that is.
//
// Three unseeded Math.random() calls sit in the engine, faithfully ported from
// the original:
//
//   buildPerm       gate evaluation order, shuffled once per Circuit
//   RandomTable()   a fresh 4096-entry jitter table per Circuit
//   reseed()        a fresh read cursor into it, every single cycle
//
// A Circuit is constructed on load AND on every recompile -- which the editor
// does after every completed stroke. So "a different run" is not only a page
// reload; it is every edit.
//
// This compiles identical pixels N times, cold-starts each, lets it settle,
// and reports how many distinct states come back.
//
//   node scripts/verify/determinism.mjs [--runs N] [--cycles N]

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const S = await loadDist('sequential.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const RUNS = arg('--runs', 40);
const CYCLES = arg('--cycles', 1500);
const WINDOW = 16;

const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));

// The clusters investigate-ax.mjs found, by their printed rectangles.
const CLUSTERS = [
  ['#1', { x: 563, y: 573, width: 53, height: 23 }],
  ['#2', { x: 423, y: 576, width: 20, height: 23 }],
  ['#3', { x: 463, y: 583, width: 46, height: 29 }],
  ['#4', { x: 534, y: 587, width: 18, height: 23 }],
  ['#5', { x: 205, y: 588, width: 74, height: 39 }],
  ['#6', { x: 323, y: 593, width: 30, height: 85 }],
  ['#7', { x: 371, y: 593, width: 32, height: 88 }],
  ['#8', { x: 412, y: 623, width: 166, height: 133 }],
];

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

/** Cold-start a circuit and run it until the whole frame stops changing. */
function settle(circuit) {
  let last = null;
  let same = 0;
  for (let i = 0; i < CYCLES; i++) {
    circuit.simulate();
    const f = circuit.render();
    let h = 0x811c9dc5;
    const d = f.data;
    for (let k = 0; k < d.length; k += 4) {
      h ^= d[k] + d[k + 1] + d[k + 2];
      h = Math.imul(h, 0x01000193);
    }
    h >>>= 0;
    if (h === last) {
      if (++same >= WINDOW) return { hash: h, settled: true, cycles: i + 1 };
    } else {
      same = 0;
      last = h;
    }
  }
  return { hash: last, settled: false, cycles: CYCLES };
}

/** Read every net's state from the rendered frame. */
function stateVector(circuit, netlist) {
  const d = circuit.frame.data;
  return netlist.nets
    .map((n) => {
      const p = (n.probe.y * circuit.width + n.probe.x) << 2;
      return Math.max(d[p], d[p + 1], d[p + 2]) >= 224 ? '1' : '0';
    })
    .join('');
}

console.log(`Cold-starting each circuit ${RUNS} times from identical pixels.`);
console.log(`(settle window ${WINDOW}, cap ${CYCLES} cycles)\n`);

const summary = [];

for (const [label, rect] of CLUSTERS) {
  const image = crop(rect);

  // One reference compile, for the structural facts.
  const ref = new Circuit(image, null);
  const r = extractNetlist(ref, image);
  if (!r.ok) {
    console.log(`${label}  REFUSED: ${r.reason}\n`);
    continue;
  }
  const netlist = r.netlist;
  const sequential = S.isSequential(netlist);

  const outcomes = new Map();
  let neverSettled = 0;

  for (let run = 0; run < RUNS; run++) {
    const c = new Circuit(image, null);
    const s = settle(c);
    if (!s.settled) neverSettled++;
    const key = stateVector(c, netlist);
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }

  // How many rest states do the equations permit, for the all-low inputs a
  // cold start presents? That is the structural explanation for whatever the
  // runs just did.
  let restStates = null;
  if (sequential) {
    const model = S.analyseSequential(netlist, netlist.outputs);
    const k = model.stateNets.length;
    if (k > 0 && k <= 16) {
      const env0 = new Map();
      for (const i of netlist.inputs) env0.set(i, false);
      let count = 0;
      for (let s = 0; s < 2 ** k; s++) {
        const st = B.combinationFor(s, k);
        model.stateNets.forEach((n, b) => env0.set(n, st[b]));
        const next = model.stateNets.map((n) => {
          const e = model.nextState.get(n);
          return e ? B.evaluate(e, env0) : false;
        });
        if (next.every((v, b) => v === st[b])) count++;
      }
      restStates = { count, of: 2 ** k, stateNets: k };
    }
  }

  const distinct = outcomes.size;
  const sorted = [...outcomes.entries()].sort((a, b) => b[1] - a[1]);
  const flag = distinct > 1 ? 'NON-DETERMINISTIC' : 'deterministic';

  console.log(
    `${label}  ${rect.width}x${rect.height}  ${ref.gateCount} gates  ` +
      `${sequential ? 'sequential' : 'combinational'}`
  );
  console.log(
    `    ${distinct} distinct settled state(s) across ${RUNS} cold starts  =>  ${flag}`
  );
  for (const [key, n] of sorted.slice(0, 4)) {
    const pct = ((n / RUNS) * 100).toFixed(0);
    const shown = key.length > 48 ? `${key.slice(0, 48)}…` : key;
    console.log(`      ${String(n).padStart(3)}/${RUNS} (${pct.padStart(3)}%)  ${shown}`);
  }
  if (sorted.length > 4) console.log(`      … and ${sorted.length - 4} more`);
  if (neverSettled) console.log(`      ${neverSettled} run(s) never settled at all`);
  if (restStates) {
    console.log(
      `    the equations permit ${restStates.count} of ${restStates.of} rest states ` +
        `with all inputs low (${restStates.stateNets} state variable(s))`
    );
  }
  console.log('');

  summary.push({ label, distinct, flag, restStates });
}

console.log('summary');
console.log('-------');
for (const s of summary) {
  const rest = s.restStates ? `${s.restStates.count} rest state(s) permitted` : '';
  console.log(`  ${s.label.padEnd(4)} ${String(s.distinct).padStart(3)} outcome(s)  ${s.flag.padEnd(18)} ${rest}`);
}
