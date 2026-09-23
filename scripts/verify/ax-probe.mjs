// ax-probe.mjs — is a reported sequential discrepancy real?
//
// investigate-ax.mjs reports rows where the engine's settled state differs
// from the analytic fixed point. Before any of that can be called a simulator
// defect, one alternative has to be ruled out: a bistable circuit has more
// than one fixed point, and the analytic iteration and the engine may simply
// have fallen into different ones. That is not a disagreement about logic --
// both answers satisfy the equations.
//
// So for every reported discrepancy, this asks whether the OBSERVED state is
// itself a fixed point of the next-state function. If it is, the row proves
// nothing about the simulator, and the oracle is over-reporting.
//
//   node scripts/verify/ax-probe.mjs <clusterIndex>

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const S = await loadDist('sequential.js');
const { sweepSequential } = await loadDist('oracle.js');

// The clusters investigate-ax.mjs found, by their printed rectangles.
const CLUSTERS = {
  1: { x: 563, y: 573, width: 53, height: 23 },
  2: { x: 423, y: 576, width: 20, height: 23 },
  4: { x: 534, y: 587, width: 18, height: 23 },
  6: { x: 323, y: 593, width: 30, height: 85 },
  7: { x: 371, y: 593, width: 32, height: 88 },
};

const which = Number(process.argv[2] ?? 4);
const rect = CLUSTERS[which];
if (!rect) throw new Error(`no cluster ${which}; have ${Object.keys(CLUSTERS).join(', ')}`);

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

const image = crop(rect);
const circuit = new Circuit(image, null);
const r = extractNetlist(circuit, image);
if (!r.ok) throw new Error(r.reason);
const netlist = r.netlist;

const model = S.analyseSequential(netlist, netlist.outputs);
const inputs = netlist.inputs;
const stateNets = model.stateNets;

console.log(`cluster #${which}  x=${rect.x} y=${rect.y} ${rect.width}x${rect.height}`);
console.log(`${inputs.length} inputs, ${stateNets.length} state variable(s)\n`);

const res = sweepSequential(
  circuit, netlist, inputs, stateNets, model.nextState, B.evaluate, { maxCycles: 2000 }
);

/** Apply the next-state functions once to a given (inputs, state) pair. */
function step(inputValues, stateValues) {
  const env = new Map();
  inputs.forEach((net, b) => env.set(net, inputValues[b]));
  stateNets.forEach((net, b) => env.set(net, stateValues[b]));
  return stateNets.map((s) => {
    const e = model.nextState.get(s);
    return e ? B.evaluate(e, env) : false;
  });
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

let bistable = 0;
let genuine = 0;

console.log(`${res.discrepancies.length} reported discrepancies\n`);

for (const d of res.discrepancies) {
  const inputValues = d.inputs.slice(0, inputs.length);
  const observedIsFixed = same(step(inputValues, d.observed), d.observed);
  const expectedIsFixed = same(step(inputValues, d.expected), d.expected);

  if (observedIsFixed) bistable++;
  else genuine++;

  if (bistable + genuine <= 8) {
    console.log(
      `  inputs ${d.inputs.map((v) => (v ? 1 : 0)).join('')}  ` +
        `expected ${d.expected.map((v) => (v ? 1 : 0)).join('')}` +
        `${expectedIsFixed ? ' (fixed)' : ' (NOT fixed)'}  ` +
        `observed ${d.observed.map((v) => (v ? 1 : 0)).join('')}` +
        `${observedIsFixed ? ' (fixed)' : ' (NOT fixed)'}`
    );
  }
}

console.log(`
  ${bistable} rows where the observed state is ALSO a fixed point
  ${genuine} rows where the observed state satisfies no equation
`);

if (genuine === 0 && res.discrepancies.length > 0) {
  console.log(
    'VERDICT: every reported discrepancy is a second valid fixed point.\n' +
      'The circuit is bistable under these inputs and the engine settled into\n' +
      'the other attractor. This says nothing about the simulator, and the\n' +
      'sequential oracle is over-reporting.'
  );
} else if (genuine > 0) {
  console.log(
    `VERDICT: ${genuine} row(s) settle to a state that is not a fixed point of\n` +
      'the next-state functions. That is a real disagreement worth pursuing.'
  );
} else {
  console.log('VERDICT: no discrepancies to explain.');
}

// How many attractors does each input combination actually have?
const total = 2 ** inputs.length;
let multi = 0;
for (let i = 0; i < total; i++) {
  const inputValues = Array.from({ length: inputs.length }, (_, b) => ((i >> b) & 1) === 1);
  let fixedPoints = 0;
  for (let s = 0; s < 2 ** stateNets.length; s++) {
    const st = Array.from({ length: stateNets.length }, (_, b) => ((s >> b) & 1) === 1);
    if (same(step(inputValues, st), st)) fixedPoints++;
  }
  if (fixedPoints !== 1) multi++;
}
console.log(
  `\n${multi} of ${total} input combinations have other than exactly one fixed point ` +
    `(${stateNets.length} state variable(s))`
);
void netById;
