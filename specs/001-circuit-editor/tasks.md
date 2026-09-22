---

description: "Task list for the Circuit Editor feature"
---

# Tasks: Circuit Editor

**Input**: Design documents from `/specs/001-circuit-editor/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: This project has no test framework, by constitution (no runtime or dev
dependencies beyond `typescript`). TDD tasks are therefore **not** generated. In their
place, each story ends with a **verification** task mapped to a numbered scenario in
[quickstart.md](./quickstart.md) and to the success criteria in spec.md. Verification runs
through the two harnesses the project already uses: a zero-dependency Node script importing
`dist/simulator.js`, and Playwright for browser-level behaviour.

**Organization**: Tasks are grouped by user story so each can be implemented and validated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: The user story the task serves (US1–US5)
- Every task names an exact file path

## Path Conventions

Single project, served from the repository root. Source in `src/`, build output in `dist/`,
helper scripts in `scripts/`. Paths below are repo-relative, per plan.md's structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the verification harness and record a pre-change baseline, so the
architectural move in Phase 2 can be proven to change nothing.

- [X] T001 [P] Create `scripts/verify/harness.mjs`: shim `globalThis.ImageData`, expose helpers to build small RGBA bitmaps in memory, and import `dist/simulator.js`. Zero dependencies.
- [X] T002 [P] Create `scripts/verify/decode.py`: decode a PNG to raw RGBA with Pillow, for harness scripts that need real schematics.
- [X] T003 Create `scripts/verify/counts.mjs` and record wire/gate counts for all 22 schematics under `projects/` into `scripts/verify/baseline.json` (depends on T001, T002).

**Checkpoint**: A regression in the engine or the load path is now detectable in one command.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce the `CircuitDocument` layer and make `Circuit` a derived artefact.
This is plan.md Phase A and research R9.

**⚠️ CRITICAL**: No user story can begin until this phase is complete. It must land with
**zero** behavioural change.

- [X] T004 [P] Add the `Rgba` type and channel-wise pack/unpack helpers in `src/document.ts`, endianness-safe in the style of `buildRenderTables`.
- [X] T005 [P] Define `Edit` and `EditHistory` in `src/history.ts` per [contracts/document-api.md](./contracts/document-api.md) — parallel `indices`/`before`/`after` arrays, `push`, `popUndo`, `popRedo`, `clear`.
- [X] T006 Implement `CircuitDocument` in `src/document.ts`: `fromImageData`, `get`, `set`, `line` (Bresenham), `beginStroke`, `endStroke`, `pendingEdits`, `compile`, `markSaved`, `dirty` (depends on T004, T005).
- [X] T007 Enforce the document invariants in `src/document.ts`: source pixels only (D1), alpha forced to 255 (D2), out-of-bounds writes dropped (T3), `set`/`line` outside a stroke throws (DA-2), each pixel recorded once at its pre-stroke value (E2), empty strokes discarded (E4).
- [X] T008 Route loading through the document in `src/ui.ts`: decode → `CircuitDocument.fromImageData` → `doc.compile(prevRender)`; make live reload replace the document's pixels and recompile through the same path (depends on T006).
- [X] T009 [P] Add the pending-edit overlay pass to `src/renderer.ts`, compositing `doc.pendingEdits()` over the circuit frame, costing nothing when the map is empty (RO-1, RO-4; depends on T006).
- [X] T010 Verify Scenario 0: `node scripts/verify/counts.mjs` matches `baseline.json` for all 22 schematics, and the existing Playwright suite still passes on Chrome, Edge, Firefox and WebKit (depends on T008, T009).

**Checkpoint**: Architecture moved, nothing visibly changed. User stories can now begin.

---

## Phase 3: User Story 1 - Draw a wire and watch it conduct (Priority: P1) 🎯 MVP

**Goal**: Drag the pencil across a gap and the two nets become one, with the circuit still
running and its state intact.

**Independent Test**: Open `projects/External_Shemes/Flip Flop.png`, draw across the gap
between two nets, and confirm the wire count drops by one and the lit state propagates.

### Implementation for User Story 1

- [X] T011 [US1] Add `src/tools/types.ts` with `ToolId`, `PixelPoint`, `ToolContext` and `Tool` exactly as specified in [contracts/tool-api.md](./contracts/tool-api.md).
- [X] T012 [P] [US1] Implement the pencil in `src/tools/pencil.ts`, interpolating between successive pointer points so a fast drag cannot leave gaps (TL-2, FR-001; depends on T011).
- [X] T013 [P] [US1] Style the toolbar, the two mode states and the edit-mode cursor in `css/style.css`.
- [X] T014 [US1] Implement `Editor` in `src/editor.ts`: `mode`, active tool, and pointer handlers returning `true` when the editor consumed the event and `false` to fall through to existing behaviour (ED-1, ED-2; depends on T011, T012).
- [X] T015 [US1] Add the mode toggle and toolbar container to `index.html`, and their typed handles to `src/dom.ts`.
- [X] T016 [US1] Wire pointer events in `src/ui.ts` through `Editor` ahead of the existing simulate handling, converting screen to bitmap coordinates with `viewport.toWorld` plus `Math.floor` (depends on T014, T015).
- [X] T017 [US1] Frame strokes in `src/ui.ts`: `beginStroke` on pointer down, `endStroke` then exactly one `doc.compile(prevRender)` on pointer up, and never a compile on move (TL-3, ED-3, FR-009; depends on T016).
- [X] T018 [P] [US1] Persist `mode` and `tool` in `src/settings.ts`, range-validated on read like the existing settings (S3).
- [X] T019 [US1] Verify Scenario 1 of `specs/001-circuit-editor/quickstart.md` in the browser: wire count drops by one when two nets are bridged, wire state survives the edit, painted pixels appear mid-stroke, and a temporary counter on `compile()` in `src/document.ts` proves one call per stroke (SC-002, SC-003, SC-004).

**Checkpoint**: Wires can be drawn into a live circuit. This alone is a demonstrable MVP.

---

## Phase 4: User Story 2 - Place a gate without counting pixels (Priority: P1)

**Goal**: One click places a correctly formed inverter in the chosen direction, and it
inverts.

**Independent Test**: Stamp a rightward gate with a wire stub on each side; the gate count
rises by one and the output reads the inverse of the input.

### Implementation for User Story 2

- [X] T020 [P] [US2] Add the five literal 3×3 patterns to `src/stamps.ts`, transcribed from the switch in `detectGates`, with no programmatic derivation of corners (SP-1, SP-2; see [contracts/stamp-patterns.md](./contracts/stamp-patterns.md)).
- [X] T021 [US2] Implement the stamp tool in `src/tools/stamp.ts`: gate in four directions plus crossover, committing on pointer down, ignoring drag, writing all nine pixels, clipped to the bitmap (TL-5, SP-2, SP-3; depends on T020).
- [X] T022 [P] [US2] Implement the eraser in `src/tools/eraser.ts`, painting opaque black with the same gap-filling as the pencil.
- [X] T023 [P] [US2] Implement the line tool in `src/tools/line.ts`, previewing continuously between press and current point (TL-6).
- [X] T024 [P] [US2] Implement the colour picker in `src/tools/picker.ts` — reads a pixel into the active colour, writes nothing, produces no `Edit` (T5, TL-5).
- [X] T025 [US2] Add tool buttons, gate-direction selector and colour control to `index.html` and `src/dom.ts`, rejecting any colour the engine would read as insulation and reporting why (FR-006, ED-4, S1, research R7).
- [X] T026 [US2] Register every tool with `Editor` in `src/editor.ts` and persist tool, colour and direction in `src/settings.ts` (depends on T021–T025).
- [X] T027 [US2] Verify Scenario 2 with a new `scripts/verify/stamps.mjs`: each of the four gates adds exactly one to `gateCount` **and points the named direction**; the crossover adds none and leaves the H and V stubs as separate nets (SC-007; depends on T020, T001).

**Checkpoint**: A complete circuit can now be built in the app. US1 and US2 together are the feature's core value.

---

## Phase 5: User Story 3 - Keep the edit (Priority: P2)

**Goal**: Saving updates the PNG on disk where the browser allows it, and downloads a PNG
everywhere else.

**Independent Test**: Draw a change, save, reload the page, reopen the file, and find the
change present with matching counts.

### Implementation for User Story 3

- [X] T028 [P] [US3] Implement `encodePng` and `downloadPng` in `src/png.ts`, encoding `doc.pixels` — never `Circuit.frame`, which would bake in the inactive-wire dimming and destroy the circuit (SV-1, SV-3, D1).
- [X] T029 [US3] Add `canWrite`, `requestWriteAccess` and `write` to `FileSource` in `src/fileHandler.ts`, with `canWrite` false for the `url` and `blob` origins (FH-2, FH-3).
- [X] T030 [US3] Refresh the stored `lastModified` stamp in `src/fileHandler.ts` after every successful write, so the live-reload poller never mistakes the app's own write for an external edit (FR-014, FH-1; depends on T029).
- [X] T031 [US3] Implement `saveDocument` in `src/png.ts`: write in place when possible, download otherwise, requesting read-write permission synchronously within the user gesture before any `await` (SV-2, SV-4, SV-5; depends on T028, T029).
- [X] T032 [US3] Add the Save control and a dirty indicator to `index.html`, `src/dom.ts` and `src/ui.ts`, invoking `saveDocument` directly from the click handler (depends on T031).
- [X] T033 [US3] Add the unsaved-changes guard in `src/ui.ts` for loading another circuit and for `beforeunload` (FR-015).
- [X] T034 [US3] Verify Scenario 3 of `specs/001-circuit-editor/quickstart.md` on Chrome, Edge, Firefox and WebKit: counts survive a round-trip, no spurious reload follows a save, and an HTTP-loaded example offers download only. Expect ±1 channel drift on WebKit for colour-rich schematics — counts must still match (SC-005, research R3).

**Checkpoint**: Work survives a reload. The editor is usable for real tasks.

---

## Phase 6: User Story 4 - Undo a mistake (Priority: P2)

**Goal**: Ctrl+Z restores the previous pixels exactly, and the circuit follows.

**Independent Test**: Capture pixels, draw, undo, and confirm the bitmap is bit-identical to
the capture.

### Implementation for User Story 4

- [X] T035 [US4] Wire `EditHistory` into `CircuitDocument.undo` and `.redo` in `src/document.ts`: apply `before`/`after`, update `pendingEdits`, and return `false` on an empty stack (DA-3, E3; depends on T005, T006).
- [X] T036 [US4] Recompile after every undo and redo in `src/ui.ts`, since the bitmap changed and the running circuit must follow (H3; depends on T035).
- [X] T037 [P] [US4] Add undo/redo buttons to `index.html` and `src/dom.ts`, enabled from `canUndo`/`canRedo`.
- [X] T038 [US4] Bind Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z in `src/ui.ts`, inert while a slider or select has focus, matching the existing `typing` guard.
- [X] T039 [US4] Enforce the cumulative-pixel budget in `src/history.ts`, trimming oldest entries by pixels touched rather than entry count (H1, FR-018; depends on T005).
- [X] T040 [US4] Verify Scenario 4 of `specs/001-circuit-editor/quickstart.md`: undo is bit-exact across every pixel, redo reproduces the stroke, a new edit clears the redo stack, and twenty strokes on the 2048×2048 schematic cost kilobytes rather than the ~320 MB full snapshots would (SC-006).

**Checkpoint**: Editing is safe to experiment with.

---

## Phase 7: User Story 5 - Draw at a readable scale (Priority: P3)

**Goal**: At high zoom, a grid and a pixel-accurate cursor show exactly what a click will do.

**Independent Test**: Zoom past the threshold, hover, and confirm the outlined pixel is the
one a click modifies.

### Implementation for User Story 5

- [X] T041 [P] [US5] Draw the pixel grid in `src/renderer.ts` above a zoom threshold chosen so grid lines do not swamp a bitmap pixel, and not at all below it (RO-2, FR-020).
- [X] T042 [US5] Draw the hover cursor in `src/renderer.ts` from `viewport.toWorld`, **not** from a canvas-pixel corner — tile boundaries fall on fractional canvas coordinates, so the corner approach is off by one at high zoom (RO-3, FR-019).
- [X] T043 [US5] Render `Tool.preview` output at reduced opacity in `src/renderer.ts`, including the 3×3 stamp ghost and the line-tool run (TL-4, TL-6; depends on T011).
- [X] T044 [US5] Verify Scenario 6 of `specs/001-circuit-editor/quickstart.md`: at high zoom, clicking the outlined pixel changes that exact pixel, and the gate preview matches what is committed.

**Checkpoint**: All five stories functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T045 [P] Document the editor in `README.md`: modes, the six tools, saving and which browsers can write in place.
- [X] T046 [P] Update `CLAUDE.md`: the document layer and its one-way derivation, the new modules, and the D1 source-versus-render hazard.
- [X] T047 Verify Scenario 7 of `specs/001-circuit-editor/quickstart.md`: simulate mode behaves exactly as before, frame rates hold at the recorded baselines, and every existing keyboard shortcut still works (ED-1, ED-2).
- [X] T048 Verify Scenario 5 of `specs/001-circuit-editor/quickstart.md` end-to-end: build a two-inverter chain from nothing, entirely in the app, and drive it (SC-001).
- [X] T049 Re-check the constitution: `npm run build` and `npx tsc --noEmit` clean, `package.json` unchanged, no runtime dependency added.
- [X] T050 [P] Measure compile time per stroke on Enigma2 and `Flash Memory 256x12` using `scripts/verify/counts.mjs`, and record the verdict on the deferred Web Worker under R1 in `specs/001-circuit-editor/research.md` (SC-003).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: needs Setup for its baseline check. **Blocks every user story.**
- **User Stories (Phases 3–7)**: all require Phase 2. US1 and US2 are both P1; US1 first, as it proves the riskiest mechanism.
- **Polish (Phase 8)**: after the desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: Foundational only. Fully independent.
- **US2 (P1)**: Foundational only. Reuses US1's `Editor` and `src/tools/types.ts`, so it is cheapest right after US1, but its stamp logic is independently verifiable headlessly (T027) with no UI at all.
- **US3 (P2)**: Foundational only. Needs a document to save, which Phase 2 provides — not US1.
- **US4 (P2)**: Foundational only. `Edit` and `EditHistory` land in Phase 2 because the stroke mechanism needs them; US4 adds the stacks, bindings and UI.
- **US5 (P3)**: Foundational plus `src/tools/types.ts` from US1 for `Tool.preview`.

### Within Each User Story

- Contracts and types before the code that implements them
- Tools before the `Editor` that registers them
- `Editor` before the `ui.ts` wiring that routes to it
- Verification last, since it exercises the finished slice

### Parallel Opportunities

- **Phase 1**: T001 and T002 together.
- **Phase 2**: T004 and T005 together; then T008 and T009 together once T006 lands.
- **US1**: T012, T013 and T018 together.
- **US2**: T022, T023 and T024 together, alongside T020.
- **US3**: T028 alongside T029.
- **US5**: T041 alongside T043.
- **Phase 8**: T045, T046 and T050 together.
- Across stories: once Phase 2 is done, US3 and US4 can be built by separate people in parallel with US1/US2, since they touch disjoint files (`png.ts`/`fileHandler.ts` and `history.ts` respectively).

---

## Parallel Example: User Story 2

```bash
# The four independent tools, all different files, after T011 exists:
Task: "Add the five 3x3 patterns in src/stamps.ts"
Task: "Implement the eraser in src/tools/eraser.ts"
Task: "Implement the line tool in src/tools/line.ts"
Task: "Implement the colour picker in src/tools/picker.ts"

# Then, sequentially, the pieces that bind them together:
Task: "Implement the stamp tool in src/tools/stamp.ts"   # needs stamps.ts
Task: "Register every tool with Editor in src/editor.ts" # needs all of the above
```

---

## Implementation Strategy

### MVP scope

Phases 1–4: Setup, Foundational, US1 and US2. That is the smallest build that lets someone
draw a wire, place a gate, and watch the circuit respond — the feature's actual proposition.
US3 (saving) is the first thing to add afterwards, since an editor whose work evaporates on
refresh is a demo rather than a tool.

### Incremental delivery

1. Phases 1–2 → architecture moved, nothing user-visible, everything still green.
2. Phase 3 (US1) → draw wires into a live circuit. **Demoable.**
3. Phase 4 (US2) → build whole circuits. **MVP complete.**
4. Phase 5 (US3) → work persists.
5. Phase 6 (US4) → safe to experiment.
6. Phase 7 (US5) → precise at high zoom.
7. Phase 8 → docs, regression sweep, performance decision.

### Risk-ordered notes

- Phase 2 is the highest-leverage and lowest-visibility phase. Its whole job is to change
  nothing, and T010 is what proves it. Do not proceed past a failing T010.
- T028 carries the feature's most destructive possible bug: encoding the rendered frame
  instead of the source pixels would darken every unlit wire below the wire threshold and
  ruin the saved file. Check it explicitly.
- T017 is what keeps the editor usable on large schematics. One compile per stroke, not per
  pointer event — a per-event compile costs 190 ms on Enigma2 and will look like a hang.

---

## Notes

- `[P]` means a different file with no incomplete dependency.
- `src/simulator.ts` is not modified by any task in this list. If a task appears to require
  editing it, stop — the design is wrong, not the engine.
- Commit per task or per logical group; each checkpoint is a safe stopping point.
