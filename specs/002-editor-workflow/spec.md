# Feature Specification: Editor Workflow

**Feature Branch**: `002-editor-workflow`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: seven additions to the circuit editor — remove wire-poking
while editing and pause the simulation; right-click to erase with the pencil; a selection
tool with copy/cut/delete/paste including a movable, rotatable floating paste; a 16-colour
palette with custom entries and wheel-to-switch; connected line drawing plus multi-wire bus
drawing; a second Paint.NET-style camera mode; and arrow-key cursor control.

## Context

[001-circuit-editor](../001-circuit-editor/spec.md) delivered drawing: pencil, line,
eraser, picker, gate and crossover stamps, undo, and saving. This feature is what turns
that into something you would actually build a circuit with.

It also fixes a defect in 001. The line tool and the pencil's gap-filling both rasterise
with Bresenham, which steps diagonally — and wires connect only on the four cardinal sides.
A 45° line drawn today produces **nine separate nets instead of one**, and a fast diagonal
drag produces wire that looks continuous and does not conduct. That is US1 below, and it is
the reason this feature leads with a bug rather than an enhancement.

### What this supersedes in 001

| 001 decision | Now |
| --- | --- |
| R8 / ED-1: "mode governs the left button only"; right-click keeps toggling wires in edit mode | Edit mode owns both buttons. Right-drag erases. |
| US1: edits land in a circuit that keeps running | Entering edit mode pauses; leaving restores the previous run state. Running while editing stays possible, deliberately. |
| FR-002: "draw a straight line between two points" | The run must be electrically connected, not merely visually straight. |
| A single colour input | A palette of 16, plus custom entries. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Wires that actually connect (Priority: P1)

A user drags the pencil diagonally across the canvas, or draws a diagonal line. What they
get is one conductor, end to end, not a dotted staircase of isolated pixels.

**Why this priority**: It is a correctness bug in shipped code, and its failure mode is the
worst kind — silent. The drawing looks right. The circuit is dead. Anything built on top of
a broken line tool inherits the problem, so this lands first.

**Independent Test**: Draw a 45° line across empty space and confirm the wire count rises
by exactly one, not by the number of pixels drawn.

**Acceptance Scenarios**:

1. **Given** an empty area, **When** the user draws a diagonal line of any slope, **Then** every pixel of it belongs to a single net.
2. **Given** a fast diagonal drag with the pencil, **When** pointer events skip pixels, **Then** the interpolated run is still a single net.
3. **Given** an axis-aligned line, **When** it is drawn, **Then** it contains no more pixels than before this change — the fix must not thicken straight runs.

---

### User Story 2 - Edit mode belongs to editing (Priority: P1)

In edit mode, clicking draws. It never sets a wire high, and nothing is evaluating
underneath while the user works. The right button erases, so switching between drawing and
rubbing out does not mean a trip to the toolbar.

**Why this priority**: Today a right-click in edit mode toggles a wire, which is both
useless while drawing and destructive of the user's mental model — the same button means
two different things depending on a mode that governs only the other button. Pausing
removes the other half of the confusion: a circuit that keeps evaluating while you rewire
it changes underneath you for reasons that look like your edit.

**Independent Test**: Enter edit mode and confirm the simulation halts and the cycle counter
stops; right-drag and confirm pixels are erased rather than a wire toggling.

**Acceptance Scenarios**:

1. **Given** a running circuit, **When** the user enters edit mode, **Then** the simulation pauses and the cycle counter stops advancing.
2. **Given** edit mode was entered from a running circuit, **When** the user leaves edit mode, **Then** the simulation resumes.
3. **Given** edit mode was entered from an already-paused circuit, **When** the user leaves, **Then** it stays paused.
4. **Given** edit mode with the pencil, **When** the user drags with the right button, **Then** pixels are erased to insulation and no wire state changes.
5. **Given** edit mode, **When** the user clicks any button, **Then** no wire is driven high or toggled.
6. **Given** edit mode, **When** the user presses Space deliberately, **Then** the simulation runs — editing a live circuit stays available to anyone who wants it.

---

### User Story 3 - A palette worth using (Priority: P2)

The user picks from sixteen ready colours instead of fighting a colour picker, adds their
own when they want one, and cycles through them by pointing at the colour tool and
scrolling.

**Why this priority**: Colour is how a schematic stays readable at 2000 pixels wide — the
bundled examples use blue, green and white to separate buses from logic. A single colour
input makes that tedious enough that people skip it.

**Independent Test**: Scroll over the colour tool and confirm the active colour advances
through the palette; add a custom colour and confirm it survives a reload.

**Acceptance Scenarios**:

1. **Given** the toolbar, **When** the user opens the palette, **Then** sixteen colours are offered and every one of them is a colour the engine reads as wire.
2. **Given** the pointer over the colour tool, **When** the user scrolls, **Then** the active colour steps one entry per notch and the canvas does not zoom or pan.
3. **Given** a custom colour that the engine would read as insulation, **When** the user tries to add it, **Then** it is refused with a reason.
4. **Given** a custom colour was added, **When** the page is reloaded, **Then** it is still in the palette.

---

### User Story 4 - Draw a bus in one stroke (Priority: P2)

Instead of drawing twelve parallel wires twelve times, the user sets the line tool to
twelve and draws once.

**Why this priority**: Buses are most of the wiring in the larger examples, and drawing them
one line at a time is the single most repetitive thing the editor currently asks for.

**Independent Test**: Set the count to four, draw one horizontal run, and confirm the wire
count rises by exactly four.

**Acceptance Scenarios**:

1. **Given** a bus width of N, **When** the user draws a line, **Then** N parallel conductors appear and the wire count rises by exactly N.
2. **Given** a bus of any width, **When** it is drawn diagonally, **Then** each of the N runs is individually connected and none of them touch each other.
3. **Given** the pointer over the line tool, **When** the user scrolls, **Then** the bus width changes and is shown.
4. **Given** a bus width of 1, **When** the user draws, **Then** the behaviour is identical to the plain line tool.

---

### User Story 5 - Move a piece of circuit (Priority: P2)

The user drags a rectangle around a sub-circuit, cuts it, pastes it somewhere else, nudges
it into place with the arrow keys, rotates it a quarter turn, and presses Enter. Nothing is
committed until they do.

**Why this priority**: This is what makes the editor useful beyond small fixes — reusing a
decoder or a latch instead of redrawing it. It is P2 rather than P1 only because the editor
is usable without it.

**Independent Test**: Copy a region containing a gate, paste it into empty space, commit,
and confirm the gate count rises by one and the copy behaves like the original.

**Acceptance Scenarios**:

1. **Given** the selection tool, **When** the user drags a rectangle, **Then** the selected region is shown distinctly and its size is reported.
2. **Given** a selection, **When** the user presses Ctrl+C, **Then** the region is held for pasting and the document is unchanged.
3. **Given** a selection, **When** the user presses Ctrl+X or Delete, **Then** the region becomes insulation in one undoable edit.
4. **Given** something held for pasting, **When** the user presses Ctrl+V, **Then** it appears as a floating block that is not yet part of the document.
5. **Given** a floating block, **When** the user drags it or presses an arrow key, **Then** it moves — one pixel per arrow press.
6. **Given** a floating block, **When** the user rotates it by 90° or −90°, **Then** it turns, and any gates inside it end up pointing the correspondingly rotated way.
7. **Given** a floating block, **When** the user presses Enter, **Then** it is written into the document as a single undoable edit and the circuit is recompiled once.
8. **Given** a floating block, **When** the user presses Escape, **Then** nothing is written and the document is untouched.

---

### User Story 6 - Camera that matches the tool you came from (Priority: P3)

A user who arrives from a paint program chooses the scheme they already know: wheel scrolls
vertically, Shift+wheel horizontally, Ctrl+wheel zooms.

**Why this priority**: A preference, not a capability — everything is reachable in either
scheme. Worth having because pixel editing is a long-session activity and fighting the
scroll wheel all afternoon is a real cost.

**Independent Test**: Switch schemes and confirm a plain wheel notch pans vertically rather
than zooming.

**Acceptance Scenarios**:

1. **Given** the classic scheme, **When** the user scrolls, **Then** the view zooms at the cursor, exactly as it does today.
2. **Given** the Paint.NET scheme, **When** the user scrolls, **Then** the view pans vertically; with Shift, horizontally; with Ctrl, it zooms at the cursor.
3. **Given** either scheme, **When** the user scrolls over the canvas, **Then** the browser's own page zoom never triggers.
4. **Given** a chosen scheme, **When** the page is reloaded, **Then** the choice is remembered.

---

### User Story 7 - Place a pixel exactly (Priority: P3)

For the pixel that has to go in exactly the right place, the user holds the mouse button
and steers with the arrow keys, one pixel per press, instead of fighting a mouse at 28x
zoom.

**Why this priority**: Precision work is where pixel editing gets frustrating, but it is a
refinement of drawing that already works.

**Independent Test**: Hold the left button with the pencil, press an arrow, and confirm
exactly one pixel is added in that direction.

**Note on the platform**: a web page cannot move the operating system's cursor — there is
no API for it, and Pointer Lock only hides it and reports relative motion. So the editor
keeps its own pointer position, which the arrows drive; the physical cursor stays where it
is, and a marker shows where the app's pointer actually is whenever the two differ.

**Acceptance Scenarios**:

1. **Given** edit mode with a button held, **When** the user presses an arrow key, **Then** the active tool acts on the adjacent pixel, exactly as if the mouse had moved one pixel.
2. **Given** a held arrow key, **When** it repeats, **Then** the pointer keeps moving, and faster the longer it is held.
3. **Given** the arrows have moved the pointer, **When** the user clicks, **Then** the click acts where the marker is, not where the physical cursor sits.
4. **Given** the arrows have moved the pointer, **When** the user moves the real mouse, **Then** the pointer snaps back to it and the marker disappears.
5. **Given** any state at all, **When** the user presses Space, **Then** it pauses or resumes the simulation — there is no apply key, so Space is never overloaded.

---


### Edge Cases

- What happens when a selection is dragged partly outside the bitmap? It is clipped to the bitmap; nothing wraps.
- What happens when a floating paste is moved partly off-canvas and committed? Only the in-bounds pixels are written.
- What happens when a paste is committed over existing circuitry? It overwrites the whole rectangle, insulation included — otherwise a cut-and-paste would leave fragments of whatever was underneath.
- What happens if the user switches tools while a paste is floating? The paste stays floating; tools do not silently discard uncommitted work.
- What happens to a floating paste when another circuit is loaded? It is discarded along with the document, behind the existing unsaved-changes guard.
- What happens when a bus is drawn so wide that it runs off the bitmap? Runs that fall outside are clipped, and the ones that remain are still individually connected.
- What happens when both a floating paste and the keyboard cursor could consume an arrow key? The floating paste wins; the precedence is fixed and documented.
- What happens when the user scrolls over a toolbar button that has no wheel parameter? Nothing — and the canvas must not react either.
- What happens when Enter or Space is pressed while a toolbar button still has focus from being clicked? The app must receive the key. A focused button would otherwise re-activate itself and swallow it — measured to happen with Enter today.
- What happens if a custom colour duplicates one already in the palette? It is not added twice.

## Requirements *(mandatory)*

### Functional Requirements

**Connectivity (US1)**

- **FR-001**: Every run the pencil or line tool produces MUST be connected under the engine's own rule — adjacent only horizontally or vertically.
- **FR-002**: Axis-aligned runs MUST NOT gain pixels as a result of FR-001.

**Edit mode (US2)**

- **FR-003**: In edit mode, no pointer button may drive, toggle or otherwise change a wire's state.
- **FR-004**: Entering edit mode MUST pause the simulation; leaving MUST restore the run state that was in effect before entering.
- **FR-005**: The user MUST still be able to run the simulation while in edit mode by their own deliberate action.
- **FR-006**: The right pointer button MUST erase while the pencil is active, with the same connectivity guarantee as drawing.

**Palette (US3)**

- **FR-007**: The palette MUST offer 16 default colours, every one of which the engine reads as wire.
- **FR-008**: Users MUST be able to add custom colours, and MUST be prevented from adding one the engine would read as insulation.
- **FR-009**: Scrolling over the colour control MUST step through the palette without zooming or panning the canvas.
- **FR-010**: Custom colours and the active colour MUST persist across reloads.

**Bus (US4)**

- **FR-011**: The line tool MUST draw N parallel conductors, N selectable from 1 to 16.
- **FR-012**: Conductors within a bus MUST NOT touch, and each MUST individually satisfy FR-001.
- **FR-013**: The bus width MUST be adjustable both from a submenu and by scrolling over the line tool, and the current value MUST be visible.

**Selection and clipboard (US5)**

- **FR-014**: Users MUST be able to select a rectangular region and see its bounds and size.
- **FR-015**: Copy MUST capture the region without modifying the document; cut and delete MUST clear it to insulation as a single undoable edit.
- **FR-016**: Paste MUST produce a floating block that is not part of the document until confirmed.
- **FR-017**: A floating block MUST be movable by pointer drag and by arrow key, one pixel per press.
- **FR-018**: A floating block MUST be rotatable by 90° in either direction, and rotation MUST preserve the behaviour of any gates it contains.
- **FR-019**: Confirming a paste MUST write it as one undoable edit and recompile exactly once; cancelling MUST leave the document untouched.
- **FR-020**: Committing MUST overwrite the full rectangle, insulation included.

**Camera (US6)**

- **FR-021**: Two wheel schemes MUST be offered: the existing zoom-at-cursor, and pan-Y / Shift pan-X / Ctrl zoom-at-cursor.
- **FR-022**: The choice MUST persist, and neither scheme may let the browser's page zoom fire.

**Pointer nudging (US7)**

- **FR-023**: Arrow keys MUST move the editor's pointer one pixel per press, with auto-repeat and acceleration while held.
- **FR-024**: While a pointer button is held, a nudge MUST feed the active tool exactly as a mouse move does, so holding the pencil and tapping an arrow draws one pixel.
- **FR-025**: Once nudged, the editor's pointer MUST be what clicks act on, and MUST be shown; it MUST snap back to the physical cursor as soon as the real mouse moves.
- **FR-029**: Space MUST pause and resume in every state. This feature MUST NOT introduce an apply key.

**Across the feature**

- **FR-026**: Enter, Escape and the arrow keys MUST follow one documented precedence order, so the same key never does two things ambiguously.
- **FR-028**: Clicking a toolbar control MUST NOT leave keyboard focus on it, so that Enter and Space continue to reach the editor. Tab-navigation to those controls MUST still work.
- **FR-027**: No change in this feature may alter simulation semantics.

### Key Entities

- **PixelBlock**: A rectangle of pixels with a size — what a selection captures, what the clipboard holds, and what floats during a paste. Rotatable.
- **Selection**: A rectangle over the document, possibly empty.
- **FloatingPaste**: A PixelBlock positioned over the document, not yet written, awaiting confirmation.
- **Palette**: The ordered list of usable wire colours, defaults plus custom.
- **ToolParameter**: A value a tool exposes for wheel adjustment — the active colour, the bus width.
- **Pointer**: The editor's own pointer position, in bitmap pixels, driven by the mouse and by the arrow keys. A browser cannot move the physical cursor, so this is the only pointer the editor has.
- **CameraScheme**: Which wheel behaviour is in effect.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A diagonal line of any slope, and a fast diagonal drag, each produce exactly one net.
- **SC-002**: Axis-aligned runs contain exactly the same pixels as before this feature.
- **SC-003**: In edit mode, no sequence of pointer input changes any wire's state.
- **SC-004**: A bus of N drawn in one stroke yields exactly N nets, for every N from 1 to 16 and for horizontal, vertical and diagonal runs.
- **SC-005**: A region containing each of the four gate directions, copied and pasted after a 90° rotation, produces gates that behave as the rotated directions — verified by driving them.
- **SC-006**: A cancelled paste leaves the document bit-identical to before the paste began.
- **SC-007**: A committed paste costs exactly one recompile and one undo step.
- **SC-008**: All 16 default palette colours, and any colour the palette accepts, satisfy the engine's wire test.
- **SC-009**: Every key with more than one possible meaning resolves per the documented precedence, demonstrated for Enter, Escape and the arrow keys with a floating paste present and absent. Space resolves to pause in every state.
- **SC-011**: With a button held, one arrow press changes exactly one pixel.
- **SC-010**: All 22 bundled schematics still compile to their recorded wire and gate counts.

## Assumptions

- Simulation semantics remain frozen. This feature changes how pixels are produced and how the view is driven, never how either is interpreted.
- The clipboard is internal to the page. Interoperating with the operating system clipboard is out of scope.
- Rotation is offered on a floating paste, not as an in-place transform of a selection.
- Selection is rectangular. Lassos, magic wands and multi-region selections are out of scope.
- Editing remains pointer-and-keyboard. Touch continues to pan, pinch and tap as it does today, and gains nothing here.
- Bus conductors are spaced one pixel apart, the minimum that keeps them separate nets.
