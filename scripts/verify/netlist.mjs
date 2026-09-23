// netlist.mjs — quickstart Scenario 1.
//
// The netlist is the foundation of every answer the analysis gives, including
// its answers *about the simulator*. So this suite cares less about whether
// extraction is clever than about whether it is honest: it must agree with the
// engine on every bundled schematic, and it must refuse when it does not.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  blank,
  check,
  crossoverFixture,
  equal,
  gateFixture,
  latchFixture,
  loadDist,
  loadEngine,
  loadPng,
  netAt,
  put,
  get,
  ringOscillatorFixture,
  stamp,
  summary,
  wiredOrFixture,
  GATE_PATTERNS,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');

console.log('Scenario 1: netlist extraction\n');

// --------------------------------------------------------------------------
// 1. Every bundled schematic agrees with the engine.
// --------------------------------------------------------------------------

function schematics(dir = 'projects', found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) schematics(path, found);
    else if (entry.name.toLowerCase().endsWith('.png')) found.push(path);
  }
  return found.sort();
}

let agreed = 0;
let disagreed = 0;
for (const path of schematics()) {
  const image = loadPng(join(ROOT, path));
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) {
    disagreed++;
    console.log(`  ....  ${path}: ${r.reason}`);
    continue;
  }
  const gatesOk = r.netlist.gates.length === circuit.gateCount;
  const netsOk = r.netlist.nets.length === circuit.wireCount;
  if (gatesOk && netsOk) agreed++;
  else {
    disagreed++;
    console.log(
      `  ....  ${path}: gates ${r.netlist.gates.length}/${circuit.gateCount}, ` +
        `nets ${r.netlist.nets.length}/${circuit.wireCount}`
    );
  }
}
check('every bundled schematic matches the engine', disagreed === 0, `${agreed} schematics`);

// --------------------------------------------------------------------------
// 2. Each gate direction resolves the right source and destination.
// --------------------------------------------------------------------------

for (const direction of ['up', 'down', 'left', 'right']) {
  const f = gateFixture(direction);
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, f.image);
  if (!check(`${direction}: extraction succeeds`, r.ok, r.ok ? '' : r.reason)) continue;

  const { gates, nets } = r.netlist;
  equal(`${direction}: one gate`, gates.length, 1);
  equal(`${direction}: two nets`, nets.length, 2);
  if (gates.length !== 1) continue;

  const g = gates[0];
  equal(`${direction}: direction`, g.direction, direction);
  equal(`${direction}: source net`, g.src, netAt(circuit, f.probes.src));
  equal(`${direction}: destination net`, g.dst, netAt(circuit, f.probes.dst));
  check(`${direction}: source and destination differ`, g.src !== g.dst);

  // Classification: the source is undriven, the destination drives nothing.
  equal(`${direction}: one input`, r.netlist.inputs.length, 1);
  equal(`${direction}: the input is the source`, r.netlist.inputs[0], g.src);
  equal(`${direction}: one output`, r.netlist.outputs.length, 1);
  equal(`${direction}: the output is the destination`, r.netlist.outputs[0], g.dst);
  equal(`${direction}: nothing is cut`, r.netlist.cut.length, 0);

  // Every net must carry a usable probe.
  const src = netById(r.netlist, g.src);
  check(
    `${direction}: source probe lies on the source net`,
    circuit.wireAt(src.probe.x, src.probe.y) === g.src
  );
}

// --------------------------------------------------------------------------
// 3. A crossover is not a gate.
// --------------------------------------------------------------------------

{
  const f = crossoverFixture();
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, f.image);
  check('crossover: extraction succeeds', r.ok, r.ok ? '' : r.reason);
  equal('crossover: no gates', r.ok ? r.netlist.gates.length : -1, 0);
  equal('crossover: two nets', r.ok ? r.netlist.nets.length : -1, 2);
  check(
    'crossover: the two arms are different nets',
    netAt(circuit, f.probes.h) !== netAt(circuit, f.probes.v)
  );
}

// --------------------------------------------------------------------------
// 4. Wired-OR, latch and ring oscillator have the shapes they claim.
// --------------------------------------------------------------------------

{
  const f = wiredOrFixture();
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, f.image);
  check('wired-OR: extraction succeeds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('wired-OR: two gates', r.netlist.gates.length, 2);
    const out = netAt(circuit, f.probes.out);
    check(
      'wired-OR: both gates drive the same net',
      r.netlist.gates.every((g) => g.dst === out)
    );
    equal('wired-OR: two inputs', r.netlist.inputs.length, 2);
    equal('wired-OR: one output', r.netlist.outputs.length, 1);
  }
}

{
  const f = latchFixture();
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, f.image);
  check('latch: extraction succeeds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('latch: two gates', r.netlist.gates.length, 2);
    equal('latch: two nets', r.netlist.nets.length, 2);
    equal('latch: no undriven net', r.netlist.inputs.length, 0);
  }
}

{
  const f = ringOscillatorFixture();
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, f.image);
  check('ring: extraction succeeds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('ring: one gate', r.netlist.gates.length, 1);
    equal('ring: one net', r.netlist.nets.length, 1);
    check(
      'ring: the gate drives its own source',
      r.netlist.gates[0].src === r.netlist.gates[0].dst
    );
  }
}

// --------------------------------------------------------------------------
// 5. A crop that bisects a gate reports the survivors as cut.
// --------------------------------------------------------------------------

{
  const f = gateFixture('down');
  const whole = new Circuit(f.image, null);
  const wholeResult = extractNetlist(whole, f.image);
  equal('uncropped fixture cuts nothing', wholeResult.ok ? wholeResult.netlist.cut.length : -1, 0);

  // Keep rows 0..4, which removes the gate's southern arm.
  const cropped = blank(9, 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) put(cropped, x, y, get(f.image, x, y));

  const circuit = new Circuit(cropped, null);
  const r = extractNetlist(circuit, cropped);
  check('bisecting crop: extraction succeeds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('bisecting crop: the gate is gone', r.netlist.gates.length, 0);
    equal('bisecting crop: one net reported cut', r.netlist.cut.length, 1);
    check(
      'bisecting crop: the cut net is also an input',
      r.netlist.inputs.includes(r.netlist.cut[0])
    );
  }
}

// --------------------------------------------------------------------------
// 6. The self-check fires.
// --------------------------------------------------------------------------
//
// Compile a crossover, then hand extraction an image in which the crossover has
// become a real gate. The detector now finds one gate where the engine reports
// none. Nothing about the returned value may look like a netlist.

{
  const f = crossoverFixture();
  const circuit = new Circuit(f.image, null);
  equal('corrupted detector: engine sees no gate', circuit.gateCount, 0);

  const lying = blank(9, 9);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) put(lying, x, y, get(f.image, x, y));
  stamp(lying, 4, 4, GATE_PATTERNS.down); // corners appear; it is now a gate

  const r = extractNetlist(circuit, lying);
  check('corrupted detector: extraction refuses', r.ok === false);
  check(
    'corrupted detector: the refusal names both counts',
    r.ok === false && /found 1/.test(r.reason) && /reports 0/.test(r.reason),
    r.ok === false ? r.reason : ''
  );
  check('corrupted detector: no netlist is returned', r.ok === false && r.netlist === undefined);
}

// A mismatched image size is refused outright rather than read out of bounds.
{
  const f = gateFixture('right');
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, blank(8, 9));
  check('size mismatch: refused', r.ok === false, r.ok === false ? r.reason : '');
}

summary('netlist');
