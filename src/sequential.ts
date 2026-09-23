// sequential.ts — circuits that have memory.
//
// The reference project breaks feedback by enumerating every simple cycle in
// the graph, which is exponential and is one of the two reasons its largest
// processed circuit is 46 gates. This finds strongly connected components in
// linear time instead, and breaks feedback only inside each non-trivial one.
//
// A combinational selection has no non-trivial components, so the common case
// costs one linear pass and stops.

import { expressionFor, not, or, variable, type BooleanExpr } from './boolean.js';
import type { NetId, Netlist } from './netlist.js';

export interface SequentialModel {
  readonly stateNets: readonly NetId[];
  readonly nextState: ReadonlyMap<NetId, BooleanExpr>;
  readonly outputs: ReadonlyMap<NetId, BooleanExpr>;
}

/** Adjacency from source net to destination net, one edge per gate. */
function adjacency(netlist: Netlist): Map<NetId, NetId[]> {
  const g = new Map<NetId, NetId[]>();
  for (const gate of netlist.gates) {
    const list = g.get(gate.src);
    if (list) list.push(gate.dst);
    else g.set(gate.src, [gate.dst]);
  }
  return g;
}

/**
 * Strongly connected components, Tarjan. Iterative, because a 45,000-gate
 * graph would blow a recursive stack.
 */
export function components(netlist: Netlist): NetId[][] {
  const adj = adjacency(netlist);
  const index = new Map<NetId, number>();
  const low = new Map<NetId, number>();
  const onStack = new Set<NetId>();
  const stack: NetId[] = [];
  const out: NetId[][] = [];
  let counter = 0;

  const nodes = netlist.nets.map((n) => n.id);

  for (const root of nodes) {
    if (index.has(root)) continue;

    // Explicit work stack: (node, next child to visit)
    const work: { v: NetId; i: number }[] = [{ v: root, i: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const children = adj.get(frame.v) ?? [];

      if (frame.i < children.length) {
        const w = children[frame.i++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
      } else {
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(frame.v)!));

        if (low.get(frame.v) === index.get(frame.v)) {
          const comp: NetId[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === frame.v) break;
          }
          out.push(comp);
        }
      }
    }
  }
  return out;
}

/** True when the component genuinely loops (more than one node, or a self-edge). */
function isFeedback(comp: NetId[], adj: Map<NetId, NetId[]>): boolean {
  if (comp.length > 1) return true;
  const only = comp[0];
  return (adj.get(only) ?? []).includes(only);
}

/**
 * Nets to cut so the gate graph becomes acyclic.
 *
 * Greedy, per component: repeatedly remove the node with the most edges inside
 * the component until it no longer loops. Not a guaranteed minimum — that
 * problem is NP-hard and does not need solving here, because one state variable
 * too many costs one extra column in a table.
 */
export function feedbackNets(netlist: Netlist): NetId[] {
  const adj = adjacency(netlist);
  const cut: NetId[] = [];

  for (const comp of components(netlist)) {
    if (!isFeedback(comp, adj)) continue;

    const remaining = new Set(comp);
    for (;;) {
      const sub = subgraphOf(remaining, adj);
      if (!hasCycle(remaining, sub)) break;

      let best: NetId | null = null;
      let bestDegree = -1;
      for (const v of remaining) {
        const deg = (sub.get(v) ?? []).length + countIncoming(v, remaining, sub);
        if (deg > bestDegree) {
          bestDegree = deg;
          best = v;
        }
      }
      if (best === null) break;
      cut.push(best);
      remaining.delete(best);
    }
  }
  return cut;
}

function subgraphOf(nodes: ReadonlySet<NetId>, adj: Map<NetId, NetId[]>): Map<NetId, NetId[]> {
  const sub = new Map<NetId, NetId[]>();
  for (const v of nodes) sub.set(v, (adj.get(v) ?? []).filter((w) => nodes.has(w)));
  return sub;
}

function countIncoming(v: NetId, nodes: ReadonlySet<NetId>, sub: Map<NetId, NetId[]>): number {
  let n = 0;
  for (const u of nodes) if ((sub.get(u) ?? []).includes(v)) n++;
  return n;
}

function hasCycle(nodes: ReadonlySet<NetId>, sub: Map<NetId, NetId[]>): boolean {
  const state = new Map<NetId, 0 | 1 | 2>();
  for (const v of nodes) state.set(v, 0);

  for (const root of nodes) {
    if (state.get(root) !== 0) continue;
    const stack: { v: NetId; i: number }[] = [{ v: root, i: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const f = stack[stack.length - 1];
      const children = sub.get(f.v) ?? [];
      if (f.i < children.length) {
        const w = children[f.i++];
        const s = state.get(w);
        if (s === 1) return true;
        if (s === 0) {
          state.set(w, 1);
          stack.push({ v: w, i: 0 });
        }
      } else {
        state.set(f.v, 2);
        stack.pop();
      }
    }
  }
  return false;
}

/** Does this netlist contain feedback at all? */
export function isSequential(netlist: Netlist): boolean {
  const adj = adjacency(netlist);
  return components(netlist).some((c) => isFeedback(c, adj));
}

/**
 * Cut the feedback, then derive next-state and output functions in terms of
 * inputs and current state.
 *
 * The cut is verified: after removing the state nets the graph must be acyclic,
 * and `expressionFor` throws if it is not, so a bad cut fails loudly.
 */
export function analyseSequential(
  netlist: Netlist,
  outputs: readonly NetId[]
): SequentialModel {
  const stateNets = feedbackNets(netlist);
  const treatAsInput = new Set(stateNets);

  const nextState = new Map<NetId, BooleanExpr>();
  for (const s of stateNets) {
    // The next value of a state net is what its drivers produce *now*, with
    // every state net — including this one — read as a current-state variable.
    //
    // Expanding `s` itself would re-enter the loop it was cut from and throw,
    // which is exactly what asking for `expressionFor(s)` with `s` excluded
    // from the cut set did. So the expansion starts one level down, at the
    // gates driving `s`, and each gate contributes its inversion.
    const srcs = netlist.gates.filter((g) => g.dst === s).map((g) => g.src);
    const terms = srcs.map((src) => not(expressionFor(netlist, src, { treatAsInput })));
    nextState.set(
      s,
      terms.length === 0 ? variable(s) : terms.length === 1 ? terms[0] : or(terms)
    );
  }

  const outs = new Map<NetId, BooleanExpr>();
  for (const o of outputs) outs.set(o, expressionFor(netlist, o, { treatAsInput }));

  return { stateNets, nextState, outputs: outs };
}

