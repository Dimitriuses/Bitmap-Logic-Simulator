// sequential.mjs — quickstart Scenario 4.
//
// Circuits with memory. The point of this suite is that the common case stays
// cheap and honest: a combinational selection must find no non-trivial
// component at all, and a latch must come back with exactly one state variable
// that can be pointed at on the canvas.

import {
  check,
  equal,
  gateFixture,
  latchFixture,
  loadDist,
  loadEngine,
  loadPng,
  netAt,
  ringOscillatorFixture,
  summary,
  wiredOrFixture,
  ROOT,
} from './harness.mjs';
import { join } from 'node:path';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const S = await loadDist('sequential.js');
const { sweepSequential } = await loadDist('oracle.js');

console.log('Scenario 4: sequential circuits\n');

function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return { circuit, netlist: r.netlist };
}

// --------------------------------------------------------------------------
// 1. Combinational selections find no feedback.
// --------------------------------------------------------------------------

for (const direction of ['up', 'down', 'left', 'right']) {
  const f = gateFixture(direction);
  const { netlist } = open(f.image, direction);
  check(`${direction}: not sequential`, S.isSequential(netlist) === false);
  equal(`${direction}: nothing to cut`, S.feedbackNets(netlist).length, 0);
}

{
  const f = wiredOrFixture();
  const { netlist } = open(f.image, 'wired-OR');
  check('wired-OR: not sequential', S.isSequential(netlist) === false);

  // Every component is a single net with no self-edge.
  const comps = S.components(netlist);
  equal('wired-OR: one component per net', comps.length, netlist.nets.length);
  check(
    'wired-OR: every component is trivial',
    comps.every((c) => c.length === 1)
  );
}

// --------------------------------------------------------------------------
// 2. A latch is sequential, with one locatable state variable that holds.
// --------------------------------------------------------------------------

{
  const f = latchFixture();
  const { circuit, netlist } = open(f.image, 'latch');

  check('latch: reported sequential', S.isSequential(netlist) === true);

  const comps = S.components(netlist);
  const nonTrivial = comps.filter((c) => c.length > 1);
  equal('latch: one non-trivial component', nonTrivial.length, 1);
  equal('latch: containing both nets', nonTrivial[0]?.length ?? 0, 2);

  const model = S.analyseSequential(netlist, []);
  equal('latch: exactly one state variable', model.stateNets.length, 1);

  const state = model.stateNets[0];
  const info = netById(netlist, state);
  check('latch: the state variable has a probe', !!info && !!info.probe);
  check(
    'latch: that probe really lies on the state net',
    !!info && circuit.wireAt(info.probe.x, info.probe.y) === state
  );

  // The hold: next state equals current state, for both values.
  const next = model.nextState.get(state);
  check('latch: a next-state function exists', !!next);
  if (next) {
    equal('latch: holds low', B.evaluate(next, new Map([[state, false]])), false);
    equal('latch: holds high', B.evaluate(next, new Map([[state, true]])), true);
    check(
      'latch: the next state depends only on the state itself',
      [...B.variablesOf(next)].every((v) => v === state)
    );
  }

  // 3. And the engine agrees: seed the state, release, and it stays put.
  const result = sweepSequential(
    circuit,
    netlist,
    [],
    model.stateNets,
    model.nextState,
    B.evaluate,
    { maxCycles: 600 }
  );
  equal('latch: two rows swept', result.observed.rows.length, 2);
  equal('latch: both settle', result.nonConvergentRows, 0);
  equal('latch: the engine matches the analysis', result.discrepancies.length, 0);
  check(
    'latch: seeded low it stays low, seeded high it stays high',
    result.observed.rows.length === 2 &&
      result.observed.rows[0].outputs[0] === false &&
      result.observed.rows[1].outputs[0] === true,
    result.observed.rows.map((r) => (r.outputs[0] ? '1' : '0')).join('')
  );
}

// --------------------------------------------------------------------------
// 3. A self-driving gate is a component of one with a self-edge.
// --------------------------------------------------------------------------

{
  const f = ringOscillatorFixture();
  const { netlist } = open(f.image, 'ring');
  check('ring: reported sequential', S.isSequential(netlist) === true);
  equal('ring: one state variable', S.feedbackNets(netlist).length, 1);

  const model = S.analyseSequential(netlist, []);
  const next = model.nextState.get(model.stateNets[0]);
  check('ring: its next state is its own inversion', !!next && next.kind === 'not');
  if (next) {
    const s = model.stateNets[0];
    equal('ring: low becomes high', B.evaluate(next, new Map([[s, false]])), true);
    equal('ring: high becomes low', B.evaluate(next, new Map([[s, true]])), false);
  }
}

// --------------------------------------------------------------------------
// 4. The cut really makes the graph acyclic, on a real schematic.
// --------------------------------------------------------------------------

{
  const image = loadPng(join(ROOT, 'projects', 'External_Shemes', 'Flip Flop.png'));
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  check('Flip Flop: extraction succeeds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    check('Flip Flop: reported sequential', S.isSequential(r.netlist) === true);
    const cut = S.feedbackNets(r.netlist);
    check('Flip Flop: at least one state variable', cut.length >= 1, `${cut.length} cut`);

    // After the cut, every remaining net must expand without throwing.
    const treatAsInput = new Set(cut);
    let threw = null;
    try {
      for (const net of r.netlist.nets) {
        B.expressionFor(r.netlist, net.id, { treatAsInput });
      }
    } catch (err) {
      threw = err;
    }
    check('Flip Flop: the graph is acyclic after the cut', threw === null, threw ? threw.message : '');
  }
}

summary('sequential');
