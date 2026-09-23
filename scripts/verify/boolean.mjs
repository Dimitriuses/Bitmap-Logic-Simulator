// boolean.mjs — quickstart Scenario 2.
//
// What does this piece of circuit compute? The answer is derived from the
// netlist alone, with no simulation involved, which is exactly what makes it
// usable as an independent opinion in Scenario 3.

import {
  check,
  crossoverFixture,
  equal,
  gateFixture,
  latchFixture,
  loadDist,
  loadEngine,
  netAt,
  summary,
  wiredOrFixture,
  blank,
  hLine,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');

console.log('Scenario 2: expressions and truth tables\n');

/** Compile an image, extract it, and fail loudly rather than silently. */
function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return { circuit, netlist: r.netlist };
}

/** The table as a compact string, e.g. "01" for a single inverter. */
function bits(table, column = 0) {
  return table.rows.map((row) => (row.outputs[column] ? '1' : '0')).join('');
}

// --------------------------------------------------------------------------
// 1. Every gate direction is an inverter, whichever way it points.
// --------------------------------------------------------------------------

for (const direction of ['up', 'down', 'left', 'right']) {
  const f = gateFixture(direction);
  const { circuit, netlist } = open(f.image, direction);

  const src = netAt(circuit, f.probes.src);
  const dst = netAt(circuit, f.probes.dst);

  const expr = B.expressionFor(netlist, dst);
  equal(`${direction}: output is a NOT`, expr.kind, 'not');
  check(`${direction}: of the source net`, expr.arg.kind === 'var' && expr.arg.net === src);

  const built = B.truthTable([src], [dst], new Map([[dst, expr]]));
  check(`${direction}: table builds`, built.ok, built.ok ? '' : built.reason);
  if (built.ok) {
    equal(`${direction}: two rows`, built.table.rows.length, 2);
    equal(`${direction}: inverts`, bits(built.table), '10');
  }

  // A source net is a free variable, since no gate drives it.
  const asInput = B.expressionFor(netlist, src);
  equal(`${direction}: source is a free variable`, asInput.kind, 'var');
}

// --------------------------------------------------------------------------
// 2. A crossover is two unrelated nets.
// --------------------------------------------------------------------------

{
  const f = crossoverFixture();
  const { circuit, netlist } = open(f.image, 'crossover');
  const h = netAt(circuit, f.probes.h);
  const v = netAt(circuit, f.probes.v);

  equal('crossover: horizontal arm is free', B.expressionFor(netlist, h).kind, 'var');
  equal('crossover: vertical arm is free', B.expressionFor(netlist, v).kind, 'var');
  check(
    'crossover: neither arm mentions the other',
    !B.variablesOf(B.expressionFor(netlist, h)).has(v) &&
      !B.variablesOf(B.expressionFor(netlist, v)).has(h)
  );
  equal('crossover: both nets are inputs', netlist.inputs.length, 2);
}

// --------------------------------------------------------------------------
// 3. Two gates on one net are a wired-OR of inversions: NOR.
// --------------------------------------------------------------------------

{
  const f = wiredOrFixture();
  const { circuit, netlist } = open(f.image, 'wired-OR');
  const a = netAt(circuit, f.probes.a);
  const b = netAt(circuit, f.probes.b);
  const out = netAt(circuit, f.probes.out);

  const expr = B.expressionFor(netlist, out);
  equal('wired-OR: the output is an OR', expr.kind, 'or');
  equal('wired-OR: of two terms', expr.args.length, 2);
  check(
    'wired-OR: both terms are inversions',
    expr.args.every((t) => t.kind === 'not' && t.arg.kind === 'var')
  );

  const built = B.truthTable([a, b], [out], new Map([[out, expr]]));
  check('wired-OR: table builds', built.ok, built.ok ? '' : built.reason);
  if (built.ok) {
    equal('wired-OR: four rows', built.table.rows.length, 4);
    // Rows are ordered by minterm index with bit 0 = first input.
    // NOT a OR NOT b is false only when both are high.
    equal('wired-OR: behaves as NAND of the inputs', bits(built.table), '1110');
  }
}

// --------------------------------------------------------------------------
// 4. A region with no gates is wiring, not logic.
// --------------------------------------------------------------------------

{
  const image = blank(9, 9);
  hLine(image, 1, 7, 4);
  const { circuit, netlist } = open(image, 'bare wire');
  equal('bare wire: no gates', netlist.gates.length, 0);
  equal('bare wire: one net', netlist.nets.length, 1);
  equal('bare wire: that net is an input', netlist.inputs.length, 1);
  equal('bare wire: nothing is a structural output', netlist.outputs.length, 0);
  equal(
    'bare wire: its expression is itself',
    B.expressionFor(netlist, netlist.inputs[0]).kind,
    'var'
  );
  void circuit;
}

// --------------------------------------------------------------------------
// 5. Feedback throws rather than expanding forever.
// --------------------------------------------------------------------------

{
  const f = latchFixture();
  const { circuit, netlist } = open(f.image, 'latch');
  const a = netAt(circuit, f.probes.a);

  let threw = null;
  try {
    B.expressionFor(netlist, a);
  } catch (err) {
    threw = err;
  }
  check('latch: expanding a cyclic net throws', threw !== null);
  check(
    'latch: and throws the dedicated error, not a stack overflow',
    threw instanceof B.CyclicNetlistError,
    threw ? threw.constructor.name : 'nothing thrown'
  );

  // Cut the loop and the same net becomes expandable.
  const b = netAt(circuit, f.probes.b);
  const cut = B.expressionFor(netlist, a, { treatAsInput: new Set([b]) });
  check('latch: treating the feedback net as an input makes it expandable', cut.kind === 'not');
}

// --------------------------------------------------------------------------
// 6. The input limit refuses before any row is computed.
// --------------------------------------------------------------------------

{
  const many = Array.from({ length: B.MAX_INPUTS + 1 }, (_, i) => i + 1);
  const exprs = new Map([[999, B.variable(1)]]);
  const t0 = performance.now();
  const built = B.truthTable(many, [999], exprs);
  const elapsed = performance.now() - t0;

  check('over the limit: refused', built.ok === false, built.ok === false ? built.reason : '');
  equal('over the limit: the count is reported', built.ok === false ? built.inputCount : -1, B.MAX_INPUTS + 1);
  check('over the limit: refused immediately, not after trying', elapsed < 50, `${elapsed.toFixed(1)} ms`);

  const atLimit = B.truthTable(
    Array.from({ length: 10 }, (_, i) => i + 1),
    [999],
    exprs
  );
  check('under the limit: accepted', atLimit.ok === true);
  equal('under the limit: 2^10 rows', atLimit.ok ? atLimit.table.rows.length : -1, 1024);
}

// --------------------------------------------------------------------------
// 7. evaluate is total over the expression union.
// --------------------------------------------------------------------------

{
  const env = new Map([
    [1, true],
    [2, false],
  ]);
  equal('evaluate: const', B.evaluate(B.TRUE, env), true);
  equal('evaluate: var', B.evaluate(B.variable(1), env), true);
  equal('evaluate: not', B.evaluate(B.not(B.variable(1)), env), false);
  equal('evaluate: and', B.evaluate(B.and([B.variable(1), B.variable(2)]), env), false);
  equal('evaluate: or', B.evaluate(B.or([B.variable(1), B.variable(2)]), env), true);
  equal('evaluate: a variable with no binding is low', B.evaluate(B.variable(77), env), false);
}

summary('boolean');
