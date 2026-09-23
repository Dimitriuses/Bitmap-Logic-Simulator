// cost.ts — what a circuit costs in this medium.
//
// The only gate here is an inverter, and several gates driving one net are an
// OR at no cost. So the number worth showing is inverters, not literals: a
// generic term count would be a different and far less useful figure.
//
// This mirrors the cost model from the reference project, which is the most
// genuinely domain-specific idea in it.

import { variablesOf, type BooleanExpr } from './boolean.js';
import type { Netlist } from './netlist.js';

/** Inverters actually present in a netlist. */
export function netlistCost(netlist: Netlist): number {
  return netlist.gates.length;
}

/**
 * Inverters needed to realise an expression.
 *
 * OR is wiring, so it is free. AND has to be built from inverters — De Morgan
 * turns it into a NOR of the inverted terms — and each positive literal used
 * inside an AND needs an inverter of its own, counted once however often it is
 * shared.
 */
export function inverterCost(e: BooleanExpr): number {
  return structural(e) + sharedPositiveLiterals(e).size;
}

function structural(e: BooleanExpr): number {
  switch (e.kind) {
    case 'const':
    case 'var':
      return 0;
    case 'not':
      // NOT of a plain variable is one gate; NOT of anything else is that
      // thing's cost plus one.
      return e.arg.kind === 'var' ? 1 : 1 + structural(e.arg);
    case 'or':
      // Wired-OR: free. Only the terms cost anything.
      return e.args.reduce((n, a) => n + structural(a), 0);
    case 'and': {
      // One gate to combine, plus the cost of inverting any term that is not
      // already a literal.
      let total = 1;
      for (const a of e.args) {
        if (a.kind === 'var') continue;
        if (a.kind === 'not' && a.arg.kind === 'var') continue;
        total += structural(a) + 1;
      }
      return total;
    }
  }
}

/**
 * Positive literals appearing inside an AND. Each needs an inverter to enter
 * the NOR form, and sharing means it is paid for once.
 */
function sharedPositiveLiterals(e: BooleanExpr, insideAnd = false, acc = new Set<number>()): Set<number> {
  switch (e.kind) {
    case 'const':
      break;
    case 'var':
      if (insideAnd) acc.add(e.net);
      break;
    case 'not':
      // A negated variable is already available; look no further.
      if (e.arg.kind !== 'var') sharedPositiveLiterals(e.arg, insideAnd, acc);
      break;
    case 'and':
      for (const a of e.args) sharedPositiveLiterals(a, true, acc);
      break;
    case 'or':
      for (const a of e.args) sharedPositiveLiterals(a, false, acc);
      break;
  }
  return acc;
}

/** Total cost of a set of output expressions. */
export function totalCost(exprs: Iterable<BooleanExpr>): number {
  let n = 0;
  for (const e of exprs) n += inverterCost(e);
  return n;
}

/** Variables an expression set reads, for reporting. */
export function fanIn(exprs: Iterable<BooleanExpr>): number {
  const all = new Set<number>();
  for (const e of exprs) for (const v of variablesOf(e)) all.add(v);
  return all.size;
}
