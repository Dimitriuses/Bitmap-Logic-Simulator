# Contract: Minimisation, Cost and Layout

**Feature**: `003-circuit-analysis` | **Modules**: `src/minimise.ts`, `src/cost.ts`,
`src/layout.ts`, `src/netlist-json.ts`

---

## `src/minimise.ts` — Quine–McCluskey

```ts
/** Minterm indices, over a fixed variable order. */
export interface Problem {
  readonly variables: readonly NetId[];
  readonly minterms: readonly number[];
  readonly dontCares?: readonly number[];
}

export function primeImplicants(p: Problem): Implicant[];
export function minimise(p: Problem): BooleanExpr;
```

- **MN-1 — Exact for the sizes that get here.** Prime implicants by repeated adjacency
  merging, then a cover of the chart: essential implicants first, then greedy. At the
  16-input ceiling this is comfortable.
- **MN-2 — Pure.** No DOM, no engine. Verified by exhaustive re-evaluation.
- **MN-3 — Correctness is checked by evaluation, not trusted.** `minimise` output must agree
  with its input minterms on all `2^n` rows. That check is cheap and it converts "the
  minimiser had a bug" from a silent wrong answer into a caught error.
- **MN-4 — Constant functions are handled.** All minterms, or none, must produce `const`
  rather than an empty `or` or a degenerate cover.
- **MN-5 — Variable order is fixed and explicit**, so results are reproducible and
  comparable between runs.

### What it does not do

Quine–McCluskey minimises a **sum of products**: fewest terms and literals. The cost this
project cares about is **inverters**, and those are different objectives (research R5). A
minimal SOP is a good starting point and usually a good answer, but the result must be
described as "minimised", never "minimal" or "optimal". Reporting a number in one metric
while minimising another, and calling it optimal, would be a quiet lie.

---

## `src/cost.ts` — what a circuit costs in this medium

```ts
/** Inverters needed to realise an expression. Wired-OR is free. */
export function inverterCost(e: BooleanExpr): number;

/** Inverters actually present in a netlist. */
export function netlistCost(n: Netlist): number;
```

- **CO-1 — The basis is NOT plus wired-OR.** The only gate is an inverter; several gates
  driving one net are an OR at no cost. That is the medium, and it is why a generic
  literal-count would be the wrong number to show.
- **CO-2 — OR is free; AND is not.** An OR is wiring. An AND must be built from inverters,
  and shared positive literals need one inverter each. This mirrors the reference project's
  cost model, which is the most genuinely domain-specific idea in it.
- **CO-3 — Both numbers are always shown.** The original's cost and the minimised cost,
  together, so the saving is visible and a non-saving is obvious.
- **CO-4 — No improvement is a legitimate outcome**, reported plainly rather than dressed up
  as an equal-cost alternative.

---

## `src/layout.ts` — putting a circuit back

```ts
export type LayoutResult =
  | { ok: true; block: PixelBlock; outputs: ReadonlyMap<NetId, { x: number; y: number }> }
  | { ok: false; reason: string };

export function layout(exprs: ReadonlyMap<NetId, BooleanExpr>, color: Rgba): LayoutResult;
```

- **LY-1 — Gates come from `stamps.ts`.** The layout writes the same literal 3×3 patterns the
  editor stamps, never hand-rolled ones. A pattern with a wrong corner is not an error — it
  is silently not a gate, which would produce a replacement circuit that looks right and
  does nothing.
- **LY-2 — Wires are drawn with `geometry.ts`.** Everything the layout routes is 4-connected
  for the same reason everything the editor draws is.
- **LY-3 — The result is an ordinary `PixelBlock`**, so it is positioned, previewed,
  committed and undone through the floating-paste mechanism that already exists. This
  feature adds no second way to place pixels.
- **LY-4 — Compiled and re-analysed before it can be committed.** The generated block is
  compiled to a `Circuit`, its gate count checked, and its truth table compared against the
  original. A layout that fails this is not offered (FR-018).
- **LY-5 — Deterministic.** The same expression lays out identically every time, so a
  result can be compared with a previous one.
- **LY-6 — Failure is honest.** An expression that cannot be laid out within a sane area
  returns `ok: false` with the reason, rather than emitting something malformed.

### Why this is the riskiest module

It is the only one that *writes* a circuit. Everything else is read-only analysis whose
worst failure is a wrong report; a bad layout silently replaces a working circuit with a
broken one. LY-4 is what stands between those two outcomes, and it is not optional.

---

## `src/netlist-json.ts` — interchange

```ts
export function exportNetlist(n: Netlist, meta: { source: string; size: [number, number] }): string;
export function importNetlist(json: string): ExtractResult;
```

- **IX-1 — The schema follows LogicShorter's `*_raw.json`**: `nets`, `gates` with
  `in_net` / `out_net`, and an `io` block, so a selection exported here can be fed to the
  existing Python analysis.
- **IX-2 — Round-trips losslessly.** Export then import yields the same nets, gates and I/O
  classification.
- **IX-3 — The direction of trust is one-way.** Export from here is reliable. Results coming
  back are suggestions to verify, because that project's 1-bit BMP reader disagrees with a
  reference decoder on the pixels themselves — 696 against 100 wire pixels on `circuit.bmp` —
  so three of its five fixtures describe bitmaps that were misread.

---

## Verification

`scripts/verify/minimise.mjs`:

| Check | Expectation |
| --- | --- |
| Random functions, 2–10 variables | minimised expression agrees with the original on all `2^n` rows |
| Constant true / constant false | `const`, not a degenerate cover |
| A function already minimal | no claimed improvement |
| Known identities (absorption, consensus) | reduced as expected |
| `inverterCost` on each of the four gates | 1 |
| `inverterCost` on a wired-OR of two gates | 2, the OR itself free |
| Layout of a known expression | compiles, gate count as predicted, truth table matches |
| Layout round-trip | laid out, compiled, re-analysed, identical table |
