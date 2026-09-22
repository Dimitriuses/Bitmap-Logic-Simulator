---

description: "Task list for the Editor Workflow feature"
---

# Tasks: Editor Workflow

**Input**: Design documents from `/specs/002-editor-workflow/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: No test framework, by constitution. Verification tasks map to numbered scenarios
in [quickstart.md](./quickstart.md). Much of this feature is pure — geometry, block
rotation, key precedence, the palette — so those parts are verified headlessly by
`npm run verify`, and the browser is reserved for what needs one.

**Organization**: Grouped by user story. US1 and US2 are independent of everything; US3–US7
all depend on the shared machinery built in Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no incomplete dependency
- **[Story]**: US1–US7
- Every task names an exact file path

---

## Phase 1: Setup

- [X] T001 [P] Extend `scripts/verify/harness.mjs` with a `netCount(image)` helper and a `samePixels(a, b)` comparison, so geometry checks read as assertions rather than boilerplate.
- [X] T002 [P] Add `scripts/verify/keymap.mjs` scaffolding that imports `dist/keymap.js` and enumerates the state space from [contracts/input.md](./contracts/input.md).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The machinery four stories share. Built once, before the stories that need it.

**⚠️ CRITICAL**: US3–US7 are blocked until this is complete. US1 and US2 are not.

- [X] T003 [P] Create `src/geometry.ts` with `walkConnected()` — one axis per iteration, inclusive endpoints, no per-pixel allocation (G-1 … G-6).
- [X] T004 [P] Add `busOffsets()` to `src/geometry.ts`: pitch 2 axis-aligned, 3 otherwise, perpendicular to the dominant axis, first offset always zero (G-7 … G-10).
- [X] T005 [P] Create `src/block.ts` with `PixelBlock`, `fromRect`, `rotateCW`/`rotateCCW` and `forEach` — pixel transform only, no gate awareness (BL-1 … BL-4).
- [X] T006 [P] Create `src/keymap.ts` with `resolveKey()` as a pure function implementing the precedence table exactly (KM-1 … KM-6).
- [X] T007 [P] Create `src/palette.ts` with the 16 defaults, `cycle`, `add`, `remove`, and a module-load assertion that every default passes `isWireColor` (PL-1 … PL-5).
- [X] T008 Add the `ToolParameter` type and wheel-parameter plumbing to `src/editor.ts`, with `{ passive: false }` registration so a notch can be consumed (T1 … T3, WH-1 … WH-4).
- [X] T009 Stop toolbar controls from stealing keyboard focus in `src/ui.ts`: `preventDefault()` on `mousedown` for every `#toolbar` control, leaving Tab access intact (FR-028, KM-7). Without this, Enter never reaches the paste-commit handler.
- [X] T010 Verify Scenario 1's pure half and Scenario 8 headlessly via `scripts/verify/geometry.mjs` and `scripts/verify/keymap.mjs`: connectivity, axis-aligned equivalence, bus widths 1–16 × 5 slopes, and the full precedence table (depends on T003–T007).

**Checkpoint**: shared machinery exists and is proven in isolation.

---

## Phase 3: User Story 1 - Wires that actually connect (Priority: P1) 🎯

**Goal**: Every run the pencil or line produces is one conductor.

**Independent Test**: Draw a 45° line; the wire count rises by exactly one.

- [X] T011 [US1] Route `CircuitDocument.line()` in `src/document.ts` through `walkConnected` from `src/geometry.ts`, replacing the Bresenham loop (FR-001).
- [X] T012 [US1] Confirm `BrushTool.move()` in `src/tools/pencil.ts` inherits the fix through `doc.line()`, and that its first-point handling still paints the press pixel.
- [X] T013 [US1] Rewrite `src/tools/line.ts` to preview and commit with `walkConnected`, so the ghost matches what gets drawn (TL-6).
- [X] T014 [US1] Verify Scenario 1 of `specs/002-editor-workflow/quickstart.md`: diagonal runs give one net, axis-aligned runs are pixel-identical to before, and a fast diagonal pencil drag in the browser produces a single net.
- [X] T015 [US1] Re-record nothing: run `npm run verify` and confirm all 22 schematics still match `scripts/verify/baseline.json` — the fix changes what the editor writes, never how anything is read (SC-010).

**Checkpoint**: the shipped connectivity bug is gone. Worth landing alone.

---

## Phase 4: User Story 2 - Edit mode belongs to editing (Priority: P1)

**Goal**: In edit mode nothing pokes wires, the simulation is paused, and the right button erases.

**Independent Test**: Enter edit mode; the cycle counter stops. Right-drag; pixels erase.

- [X] T016 [US2] Record the run state on entering edit mode and restore it on leaving, in `src/ui.ts` (FR-004, research R10).
- [X] T017 [US2] Suppress all wire poking while in edit mode in `src/ui.ts` — remove the right-click toggle and the left-button drive from the edit-mode path (FR-003).
- [X] T018 [US2] Add an optional secondary-button behaviour to the `Tool` interface in `src/tools/types.ts`, so a tool can act differently on the right button without becoming two tools.
- [X] T019 [US2] Implement right-button erasing in `src/tools/pencil.ts` using the same connected interpolation as drawing (FR-006).
- [X] T020 [US2] Route the secondary button through `src/editor.ts`, framing it as a stroke like any other so it is one undo step.
- [X] T021 [US2] Verify Scenario 2 of `specs/002-editor-workflow/quickstart.md`: pause on enter, restore on exit, stays paused when entered paused, no wire changes under any click, right-drag erases, Space still runs (SC-003).

**Checkpoint**: US1 + US2 are a shippable increment — one correctness fix and one interaction fix.

---

## Phase 5: User Story 3 - A palette worth using (Priority: P2)

**Goal**: Sixteen colours, custom additions, wheel to cycle.

**Independent Test**: Scroll over the colour tool; the active colour advances.

- [X] T022 [P] [US3] Add the palette popover markup to `index.html` and its handles to `src/dom.ts`: a 16-swatch grid, custom entries, and an add control.
- [X] T023 [P] [US3] Style the palette popover and swatch states in `css/style.css`, including which swatch is active.
- [X] T024 [US3] Wire the palette into `src/editor.ts` as the source of the active colour, replacing the single stored value (depends on T007).
- [X] T025 [US3] Register the colour control's `ToolParameter` in `src/editor.ts` so the wheel cycles the palette and the event is consumed (FR-009, depends on T008).
- [X] T026 [US3] Persist custom colours and the active index in `src/settings.ts`, validated on read like the existing preferences (FR-010, P5).
- [X] T027 [US3] Verify Scenario 3 of `specs/002-editor-workflow/quickstart.md`: 16 valid defaults, wheel cycles without moving the canvas, custom colour survives reload, `#202020` refused with a reason.

---

## Phase 6: User Story 4 - Draw a bus in one stroke (Priority: P2)

**Goal**: N parallel conductors in one drag.

**Independent Test**: Width 4, one run, wire count +4.

- [X] T028 [US4] Draw N conductors in `src/tools/line.ts` using `busOffsets`, previewing all of them (FR-011, depends on T004, T013).
- [X] T029 [P] [US4] Add the line tool's width submenu to `index.html` and `src/dom.ts`, showing the current value.
- [X] T030 [US4] Register the line tool's `ToolParameter` in `src/editor.ts` so the wheel sets the width, clamped 1–16 (FR-013, depends on T008).
- [X] T031 [P] [US4] Persist the bus width in `src/settings.ts`.
- [X] T032 [US4] Verify Scenario 4 of `specs/002-editor-workflow/quickstart.md`: 80 headless cases give exactly N nets, and the browser count matches the displayed width (SC-004).

---

## Phase 7: User Story 5 - Move a piece of circuit (Priority: P2)

**Goal**: Select, cut/copy/delete, paste as a floating block, move, rotate, commit or cancel.

**Independent Test**: Copy a gate, paste it, commit; the gate count rises by one and the copy works.

- [X] T033 [US5] Add `readBlock`, `writeBlock` and `clearRect` to `src/document.ts`, obeying the existing stroke framing so each is one `Edit` (DC-1 … DC-3, depends on T005).
- [X] T034 [US5] Create `src/clipboard.ts` with selection state, the held block, and the floating-paste lifecycle (CB-1 … CB-7).
- [X] T035 [P] [US5] Create `src/tools/select.ts`: drag a normalised, clipped rectangle; writes nothing; a click clears (SE-1 … SE-4).
- [X] T036 [US5] Wire copy/cut/delete/paste/commit/cancel into `src/editor.ts` through `resolveKey`, with no key handling of its own (depends on T006, T034).
- [X] T037 [US5] Draw the selection marquee and the floating paste in `src/renderer.ts`'s overlay, distinct from the existing tool preview (F1).
- [X] T038 [US5] Move a floating paste by pointer drag in `src/tools/select.ts` and by arrow key through `resolveKey` (FR-017).
- [X] T039 [P] [US5] Add the 90° and −90° rotate controls to `index.html` and `src/dom.ts`, enabled only while a paste floats.
- [X] T040 [US5] Discard selection and floating paste when the document changes, in `src/ui.ts`, behind the existing unsaved-changes guard (CB-7).
- [X] T041 [US5] Verify Scenario 5 of `specs/002-editor-workflow/quickstart.md` headlessly via `scripts/verify/rotate.mjs`: rotate ×4 is identity, rotated gates behave as the rotated directions, copy mutates nothing, cancel is byte-identical with zero recompiles, commit is one edit and one recompile (SC-005, SC-006, SC-007).
- [X] T042 [US5] Verify the browser half of Scenario 5 of `specs/002-editor-workflow/quickstart.md`: select, cut, paste, nudge, rotate, Enter — and the same sequence ending in Escape.

---

## Phase 8: User Story 6 - Camera schemes (Priority: P3)

**Goal**: Classic or Paint.NET wheel behaviour.

**Independent Test**: In Paint.NET mode a plain notch pans vertically.

- [X] T043 [P] [US6] Create `src/viewport-camera.ts` with `applyWheel(scheme, viewport, e, local)`, `classic` reproducing today's behaviour exactly including the 120/256 notch (CM-1 … CM-3).
- [X] T044 [US6] Route the canvas wheel handler in `src/ui.ts` through it, keeping `{ passive: false }` and `preventDefault` so Ctrl+wheel never reaches the browser (FR-022, C1).
- [X] T045 [P] [US6] Add the scheme setting to the settings panel in `index.html` and `src/dom.ts`, and persist it in `src/settings.ts` (CM-4).
- [X] T046 [US6] Verify Scenario 6 of `specs/002-editor-workflow/quickstart.md`: both schemes behave as specified, page zoom never fires, classic is unchanged, choice persists.

---

## Phase 9: User Story 7 - Place a pixel exactly (Priority: P3)

**Goal**: The arrow keys move the editor's pointer; with a button held they draw.

**Independent Test**: Hold the left button with the pencil, press an arrow, and exactly one
pixel appears in that direction.

**Platform note**: a web page cannot move the operating system's cursor — no API exists,
and Pointer Lock only hides it and reports relative motion. The editor therefore keeps its
own pointer position, and a marker shows where it is whenever it differs from the physical
cursor.

- [X] T047 [US7] Add `nudgeTo(p)` to `src/editor.ts`: when a stroke is active, feed the point to the tool exactly as a mouse move would (FR-024).
- [X] T048 [US7] Track the app's pointer and a `nudged` flag in `src/ui.ts`, moving it one pixel per arrow press and clamping to the bitmap (FR-023).
- [X] T049 [US7] Make the nudged pointer authoritative in `src/ui.ts`: clicks act where the marker is, and any real mouse movement snaps it back and clears the flag (FR-025).
- [X] T050 [US7] Implement auto-repeat with acceleration in `src/ui.ts`, clamped so a held key cannot cross a large bitmap instantly (KM-6).
- [X] T051 [P] [US7] Draw the pointer marker in `src/renderer.ts`, shown only while nudged — it is the only indication of where clicks will land (FR-025).

**Checkpoint**: All five stories functional, and Space still means one thing everywhere.

---


## Phase 10: Polish & Cross-Cutting Concerns

- [X] T052 [P] Document the editor workflow in `README.md`: palette, bus, selection and clipboard, camera schemes, keyboard cursor, and the precedence rules for Enter/Escape/Space.
- [X] T053 [P] Update `CLAUDE.md`: the shared modules and what each is for, the connectivity requirement, and that `resolveKey` is the only place key precedence lives.
- [X] T054 [P] Add `geometry.mjs`, `rotate.mjs` and `keymap.mjs` to the `verify` script in `package.json`.
- [X] T055 Verify Scenario 9 of `specs/002-editor-workflow/quickstart.md`: `npm run verify` fully green, and the 001 browser regression suite still passing on Chrome, Edge, Firefox and WebKit.
- [X] T056 Re-check the constitution: `npm run build` and `npx tsc --noEmit` clean, `package.json` dependencies still empty, `src/simulator.ts` untouched.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → everything else.
- **US1 (3)** and **US2 (4)** depend only on Phase 2's `geometry.ts` (US1) or on nothing at all (US2). Both can start immediately.
- **US3–US7 (5–9)** all need Phase 2 complete.
- **Polish (10)** last.

### User Story Dependencies

- **US1 (P1)**: needs `geometry.ts` (T003). Otherwise independent.
- **US2 (P1)**: fully independent — it touches mode and button handling, not geometry. Can be built in parallel with US1 by a second person.
- **US3 (P2)**: needs `palette.ts` and the wheel mechanism.
- **US4 (P2)**: needs `busOffsets` and the wheel mechanism, and builds on US1's rewritten line tool. Cheapest immediately after US1.
- **US5 (P2)**: needs `block.ts` and `keymap.ts`. Largest phase; disjoint files from US3/US4 so it can run in parallel with them.
- **US6 (P3)**: independent of the other stories once Phase 2 exists.
- **US7 (P3)**: needs `keymap.ts`; shares the overlay with US5, so sequence T050 after T037 if one person does both.

### Parallel Opportunities

- **Phase 2**: T003–T007 are five separate files with no interdependencies — the widest parallel window in the feature.
- **US3**: T022, T023 alongside T007's output.
- **US4**: T029, T031 alongside T028.
- **US5**: T035 and T039 alongside T033/T034.
- **US6**: T043 and T045 together.
- **Polish**: T052, T053, T054 together.
- Across stories: once Phase 2 lands, US3, US4, US5 and US6 touch largely disjoint files.

---

## Parallel Example: Phase 2

```bash
# Five independent modules, no shared files:
Task: "Create src/geometry.ts with walkConnected()"
Task: "Create src/block.ts with PixelBlock and rotation"
Task: "Create src/keymap.ts with resolveKey()"
Task: "Create src/palette.ts with the 16 defaults"
Task: "Add busOffsets() to src/geometry.ts"   # after walkConnected lands

# Then, sequentially:
Task: "Add ToolParameter plumbing to src/editor.ts"
Task: "Verify geometry and keymap headlessly"
```

---

## Implementation Strategy

### MVP scope

Phases 1–4: setup, the shared machinery, US1 and US2. That is a correctness fix for wires
that do not conduct and an edit mode that stops fighting the user — both worth shipping
before anything else is started.

### Incremental delivery

1. Phase 2 → shared machinery, proven in isolation, nothing user-visible.
2. US1 → diagonal wires conduct. **Ship this on its own.**
3. US2 → edit mode only edits. **Shippable.**
4. US4 → buses, cheap right after US1.
5. US3 → palette.
6. US5 → selection and clipboard, the feature's centre of gravity.
7. US6, US7 → camera and keyboard precision.
8. Polish.

### Risk-ordered notes

- **T011 is the highest-value task in the feature** and the easiest to get subtly wrong. The
  new walk must leave axis-aligned runs byte-identical (FR-002), or every existing drawing
  changes shape. T014 checks exactly that.
- **T009 and T010 before any of US3–US7.** T009 is what lets Enter and Space reach the
  editor at all — measured: a focused toolbar button swallows Enter today. T010 proves the
  precedence table and the bus spacing rule, both cheap to verify now and expensive to
  discover wrong later, and both pure functions.
- **T036 must not grow its own key handling.** Every key decision belongs in `resolveKey`;
  the moment two places decide, Escape starts doing two things.
- **T044's `preventDefault`** is what stands between the Paint.NET scheme and Ctrl+wheel
  zooming the entire page.

---

## Notes

- `[P]` means a different file with no incomplete dependency.
- `src/simulator.ts` is not modified by any task here. If one appears to need it, the design
  is wrong, not the engine.
- Commit per task or logical group; each checkpoint is a safe stopping point.
