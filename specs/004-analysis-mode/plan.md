# Implementation Plan: Analysis Mode

**Branch**: `004-analysis-mode` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-analysis-mode/spec.md`

## Summary

Give circuit analysis its own mode, and give it a way of showing a circuit *as a circuit*.

Three things change. Analysis moves out of the editing toolbar into a third mode that carries
the selection tool and **cannot write** — which is what makes it safe to explore a circuit that
works. The selection can then be drawn as a proper schematic, with gates recognised from the
medium's inverter-and-wired-OR algebra and laid out by a layered graph algorithm, at a scale
where truth tables have long since had to refuse. And the analyser learns to describe what the
4-bit CPU actually contains: storage elements rather than "19 state variables", a clock rather
than an unnamed input, and — the finding that motivated this — whether a memory element has a
**defined state at power-on**, which the current tooling cannot see because it seeds a
consistent state before it starts.

## Technical Context

**Language/Version**: TypeScript 5.9, compiled by plain `tsc` to native ES modules in `dist/`

**Primary Dependencies**: none at runtime. `typescript` remains the only devDependency.

**Storage**: browser storage for the labels working copy; a sidecar `*.labels.json` for the
portable record. Nothing is written into the circuit image — neither pixels nor metadata.

**Testing**: the zero-dependency harness in [scripts/verify/](../../scripts/verify/), extended
with suites for the new pure modules. Browser-level behaviour with Playwright, installed
outside the repo and pointed at `python -m http.server`.

**Target Platform**: Chrome, Edge, Firefox and WebKit. Client-side only; served over HTTP.

**Project Type**: single client-side web application; the site root is the repo root.

**Performance Goals**: a 250-gate selection renders as a schematic in under 2 s (SC-002). The
existing 60 fps frame loop must be undisturbed — layout runs once per analysis, never per frame.

**Constraints**: [src/simulator.ts](../../src/simulator.ts) is not to be modified. Analysis never
writes to the document. Every layout pass is deterministic — no `Math.random`, all ties broken
by id. The truth-table limit of 16 inputs stays; structural views are not bounded by it.

**Scale/Scope**: must work on the largest block measured in `4bitCPU.png` — 241 gates, 180 nets,
19 state variables — which is roughly 700 schematic symbols before recognition. Adds ~7 modules
and touches ~8 existing ones.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

[.specify/memory/constitution.md](../../.specify/memory/constitution.md) is still an unfilled
template, so its placeholders carry no rules. The operative constraint set is the one the
original plan established and that features 001–003 have held to:

| Gate | Status | Notes |
|------|--------|-------|
| No framework | ✅ PASS | Plain TypeScript and DOM throughout |
| No bundler | ✅ PASS | `tsc` only; each module compiles 1:1 to an ES module |
| No runtime dependencies | ✅ PASS | The graph layout and gate recognition are hand-rolled precisely so that no library is added |
| Client-side only | ✅ PASS | Nothing leaves the machine; the sidecar is a local file |
| Simplicity | ⚠️ **WATCH** | This is the largest feature so far. See Complexity Tracking |
| `simulator.ts` unchanged | ✅ PASS | Everything works through its public surface, as 003 does |

**Post-design re-check**: unchanged. Phase 1 introduced no dependency and no new build step. The
simplicity gate remains the live risk and is tracked below rather than waved through.

## Project Structure

### Documentation (this feature)

```text
specs/004-analysis-mode/
├── plan.md              # This file
├── research.md          # Phase 0 — the three algorithmic decisions
├── data-model.md        # Phase 1 — entities and their invariants
├── quickstart.md        # Phase 1 — runnable validation scenarios
├── contracts/           # Phase 1 — module contracts
│   ├── mode.md
│   ├── schematic.md
│   ├── labels.md
│   └── sequential-analysis.md
├── checklists/
│   └── requirements.md  # 16/16 passing
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

The project keeps a flat `src/`. That is deliberate and documented; the analysis modules from
003 (`netlist.ts`, `boolean.ts`, `oracle.ts`, `sequential.ts`, …) already live there, and moving
them into a subfolder to accommodate this feature would be churn across working, verified code.

```text
src/
├── simulator.ts           # UNTOUCHED. The engine.
│
├── netlist.ts             # 003 — structural truth, reused as-is
├── boolean.ts             # 003 — expressions, truth tables
├── oracle.ts              # 003 — differential checking, settle machinery
├── sequential.ts          # 003 — SCCs and feedback sets, reused by layout AND storage
├── minimise.ts cost.ts    # 003 — unchanged
├── layout.ts              # 003 — expression → pixels. NOT this feature's layout.
│
├── gates.ts               # NEW — recognise NAND/NOR/AND/OR/NOT from the netlist
├── graph-layout.ts        # NEW — layered DAG layout, five pure passes
├── schematic.ts           # NEW — Netlist + recognition + layout → a Schematic model
├── schematic-view.ts      # NEW — draw a Schematic to canvas; hit testing
├── labels.ts              # NEW — names anchored to pixels; sidecar + working copy
├── storage-elements.ts    # NEW — storage identification; power-on sampling
├── clock.ts               # NEW — clock candidates, behavioural + structural
│
├── editor.ts              # MODIFIED — third mode; analysis tools
├── keymap.ts              # MODIFIED — third mode in the precedence table
├── ui.ts dom.ts           # MODIFIED — mode switching, the schematic stage
├── analysis-panel.ts      # MODIFIED — retargeted to the new mode
├── settings.ts            # MODIFIED — persist the third mode
└── renderer.ts            # MODIFIED — cross-highlight from the schematic

scripts/verify/
├── gates.mjs              # NEW — recognition soundness, exhaustively
├── graph-layout.mjs       # NEW — layering, determinism, crossing reduction
├── schematic.mjs          # NEW — diagram agrees with the netlist
├── labels.mjs             # NEW — anchoring, resolution, round-trip
├── storage-elements.mjs   # NEW — storage identification, power-on
├── clock.mjs              # NEW — candidate ranking
└── keymap.mjs             # MODIFIED — the table grows by a mode
```

**Structure Decision**: flat `src/`, consistent with the existing project and with how 003's
analysis modules are already arranged. The new modules split along a deliberate line: everything
above `editor.ts` is **pure** — a function of a netlist, with no DOM and no canvas — and is
therefore verifiable in the headless harness. Only `schematic-view.ts` and the modified UI files
need a browser. That split is what keeps the largest feature so far testable.

## Phasing

The spec's priorities and the delivery order differ, for one reason worth stating.

| Phase | Stories | Why here |
|-------|---------|----------|
| 1. The mode | US1 | Everything lives inside it. Also the smallest, and independently demonstrable. |
| 2. Recognition + layout | US2 | The headline. Pure modules, so most of it lands before any UI. |
| 3. The schematic stage | US2 | Drawing, hit testing, cross-highlighting, the view toggle. |
| 4. Storage & power-on | US4 | **Brought forward from P2.** It is the motivating defect, and it needs no schematic. |
| 5. Labels | US3 | Improves everything above; nothing above depends on it. |
| 6. Clock | US5 | Builds on storage elements from phase 4. |

**Why US4 moves ahead of US3**: the power-on finding is the reason this investigation started,
and the analysis for it is independent of both the schematic and labels. Delivering it in phase
4 rather than after labels means the motivating question is answered as early as the machinery
allows.

## Risks

| Risk | Mitigation |
|------|-----------|
| **Layout is the biggest single piece of new work** and is easy to get subtly wrong — an unstable sort reintroduces nondeterminism that no one notices until two runs differ. | Every pass is a pure function over a graph, verified headlessly. Determinism is asserted directly: the same input laid out twice must be byte-identical. |
| **Gate recognition could lie.** A wrong symbol is worse than no symbol, because it looks authoritative. | FR-011c: every symbol is evaluated against the gates it absorbed, over all its inputs, before it is drawn. A symbol that fails is not shown. Same discipline as `layout.ts` in 003. |
| **Absorption could drop or double-count a gate**, which would make the diagram quietly wrong. | FR-015a is verified as a hard invariant: every gate in the netlist is drawn or absorbed exactly once, checked against every bundled schematic. |
| **The key table grows by a mode** and Escape starts meaning a third thing. | The table stays the single decision point and its exhaustive verification grows in the same task, not a later one. |
| **Power-on sampling reports "defined" from too few runs.** | 20 starts, and the wording is a requirement (FR-029b): "defined across 20 starts", never "defined". SC-007 names a circuit known to fail, so a green run cannot be claimed without reproducing it. |
| **Scope.** This is the largest feature attempted here. | Six phases, each independently demonstrable; the pure/impure split keeps most of it out of the browser. See Complexity Tracking. |

## Complexity Tracking

> The simplicity gate is marked WATCH rather than PASS. This records why, honestly.

| Violation | Why needed | Simpler alternative rejected because |
|-----------|-----------|--------------------------------------|
| **Seven new modules** | The feature genuinely contains seven separable concerns: recognition, layout, the schematic model, its rendering, labels, storage analysis, clock analysis. | Folding them together would produce a single large module mixing pure graph algorithms with canvas drawing — untestable headlessly, which is the property that makes the rest of this codebase verifiable. |
| **A second rendering path** (`schematic-view.ts` alongside `renderer.ts`) | A schematic is vector geometry with different invalidation from a tile-cached bitmap. | Extending `renderer.ts` to do both would couple two unrelated drawing models; reuse is taken at the right level instead, by sharing the `Viewport` class. |
| **A hand-rolled graph layout** | No runtime dependencies are permitted, and layered layout is the only approach that is both deterministic and aware of signal direction. | A library is forbidden by the constitution; force-directed layout is neither deterministic nor direction-aware. |
| **Two schematic views** (recognised and faithful) | Settled during clarification: a recognised symbol that surprises the reader needs a ground truth to check against. | Recognised-only leaves a surprising symbol uncheckable except by returning to pixels; faithful-only leaves the reader to spot the NANDs themselves, which is the work the feature exists to do. |

Nothing here is accepted as unavoidable complexity without a named alternative and a reason it
was rejected. If any of these reasons stops holding, the corresponding piece should be cut.
