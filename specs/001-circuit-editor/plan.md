# Implementation Plan: Circuit Editor

**Branch**: `001-circuit-editor` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-circuit-editor/spec.md`

## Summary

Add in-app drawing to a simulator that is currently read-only, so wires and gates can be
drawn directly onto a running circuit instead of round-tripping through a paint program.

The approach is a small architectural change with a large clarifying effect: introduce a
`CircuitDocument` that owns the editable pixels and the undo history, and make `Circuit` a
*derived* artefact compiled from it. Drawing mutates the document and paints immediately;
on stroke end the document recompiles into a new `Circuit`, carrying wire state across via
the `prevRender` path that live reload already uses. Saving writes the document's pixels
back to the originating PNG through the file handle the app already holds, falling back to
a download where the browser cannot write.

The simulation engine is not touched. `Circuit` keeps its readonly, compile-once structure
and its bit-for-bit fidelity to `UMain.pas`; it simply receives its `ImageData` from the
document rather than straight from a decoded file.

## Technical Context

**Language/Version**: TypeScript 5.9, targeting ES2022, compiled by plain `tsc` to native
ES modules. No bundler.

**Primary Dependencies**: None at runtime. `typescript` remains the only devDependency.
Platform APIs only: Canvas 2D, Pointer Events, File System Access (Chromium), `canvas.toBlob`.

**Storage**: PNG files on the user's disk, via `FileSystemFileHandle` where available and
downloads elsewhere. Tool and mode preferences join the existing `localStorage` settings.

**Testing**: No test framework, consistent with the existing project. Verification is the
headless Node harness (shim `globalThis.ImageData`, decode PNGs with Pillow, import
`dist/simulator.js`) plus Playwright for browser-level behaviour — the same two rounds used
to verify the port.

**Target Platform**: Chrome, Edge, Firefox and Safari, recent versions. Editing targets
pointer input; write-back is Chromium-only by platform constraint.

**Project Type**: Client-side single-page application, served statically from the repository
root and published to GitHub Pages.

**Performance Goals**: Painted pixels visible within one frame of the pointer event on every
bundled schematic, including 2048×2048 (SC-002). One recompile per completed stroke,
≤250 ms up to ~12 000 gates (SC-003, measured at 190 ms for Enigma2's 11 515 gates).
Simulation continues at the configured rate during and after edits.

**Constraints**: Zero runtime dependencies; no framework, no bundler. Undo history must not
scale with bitmap size (FR-018). Simulation semantics are frozen — no change to wire
detection, gate detection, evaluation order or timing. The document written to disk is the
*source* bitmap, never the rendered frame.

**Scale/Scope**: Six new modules and targeted changes to four existing ones; schematics up
to 2048×2048 with ~45 000 gates; six drawing tools.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[.specify/memory/constitution.md](../../.specify/memory/constitution.md) is still an
unfilled template — every principle is a `[PLACEHOLDER]`, so it carries no enforceable
rules. The operative constraint set is the one the original plan's Constitution Check
established and that `CLAUDE.md` records as still binding.

| Gate | Status | Notes |
| --- | --- | --- |
| Simplicity / YAGNI | **PASS** | Full recompile rather than incremental relabelling (R1); sparse diffs rather than a command-replay engine (R5); a literal stamp table rather than derived geometry (R6). Each rejects the cleverer option on purpose. |
| No frameworks | **PASS** | Platform APIs only; no UI library introduced for the toolbar. |
| No bundler / no build tooling beyond `tsc` | **PASS** | New modules are ordinary `.ts` files compiled by the existing `tsc` invocation. No change to `package.json` scripts. |
| No external runtime dependencies | **PASS** | Nothing added. PNG encoding uses `canvas.toBlob`, which is why a hand-rolled encoder was rejected (R3). |
| Client-side only | **PASS** | No server, no network calls beyond fetching schematics as today. |
| Simulation fidelity to `UMain.pas` | **PASS** | `Circuit` is unmodified. Stamp patterns are transcribed from `detectGates` rather than re-derived (R6), so the editor cannot express a pattern the engine would not recognise. |

**Deferred with justification**: moving the recompile into a Web Worker (R1). It would help
only the 2048×2048 case and would require making `ImageData` and `Circuit` transferable.
Not needed to meet any success criterion; recorded as a follow-up rather than scoped here.

**Result (pre-Phase 0)**: no violations. Complexity Tracking below is therefore empty.

**Re-check (post-Phase 1 design)**: still passing, and the design tightened two gates
rather than loosening any. The contracts forbid deriving stamp corners programmatically
(SP-1), keeping the engine's encoding expressed in exactly one place; and they confine
tools to writing pixels (TL-1), so nothing in `src/tools/` can reach the simulation at all.
No new dependency, module boundary or build step was introduced by Phase 1. The only
carried-forward item remains the deferred Web Worker, which is recorded as a follow-up and
is not required by any success criterion.

## Project Structure

### Documentation (this feature)

```text
specs/001-circuit-editor/
├── spec.md              # Feature specification
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output — nine decisions, with measurements
├── data-model.md        # Phase 1 output — entities and invariants
├── quickstart.md        # Phase 1 output — runnable validation scenarios
├── contracts/           # Phase 1 output — module and pattern contracts
│   ├── stamp-patterns.md
│   ├── document-api.md
│   └── tool-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
index.html               # + mode toggle, toolbar, save control
css/style.css            # + toolbar, tool cursors, grid/preview styling

src/
├── main.ts              # unchanged entry point
├── simulator.ts         # UNCHANGED — the engine stays frozen
├── renderer.ts          # + overlay pass: pixel grid, hover cursor, stamp preview,
│                        #   pending-edit compositing
├── fileHandler.ts       # + write-back via createWritable, permission request,
│                        #   poll-stamp refresh so the app ignores its own write
├── ui.ts                # + mode/tool wiring, save flow, unsaved-changes guard
├── dom.ts               # + the new elements
├── settings.ts          # + persisted mode, tool and colour
├── errors.ts            # unchanged
├── document.ts          # NEW — CircuitDocument: pixels, dirty flag, compile()
├── history.ts           # NEW — sparse per-stroke diffs, undo/redo
├── stamps.ts            # NEW — the five 3×3 patterns, transcribed from the engine
├── editor.ts            # NEW — mode + active tool, routes pointer events to tools
├── png.ts               # NEW — encode a document to a PNG blob; save and download
└── tools/               # NEW
    ├── types.ts         #   the Tool contract
    ├── pencil.ts
    ├── line.ts
    ├── eraser.ts
    ├── picker.ts
    └── stamp.ts         #   gate (4 directions) + crossover

scripts/gen-examples.mjs # unchanged
```

**Structure Decision**: The existing flat `src/` layout is kept — it is small, it maps one
module to one concern, and it needs no reorganisation. Drawing tools are the one place a
subdirectory earns itself, because they are a set of interchangeable implementations of a
single interface; `src/tools/` holds them.

The dependency direction is strictly one way, which is the point of the redesign:

```
FileSource ──decode──▶ CircuitDocument ──compile──▶ Circuit ──render──▶ Renderer
   (png.ts)            (document.ts,               (simulator.ts,      (renderer.ts)
                        history.ts)                 untouched)
                             ▲
                             │ mutate
                        editor.ts + tools/
```

`simulator.ts` depends on nothing new and is imported by `document.ts`, not the reverse.
Nothing in `tools/` knows that a `Circuit` exists — tools only write pixels.

## Complexity Tracking

> No Constitution Check violations. Nothing to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| *(none)* | — | — |

## Implementation Phases

Ordered so that each phase is independently demonstrable, matching the spec's story
priorities.

**Phase A — Document layer (no visible change).** Introduce `CircuitDocument`; route the
existing load path through it so `Circuit` is compiled from a document. Live reload becomes
"replace pixels, recompile". Ships with no UI change and no behavioural difference — the
safest possible way to land the architectural move. *Verify: every existing Playwright
check still passes; gate counts unchanged on all 22 schematics.*

**Phase B — Draw a wire (User Story 1).** Mode toggle, pencil, pending-edit overlay,
recompile on stroke end. *Verify: bridging two nets merges them and state survives.*

**Phase C — Place a gate (User Story 2).** `stamps.ts` and the stamp tool; the remaining
tools (line, eraser, picker). *Verify: each of the five patterns registers in the gate count
and behaves correctly.*

**Phase D — Keep the edit (User Story 3).** `png.ts`, write-back with permission handling,
download fallback, echo suppression, unsaved-changes guard. *Verify: round-trip on every
engine.*

**Phase E — Undo (User Story 4).** `history.ts` wired to stroke boundaries. *Verify:
bit-exact restoration.*

**Phase F — Editing aids (User Story 5).** Grid, hover cursor, stamp preview.

Phases B and C together are the minimum that delivers the feature's core value; D and E are
what make it usable for real work; F is polish.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Recompile hitch on the largest schematics | 250 ms pause per stroke at 2048×2048 | Accepted for now; Web Worker path identified (R1) if it proves objectionable |
| Saving the rendered frame instead of the source bitmap | Catastrophic — dims every unlit wire below the wire threshold, destroying the circuit | The document never holds rendered pixels; called out in the data model and contracts |
| Live-reload poller reloading over the user's own write | Silent loss of in-progress work | Refresh the poll stamp after every successful write (R4) |
| A user-chosen wire colour the engine reads as insulation | Circuit looks wired and is dead | Validate every colour against `isWire` before it can be selected (R7) |
| Permission request outside a user gesture | Save silently fails on Chromium | Request inside the click handler, before any `await` |
