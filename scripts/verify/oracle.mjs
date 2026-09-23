// oracle.mjs — quickstart Scenario 3.
//
// The differential oracle: drive the real engine through every input
// combination and diff it against the analytic table. This is the suite that
// decides whether a reported disagreement can be believed, so it has to prove
// three separate things — that agreement is detected, that disagreement is
// detected *and located*, and that a circuit which never settles is never
// quietly sampled and reported as if it had.

import {
  check,
  equal,
  gateFixture,
  loadDist,
  loadEngine,
  netAt,
  ringOscillatorFixture,
  summary,
  wiredOrFixture,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const { sweep } = await loadDist('oracle.js');

console.log('Scenario 3: the differential oracle\n');

function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return { circuit, netlist: r.netlist };
}

/** Analytic table for a netlist's own inputs and the given outputs. */
function analytic(netlist, inputs, outputs) {
  const exprs = new Map(outputs.map((o) => [o, B.expressionFor(netlist, o)]));
  const built = B.truthTable(inputs, outputs, exprs);
  if (!built.ok) throw new Error(built.reason);
  return built.table;
}

// --------------------------------------------------------------------------
// 1. Known-good circuits agree, and the agreement is explicit.
// --------------------------------------------------------------------------

for (const direction of ['up', 'down', 'left', 'right']) {
  const f = gateFixture(direction);
  const { circuit, netlist } = open(f.image, direction);
  const src = netAt(circuit, f.probes.src);
  const dst = netAt(circuit, f.probes.dst);

  const expected = analytic(netlist, [src], [dst]);
  const result = sweep(circuit, netlist, expected);

  equal(`${direction}: no discrepancies`, result.discrepancies.length, 0);
  equal(`${direction}: every row settled`, result.nonConvergentRows, 0);
  equal(`${direction}: no timing dependence`, result.timingDependentRows, 0);
  check(`${direction}: not aborted`, result.aborted === false);
  check(
    `${direction}: the engine really inverts`,
    result.observed.rows.every((row, i) => row.outputs[0] === expected.rows[i].outputs[0])
  );
}

{
  const f = wiredOrFixture();
  const { circuit, netlist } = open(f.image, 'wired-OR');
  const a = netAt(circuit, f.probes.a);
  const b = netAt(circuit, f.probes.b);
  const out = netAt(circuit, f.probes.out);

  const expected = analytic(netlist, [a, b], [out]);
  const result = sweep(circuit, netlist, expected);
  equal('wired-OR: no discrepancies', result.discrepancies.length, 0);
  equal('wired-OR: all four rows settled', result.nonConvergentRows, 0);
  equal('wired-OR: four rows observed', result.observed.rows.length, 4);
  check(
    'wired-OR: the engine performs the wired-OR',
    result.observed.rows.every((row, i) => row.outputs[0] === expected.rows[i].outputs[0])
  );
}

// --------------------------------------------------------------------------
// 2. A corrupted expectation produces a located discrepancy.
// --------------------------------------------------------------------------
//
// The engine is left alone; the *analysis* is falsified. If the oracle cannot
// catch a lie planted here, it cannot be trusted to catch a real one.

{
  const f = gateFixture('right');
  const { circuit, netlist } = open(f.image, 'corrupt');
  const src = netAt(circuit, f.probes.src);
  const dst = netAt(circuit, f.probes.dst);

  const good = analytic(netlist, [src], [dst]);
  const rows = good.rows.map((row, i) =>
    i === 1 ? { ...row, outputs: [!row.outputs[0]] } : row
  );
  const lying = { inputs: good.inputs, outputs: good.outputs, rows };

  const result = sweep(circuit, netlist, lying);
  equal('corrupted table: exactly one discrepancy', result.discrepancies.length, 1);
  if (result.discrepancies.length === 1) {
    const d = result.discrepancies[0];
    equal('corrupted table: on the row that was falsified', d.inputs[0], true);
    equal('corrupted table: located at the output net', d.firstDivergentNet, dst);
    check(
      'corrupted table: expected and observed both reported',
      d.expected.length === 1 && d.observed.length === 1 && d.expected[0] !== d.observed[0]
    );
    check(
      'corrupted table: the inputs reproduce it',
      Array.isArray(d.inputs) && d.inputs.length === 1
    );
  }
}

// --------------------------------------------------------------------------
// 3. A ring oscillator is reported non-convergent, never sampled.
// --------------------------------------------------------------------------

{
  const f = ringOscillatorFixture();
  const { circuit, netlist } = open(f.image, 'ring');
  const loop = netAt(circuit, f.probes.loop);

  // The loop net is both driven and driving, so it is neither an input nor a
  // structural output. Probe it directly.
  const expected = {
    inputs: [],
    outputs: [loop],
    rows: [{ inputs: [], outputs: [false], status: 'settled' }],
  };

  const result = sweep(circuit, netlist, expected, { maxCycles: 400 });
  equal('ring: one row', result.observed.rows.length, 1);
  equal('ring: reported non-convergent', result.nonConvergentRows, 1);
  equal('ring: the row carries that status', result.observed.rows[0].status, 'nonConvergent');
  equal(
    'ring: a non-convergent row is never reported as a disagreement',
    result.discrepancies.length,
    0
  );
}

// --------------------------------------------------------------------------
// 4. Progress and abort.
// --------------------------------------------------------------------------

{
  const f = wiredOrFixture();
  const { circuit, netlist } = open(f.image, 'progress');
  const a = netAt(circuit, f.probes.a);
  const b = netAt(circuit, f.probes.b);
  const out = netAt(circuit, f.probes.out);
  const expected = analytic(netlist, [a, b], [out]);

  const seen = [];
  sweep(circuit, netlist, expected, { onProgress: (done, total) => seen.push([done, total]) });
  check('progress is reported', seen.length > 0);
  check(
    'progress reports the true total',
    seen.every(([, total]) => total === 4)
  );

  const stopped = sweep(circuit, netlist, expected, { shouldAbort: () => true });
  check('abort stops the sweep', stopped.aborted === true);
  equal('abort leaves no rows behind', stopped.observed.rows.length, 0);
}

summary('oracle');
