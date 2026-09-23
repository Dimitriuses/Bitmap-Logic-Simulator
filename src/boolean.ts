// boolean.ts — what a circuit computes, as algebra.
//
// Pure: no DOM, no engine, no document. That is what lets the whole boolean
// layer be checked headlessly, which matters because every conclusion this
// feature draws about the simulator rests on it being right.

import type { NetId, Netlist } from './netlist.js';

export type BooleanExpr =
  | { readonly kind: 'const'; readonly value: boolean }
  | { readonly kind: 'var'; readonly net: NetId }
  | { readonly kind: 'not'; readonly arg: BooleanExpr }
  | { readonly kind: 'and'; readonly args: readonly BooleanExpr[] }
  | { readonly kind: 'or'; readonly args: readonly BooleanExpr[] };

export const TRUE: BooleanExpr = { kind: 'const', value: true };
export const FALSE: BooleanExpr = { kind: 'const', value: false };
export const variable = (net: NetId): BooleanExpr => ({ kind: 'var', net });
export const not = (arg: BooleanExpr): BooleanExpr => ({ kind: 'not', arg });
export const and = (args: readonly BooleanExpr[]): BooleanExpr => ({ kind: 'and', args });
export const or = (args: readonly BooleanExpr[]): BooleanExpr => ({ kind: 'or', args });

/**
 * The largest input count the tool will enumerate.
 *
 * Measured: 16 inputs is 65,536 rows and about 12 s of simulator sweep at
 * 0.19 ms per settled row. 20 would be over three minutes, which is a freeze
 * rather than a result.
 */
export const MAX_INPUTS = 16;

/** Evaluation is total: every variable has a value in every row. */
export function evaluate(e: BooleanExpr, env: ReadonlyMap<NetId, boolean>): boolean {
  switch (e.kind) {
    case 'const':
      return e.value;
    case 'var':
      return env.get(e.net) ?? false;
    case 'not':
      return !evaluate(e.arg, env);
    case 'and':
      return e.args.every((a) => evaluate(a, env));
    case 'or':
      return e.args.some((a) => evaluate(a, env));
  }
}

/** Nets an expression reads. */
export function variablesOf(e: BooleanExpr, acc = new Set<NetId>()): Set<NetId> {
  switch (e.kind) {
    case 'const':
      break;
    case 'var':
      acc.add(e.net);
      break;
    case 'not':
      variablesOf(e.arg, acc);
      break;
    case 'and':
    case 'or':
      for (const a of e.args) variablesOf(a, acc);
      break;
  }
  return acc;
}

export class CyclicNetlistError extends Error {
  constructor(readonly net: NetId) {
    super(`net ${net} is part of a feedback loop; use the sequential path`);
    this.name = 'CyclicNetlistError';
  }
}

/**
 * The expression a net carries, in terms of the netlist's inputs.
 *
 * Three engine rules are modelled exactly, and they are the whole of the
 * semantics:
 *
 *   - every gate is an inverter, so a driven net is NOT of its source;
 *   - a net driven by several gates is their wired-OR, which is how every
 *     non-inverter gate in this medium is built;
 *   - a net no gate drives is a free variable holding whatever the user last
 *     set — the same fallback that makes clicking a wire work. Treating it as a
 *     constant would fabricate a function the circuit does not compute.
 *
 * Feedback is refused rather than expanded forever; that is sequential.ts's job.
 */
export function expressionFor(
  netlist: Netlist,
  net: NetId,
  opts: { readonly treatAsInput?: ReadonlySet<NetId> } = {}
): BooleanExpr {
  const drivers = new Map<NetId, NetId[]>();
  for (const g of netlist.gates) {
    const list = drivers.get(g.dst);
    if (list) list.push(g.src);
    else drivers.set(g.dst, [g.src]);
  }

  const free = opts.treatAsInput ?? new Set<NetId>();
  const onPath = new Set<NetId>();
  const memo = new Map<NetId, BooleanExpr>();

  const build = (id: NetId): BooleanExpr => {
    if (free.has(id)) return variable(id);
    const cached = memo.get(id);
    if (cached) return cached;

    const srcs = drivers.get(id);
    if (!srcs || srcs.length === 0) return variable(id); // undriven: free input

    if (onPath.has(id)) throw new CyclicNetlistError(id);
    onPath.add(id);
    const terms = srcs.map((s) => not(build(s)));
    onPath.delete(id);

    const expr = terms.length === 1 ? terms[0] : or(terms);
    memo.set(id, expr);
    return expr;
  };

  return build(net);
}

export type RowStatus = 'settled' | 'nonConvergent' | 'timingDependent';

export interface TruthRow {
  readonly inputs: readonly boolean[];
  readonly outputs: readonly boolean[];
  readonly status: RowStatus;
}

export interface TruthTable {
  readonly inputs: readonly NetId[];
  readonly outputs: readonly NetId[];
  readonly rows: readonly TruthRow[];
}

export type TableResult =
  | { readonly ok: true; readonly table: TruthTable }
  | { readonly ok: false; readonly reason: string; readonly inputCount: number };

/** The combination for row `i`, LSB = first input. */
export function combinationFor(i: number, count: number): boolean[] {
  const out: boolean[] = [];
  for (let b = 0; b < count; b++) out.push((i >> b & 1) === 1);
  return out;
}

/**
 * Build a truth table from expressions.
 *
 * The size check happens before a single row is computed: the refusal has to
 * arrive instead of the freeze, not after it.
 */
export function truthTable(
  inputs: readonly NetId[],
  outputs: readonly NetId[],
  exprs: ReadonlyMap<NetId, BooleanExpr>
): TableResult {
  if (inputs.length > MAX_INPUTS) {
    return {
      ok: false,
      reason: `${inputs.length} inputs exceeds the limit of ${MAX_INPUTS}`,
      inputCount: inputs.length,
    };
  }

  const rows: TruthRow[] = [];
  const total = 2 ** inputs.length;
  const env = new Map<NetId, boolean>();
  for (let i = 0; i < total; i++) {
    const combo = combinationFor(i, inputs.length);
    env.clear();
    inputs.forEach((net, b) => env.set(net, combo[b]));
    rows.push({
      inputs: combo,
      outputs: outputs.map((o) => evaluate(exprs.get(o) ?? FALSE, env)),
      status: 'settled',
    });
  }
  return { ok: true, table: { inputs, outputs, rows } };
}

/** Two expressions are equal when they agree on every row, not when they look alike. */
export function equivalent(
  a: BooleanExpr,
  b: BooleanExpr,
  inputs: readonly NetId[]
): boolean {
  const total = 2 ** inputs.length;
  const env = new Map<NetId, boolean>();
  for (let i = 0; i < total; i++) {
    const combo = combinationFor(i, inputs.length);
    env.clear();
    inputs.forEach((net, bIdx) => env.set(net, combo[bIdx]));
    if (evaluate(a, env) !== evaluate(b, env)) return false;
  }
  return true;
}

/** Readable form, for the panel. */
export function formatExpr(e: BooleanExpr, name: (n: NetId) => string): string {
  switch (e.kind) {
    case 'const':
      return e.value ? '1' : '0';
    case 'var':
      return name(e.net);
    case 'not': {
      const inner = formatExpr(e.arg, name);
      return e.arg.kind === 'var' || e.arg.kind === 'const' ? `¬${inner}` : `¬(${inner})`;
    }
    case 'and':
      return e.args.map((a) => (a.kind === 'or' ? `(${formatExpr(a, name)})` : formatExpr(a, name))).join(' · ');
    case 'or':
      return e.args.map((a) => formatExpr(a, name)).join(' + ');
  }
}
