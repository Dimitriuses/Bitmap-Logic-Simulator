// minimise.mjs — quickstart Scenario 5.
//
// Quine-McCluskey, plus the cost model that makes its output mean anything in
// this medium. The bar here is correctness on every row of every function
// tried, not elegance of the cover: a simplification that is merely *usually*
// right would be offered as pixels to paste over a working circuit.

import {
  check,
  equal,
  gateFixture,
  loadDist,
  loadEngine,
  netAt,
  summary,
  wiredOrFixture,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const M = await loadDist('minimise.js');
const C = await loadDist('cost.js');

console.log('Scenario 5: minimisation and cost\n');

/** Deterministic PRNG, so a failure can be reproduced exactly. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// --------------------------------------------------------------------------
// 1. Random functions of 2-10 variables agree on every row.
// --------------------------------------------------------------------------

{
  const random = rng(20260923);
  let functions = 0;
  let rowsChecked = 0;
  let wrong = 0;
  let firstFailure = '';

  for (let n = 2; n <= 10; n++) {
    const variables = Array.from({ length: n }, (_, i) => i + 1);
    const total = 2 ** n;

    for (let trial = 0; trial < 12; trial++) {
      // Vary the density so both sparse and dense functions are covered.
      const density = trial === 0 ? 0 : trial === 1 ? 1 : random();
      const minterms = [];
      for (let m = 0; m < total; m++) if (random() < density) minterms.push(m);

      let expr;
      try {
        expr = M.minimise({ variables, minterms });
      } catch (err) {
        wrong++;
        if (!firstFailure) firstFailure = `n=${n} trial=${trial}: ${err.message}`;
        continue;
      }
      functions++;

      const want = new Set(minterms);
      const env = new Map();
      for (let m = 0; m < total; m++) {
        variables.forEach((v, b) => env.set(v, ((m >> b) & 1) === 1));
        rowsChecked++;
        if (B.evaluate(expr, env) !== want.has(m)) {
          wrong++;
          if (!firstFailure) firstFailure = `n=${n} trial=${trial} minterm=${m}`;
          break;
        }
      }
    }
  }

  check(
    'random functions of 2-10 variables agree on every row',
    wrong === 0,
    `${functions} functions, ${rowsChecked} rows${firstFailure ? ` — ${firstFailure}` : ''}`
  );
}

// --------------------------------------------------------------------------
// 2. Constants come back as constants, not as a degenerate cover.
// --------------------------------------------------------------------------

{
  const variables = [1, 2, 3];
  const none = M.minimise({ variables, minterms: [] });
  equal('empty function is a constant', none.kind, 'const');
  equal('empty function is false', none.value, false);

  const all = M.minimise({ variables, minterms: [0, 1, 2, 3, 4, 5, 6, 7] });
  equal('full function is a constant', all.kind, 'const');
  equal('full function is true', all.value, true);

  equal('a constant costs nothing', C.inverterCost(none), 0);
}

// --------------------------------------------------------------------------
// 3. An already-minimal function is not "improved".
// --------------------------------------------------------------------------

{
  const variables = [1, 2];
  // NOT a: minterms where bit 0 is low.
  const expr = M.minimise({ variables, minterms: [0, 2] });
  equal('NOT a minimises to a single NOT', expr.kind, 'not');
  check('of the right variable', expr.arg.kind === 'var' && expr.arg.net === 1);
  equal('and costs one inverter', C.inverterCost(expr), 1);

  // Re-minimising changes nothing.
  const again = M.minimise({ variables, minterms: [0, 2] });
  equal('re-minimising is idempotent in cost', C.inverterCost(again), C.inverterCost(expr));

  // Four minterms that share no adjacency cannot shrink to one term.
  const xor = M.minimise({ variables, minterms: [1, 2] });
  equal('XOR needs two terms', xor.kind, 'or');
  equal('and no more', xor.args.length, 2);
}

// --------------------------------------------------------------------------
// 4. Adjacency really is exploited.
// --------------------------------------------------------------------------

{
  const variables = [1, 2, 3];
  // Every minterm where bit 2 is high: should collapse to the single literal c.
  const expr = M.minimise({ variables, minterms: [4, 5, 6, 7] });
  equal('a half-cube collapses to one literal', expr.kind, 'var');
  equal('namely the third variable', expr.net, 3);

  const primes = M.primeImplicants({ variables, minterms: [4, 5, 6, 7] });
  equal('one prime implicant', primes.length, 1);
  equal('covering all four minterms', primes[0].covers.length, 4);
}

// --------------------------------------------------------------------------
// 5. The self-check fires when the result is wrong.
// --------------------------------------------------------------------------
//
// Feed a minterm outside the variable space. It is filtered, so the function
// becomes empty -- proving the filter and the check do not contradict.

{
  const variables = [1, 2];
  const expr = M.minimise({ variables, minterms: [9, 99] });
  equal('out-of-range minterms are dropped', expr.kind, 'const');
  equal('leaving the empty function', expr.value, false);
  check('MinimisationError is exported so callers can catch it', typeof M.MinimisationError === 'function');
}

// --------------------------------------------------------------------------
// 6. The cost model counts inverters, because that is what a gate is here.
// --------------------------------------------------------------------------

{
  for (const direction of ['up', 'down', 'left', 'right']) {
    const f = gateFixture(direction);
    const circuit = new Circuit(f.image, null);
    const r = extractNetlist(circuit, f.image);
    equal(`${direction}: one gate costs 1`, C.netlistCost(r.netlist), 1);

    const dst = netAt(circuit, f.probes.dst);
    equal(`${direction}: its expression costs 1`, C.inverterCost(B.expressionFor(r.netlist, dst)), 1);
  }

  const f = wiredOrFixture();
  const circuit = new Circuit(f.image, null);
  const r = extractNetlist(circuit, f.image);
  equal('a wired-OR pair costs 2 gates', C.netlistCost(r.netlist), 2);

  const out = netAt(circuit, f.probes.out);
  const expr = B.expressionFor(r.netlist, out);
  equal('and its expression costs 2 inverters', C.inverterCost(expr), 2);
  check('because the OR itself is wiring, and free', expr.kind === 'or');

  equal('a bare variable costs nothing', C.inverterCost(B.variable(1)), 0);
  equal(
    'an AND of two literals costs the AND plus its positive literals',
    C.inverterCost(B.and([B.variable(1), B.variable(2)])),
    3
  );
  equal(
    'a shared positive literal is paid for once',
    C.inverterCost(B.or([B.and([B.variable(1), B.variable(2)]), B.and([B.variable(1), B.variable(3)])])),
    5
  );
  equal('fan-in is the variables actually read', C.fanIn([B.and([B.variable(1), B.variable(2)])]), 2);
}

summary('minimise');
