# Implementation Plan: Editor Workflow

**Branch**: `002-editor-workflow` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-editor-workflow/spec.md`

## Summary

Seven additions that turn the drawing tools from [001](../001-circuit-editor/plan.md) into
an editor you would build a circuit with: connected wires, an edit mode that only edits, a
colour palette, bus drawing, selection and clipboard with a movable rotatable paste, a
second camera scheme, and keyboard cursor control.

The first of those is a bug fix. Both the line tool and the pencil's gap-filling rasterise
with Bresenham, which steps diagonally, and the engine connects wires only on the four
cardinal sides — so a diagonal run today is up to nine separate nets pretending to be one
wire. Everything else in this feature would inherit that, so it lands first.

Four of the seven share machinery rather than sitting side by side, and the plan is built
around extracting that machinery once: a 4-connected rasteriser (pencil, line, bus), a
`PixelBlock` (selection, clipboard, floating paste), wheel-driven tool parameters (colour,
bus width), and a single key-precedence resolver (paste, keyboard cursor, selection,
settings). Building them per-story would produce four near-duplicates of each.

`simulator.ts` remains untouched.

## Technical Context

**Language/Version**: TypeScript 5.9, ES2022, plain `tsc`. No bundler.

**Primary Dependencies**: None at runtime. `typescript` remains the only devDependency.

**Storage**: `localStorage` for editor preferences, now including the palette, bus width and
camera scheme. The clipboard is in-memory and deliberately not the system clipboard (R6).

**Testing**: The existing zero-dependency harness in `scripts/verify/`, extended with
geometry checks; Playwright, outside the repo, for interaction.

**Target Platform**: Chrome, Edge, Firefox, Safari. Pointer and keyboard; touch keeps its
current pan/pinch/tap and gains nothing here.

**Performance Goals**: Unchanged from 001 — one recompile per committed action. The paste
model exists partly to hold that line: a floating block is editor state, so moving it costs
nothing (R8).

**Constraints**: Simulation semantics frozen. Undo stays stroke-granular and bounded by
pixels touched. No new dependency.

**Scale/Scope**: Five new modules, four rewritten tools, extensions to six existing files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[.specify/memory/constitution.md](../../.specify/memory/constitution.md) is still an
unfilled template, so the operative constraints remain the ones `CLAUDE.md` records.

| Gate | Status | Notes |
| --- | --- | --- |
| Simplicity / YAGNI | **PASS** | Shared machinery extracted because four stories need it, not speculatively. Clipboard scoped to the page (R6); rotation needs no gate logic at all (R2). |
| No frameworks | **PASS** | Palette, submenu and selection are plain DOM and canvas. |
| No bundler / `tsc` only | **PASS** | New files compile with the existing invocation. |
| No runtime dependencies | **PASS** | Nothing added. |
| Client-side only | **PASS** | Unchanged. |
| Simulation fidelity | **PASS** | `simulator.ts` untouched. The connectivity fix changes what the editor *writes*, never how pixels are read. |

**Result (pre-Phase 0)**: no violations.

**Re-check (post-Phase 1 design)**: still passing, and two design results removed work
rather than adding it. Rotation turned out to need no gate-aware code (R2), and the bus
spacing rule was proven exhaustively at design time (R3), so neither carries a hedge into
implementation. No new module boundary, dependency or build step was introduced by Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/002-editor-workflow/
├── spec.md              # 7 user stories, 27 FRs, 10 success criteria
├── plan.md              # This file
├── research.md          # Phase 0 — 10 decisions, 3 settled by measurement
├── data-model.md        # Phase 1 — entities and invariants
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/           # Phase 1
│   ├── geometry.md      #   4-connected rasterisation and bus offsets
│   ├── clipboard.md     #   PixelBlock, selection, floating paste
│   └── input.md         #   key precedence, wheel routing, camera schemes
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
index.html               # + palette popover, line submenu, selection/rotate controls,
                         #   camera scheme setting
css/style.css            # + palette, submenu, selection marquee, floating-paste chrome

src/
├── simulator.ts         # UNCHANGED
├── geometry.ts          # NEW — walkConnected(), busOffsets(); the one rasteriser
├── block.ts             # NEW — PixelBlock: capture, rotate, blit, bounds
├── clipboard.ts         # NEW — the held block, selection state, floating paste
├── palette.ts           # NEW — 16 defaults, custom entries, validation, cycling
├── keymap.ts            # NEW — the precedence resolver from research R5
├── document.ts          # line() routed through geometry; blockAt()/writeBlock()
├── editor.ts            # + selection/paste/keyboard-cursor state, wheel parameters
├── renderer.ts          # + marquee, floating paste, keyboard cursor in the overlay
├── ui.ts                # + pause-on-enter, palette/submenu wiring, key routing
├── settings.ts          # + palette, bus width, camera scheme
├── dom.ts               # + the new elements
├── viewport-camera.ts   # NEW — the two wheel schemes
└── tools/
    ├── pencil.ts        # right button erases; connected interpolation
    ├── line.ts          # connected; draws N conductors
    └── select.ts        # NEW — rectangular selection

scripts/verify/
├── geometry.mjs         # NEW — connectivity and bus-width net counts
└── rotate.mjs           # NEW — rotated gates still behave
```

**Structure Decision**: The flat `src/` layout continues to hold. The four extracted
modules are named for what they own rather than which story asked for them, because each is
used by more than one:

| Module | Used by |
| --- | --- |
| `geometry.ts` | pencil (US1), line (US1), bus (US4) |
| `block.ts` | selection, clipboard, floating paste (US5) |
| `keymap.ts` | paste (US5), keyboard cursor (US7), selection (US5), settings (existing) |
| `palette.ts` | colour tool (US3), and the wheel-parameter mechanism it shares with the bus width (US4) |

Dependency direction is unchanged and still one way:

```
FileSource ─▶ CircuitDocument ─▶ Circuit ─▶ Renderer
                   ▲                            ▲
        geometry ──┤                            │ overlay
           block ──┤                    editor ─┘
                   └── editor ── tools/, palette, clipboard, keymap
```

`geometry.ts` and `block.ts` are pure — no DOM, no document, no circuit — which is what
lets them be verified headlessly.

## Complexity Tracking

> No Constitution Check violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| *(none)* | — | — |

## Implementation Phases

**Phase A — Connectivity (US1).** `geometry.ts`, then route `document.line()` and the
pencil through it. *Verify: diagonal runs are one net; axis-aligned runs are byte-identical
to before.* This is a bug fix and should land on its own.

**Phase B — Edit mode (US2).** Pause on enter / restore on exit, no wire poking, right
button erases. Small, self-contained, and removes a live source of confusion.

**Phase C — Shared input machinery.** `keymap.ts` and the wheel-parameter mechanism, with
no feature attached yet. Extracted before the three stories that need it, so none of them
grows its own.

**Phase D — Palette (US3)** and **Phase E — Bus (US4)**, both of which are then mostly
wiring: each is a tool parameter plus a popover.

**Phase F — Selection and clipboard (US5).** `block.ts`, `clipboard.ts`, `select.ts`, the
overlay chrome and the paste lifecycle. The largest phase by a distance.

**Phase G — Camera (US6)** and **Phase H — Keyboard cursor (US7).** Both depend on Phase C
and are otherwise independent.

**Phase I — Polish.** Docs, full regression sweep, baseline re-check.

A and B together are the minimum worth shipping: they fix a correctness bug and an
interaction one. F is where the feature's value concentrates.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The connectivity fix changes axis-aligned output | Every existing drawing shifts; baselines break | FR-002 and a byte-comparison check; the algorithm steps one axis per iteration precisely so straight runs are unchanged |
| Bus conductors silently merge | A bus that looks right and is one net | Spacing rule proven exhaustively for N=1–16 across five slopes before implementation (R3) |
| Key precedence handled per-feature | Enter or Escape doing two things | One resolver in `keymap.ts`; the table in R5 is the contract |
| A floating paste written per nudge | A recompile per arrow press, ~190 ms each | Floating blocks are editor state and reach the document only on Enter (R8) |
| Ctrl+wheel zooms the browser | Camera scheme unusable | `{ passive: false }` and `preventDefault` on every wheel listener, toolbar included (R7) |
| Palette accepts an unusable colour | Wire that looks right and does not conduct | Every entry, default or custom, validated against the engine's own test |
