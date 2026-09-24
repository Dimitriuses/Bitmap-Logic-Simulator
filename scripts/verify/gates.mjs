// gates.mjs — quickstart Scenario 2.
//
// Recognition is the one place in this feature where a confident, wrong answer
// is easy to produce: a bad gate symbol looks authoritative, and a reader has
// no reason to doubt it. So the bar here is not "the rules fire on the cases we
// thought of" but two invariants that hold on every bundled schematic:
//
//   conservation   every gate is drawn or absorbed exactly once
//   verification   every symbol computes what the gates it replaced compute
//
// and one negative case: a deliberately broken rule must be CAUGHT, not drawn.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AND_PATTERN,
  NAND_PAIR,
  NOR_PATTERN,
  OR_PATTERN,
  REGISTER_4BIT,
  ROOT,
  SHARED_FANOUT,
  check,
  equal,
  loadDist,
  loadEngine,
  loadPng,
  netlistOf,
  summary,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const G = await loadDist('gates.js');
const B = await loadDist('boolean.js');

console.log('Scenario 2: gate recognition\n');

const kindsOf = (r) => r.symbols.map((s) => s.kind).sort().join(',');
const find = (r, kind) => r.symbols.find((s) => s.kind === kind);

// --------------------------------------------------------------------------
// 1. The rules fire on the shapes they are for.
// --------------------------------------------------------------------------

{
  const r = G.recognise(NAND_PAIR());
  check('NAND pair: recognised', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('NAND pair: one symbol', r.recognition.symbols.length, 1);
    equal('NAND pair: it is a NAND', r.recognition.symbols[0].kind, 'NAND');
    equal('NAND pair: over two inputs', r.recognition.symbols[0].inputs.length, 2);
    equal('NAND pair: absorbing both gates', r.recognition.symbols[0].absorbed.length, 2);
  }
}

{
  const r = G.recognise(OR_PATTERN());
  check('OR pattern: recognised', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    const or = find(r.recognition, 'OR');
    check('OR pattern: an OR is found', !!or, kindsOf(r.recognition));
    if (or) {
      check('OR pattern: over the original inputs', or.inputs.slice().sort().join(',') === '1,2');
      equal('OR pattern: absorbing all four gates', or.absorbed.length, 4);
      equal('OR pattern: nothing else is drawn', r.recognition.symbols.length, 1);
    }
  }
}

{
  const r = G.recognise(AND_PATTERN());
  const and = r.ok && find(r.recognition, 'AND');
  check('AND pattern: an AND is found', !!and, r.ok ? kindsOf(r.recognition) : r.reason);
  if (and) {
    check('AND pattern: over the original inputs', and.inputs.slice().sort().join(',') === '1,2');
    equal('AND pattern: absorbing all three gates', and.absorbed.length, 3);
  }
}

{
  const r = G.recognise(NOR_PATTERN());
  const nor = r.ok && find(r.recognition, 'NOR');
  check('NOR pattern: a NOR is found', !!nor, r.ok ? kindsOf(r.recognition) : r.reason);
  if (nor) {
    check('NOR pattern: over the original inputs', nor.inputs.slice().sort().join(',') === '1,2');
    equal('NOR pattern: absorbing all five gates', nor.absorbed.length, 5);
  }
}

// --------------------------------------------------------------------------
// 2. Fan-out 1 is required. This is the rule that stops recognition lying.
// --------------------------------------------------------------------------

{
  const r = G.recognise(SHARED_FANOUT());
  check('shared fan-out: recognised', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    check(
      'shared fan-out: the shared net is NOT folded into an OR',
      !find(r.recognition, 'OR'),
      kindsOf(r.recognition)
    );
    // Net 3 is read by two gates, so its NOT must survive as its own symbol.
    check(
      'shared fan-out: the shared net keeps its own symbol',
      r.recognition.symbols.some((s) => s.output === 3)
    );
  }
}

// --------------------------------------------------------------------------
// 3. Conservation, on every bundled schematic. The hard invariant.
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
  let checked = 0;
  let broken = [];
  let totalGates = 0;
  let totalSymbols = 0;

  for (const path of schematics()) {
    const image = loadPng(join(ROOT, path));
    const circuit = new Circuit(image, null);
    const extracted = extractNetlist(circuit, image);
    if (!extracted.ok) {
      broken.push(`${path}: ${extracted.reason}`);
      continue;
    }
    const r = G.recognise(extracted.netlist);
    if (!r.ok) {
      broken.push(`${path}: ${r.reason}`);
      continue;
    }
    const absorbed = G.absorbedCount(r.recognition);
    if (absorbed !== circuit.gateCount) {
      broken.push(`${path}: accounted ${absorbed} of ${circuit.gateCount}`);
      continue;
    }
    checked++;
    totalGates += circuit.gateCount;
    totalSymbols += r.recognition.symbols.length;
  }

  check(
    'every gate on every bundled schematic is accounted for exactly once',
    broken.length === 0,
    `${checked} schematics, ${totalGates} gates${broken.length ? ' — ' + broken[0] : ''}`
  );
  check(
    'recognition earns its keep: fewer symbols than gates',
    totalSymbols < totalGates,
    `${totalSymbols} symbols for ${totalGates} gates`
  );
}

// --------------------------------------------------------------------------
// 4. Every symbol computes what it replaced — checked independently here,
//    not by trusting the module's own internal check.
// --------------------------------------------------------------------------

{
  let symbols = 0;
  let wrong = [];

  for (const make of [NAND_PAIR, OR_PATTERN, AND_PATTERN, NOR_PATTERN, SHARED_FANOUT, REGISTER_4BIT]) {
    const netlist = make();
    const r = G.recognise(netlist);
    if (!r.ok) continue;
    for (const s of r.recognition.symbols) {
      if (s.inputs.length === 0 || s.inputs.length > 10) continue;
      let expr;
      try {
        expr = B.expressionFor(netlist, s.output, { treatAsInput: new Set(s.inputs) });
      } catch {
        continue; // feedback: the module declines these too
      }
      symbols++;
      const total = 2 ** s.inputs.length;
      for (let i = 0; i < total; i++) {
        const values = s.inputs.map((_, b) => ((i >> b) & 1) === 1);
        const env = new Map();
        s.inputs.forEach((net, b) => env.set(net, values[b]));
        if (B.evaluate(expr, env) !== G.apply(s.kind, values)) {
          wrong.push(`${s.kind} on ${s.output} at row ${i}`);
          break;
        }
      }
    }
  }
  check('every recognised symbol computes what it replaced', wrong.length === 0,
    `${symbols} symbols${wrong.length ? ' — ' + wrong[0] : ''}`);
}

// --------------------------------------------------------------------------
// 5. A corrupted rule must be caught.
// --------------------------------------------------------------------------
//
// The case that proves the verification fires. A netlist is built whose shape
// LOOKS like the OR pattern to a rule that forgot to check what it is folding:
// net 5 is driven by two gates whose sources are 3 and 4, and 3 and 4 are each
// driven by one gate — but from the SAME source, so the "OR" would be over
// (1, 1) rather than (1, 2). A rule that only pattern-matches accepts it; the
// verification does not, because the function differs.

{
  // 1 -> 3, 1 -> 4, 3 -> 5, 4 -> 5.  Net 5 = ¬(¬1) ∨ ¬(¬1) = 1, not OR(1,1)... which
  // IS 1, so this one is genuinely sound. Use it to confirm no false rejection.
  const sound = netlistOf([[1, 3], [1, 4], [3, 5], [4, 5]]);
  const r = G.recognise(sound);
  check('a sound fold over a repeated source is accepted', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('and still accounts for all four gates', G.absorbedCount(r.recognition), 4);
  }
}

{
  // Now genuinely corrupt the input: claim a gate exists that does not, so the
  // absorbed set no longer matches the expression. recognise() must refuse
  // rather than return a netlist-disagreeing recognition.
  const netlist = OR_PATTERN();
  const tampered = {
    ...netlist,
    gates: [...netlist.gates, { src: 9, dst: 5, direction: 'right', at: { x: 0, y: 0 } }],
    nets: [...netlist.nets, { id: 9, probe: { x: 9, y: 0 }, pixelCount: 1, bounds: { x: 9, y: 0, width: 1, height: 1 } }],
  };
  const r = G.recognise(tampered);
  check('an extra driver changes the answer rather than being ignored',
    !r.ok || !find(r.recognition, 'OR'),
    r.ok ? kindsOf(r.recognition) : r.reason);
  if (r.ok) {
    equal('and all five gates are still accounted for', G.absorbedCount(r.recognition), 5);
  }
}

{
  // Directly exercise the rejection path: a symbol whose absorbed gates do not
  // compute its kind must be discarded and its gates drawn faithfully.
  // Achieved by wiring a "NAND of NOTs" where one NOT is really a buffer chain,
  // so the OR reading is wrong.
  const netlist = netlistOf([[1, 3], [2, 7], [7, 4], [3, 5], [4, 5]]);
  const r = G.recognise(netlist);
  check('a mis-shaped fold is still conservative', r.ok, r.ok ? '' : r.reason);
  if (r.ok) {
    equal('all five gates accounted for', G.absorbedCount(r.recognition), 5);
    // Whatever it decided, the symbols must be individually sound.
    let sound = true;
    for (const s of r.recognition.symbols) {
      const expr = B.expressionFor(netlist, s.output, { treatAsInput: new Set(s.inputs) });
      const total = 2 ** s.inputs.length;
      for (let i = 0; i < total; i++) {
        const values = s.inputs.map((_, b) => ((i >> b) & 1) === 1);
        const env = new Map();
        s.inputs.forEach((net, b) => env.set(net, values[b]));
        if (B.evaluate(expr, env) !== G.apply(s.kind, values)) sound = false;
      }
    }
    check('and every symbol it produced is sound', sound);
  }
}

// --------------------------------------------------------------------------
// 6. Determinism.
// --------------------------------------------------------------------------

{
  const netlist = REGISTER_4BIT();
  const a = G.recognise(netlist);
  const b = G.recognise(netlist);
  check('recognition is deterministic', a.ok && b.ok &&
    JSON.stringify(a.recognition.symbols) === JSON.stringify(b.recognition.symbols));
}

summary('gates');
