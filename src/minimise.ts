// minimise.ts — Quine–McCluskey.
//
// Pure, ~exact for the sizes that reach it, and written rather than imported
// because there is no sympy for a browser and the constitution forbids adding
// a dependency.
//
// WHAT THIS DOES NOT DO: it minimises a *sum of products* — fewest terms,
// fewest literals. The cost this project actually cares about is inverters
// (see cost.ts), and those are different objectives. A minimal SOP is a good
// starting point and usually a good answer, but the result is "minimised",
// never "minimal" or "optimal". Reporting a number in one metric while
// optimising another and calling it optimal would be a quiet lie.

import { and, evaluate, FALSE, not, or, TRUE, variable, type BooleanExpr } from './boolean.js';
import type { NetId } from './netlist.js';

/** Thrown when a minimised expression fails to reproduce its own input. */
export class MinimisationError extends Error {
  constructor(readonly minterm: number) {
    super(`minimised expression disagrees with its input at minterm ${minterm}`);
    this.name = 'MinimisationError';
  }
}

export interface Problem {
  /** Variable order. Bit b of a minterm is `variables[b]`. */
  readonly variables: readonly NetId[];
  readonly minterms: readonly number[];
  readonly dontCares?: readonly number[];
}

/** A cube: `mask` bits are "don't care", `bits` holds the fixed values. */
export interface Implicant {
  readonly bits: number;
  readonly mask: number;
  readonly covers: readonly number[];
}

const bitCount = (n: number): number => {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
};

/** Prime implicants, by repeated adjacency merging. */
export function primeImplicants(p: Problem): Implicant[] {
  const all = [...new Set([...p.minterms, ...(p.dontCares ?? [])])];
  if (all.length === 0) return [];

  let current: Implicant[] = all.map((m) => ({ bits: m, mask: 0, covers: [m] }));
  const primes: Implicant[] = [];

  for (;;) {
    const merged = new Array<boolean>(current.length).fill(false);
    const next = new Map<string, Implicant>();

    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        if (a.mask !== b.mask) continue;
        const diff = a.bits ^ b.bits;
        if (bitCount(diff) !== 1) continue;

        merged[i] = true;
        merged[j] = true;
        const mask = a.mask | diff;
        const bits = a.bits & ~mask;
        const key = `${bits}/${mask}`;
        if (!next.has(key)) {
          next.set(key, { bits, mask, covers: [...new Set([...a.covers, ...b.covers])] });
        }
      }
    }

    for (let i = 0; i < current.length; i++) if (!merged[i]) primes.push(current[i]);
    if (next.size === 0) break;
    current = [...next.values()];
  }

  return primes;
}

/** Cover the chart: essentials first, then greedy on what is left. */
function cover(primes: Implicant[], minterms: readonly number[]): Implicant[] {
  const need = new Set(minterms);
  const chosen: Implicant[] = [];

  // Essential prime implicants: the only cover for some minterm.
  for (const m of minterms) {
    const covering = primes.filter((p) => p.covers.includes(m));
    if (covering.length === 1 && !chosen.includes(covering[0])) {
      chosen.push(covering[0]);
      for (const c of covering[0].covers) need.delete(c);
    }
  }

  // Greedy for the remainder: take whichever prime covers the most that is
  // still needed. Not provably optimal, and the difference at these sizes is
  // a term at most.
  while (need.size > 0) {
    let best: Implicant | null = null;
    let bestGain = 0;
    for (const p of primes) {
      if (chosen.includes(p)) continue;
      let gain = 0;
      for (const c of p.covers) if (need.has(c)) gain++;
      if (gain > bestGain) {
        bestGain = gain;
        best = p;
      }
    }
    if (!best || bestGain === 0) break;
    chosen.push(best);
    for (const c of best.covers) need.delete(c);
  }

  return chosen;
}

/** One cube as a product term. */
function termOf(imp: Implicant, variables: readonly NetId[]): BooleanExpr {
  const factors: BooleanExpr[] = [];
  for (let b = 0; b < variables.length; b++) {
    if ((imp.mask >> b) & 1) continue; // don't care
    const v = variable(variables[b]);
    factors.push(((imp.bits >> b) & 1) === 1 ? v : not(v));
  }
  if (factors.length === 0) return TRUE;
  return factors.length === 1 ? factors[0] : and(factors);
}

/**
 * Minimise to a sum of products.
 *
 * Constant functions come back as constants rather than as a degenerate empty
 * cover, which is the case most likely to produce nonsense downstream.
 */
export function minimise(p: Problem): BooleanExpr {
  const total = 2 ** p.variables.length;
  const ms = [...new Set(p.minterms)].filter((m) => m >= 0 && m < total);

  if (ms.length === 0) return FALSE;
  if (ms.length === total) return TRUE;

  const primes = primeImplicants({ ...p, minterms: ms });
  const chosen = cover(primes, ms);
  if (chosen.length === 0) return FALSE;

  const terms = chosen.map((c) => termOf(c, p.variables));
  const result = terms.length === 1 ? terms[0] : or(terms);

  verify(result, p.variables, new Set(ms), new Set(p.dontCares ?? []));
  return result;
}

/**
 * The self-check: the result must reproduce the function it was built from, on
 * every row.
 *
 * A wrong simplification is worse than none, because it looks like progress —
 * and this one would be offered as pixels to paste over a working circuit. The
 * check costs one pass over rows already bounded by MAX_INPUTS, so there is no
 * reason to skip it. Don't-care minterms are exempt by definition.
 */
function verify(
  e: BooleanExpr,
  variables: readonly NetId[],
  minterms: ReadonlySet<number>,
  dontCares: ReadonlySet<number>
): void {
  const total = 2 ** variables.length;
  const env = new Map<NetId, boolean>();
  for (let m = 0; m < total; m++) {
    if (dontCares.has(m)) continue;
    variables.forEach((v, b) => env.set(v, ((m >> b) & 1) === 1));
    if (evaluate(e, env) !== minterms.has(m)) throw new MinimisationError(m);
  }
}

/** Minterm indices where `rows` is true, for a given output column. */
export function mintermsOf(rows: readonly { outputs: readonly boolean[] }[], column: number): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r.outputs[column]) out.push(i);
  });
  return out;
}
