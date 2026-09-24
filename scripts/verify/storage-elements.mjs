// storage-elements.mjs — quickstart Scenarios 6 and 7.
//
// The suite the feature was built for. Its centrepiece is one circuit that
// PASSES the behavioural check from feature 003 and FAILS power-on, in the same
// run — because those are different questions and the existing tooling can only
// ask the first. If those two findings ever collapse into one, this suite is
// what notices.

import { join } from 'node:path';
import {
  REGISTER_4BIT,
  ROOT,
  check,
  equal,
  latchFixture,
  loadDist,
  loadEngine,
  loadPng,
  netlistOf,
  ringOscillatorFixture,
  summary,
  wiredOrFixture,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const ST = await loadDist('storage-elements.js');
const S = await loadDist('sequential.js');
const B = await loadDist('boolean.js');
const { sweepSequential } = await loadDist('oracle.js');

console.log('Scenarios 6 and 7: storage, and whether it starts\n');

function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return { circuit, netlist: r.netlist, image };
}

function crop(source, rect) {
  const out = new globalThis.ImageData(
    new Uint8ClampedArray(rect.width * rect.height * 4), rect.width, rect.height
  );
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const s = ((y + rect.y) * source.width + (x + rect.x)) << 2;
      const d = (y * rect.width + x) << 2;
      out.data[d] = source.data[s];
      out.data[d + 1] = source.data[s + 1];
      out.data[d + 2] = source.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// 1. A latch is storage.
// --------------------------------------------------------------------------

{
  const f = latchFixture();
  const { netlist } = open(f.image, 'latch');
  const { elements, settlingLoops } = ST.findStorageElements(netlist);

  equal('latch: one storage element', elements.length, 1);
  equal('latch: no settling loops left over', settlingLoops, 0);
  if (elements.length === 1) {
    const e = elements[0];
    equal('latch: one state net holds it', e.stateNets.length, 1);
    equal('latch: with two rest states', e.restStates.length, 2);
    check('latch: the two rest states differ',
      e.restStates[0][0] !== e.restStates[1][0]);
    check('latch: it can be found on the canvas',
      Number.isFinite(e.probe.x) && Number.isFinite(e.probe.y));
  }
}

// --------------------------------------------------------------------------
// 2. Feedback alone is NOT memory.
// --------------------------------------------------------------------------

{
  // A ring oscillator loops but never rests: it has zero rest states, so it is
  // a loop, not storage.
  const f = ringOscillatorFixture();
  const { netlist } = open(f.image, 'ring');
  const { elements, settlingLoops } = ST.findStorageElements(netlist);
  equal('ring oscillator: not reported as storage', elements.length, 0);
  equal('ring oscillator: counted as a loop instead', settlingLoops, 1);
}

{
  // A purely combinational circuit has no loops at all.
  const f = wiredOrFixture();
  const { netlist } = open(f.image, 'wired-OR');
  const { elements, settlingLoops } = ST.findStorageElements(netlist);
  equal('combinational: no storage', elements.length, 0);
  equal('combinational: no loops', settlingLoops, 0);
}

{
  // A two-inverter loop whose value is forced by an external driver settles to
  // one state, so it is a loop rather than memory.
  //
  // Net 1 drives both halves through a wired-OR, so whatever the loop is doing
  // the external gate pins it.
  const forced = netlistOf([[2, 3], [3, 2], [1, 2], [1, 3]]);
  const { elements } = ST.findStorageElements(forced);
  check('a loop with a single rest state is not called memory',
    elements.length === 0 || elements[0].restStates.length > 1,
    `${elements.length} elements`);
}

// --------------------------------------------------------------------------
// 3. Grouping: a register, not loose bits.
// --------------------------------------------------------------------------

{
  const netlist = REGISTER_4BIT();
  const { elements } = ST.findStorageElements(netlist);
  equal('4-bit register: four storage elements', elements.length, 4);
  check('each holds one bit', elements.every((e) => e.stateNets.length === 1));
  check('each has two rest states', elements.every((e) => e.restStates.length === 2));

  const groups = ST.groupElements(elements);
  equal('they are reported as ONE group, not four loose bits', groups.length, 1);
  equal('  holding all four', groups[0].elements.length, 4);
  check('  sharing the write line', groups[0].sharedControl.includes(1),
    groups[0].sharedControl.join(','));
}

{
  // Two registers with different write lines must NOT be grouped together.
  const gates = [];
  for (const [ctrl, base] of [[1, 10], [2, 20]]) {
    for (let bit = 0; bit < 2; bit++) {
      const a = base + bit * 2;
      const b = base + bit * 2 + 1;
      gates.push([a, b], [b, a], [ctrl, a]);
    }
  }
  const { elements } = ST.findStorageElements(netlistOf(gates));
  const groups = ST.groupElements(elements);
  equal('two independent registers stay two groups', groups.length, 2);
}

// --------------------------------------------------------------------------
// 4. Scale: per-group enumeration, not per-selection.
// --------------------------------------------------------------------------

{
  // 19 state variables in one vector is 524,288 rows. As independent groups it
  // is nothing. This is the claim the whole approach rests on.
  const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
  const rect = { x: 412, y: 623, width: 166, height: 133 };
  const image = crop(source, rect);
  const { circuit, netlist } = open(image, 'CPU block');

  equal('the CPU block has 241 gates', circuit.gateCount, 241);
  equal('and 19 feedback nets in total', S.feedbackNets(netlist).length, 19);

  const t0 = performance.now();
  const { elements } = ST.findStorageElements(netlist);
  const ms = performance.now() - t0;

  check('its storage resolves into small groups', elements.length > 0, `${elements.length} elements`);
  check('each small enough to enumerate',
    elements.every((e) => e.stateNets.length <= 4),
    `widest ${Math.max(...elements.map((e) => e.stateNets.length))} state nets`);
  check('and it is fast, because no 2^19 table is ever built', ms < 3000, `${ms.toFixed(0)} ms`);
}

// --------------------------------------------------------------------------
// 5. Power-on — the motivating defect.
// --------------------------------------------------------------------------

{
  const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
  // The six-inverter storage loop localised during the investigation.
  const rect = { x: 538, y: 628, width: 19, height: 23 };
  const image = crop(source, rect);
  const { netlist } = open(image, 'six-inverter loop');

  const report = ST.analyseStorage(netlist, image, { starts: 20 });
  equal('the loop is reported as storage', report.elements.length >= 1, true);
  equal('across 20 cold starts', report.starts, 20);

  const element = report.elements[0];
  check('it has more than one rest state', element && element.restStates.length > 1,
    element ? `${element.restStates.length} rest states` : 'no element');

  const finding = element?.powerOn;
  check('a power-on finding is produced', !!finding);
  check(
    'and it is NOT "defined" — the known defect is reproduced',
    finding && finding.kind !== 'defined',
    finding ? `${finding.kind}: ${ST.describePowerOn(finding)}` : ''
  );
  check(
    'the finding names the number of starts, because this is sampling',
    finding && /20 cold starts/.test(ST.describePowerOn(finding)),
    ST.describePowerOn(finding)
  );
  if (finding?.kind === 'undefined') {
    check('it names more than one observed state', finding.distribution.size > 1,
      `${finding.distribution.size} states`);
  }
  if (finding?.kind === 'neverSettles') {
    check('no held value is presented for a circuit that never settles',
      !('value' in finding));
  }
}

// --------------------------------------------------------------------------
// 6. Holding is not starting. The two findings must not collapse.
// --------------------------------------------------------------------------
//
// The same circuit, in the same run: the behavioural sweep from feature 003
// reports it as holding correctly, AND power-on reports it as undefined. If a
// future change lets one imply the other, this fails.

{
  const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
  const rect = { x: 538, y: 628, width: 19, height: 23 };
  const image = crop(source, rect);
  const { circuit, netlist } = open(image, 'six-inverter loop');

  // (a) does it hold and compute correctly, once started?
  const model = S.analyseSequential(netlist, netlist.outputs);
  const swept = sweepSequential(
    circuit, netlist, netlist.inputs, model.stateNets, model.nextState, B.evaluate,
    { maxCycles: 1200 }
  );
  const holdsCorrectly = swept.discrepancies.length === 0 && swept.nonConvergentRows === 0;
  check('(a) the behavioural sweep reports it as holding correctly', holdsCorrectly,
    `${swept.discrepancies.length} discrepancies, ${swept.nonConvergentRows} non-convergent`);

  // (b) does it start correctly?
  const report = ST.analyseStorage(netlist, image, { starts: 20 });
  const startsUndefined = report.elements.some((e) => e.powerOn && e.powerOn.kind !== 'defined');
  check('(b) power-on reports it as NOT starting from a defined state', startsUndefined);

  check(
    'BOTH are true at once — a pass on holding never implies a pass on starting',
    holdsCorrectly && startsUndefined,
    'this is the failure the feature exists to catch'
  );
}

// --------------------------------------------------------------------------
// 7. A latch seeded consistently really does hold — the contrast case.
// --------------------------------------------------------------------------

{
  const f = latchFixture();
  const { netlist, image } = open(f.image, 'latch');
  const report = ST.analyseStorage(netlist, image, { starts: 12 });
  check('the fixture latch is storage', report.elements.length === 1);
  const finding = report.elements[0]?.powerOn;
  check('with a power-on finding of its own', !!finding, finding ? finding.kind : '');
  check('described in words that name the sample size',
    /12 cold starts/.test(ST.describePowerOn(finding)), ST.describePowerOn(finding));
}

summary('storage-elements');
