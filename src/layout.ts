// layout.ts — turn an expression back into pixels.
//
// The only module in this feature that produces a circuit rather than
// describing one. Everything else is read-only analysis whose worst failure is
// a wrong report; this one's output gets pasted over a circuit that works. So
// nothing leaves here unproven: `layout()` compiles what it drew, re-analyses
// it with the same extractor the UI uses, and compares its truth table against
// the one it was asked to realise. A layout that fails that is not returned.
//
// THE SCHEME
//
// One net per row, one gate per column, and every gate points down.
//
//   rows, top to bottom:   input rails  ->  inverted rails  ->  term nodes  ->  output
//
// Because that ordering matches the direction signal flows, every gate's source
// row lies above its destination row, so every gate is the same 'down' stamp
// and no direction logic is needed here at all.
//
// A gate is a vertical run in its own column, from its source row to its
// destination row, with the 3x3 stamp sitting in the gap just below the source.
// Where a run passes a row it does not belong to, it gets a crossover — the
// engine's own cornerless plus, which unions left/right and top/bottom
// separately, so the two nets pass without meeting.
//
// Row pitch 4 and column pitch 4 are what keep 3x3 stamps from touching. At
// pitch 4 a stamp spans c-1..c+1 and the next spans c+3..c+5, leaving c+2 clear.
//
// SUM OF PRODUCTS, IN A MEDIUM WHOSE ONLY GATE IS AN INVERTER
//
//   a AND b  =  NOT(NOT a OR NOT b)       -- De Morgan; OR is free wiring
//   a OR b   =  two gates driving one net -- wired-OR, no gate of its own
//
// so each product term becomes: one gate per literal driving a shared term
// node, then one gate inverting that node onto the output. A negative literal
// needs its variable inverted first, which is what the inverted rails are for,
// and they are shared across every term that needs them.

import { PixelBlock } from './block.js';
import { INSULATION, WIRE_WHITE, type Rgba } from './colors.js';
import {
  combinationFor,
  equivalent,
  evaluate,
  expressionFor,
  truthTable,
  type BooleanExpr,
  type TruthTable,
} from './boolean.js';
import { extractNetlist, type NetId } from './netlist.js';
import { STAMPS } from './stamps.js';
import { Circuit } from './simulator.js';

const ROW_PITCH = 4;
const COL_PITCH = 4;
const MARGIN = 2;

export interface LayoutResult {
  readonly block: PixelBlock;
  /** Gates the layout placed. Checked against the compiled circuit. */
  readonly gateCount: number;
  /** Input rails, in the variable order the caller supplied. */
  readonly inputRows: readonly number[];
  readonly outputRow: number;
}

export type LayoutOutcome =
  | { readonly ok: true; readonly result: LayoutResult }
  | { readonly ok: false; readonly reason: string };

/** A product term, flattened into literals. */
interface Term {
  readonly literals: readonly { readonly variable: NetId; readonly negated: boolean }[];
}

/**
 * Flatten a sum-of-products expression.
 *
 * Anything that is not an OR of ANDs of literals is refused rather than
 * approximated — the minimiser produces exactly this shape, and accepting more
 * would mean emitting a circuit for an expression this layout cannot express.
 */
function asSumOfProducts(e: BooleanExpr): Term[] | null {
  const terms = e.kind === 'or' ? e.args : [e];
  const out: Term[] = [];
  for (const t of terms) {
    const factors = t.kind === 'and' ? t.args : [t];
    const literals: { variable: NetId; negated: boolean }[] = [];
    for (const f of factors) {
      if (f.kind === 'var') literals.push({ variable: f.net, negated: false });
      else if (f.kind === 'not' && f.arg.kind === 'var') {
        literals.push({ variable: f.arg.net, negated: true });
      } else return null;
    }
    if (literals.length === 0) return null;
    out.push({ literals });
  }
  return out;
}

/** A blank canvas of packed RGBA. */
function canvas(width: number, height: number): Uint32Array {
  return new Uint32Array(width * height).fill(INSULATION);
}

/**
 * Lay out a sum-of-products expression as a pasteable block.
 *
 * @param expr      the expression to realise
 * @param variables the input order; rail 0 is `variables[0]`
 * @param expected  the truth table the result must reproduce, if it is to be
 *                  offered at all
 */
export function layout(
  expr: BooleanExpr,
  variables: readonly NetId[],
  expected: TruthTable | null = null
): LayoutOutcome {
  if (expr.kind === 'const') {
    return {
      ok: false,
      reason:
        'a constant cannot be drawn: this medium has no supply rail, only ' +
        'inverters, so there is nothing to derive a fixed level from',
    };
  }
  if (variables.length === 0) {
    return { ok: false, reason: 'nothing to lay out: the expression has no inputs' };
  }

  const terms = asSumOfProducts(expr);
  if (!terms) {
    return {
      ok: false,
      reason: 'the expression is not a sum of products, which is the only shape this lays out',
    };
  }

  // --- rows
  const inputRow = new Map<NetId, number>();
  variables.forEach((v, i) => inputRow.set(v, i));

  // An inverted rail only for variables some term actually uses negatively.
  const needsInverted = new Set<NetId>();
  for (const t of terms) for (const l of t.literals) if (l.negated) needsInverted.add(l.variable);
  const invertedOrder = variables.filter((v) => needsInverted.has(v));

  const invertedRow = new Map<NetId, number>();
  invertedOrder.forEach((v, i) => invertedRow.set(v, variables.length + i));

  const termRowBase = variables.length + invertedOrder.length;
  const outputRowIndex = termRowBase + terms.length;
  const rowCount = outputRowIndex + 1;

  // --- gates, as (source row, destination row) pairs
  const gates: { from: number; to: number }[] = [];
  for (const v of invertedOrder) {
    gates.push({ from: inputRow.get(v)!, to: invertedRow.get(v)! });
  }
  terms.forEach((t, ti) => {
    const node = termRowBase + ti;
    for (const l of t.literals) {
      // The term node collects NOT(literal): a positive literal is inverted
      // from its own rail, a negative one is taken from the inverted rail,
      // whose inversion undoes the literal's.
      const from = l.negated ? invertedRow.get(l.variable)! : inputRow.get(l.variable)!;
      gates.push({ from, to: node });
    }
    gates.push({ from: node, to: outputRowIndex });
  });

  if (gates.some((g) => g.to <= g.from)) {
    return { ok: false, reason: 'internal: a gate would have to point upwards' };
  }

  // --- geometry
  const yOf = (row: number) => MARGIN + row * ROW_PITCH;
  const xOf = (col: number) => MARGIN + col * COL_PITCH;

  const width = xOf(gates.length - 1) + 1 + MARGIN + 1;
  const height = yOf(rowCount - 1) + 1 + MARGIN;
  const pixels = canvas(width, height);

  const set = (x: number, y: number, color: Rgba) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    pixels[y * width + x] = color;
  };

  // Every net is a full-width horizontal line.
  for (let row = 0; row < rowCount; row++) {
    const y = yOf(row);
    for (let x = 0; x < width; x++) set(x, y, WIRE_WHITE);
  }

  const stampAt = (cx: number, cy: number, pattern: readonly string[]) => {
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        set(cx - 1 + dx, cy - 1 + dy, pattern[dy][dx] === '#' ? WIRE_WHITE : INSULATION);
      }
    }
  };

  gates.forEach((g, col) => {
    const x = xOf(col);
    const yFrom = yOf(g.from);
    const yTo = yOf(g.to);

    // The vertical run, then the pieces that interrupt it.
    for (let y = yFrom; y <= yTo; y++) set(x, y, WIRE_WHITE);

    // The gate sits in the gap immediately below the source row.
    stampAt(x, yFrom + 2, STAMPS.down);

    // Every row strictly between source and destination belongs to some other
    // net, so the run must pass it without joining it.
    for (let row = g.from + 1; row < g.to; row++) stampAt(x, yOf(row), STAMPS.crossover);
  });

  const block = new PixelBlock(width, height, pixels);

  // --- prove it before offering it
  const check = verify(block, variables, expr, expected, gates.length);
  if (!check.ok) return { ok: false, reason: check.reason };

  return {
    ok: true,
    result: {
      block,
      gateCount: gates.length,
      inputRows: variables.map((_, i) => yOf(i)),
      outputRow: yOf(outputRowIndex),
    },
  };
}

/**
 * Compile the drawing and re-derive what it computes.
 *
 * This is the step that makes the feature safe to use. The layout above is
 * reasoned geometry, and reasoned geometry in a medium where a single stray
 * pixel changes a gate into a crossover is not evidence. What counts as
 * evidence is that the pixels, run through the same engine and the same
 * extractor the rest of the tool uses, compute the function that was asked for.
 */
function verify(
  block: PixelBlock,
  variables: readonly NetId[],
  expr: BooleanExpr,
  expected: TruthTable | null,
  predictedGates: number
): { ok: true } | { ok: false; reason: string } {
  const image = toImageData(block);
  const circuit = new Circuit(image, null);

  if (circuit.gateCount !== predictedGates) {
    return {
      ok: false,
      reason:
        `the drawing compiled to ${circuit.gateCount} gates but the layout placed ` +
        `${predictedGates}`,
    };
  }

  const extracted = extractNetlist(circuit, image);
  if (!extracted.ok) return { ok: false, reason: `the drawing did not extract: ${extracted.reason}` };
  const netlist = extracted.netlist;

  // The input rails are the nets no gate drives; the output is the one net
  // driven by gates that feeds nothing further.
  if (netlist.inputs.length !== variables.length) {
    return {
      ok: false,
      reason:
        `the drawing has ${netlist.inputs.length} free inputs but the expression has ` +
        `${variables.length}`,
    };
  }
  if (netlist.outputs.length !== 1) {
    return {
      ok: false,
      reason: `the drawing has ${netlist.outputs.length} outputs; exactly one was expected`,
    };
  }

  // Map the drawing's own net ids back onto the caller's variables by row
  // order: rail i is at row i, and collectNets probes in raster order, so the
  // rails come out top to bottom.
  const rails = [...netlist.inputs].sort((a, b) => {
    const na = netlist.nets.find((n) => n.id === a);
    const nb = netlist.nets.find((n) => n.id === b);
    return (na?.probe.y ?? 0) - (nb?.probe.y ?? 0);
  });

  let drawn: BooleanExpr;
  try {
    drawn = expressionFor(netlist, netlist.outputs[0]);
  } catch (err) {
    return { ok: false, reason: `the drawing contains feedback: ${(err as Error).message}` };
  }

  // Rename the drawing's variables to the caller's, then compare as functions.
  const rename = new Map<NetId, NetId>();
  rails.forEach((id, i) => rename.set(id, variables[i]));
  const renamed = substitute(drawn, rename);

  if (!equivalent(expr, renamed, variables)) {
    return {
      ok: false,
      reason: 'the drawing does not compute the expression it was built from',
    };
  }

  if (expected) {
    const built = truthTable(variables, [variables[0]], new Map([[variables[0], renamed]]));
    if (!built.ok) return { ok: false, reason: built.reason };
    const total = 2 ** variables.length;
    for (let i = 0; i < total; i++) {
      const combo = combinationFor(i, variables.length);
      const env = new Map<NetId, boolean>();
      variables.forEach((v, b) => env.set(v, combo[b]));
      if (evaluate(renamed, env) !== expected.rows[i].outputs[0]) {
        return {
          ok: false,
          reason: `the drawing disagrees with the original circuit at row ${i}`,
        };
      }
    }
  }

  return { ok: true };
}

function substitute(e: BooleanExpr, rename: ReadonlyMap<NetId, NetId>): BooleanExpr {
  switch (e.kind) {
    case 'const':
      return e;
    case 'var':
      return { kind: 'var', net: rename.get(e.net) ?? e.net };
    case 'not':
      return { kind: 'not', arg: substitute(e.arg, rename) };
    case 'and':
      return { kind: 'and', args: e.args.map((a) => substitute(a, rename)) };
    case 'or':
      return { kind: 'or', args: e.args.map((a) => substitute(a, rename)) };
  }
}

/** A block as pixels the engine can compile. */
export function toImageData(block: PixelBlock): ImageData {
  const data = new Uint8ClampedArray(block.width * block.height * 4);
  for (let i = 0; i < block.pixels.length; i++) {
    const v = block.pixels[i];
    const p = i << 2;
    data[p] = (v >>> 24) & 255;
    data[p + 1] = (v >>> 16) & 255;
    data[p + 2] = (v >>> 8) & 255;
    data[p + 3] = 255;
  }
  return new ImageData(data, block.width, block.height);
}
