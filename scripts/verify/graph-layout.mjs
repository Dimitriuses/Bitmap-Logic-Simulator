// graph-layout.mjs — quickstart Scenario 3.
//
// Layered layout, five passes. The check that matters most here is not that a
// diagram looks reasonable — nothing automated can judge that — but that the
// same graph laid out twice comes back IDENTICAL. Nondeterminism in a layout
// fails silently: nothing errors, two runs just differ, and it is noticed
// weeks later when a screenshot stops matching. The usual culprit is a sort
// whose comparator returns 0 for two nodes.

import { check, equal, loadDist, netlistOf, REGISTER_4BIT, summary } from './harness.mjs';

const L = await loadDist('graph-layout.js');

console.log('Scenario 3: layered layout\n');

/** Deterministic PRNG, so any failure reproduces exactly. */
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

/**
 * The acyclic edge set, per the contract: breakCycles keeps its result
 * index-aligned with the input, so self-loops remain in `edges` and are
 * reported in `selfLoops`. The acyclic graph is the difference.
 */
const acyclicPart = (r) => r.edges.filter((_, i) => !r.selfLoops.has(i));

const graphOf = (edges, nodes) => ({
  nodes: nodes ?? [...new Set(edges.flat())].sort((a, b) => a - b),
  edges: edges.map(([from, to]) => ({ from, to })),
});

// --------------------------------------------------------------------------
// 1. Cycle breaking
// --------------------------------------------------------------------------

{
  // A plain chain has nothing to break.
  const g = graphOf([[1, 2], [2, 3], [3, 4]]);
  const r = L.breakCycles(g);
  equal('a chain reverses nothing', r.reversed.size, 0);
  check('and is acyclic', L.isAcyclic(g.nodes, acyclicPart(r)));
}

{
  // A triangle must lose exactly one edge to become a DAG.
  const g = graphOf([[1, 2], [2, 3], [3, 1]]);
  const r = L.breakCycles(g);
  equal('a 3-cycle reverses one edge', r.reversed.size, 1);
  check('and becomes acyclic', L.isAcyclic(g.nodes, acyclicPart(r)));
}

{
  // A self-loop is a cycle of one.
  const g = graphOf([[1, 1]]);
  const r = L.breakCycles(g);
  // A self-loop cannot be reversed into acyclicity, so it is reported and
  // excluded rather than pretended away.
  equal('a self-loop is reported as such', r.selfLoops.size, 1);
  check('and excluding it leaves an acyclic graph', L.isAcyclic(g.nodes, acyclicPart(r)));
  const out = L.layout(g);
  equal('the layout still draws it', out.edges.length, 1);
  check('as feedback', out.edges[0].isFeedback);
  check('with a visible loop rather than a zero-length line', out.edges[0].points.length >= 3);
}

{
  // The two-inverter latch, which is the shape this feature cares about.
  const g = graphOf([[1, 2], [2, 1]]);
  const r = L.breakCycles(g);
  equal('a latch loop reverses one edge', r.reversed.size, 1);
  check('and becomes acyclic', L.isAcyclic(g.nodes, acyclicPart(r)));
}

{
  // Random graphs: whatever the shape, the result must be acyclic.
  const random = rng(20260924);
  let broken = 0;
  let tried = 0;
  for (let trial = 0; trial < 60; trial++) {
    const n = 4 + Math.floor(random() * 20);
    const edges = [];
    for (let i = 0; i < n * 2; i++) {
      const a = 1 + Math.floor(random() * n);
      const b = 1 + Math.floor(random() * n);
      edges.push([a, b]);
    }
    const g = graphOf(edges, Array.from({ length: n }, (_, i) => i + 1));
    const r = L.breakCycles(g);
    tried++;
    if (!L.isAcyclic(g.nodes, acyclicPart(r))) broken++;
  }
  check('60 random graphs all become acyclic', broken === 0, `${tried} graphs`);
}

// --------------------------------------------------------------------------
// 2. Layering
// --------------------------------------------------------------------------

{
  const g = graphOf([[1, 2], [2, 3], [3, 4]]);
  const layers = L.assignLayers(g.nodes, g.edges);
  equal('a chain layers 0,1,2,3 — node 1', layers.get(1), 0);
  equal('  node 4', layers.get(4), 3);
}

{
  // Longest path, not shortest: node 4 must sit after the long branch.
  const g = graphOf([[1, 2], [2, 3], [3, 4], [1, 4]]);
  const layers = L.assignLayers(g.nodes, g.edges);
  equal('longest path wins over the shortcut', layers.get(4), 3);
}

{
  const g = graphOf([[1, 3], [2, 3]]);
  const layers = L.assignLayers(g.nodes, g.edges);
  check('both sources land on layer 0', layers.get(1) === 0 && layers.get(2) === 0);
  equal('the sink is one layer on', layers.get(3), 1);
}

// --------------------------------------------------------------------------
// 3. The whole layout
// --------------------------------------------------------------------------

{
  const g = graphOf([[1, 3], [2, 3], [3, 4]]);
  const out = L.layout(g);
  equal('every node is placed', out.nodes.filter((n) => !n.isDummy).length, 4);
  equal('every edge is placed', out.edges.length, 3);
  check('inputs are on the first layer',
    out.nodes.filter((n) => n.id === 1 || n.id === 2).every((n) => n.layer === 0));
  check('the output is on the last layer',
    out.nodes.find((n) => n.id === 4).layer === out.layers - 1);
  check('every edge has at least two points', out.edges.every((e) => e.points.length >= 2));
}

{
  // A long edge must bend through dummies rather than cutting across layers.
  const g = graphOf([[1, 2], [2, 3], [3, 4], [1, 4]]);
  const out = L.layout(g);
  const long = out.edges.find((e) => e.from === 1 && e.to === 4);
  check('a layer-spanning edge bends through dummies', long.points.length > 2,
    `${long.points.length} points`);
  check('dummy nodes were created', out.nodes.some((n) => n.isDummy));
}

{
  const g = graphOf([[1, 2], [2, 1]]);
  const out = L.layout(g);
  equal('a latch loop yields one feedback edge', out.edges.filter((e) => e.isFeedback).length, 1);
  check('and the other edge is not feedback', out.edges.filter((e) => !e.isFeedback).length === 1);
  check('feedback edges keep the caller’s direction',
    out.edges.every((e) => (e.from === 1 && e.to === 2) || (e.from === 2 && e.to === 1)));
}

// --------------------------------------------------------------------------
// 4. Determinism — the check this suite exists for.
// --------------------------------------------------------------------------

{
  const random = rng(99);
  let differed = [];
  for (let trial = 0; trial < 25; trial++) {
    const n = 8 + Math.floor(random() * 30);
    const edges = [];
    for (let i = 0; i < n * 2; i++) {
      edges.push([1 + Math.floor(random() * n), 1 + Math.floor(random() * n)]);
    }
    const g = graphOf(edges, Array.from({ length: n }, (_, i) => i + 1));
    const a = JSON.stringify(L.layout(g));
    const b = JSON.stringify(L.layout(g));
    if (a !== b) differed.push(`trial ${trial}`);
  }
  check('25 random graphs lay out identically twice', differed.length === 0, differed.join(','));
}

{
  // And the shape the feature actually produces.
  const netlist = REGISTER_4BIT();
  const g = graphOf(netlist.gates.map((x) => [x.src, x.dst]));
  check('a 4-bit register lays out identically twice',
    JSON.stringify(L.layout(g)) === JSON.stringify(L.layout(g)));
}

// --------------------------------------------------------------------------
// 5. Scale
// --------------------------------------------------------------------------

{
  // 250 gates, the size named in SC-002, shaped like a circuit: mostly forward
  // with a few loops.
  const random = rng(7);
  const n = 250;
  const edges = [];
  for (let i = 1; i < n; i++) {
    edges.push([i, i + 1]);
    if (random() < 0.4) edges.push([Math.max(1, i - 1 - Math.floor(random() * 5)), i + 1]);
    if (random() < 0.05) edges.push([i + 1, Math.max(1, i - Math.floor(random() * 10))]);
  }
  const g = graphOf(edges, Array.from({ length: n }, (_, i) => i + 1));

  const t0 = performance.now();
  const out = L.layout(g);
  const ms = performance.now() - t0;

  check('a 250-node circuit-shaped graph lays out well inside budget', ms < 2000, `${ms.toFixed(0)} ms`);
  equal('all 250 nodes placed', out.nodes.filter((x) => !x.isDummy).length, n);
  check('feedback edges are marked', out.edges.some((e) => e.isFeedback));

  const t1 = performance.now();
  const again = L.layout(g);
  check('and deterministically', JSON.stringify(out) === JSON.stringify(again),
    `${(performance.now() - t1).toFixed(0)} ms for the second pass`);
}

// --------------------------------------------------------------------------
// 6. Degenerate inputs
// --------------------------------------------------------------------------

{
  const empty = L.layout({ nodes: [], edges: [] });
  equal('an empty graph places nothing', empty.nodes.length, 0);
  equal('and has no edges', empty.edges.length, 0);

  const lone = L.layout(graphOf([], [1, 2, 3]));
  equal('isolated nodes are still placed', lone.nodes.length, 3);
  check('all on one layer', lone.nodes.every((n) => n.layer === 0));

  const gateless = L.layout(graphOf([[1, 2]], [1, 2, 9]));
  check('a node with no edges coexists with one that has them', gateless.nodes.length === 3);
}

summary('graph-layout');
