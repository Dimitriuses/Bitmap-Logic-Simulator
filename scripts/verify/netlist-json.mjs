// netlist-json.mjs — quickstart Scenario 7.
//
// A round-trip must be lossless in the things that carry meaning: nets, gates
// and the I/O classification derived from them. And an import must refuse
// malformed input rather than half-read it, because everything downstream
// would then be describing a circuit that does not exist.

import { join } from 'node:path';
import {
  ROOT,
  check,
  crossoverFixture,
  equal,
  gateFixture,
  latchFixture,
  loadDist,
  loadEngine,
  loadPng,
  summary,
  wiredOrFixture,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const J = await loadDist('netlist-json.js');

console.log('Scenario 7: netlist interchange\n');

function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return r.netlist;
}

const sameIds = (a, b) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

// --------------------------------------------------------------------------
// 1. Round-trip every fixture, and a real schematic.
// --------------------------------------------------------------------------

const cases = [
  ['gate up', open(gateFixture('up').image, 'up')],
  ['gate down', open(gateFixture('down').image, 'down')],
  ['gate left', open(gateFixture('left').image, 'left')],
  ['gate right', open(gateFixture('right').image, 'right')],
  ['crossover', open(crossoverFixture().image, 'crossover')],
  ['wired-OR', open(wiredOrFixture().image, 'wired-OR')],
  ['latch', open(latchFixture().image, 'latch')],
  ['Flip Flop', open(loadPng(join(ROOT, 'projects', 'External_Shemes', 'Flip Flop.png')), 'ff')],
];

for (const [label, netlist] of cases) {
  const text = J.toJsonText(netlist);
  const back = J.importNetlist(text);
  if (!check(`${label}: re-imports`, back.ok, back.ok ? '' : back.reason)) continue;

  const got = back.netlist;
  equal(`${label}: net count survives`, got.nets.length, netlist.nets.length);
  equal(`${label}: gate count survives`, got.gates.length, netlist.gates.length);
  check(`${label}: net ids survive`, sameIds(got.nets.map((n) => n.id), netlist.nets.map((n) => n.id)));
  check(
    `${label}: every gate survives with its direction and both nets`,
    got.gates.every((g, i) => {
      const o = netlist.gates[i];
      return g.src === o.src && g.dst === o.dst && g.direction === o.direction;
    })
  );
  check(`${label}: inputs survive`, sameIds(got.inputs, netlist.inputs));
  check(`${label}: outputs survive`, sameIds(got.outputs, netlist.outputs));
  check(
    `${label}: probes survive`,
    got.nets.every((n) => {
      const o = netlist.nets.find((m) => m.id === n.id);
      return o && n.probe.x === o.probe.x && n.probe.y === o.probe.y;
    })
  );

  // A second round-trip is byte-identical: the format has no free choices.
  check(`${label}: export is stable across round-trips`, J.toJsonText(got) === text);
}

// --------------------------------------------------------------------------
// 2. The export uses LogicShorter's field names.
// --------------------------------------------------------------------------

{
  const netlist = open(gateFixture('right').image, 'right');
  const json = J.exportNetlist(netlist);
  equal('format tag', json.format, 'bitmap-logic-netlist');
  equal('version', json.version, 1);
  check('gates carry in_net', 'in_net' in json.gates[0]);
  check('gates carry out_net', 'out_net' in json.gates[0]);
  check('there is an io block', !!json.io && Array.isArray(json.io.inputs));
}

// --------------------------------------------------------------------------
// 3. Malformed input is refused, not half-read.
// --------------------------------------------------------------------------

const rejects = [
  ['not JSON at all', '{oh no'],
  ['not an object', '42'],
  ['wrong format tag', JSON.stringify({ format: 'something-else', version: 1 })],
  ['wrong version', JSON.stringify({ format: 'bitmap-logic-netlist', version: 9 })],
  [
    'missing gates',
    JSON.stringify({ format: 'bitmap-logic-netlist', version: 1, nets: [] }),
  ],
  [
    'gate naming an unknown net',
    JSON.stringify({
      format: 'bitmap-logic-netlist',
      version: 1,
      nets: [{ id: 1, probe: { x: 0, y: 0 }, pixels: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
      gates: [{ in_net: 1, out_net: 99, direction: 'up', at: { x: 0, y: 0 } }],
    }),
  ],
  [
    'gate with a bad direction',
    JSON.stringify({
      format: 'bitmap-logic-netlist',
      version: 1,
      nets: [
        { id: 1, probe: { x: 0, y: 0 }, pixels: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
        { id: 2, probe: { x: 1, y: 0 }, pixels: 1, bounds: { x: 1, y: 0, width: 1, height: 1 } },
      ],
      gates: [{ in_net: 1, out_net: 2, direction: 'sideways', at: { x: 0, y: 0 } }],
    }),
  ],
  [
    'duplicate net ids',
    JSON.stringify({
      format: 'bitmap-logic-netlist',
      version: 1,
      nets: [
        { id: 1, probe: { x: 0, y: 0 }, pixels: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
        { id: 1, probe: { x: 1, y: 0 }, pixels: 1, bounds: { x: 1, y: 0, width: 1, height: 1 } },
      ],
      gates: [],
    }),
  ],
];

for (const [label, text] of rejects) {
  const r = J.importNetlist(text);
  check(`refused: ${label}`, r.ok === false, r.ok === false ? r.reason : 'ACCEPTED');
}

// An io block that contradicts its own gate list is refused rather than fixed.
{
  const netlist = open(gateFixture('right').image, 'right');
  const json = J.exportNetlist(netlist);
  const tampered = { ...json, io: { ...json.io, inputs: [] } };
  const r = J.importNetlist(JSON.stringify(tampered));
  check(
    'refused: an io block that disagrees with its own gates',
    r.ok === false,
    r.ok === false ? r.reason : 'ACCEPTED'
  );
}

summary('netlist-json');
