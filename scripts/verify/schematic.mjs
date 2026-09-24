// schematic.mjs — quickstart Scenario 4.
//
// The diagram must agree with the netlist. Not approximately, not usually —
// exactly, on every bundled schematic, because a diagram that quietly omits a
// gate is worse than no diagram: it is a wrong answer that looks complete.
//
// Also proves the claim that motivated the whole schematic view: it works at
// sizes where truth tables must refuse.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AND_PATTERN,
  NAND_PAIR,
  OR_PATTERN,
  REGISTER_4BIT,
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
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const S = await loadDist('schematic.js');

console.log('Scenario 4: the diagram agrees with the netlist\n');

function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return { circuit, netlist: r.netlist };
}

const gatesIn = (s) => s.symbols.reduce((n, x) => n + x.absorbed.length, 0);

// --------------------------------------------------------------------------
// 1. Faithful level: one symbol per gate, counts exact.
// --------------------------------------------------------------------------

for (const direction of ['up', 'down', 'left', 'right']) {
  const f = gateFixture(direction);
  const { circuit, netlist } = open(f.image, direction);
  const r = S.buildSchematic(netlist, { x: 0, y: 0, width: 9, height: 9 }, { level: 'faithful' });
  check(`${direction}: builds`, r.ok, r.ok ? '' : r.reason);
  if (!r.ok) continue;
  const s = r.schematic;
  equal(`${direction}: accounts for every gate`, gatesIn(s), circuit.gateCount);
  equal(`${direction}: one NOT symbol`, s.symbols.filter((x) => x.kind === 'NOT').length, 1);
  equal(`${direction}: one input terminal`, s.symbols.filter((x) => x.kind === 'input').length, 1);
  equal(`${direction}: one output terminal`, s.symbols.filter((x) => x.kind === 'output').length, 1);
}

// --------------------------------------------------------------------------
// 2. Recognised level folds, and still accounts for everything.
// --------------------------------------------------------------------------

{
  const netlist = OR_PATTERN();
  const faithful = S.buildSchematic(netlist, undefined, { level: 'faithful' });
  const recognised = S.buildSchematic(netlist, undefined, { level: 'recognised' });
  check('both levels build', faithful.ok && recognised.ok);
  if (faithful.ok && recognised.ok) {
    equal('faithful draws four gate symbols',
      faithful.schematic.symbols.filter((s) => !['input', 'output'].includes(s.kind)).length, 4);
    equal('recognised draws one',
      recognised.schematic.symbols.filter((s) => !['input', 'output'].includes(s.kind)).length, 1);
    equal('and it is an OR',
      recognised.schematic.symbols.find((s) => !['input', 'output'].includes(s.kind)).kind, 'OR');
    equal('both account for all four gates', gatesIn(faithful.schematic), 4);
    equal('  recognised too', gatesIn(recognised.schematic), 4);
  }
}

{
  const r = S.buildSchematic(AND_PATTERN());
  check('AND pattern builds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) equal('and accounts for three gates', gatesIn(r.schematic), 3);
}

// --------------------------------------------------------------------------
// 3. Crossovers, feedback and cut nets.
// --------------------------------------------------------------------------

{
  const f = crossoverFixture();
  const { netlist } = open(f.image, 'crossover');
  const r = S.buildSchematic(netlist);
  check('crossover: builds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('crossover: no gate symbols', gatesIn(r.schematic), 0);
    equal('crossover: two nets, drawn as two terminals', r.schematic.symbols.length, 2);
    equal('crossover: and no edges between them', r.schematic.edges.length, 0);
  }
}

{
  const f = latchFixture();
  const { circuit, netlist } = open(f.image, 'latch');
  const r = S.buildSchematic(netlist);
  check('latch: builds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('latch: accounts for both gates', gatesIn(r.schematic), circuit.gateCount);
    check('latch: a feedback edge is marked',
      r.schematic.edges.some((e) => e.isFeedback),
      `${r.schematic.edges.filter((e) => e.isFeedback).length} of ${r.schematic.edges.length}`);
  }
}

{
  const r = S.buildSchematic(REGISTER_4BIT());
  check('4-bit register: builds', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('and accounts for all twelve gates', gatesIn(r.schematic), 12);
    check('with feedback marked on the storage loops',
      r.schematic.edges.filter((e) => e.isFeedback).length >= 4,
      `${r.schematic.edges.filter((e) => e.isFeedback).length} feedback edges`);
  }
}

// --------------------------------------------------------------------------
// 4. Every bundled schematic, both levels. The hard invariant.
// --------------------------------------------------------------------------

function schematics(dir = 'projects', found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) schematics(path, found);
    else if (entry.name.toLowerCase().endsWith('.png')) found.push(path);
  }
  return found.sort();
}

{
  const problems = [];
  let count = 0;
  let faithfulSymbols = 0;
  let recognisedSymbols = 0;

  for (const path of schematics()) {
    const image = loadPng(join(ROOT, path));
    const circuit = new Circuit(image, null);
    const extracted = extractNetlist(circuit, image);
    if (!extracted.ok) {
      problems.push(`${path}: ${extracted.reason}`);
      continue;
    }
    for (const level of ['faithful', 'recognised']) {
      const r = S.buildSchematic(extracted.netlist, undefined, { level });
      if (!r.ok) {
        problems.push(`${path} (${level}): ${r.reason}`);
        continue;
      }
      if (gatesIn(r.schematic) !== circuit.gateCount) {
        problems.push(`${path} (${level}): ${gatesIn(r.schematic)} of ${circuit.gateCount} gates`);
        continue;
      }
      const drawn = r.schematic.symbols.filter((s) => !['input', 'output'].includes(s.kind)).length;
      if (level === 'faithful') faithfulSymbols += drawn;
      else recognisedSymbols += drawn;
    }
    count++;
  }

  check('every bundled schematic builds at both levels and accounts for every gate',
    problems.length === 0, `${count} schematics${problems.length ? ' — ' + problems[0] : ''}`);
  check('the recognised view is measurably smaller than the faithful one',
    recognisedSymbols < faithfulSymbols,
    `${recognisedSymbols} vs ${faithfulSymbols} symbols`);
}

// --------------------------------------------------------------------------
// 5. Scale — the claim truth tables cannot make.
// --------------------------------------------------------------------------

{
  // The 241-gate block from the 4-bit CPU: 19 state variables, far beyond the
  // 16-input truth-table limit.
  const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
  const rect = { x: 412, y: 623, width: 166, height: 133 };
  const image = new globalThis.ImageData(
    new Uint8ClampedArray(rect.width * rect.height * 4), rect.width, rect.height
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
  const { circuit, netlist } = open(image, 'CPU block');
  equal('the CPU block has 241 gates', circuit.gateCount, 241);

  const t0 = performance.now();
  const r = S.buildSchematic(netlist, rect);
  const ms = performance.now() - t0;

  check('it builds a diagram without refusing on size', r.ok, r.ok ? '' : r.reason);
  check('inside the 2 s budget', ms < 2000, `${ms.toFixed(0)} ms`);
  if (r.ok) {
    equal('accounting for all 241 gates', gatesIn(r.schematic), 241);
    const drawn = r.schematic.symbols.filter((s) => !['input', 'output'].includes(s.kind)).length;
    check('as fewer symbols than gates', drawn < 241, `${drawn} symbols`);
    check('with feedback marked', r.schematic.edges.some((e) => e.isFeedback));
  }
}

// --------------------------------------------------------------------------
// 6. Determinism, and the two-way correspondence.
// --------------------------------------------------------------------------

{
  const netlist = REGISTER_4BIT();
  const a = S.buildSchematic(netlist);
  const b = S.buildSchematic(netlist);
  check('the same netlist produces an identical diagram',
    a.ok && b.ok && JSON.stringify(a.schematic) === JSON.stringify(b.schematic));
}

{
  const f = gateFixture('right');
  const { circuit, netlist } = open(f.image, 'right');
  const r = S.buildSchematic(netlist, { x: 0, y: 0, width: 9, height: 9 });
  if (r.ok) {
    const s = r.schematic;
    check('every symbol carries a probe point',
      s.symbols.every((x) => Number.isFinite(x.probe.x) && Number.isFinite(x.probe.y)));
    check('every probe lands on the net it claims',
      s.symbols.every((x) => circuit.wireAt(x.probe.x, x.probe.y) === x.net));
    const gate = s.symbols.find((x) => x.kind === 'NOT');
    check('a net resolves back to its symbol',
      S.symbolForNet(s, gate.net)?.id === gate.id);
    check('and a symbol names its nets',
      S.netsOfSymbol(s, gate).includes(gate.net));
  }
}

summary('schematic');
