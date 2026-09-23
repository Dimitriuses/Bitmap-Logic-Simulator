// layout.mjs — quickstart Scenario 6.
//
// The replacement path. Layout is the only module that writes a circuit, so
// the standard here is higher than elsewhere: it is not enough that a drawing
// looks right, it has to compile to the function it claims and be driven
// through the real engine to prove it.

import { check, equal, loadDist, loadEngine, summary } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const M = await loadDist('minimise.js');
const L = await loadDist('layout.js');
const { sweep } = await loadDist('oracle.js');

console.log('Scenario 6: laying an expression back out\n');

/** Deterministic PRNG so any failure reproduces. */
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
// 1. Every function of 1-4 variables lays out and computes itself.
// --------------------------------------------------------------------------
//
// Exhaustive for 1-3 variables (every one of the 2^2^n functions), sampled for
// 4. Constants are excluded: they are refused by design, and tested separately.

{
  let laid = 0;
  let refused = 0;
  let wrong = 0;
  let firstFailure = '';

  for (let n = 1; n <= 3; n++) {
    const variables = Array.from({ length: n }, (_, i) => i + 1);
    const rows = 2 ** n;
    for (let f = 0; f < 2 ** rows; f++) {
      const minterms = [];
      for (let m = 0; m < rows; m++) if ((f >> m) & 1) minterms.push(m);
      if (minterms.length === 0 || minterms.length === rows) continue; // constant

      const expr = M.minimise({ variables, minterms });
      const out = L.layout(expr, variables);
      if (!out.ok) {
        refused++;
        if (!firstFailure) firstFailure = `n=${n} f=${f}: ${out.reason}`;
        continue;
      }
      laid++;

      // Independently: compile the block and derive what it computes.
      const image = L.toImageData(out.result.block);
      const circuit = new Circuit(image, null);
      const r = extractNetlist(circuit, image);
      if (!r.ok || r.netlist.outputs.length !== 1) {
        wrong++;
        if (!firstFailure) firstFailure = `n=${n} f=${f}: bad netlist`;
        continue;
      }
      const rails = [...r.netlist.inputs].sort((a, b) => {
        const na = r.netlist.nets.find((x) => x.id === a);
        const nb = r.netlist.nets.find((x) => x.id === b);
        return na.probe.y - nb.probe.y;
      });
      const drawn = B.expressionFor(r.netlist, r.netlist.outputs[0]);

      const want = new Set(minterms);
      for (let m = 0; m < rows; m++) {
        const env = new Map();
        rails.forEach((id, b) => env.set(id, ((m >> b) & 1) === 1));
        if (B.evaluate(drawn, env) !== want.has(m)) {
          wrong++;
          if (!firstFailure) firstFailure = `n=${n} f=${f} minterm=${m}`;
          break;
        }
      }
    }
  }

  check(
    'every non-constant function of 1-3 variables lays out',
    refused === 0,
    `${laid} laid out${firstFailure ? ` — ${firstFailure}` : ''}`
  );
  check(
    'and the compiled drawing computes it',
    wrong === 0,
    `${laid} drawings${firstFailure && wrong ? ` — ${firstFailure}` : ''}`
  );
}

// --------------------------------------------------------------------------
// 2. Four and five variables, sampled.
// --------------------------------------------------------------------------

{
  const random = rng(4242);
  let laid = 0;
  let bad = 0;
  let firstFailure = '';

  for (let n = 4; n <= 5; n++) {
    const variables = Array.from({ length: n }, (_, i) => i + 1);
    const rows = 2 ** n;
    for (let trial = 0; trial < 24; trial++) {
      const minterms = [];
      const density = 0.2 + random() * 0.6;
      for (let m = 0; m < rows; m++) if (random() < density) minterms.push(m);
      if (minterms.length === 0 || minterms.length === rows) continue;

      const expr = M.minimise({ variables, minterms });
      const out = L.layout(expr, variables);
      if (!out.ok) {
        bad++;
        if (!firstFailure) firstFailure = out.reason;
        continue;
      }
      laid++;
    }
  }
  check('4- and 5-variable functions lay out', bad === 0, `${laid} laid out — ${firstFailure}`);
}

// --------------------------------------------------------------------------
// 3. The drawing survives the real engine, not just the extractor.
// --------------------------------------------------------------------------
//
// The strongest available check short of a browser: drive the generated pixels
// through the simulator for every input combination.

{
  const variables = [1, 2, 3];
  // (a AND b) OR (NOT c): a shape with both polarities and a shared rail.
  const minterms = [0, 1, 2, 3, 7];
  const expr = M.minimise({ variables, minterms });
  const out = L.layout(expr, variables);
  check('the sample function lays out', out.ok, out.ok ? '' : out.reason);

  if (out.ok) {
    const image = L.toImageData(out.result.block);
    const circuit = new Circuit(image, null);
    equal('compiled gate count matches the prediction', circuit.gateCount, out.result.gateCount);

    const r = extractNetlist(circuit, image);
    check('the drawing extracts', r.ok, r.ok ? '' : r.reason);

    const rails = [...r.netlist.inputs].sort((a, b) => {
      const na = r.netlist.nets.find((x) => x.id === a);
      const nb = r.netlist.nets.find((x) => x.id === b);
      return na.probe.y - nb.probe.y;
    });
    const outNet = r.netlist.outputs[0];
    const drawn = B.expressionFor(r.netlist, outNet);
    const built = B.truthTable(rails, [outNet], new Map([[outNet, drawn]]));
    check('its truth table builds', built.ok, built.ok ? '' : built.reason);

    if (built.ok) {
      const want = new Set(minterms);
      check(
        'the analytic table is the function that was asked for',
        built.table.rows.every((row, m) => row.outputs[0] === want.has(m))
      );

      const res = sweep(circuit, r.netlist, built.table, { maxCycles: 2000 });
      equal('the engine agrees with it on every row', res.discrepancies.length, 0);
      equal('every row settles', res.nonConvergentRows, 0);
      equal('nothing is timing-dependent', res.timingDependentRows, 0);
      check(
        'and the engine computes the original function',
        res.observed.rows.every((row, m) => row.outputs[0] === want.has(m))
      );
    }
  }
}

// --------------------------------------------------------------------------
// 4. Determinism.
// --------------------------------------------------------------------------

{
  const variables = [1, 2, 3, 4];
  const expr = M.minimise({ variables, minterms: [1, 3, 5, 7, 9, 12, 14] });
  const a = L.layout(expr, variables);
  const b = L.layout(expr, variables);
  check('two layouts of one expression both succeed', a.ok && b.ok);
  if (a.ok && b.ok) {
    equal('same width', a.result.block.width, b.result.block.width);
    equal('same height', a.result.block.height, b.result.block.height);
    check(
      'identical pixels',
      a.result.block.pixels.every((v, i) => v === b.result.block.pixels[i])
    );
  }
}

// --------------------------------------------------------------------------
// 5. Refusals, with a reason.
// --------------------------------------------------------------------------

{
  const constant = L.layout(B.TRUE, [1, 2]);
  check('a constant is refused', constant.ok === false, constant.ok === false ? constant.reason : '');
  check(
    'and the refusal explains why, not just that',
    constant.ok === false && /supply rail|inverter/.test(constant.reason)
  );

  const noVars = L.layout(B.variable(1), []);
  check('no variables is refused', noVars.ok === false, noVars.ok === false ? noVars.reason : '');

  // Nested ORs are not the sum-of-products shape this lays out.
  const nested = L.layout(B.and([B.or([B.variable(1), B.variable(2)]), B.variable(3)]), [1, 2, 3]);
  check(
    'a non-SOP expression is refused rather than approximated',
    nested.ok === false,
    nested.ok === false ? nested.reason : 'ACCEPTED'
  );
}

// --------------------------------------------------------------------------
// 6. A layout checked against an original truth table.
// --------------------------------------------------------------------------

{
  const variables = [1, 2];
  const expr = M.minimise({ variables, minterms: [1, 2] }); // XOR
  const good = B.truthTable(variables, [99], new Map([[99, expr]]));
  check('the reference table builds', good.ok);

  if (good.ok) {
    const out = L.layout(expr, variables, good.table);
    check('a layout matching the original is offered', out.ok, out.ok ? '' : out.reason);

    // Falsify the reference: the layout must now refuse.
    const rows = good.table.rows.map((row, i) =>
      i === 0 ? { ...row, outputs: [!row.outputs[0]] } : row
    );
    const lying = { ...good.table, rows };
    const refused = L.layout(expr, variables, lying);
    check(
      'a layout that disagrees with the original is NOT offered',
      refused.ok === false,
      refused.ok === false ? refused.reason : 'OFFERED'
    );
  }
}

summary('layout');
