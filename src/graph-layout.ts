// graph-layout.ts — a layered layout for directed graphs that have a flow.
//
// A logic circuit flows from inputs to outputs, so it wants a layered
// (Sugiyama-style) layout rather than a force-directed one: signal direction is
// real information and a physics simulation throws it away, producing the
// hairball this feature exists to replace.
//
// Five passes, each a pure function of the graph it is given:
//
//   1. break cycles      reverse a feedback set so the rest can assume a DAG
//   2. assign layers     longest path; inputs land at 0, outputs at the end
//   3. insert dummies    so every edge spans one layer and long edges can bend
//   4. reduce crossings  iterated median ordering, swept down then up
//   5. assign positions  even spacing, then relaxation toward neighbour medians
//
// DETERMINISM IS A CONSTRAINT, NOT A HOPE. No Math.random anywhere, every tie
// broken by node id, every sort explicitly total. The crossing-reduction sweep
// is where this is easiest to lose — a comparator that returns 0 for two nodes
// leaves their order to the sort implementation, and nothing fails, two runs
// just differ. `layout()` called twice on the same graph must produce identical
// coordinates, and scripts/verify/graph-layout.mjs asserts exactly that.

export interface LayoutEdge {
  readonly from: number;
  readonly to: number;
  /** Carried through untouched, so callers can identify their own edges. */
  readonly tag?: unknown;
}

export interface LayoutGraph {
  /** Node ids. Need not be contiguous; order does not matter. */
  readonly nodes: readonly number[];
  readonly edges: readonly LayoutEdge[];
  /** Nodes to pin to the first layer, whatever the longest path says. */
  readonly sources?: readonly number[];
}

export interface PlacedNode {
  readonly id: number;
  readonly layer: number;
  readonly order: number;
  readonly x: number;
  readonly y: number;
  readonly isDummy: boolean;
}

export interface PlacedEdge {
  readonly from: number;
  readonly to: number;
  readonly tag?: unknown;
  /** True when this edge had to be reversed to break a cycle. */
  readonly isFeedback: boolean;
  /** Straight segments, bending at each dummy node. */
  readonly points: readonly { x: number; y: number }[];
}

export interface Layout {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[];
  readonly width: number;
  readonly height: number;
  readonly layers: number;
}

export interface LayoutOptions {
  readonly layerGap?: number;
  readonly nodeGap?: number;
  readonly sweeps?: number;
}

const DEFAULTS = { layerGap: 90, nodeGap: 46, sweeps: 4 };

// ---------------------------------------------------------------------------
// 1. Break cycles
// ---------------------------------------------------------------------------

/**
 * Reverse a set of edges so the graph becomes acyclic.
 *
 * The returned `edges` array is **index-aligned with the input**, which the
 * layout relies on to map a placed edge back to the one the caller gave it. So
 * self-loops are still present in it, unreversed — reversing `1 -> 1` gives
 * `1 -> 1` — and are reported separately in `selfLoops`. The acyclic graph is
 * therefore `edges` MINUS `selfLoops`, not `edges`.
 *
 * Greedy depth-first: an edge that points back at a node currently on the
 * recursion stack closes a cycle, so it is the one reversed. Iterative, because
 * a 45,000-gate graph would blow a recursive stack — the same reason
 * sequential.ts iterates Tarjan.
 */
export function breakCycles(graph: LayoutGraph): {
  edges: LayoutEdge[];
  reversed: Set<number>;
  selfLoops: Set<number>;
} {
  const selfLoops = new Set<number>();
  graph.edges.forEach((e, i) => {
    if (e.from === e.to) selfLoops.add(i);
  });

  const adjacency = new Map<number, { to: number; index: number }[]>();
  for (const n of graph.nodes) adjacency.set(n, []);
  graph.edges.forEach((e, index) => {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    if (!adjacency.has(e.to)) adjacency.set(e.to, []);
    if (selfLoops.has(index)) return;
    adjacency.get(e.from)!.push({ to: e.to, index });
  });
  // Deterministic traversal order.
  for (const list of adjacency.values()) list.sort((a, b) => a.to - b.to || a.index - b.index);

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<number, number>();
  for (const n of adjacency.keys()) colour.set(n, WHITE);

  const reversed = new Set<number>();
  const roots = [...adjacency.keys()].sort((a, b) => a - b);

  for (const root of roots) {
    if (colour.get(root) !== WHITE) continue;
    const stack: { v: number; i: number }[] = [{ v: root, i: 0 }];
    colour.set(root, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = adjacency.get(frame.v) ?? [];
      if (frame.i < children.length) {
        const { to, index } = children[frame.i++];
        const c = colour.get(to);
        if (c === GREY) {
          reversed.add(index); // closes a cycle
        } else if (c === WHITE) {
          colour.set(to, GREY);
          stack.push({ v: to, i: 0 });
        }
      } else {
        colour.set(frame.v, BLACK);
        stack.pop();
      }
    }
  }

  // A self-loop cannot be fixed by reversing it — reversing `1 -> 1` gives
  // `1 -> 1`. It is reported as feedback and excluded from the acyclic edge
  // set, because no layering can place an edge from a node to itself.
  const edges = graph.edges.map((e, i) =>
    reversed.has(i) ? { from: e.to, to: e.from, tag: e.tag } : e
  );
  return { edges, reversed, selfLoops };
}

// ---------------------------------------------------------------------------
// 2. Layer assignment
// ---------------------------------------------------------------------------

/** Longest-path layering over a DAG. Sources at layer 0. */
export function assignLayers(
  nodes: readonly number[],
  edges: readonly LayoutEdge[],
  pinned: readonly number[] = []
): Map<number, number> {
  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();
  for (const n of nodes) {
    incoming.set(n, []);
    outgoing.set(n, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    incoming.get(e.to)!.push(e.from);
    outgoing.get(e.from)!.push(e.to);
  }

  // Kahn ordering, ids ascending so the result never depends on insertion order.
  const indegree = new Map<number, number>();
  for (const n of incoming.keys()) indegree.set(n, incoming.get(n)!.length);

  const ready = [...indegree.keys()].filter((n) => indegree.get(n) === 0).sort((a, b) => a - b);
  const order: number[] = [];
  const queue = [...ready];
  while (queue.length > 0) {
    const v = queue.shift()!;
    order.push(v);
    for (const w of (outgoing.get(v) ?? []).slice().sort((a, b) => a - b)) {
      const d = (indegree.get(w) ?? 1) - 1;
      indegree.set(w, d);
      if (d === 0) queue.push(w);
    }
  }

  const layer = new Map<number, number>();
  for (const n of incoming.keys()) layer.set(n, 0);
  for (const v of order) {
    for (const w of outgoing.get(v) ?? []) {
      layer.set(w, Math.max(layer.get(w) ?? 0, (layer.get(v) ?? 0) + 1));
    }
  }
  // Any node a cycle kept out of the topological order still needs a layer.
  for (const n of incoming.keys()) if (!layer.has(n)) layer.set(n, 0);
  for (const p of pinned) layer.set(p, 0);
  return layer;
}

// ---------------------------------------------------------------------------
// 3–5. The whole thing
// ---------------------------------------------------------------------------

export function layout(graph: LayoutGraph, opts: LayoutOptions = {}): Layout {
  const layerGap = opts.layerGap ?? DEFAULTS.layerGap;
  const nodeGap = opts.nodeGap ?? DEFAULTS.nodeGap;
  const sweeps = opts.sweeps ?? DEFAULTS.sweeps;

  const { edges: acyclic, reversed, selfLoops } = breakCycles(graph);
  // Layering sees neither self-loops nor the direction they pretend to have.
  const forLayering = acyclic.filter((_, i) => !selfLoops.has(i));
  const layerOf = assignLayers(graph.nodes, forLayering, graph.sources);

  // --- 3. dummies, so every edge spans exactly one layer
  interface Segment {
    from: number;
    to: number;
    edgeIndex: number;
  }
  const segments: Segment[] = [];
  const dummies = new Map<number, { layer: number; edgeIndex: number }>();
  // Dummy ids are negative so they cannot collide with real node ids.
  let nextDummy = -1;
  /** Real nodes, in order, that each edge's polyline passes through. */
  const chain = new Map<number, number[]>();

  acyclic.forEach((e, index) => {
    if (selfLoops.has(index)) {
      chain.set(index, [e.from]);
      return;
    }
    const a = layerOf.get(e.from) ?? 0;
    const b = layerOf.get(e.to) ?? 0;
    const path: number[] = [e.from];
    let previous = e.from;
    // Same layer: one segment, no dummies. Computing a step here would give 1
    // and the loop below would never reach `b`, which is an infinite loop
    // rather than a wrong picture.
    const step = b === a ? 0 : b > a ? 1 : -1;
    for (let l = a + step; step !== 0 && l !== b; l += step) {
      const id = nextDummy--;
      dummies.set(id, { layer: l, edgeIndex: index });
      segments.push({ from: previous, to: id, edgeIndex: index });
      path.push(id);
      previous = id;
    }
    segments.push({ from: previous, to: e.to, edgeIndex: index });
    path.push(e.to);
    chain.set(index, path);
  });

  // --- collect every node, real and dummy, into its layer
  const allLayers = new Map<number, number[]>();
  const layerOfAll = new Map<number, number>(layerOf);
  for (const [id, d] of dummies) layerOfAll.set(id, d.layer);
  for (const [id, l] of layerOfAll) {
    const list = allLayers.get(l);
    if (list) list.push(id);
    else allLayers.set(l, [id]);
  }
  const layerIndices = [...allLayers.keys()].sort((a, b) => a - b);
  // Ascending id within each layer: the deterministic starting order.
  for (const l of layerIndices) allLayers.get(l)!.sort((a, b) => a - b);

  // --- 4. crossing reduction by iterated median
  const up = new Map<number, number[]>();
  const down = new Map<number, number[]>();
  for (const s of segments) {
    (up.get(s.to) ?? up.set(s.to, []).get(s.to)!).push(s.from);
    (down.get(s.from) ?? down.set(s.from, []).get(s.from)!).push(s.to);
  }

  const positionIn = (layerNodes: number[]): Map<number, number> => {
    const m = new Map<number, number>();
    layerNodes.forEach((n, i) => m.set(n, i));
    return m;
  };

  const medianOf = (node: number, neighbours: Map<number, number[]>, pos: Map<number, number>): number => {
    const list = (neighbours.get(node) ?? [])
      .map((n) => pos.get(n))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    if (list.length === 0) return -1;
    const mid = list.length >> 1;
    return list.length % 2 === 1 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  };

  for (let sweep = 0; sweep < sweeps; sweep++) {
    const downward = sweep % 2 === 0;
    const order = downward ? layerIndices : [...layerIndices].reverse();
    for (let k = 1; k < order.length; k++) {
      const fixed = allLayers.get(order[k - 1])!;
      const moving = allLayers.get(order[k])!;
      const pos = positionIn(fixed);
      const keys = new Map<number, number>();
      for (const n of moving) keys.set(n, medianOf(n, downward ? up : down, pos));
      // A node with no neighbour on the fixed side keeps its place, and every
      // tie is broken by id — without which this sort is not a function.
      moving.sort((a, b) => {
        const ka = keys.get(a)!;
        const kb = keys.get(b)!;
        if (ka === -1 && kb === -1) return a - b;
        if (ka === -1) return -1;
        if (kb === -1) return 1;
        return ka - kb || a - b;
      });
    }
  }

  // --- 5. coordinates
  const x = new Map<number, number>();
  const y = new Map<number, number>();
  const widest = Math.max(...layerIndices.map((l) => allLayers.get(l)!.length), 1);
  const height = Math.max((widest - 1) * nodeGap, 0);

  for (const l of layerIndices) {
    const nodes = allLayers.get(l)!;
    const span = (nodes.length - 1) * nodeGap;
    const top = (height - span) / 2;
    nodes.forEach((n, i) => {
      x.set(n, l * layerGap);
      y.set(n, top + i * nodeGap);
    });
  }

  // Straighten long runs: pull each node toward the median of its neighbours,
  // without letting it pass a sibling. Deterministic and cheap.
  for (let pass = 0; pass < 2; pass++) {
    for (const l of layerIndices) {
      const nodes = allLayers.get(l)!;
      nodes.forEach((n, i) => {
        const neighbours = [...(up.get(n) ?? []), ...(down.get(n) ?? [])]
          .map((m) => y.get(m))
          .filter((v): v is number => v !== undefined)
          .sort((a, b) => a - b);
        if (neighbours.length === 0) return;
        const mid = neighbours.length >> 1;
        const target =
          neighbours.length % 2 === 1
            ? neighbours[mid]
            : (neighbours[mid - 1] + neighbours[mid]) / 2;
        const lower = i === 0 ? -Infinity : y.get(nodes[i - 1])! + nodeGap;
        const upper = i === nodes.length - 1 ? Infinity : y.get(nodes[i + 1])! - nodeGap;
        y.set(n, Math.min(Math.max(target, lower), upper));
      });
    }
  }

  // --- assemble
  const placed: PlacedNode[] = [];
  for (const l of layerIndices) {
    allLayers.get(l)!.forEach((id, order) => {
      placed.push({
        id,
        layer: l,
        order,
        x: x.get(id) ?? 0,
        y: y.get(id) ?? 0,
        isDummy: id < 0,
      });
    });
  }
  placed.sort((a, b) => a.layer - b.layer || a.order - b.order);

  const placedEdges: PlacedEdge[] = acyclic.map((e, index) => {
    const original = graph.edges[index];

    if (selfLoops.has(index)) {
      // A gate driving its own input. Drawn as a loop beside the node, since a
      // line from a point to itself shows nothing.
      const px = x.get(original.from) ?? 0;
      const py = y.get(original.from) ?? 0;
      return {
        from: original.from,
        to: original.to,
        tag: original.tag,
        isFeedback: true,
        points: [
          { x: px, y: py },
          { x: px + layerGap * 0.35, y: py - nodeGap * 0.5 },
          { x: px, y: py },
        ],
      };
    }

    const path = chain.get(index) ?? [e.from, e.to];
    const points = path.map((id) => ({ x: x.get(id) ?? 0, y: y.get(id) ?? 0 }));
    const isFeedback = reversed.has(index);
    return {
      // Report the edge as the caller gave it, not as the layout reversed it.
      from: original.from,
      to: original.to,
      tag: original.tag,
      isFeedback,
      points: isFeedback ? [...points].reverse() : points,
    };
  });

  const maxLayer = layerIndices.length > 0 ? layerIndices[layerIndices.length - 1] : 0;
  return {
    nodes: placed,
    edges: placedEdges,
    width: maxLayer * layerGap,
    height,
    layers: layerIndices.length,
  };
}

/** Is this edge list acyclic? Used to assert pass 1 did its job. */
export function isAcyclic(nodes: readonly number[], edges: readonly LayoutEdge[]): boolean {
  const outgoing = new Map<number, number[]>();
  const indegree = new Map<number, number>();
  for (const n of nodes) {
    outgoing.set(n, []);
    indegree.set(n, 0);
  }
  for (const e of edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    if (!indegree.has(e.from)) indegree.set(e.from, 0);
    if (!indegree.has(e.to)) indegree.set(e.to, 0);
    outgoing.get(e.from)!.push(e.to);
    indegree.set(e.to, indegree.get(e.to)! + 1);
  }
  const queue = [...indegree.keys()].filter((n) => indegree.get(n) === 0);
  let seen = 0;
  while (queue.length > 0) {
    const v = queue.shift()!;
    seen++;
    for (const w of outgoing.get(v) ?? []) {
      const d = indegree.get(w)! - 1;
      indegree.set(w, d);
      if (d === 0) queue.push(w);
    }
  }
  return seen === indegree.size;
}
