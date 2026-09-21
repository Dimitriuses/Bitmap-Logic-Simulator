# Feature Specification: Circuit Editor

**Feature Branch**: `001-circuit-editor`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Redesign it to include a new feature: Circuit editor (draw wires and gates directly)"

## Context

The simulator today is read-only. A circuit *is* a PNG, and the only way to change one is
to leave the app, edit the file in a paint program, and save — at which point live reload
picks it up and the running circuit updates, keeping its wire states.

That loop already proves the hard part: the engine can absorb an arbitrary change to the
bitmap mid-run without losing state. This feature closes the loop by moving the drawing
into the app, so the paint program is no longer required for ordinary edits.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Draw a wire and watch it conduct (Priority: P1)

A user opens a circuit, picks the pencil, and drags across a gap between two wires. The
moment the stroke ends, the two nets are one net, and whatever signal was on one side is
now driving the other. Nothing was saved, reloaded, or reset — the circuit kept running
through the edit.

**Why this priority**: This is the feature in one gesture. Drawing a conductor and seeing
it conduct is the whole value proposition; everything else is convenience around it. It is
also the slice that proves the riskiest mechanism — recompiling a live circuit from edited
pixels without losing state.

**Independent Test**: Open `projects/External_Shemes/Flip Flop.png`, draw a wire bridging
two previously separate nets, and confirm with the status bar that the wire count dropped
by one and that the lit state propagated across the join.

**Acceptance Scenarios**:

1. **Given** a running circuit, **When** the user drags the pencil across insulation between two nets, **Then** the nets merge, the reported wire count decreases, and simulation continues without a visible reset.
2. **Given** a wire carrying a HIGH signal, **When** the user erases a pixel in the middle of it, **Then** the net splits and the downstream half stops being driven.
3. **Given** any edit in progress, **When** the user is mid-stroke, **Then** the drawn pixels appear immediately, before the circuit has been recompiled.

---

### User Story 2 - Place a gate without counting pixels (Priority: P1)

A user picks the gate tool, chooses a direction, and clicks. A correctly formed inverter
appears — dark centre, four cardinal wires, the right two corners filled — and starts
inverting. The user never has to remember which corners mean "points left".

**Why this priority**: Equal to P1 because a wire editor that cannot place gates does not
let you build a circuit. Hand-drawing a `+` pattern pixel by pixel is exactly the fiddly
work this feature exists to remove, and getting a corner wrong produces a silently inert
pattern rather than an error.

**Independent Test**: On a blank area, stamp a gate pointing right with a wire on each
side, and confirm the gate count rises by one and the output wire reads the inverse of the
input.

**Acceptance Scenarios**:

1. **Given** the gate tool with direction "right", **When** the user clicks on a pixel, **Then** a 3×3 pattern is written whose corners are exactly the two that produce a rightward inverter.
2. **Given** a placed gate, **When** its input wire is driven HIGH, **Then** its output wire goes LOW within the usual ramp time.
3. **Given** the crossover stamp, **When** the user clicks, **Then** a pattern with no filled corners is written and the horizontal and vertical wires pass without connecting.

---

### User Story 3 - Keep the edit (Priority: P2)

Having drawn something worth keeping, the user saves. On Chrome and Edge the PNG on disk
is updated in place, so the file the user opened now contains the new circuit. Elsewhere,
the user gets a downloaded PNG instead.

**Why this priority**: P2 rather than P1 because the first two stories are demonstrable and
valuable without it — but an editor whose work evaporates on refresh is a toy, so this is
the first thing needed after drawing works.

**Independent Test**: Draw a change, save, reload the page, reopen the same file, and
confirm the change is present.

**Acceptance Scenarios**:

1. **Given** an unsaved edit and a file opened via Open File on a browser that supports writing, **When** the user saves, **Then** the file on disk contains the edited pixels and the app does not treat its own write as an external change.
2. **Given** a browser without write support, **When** the user saves, **Then** a PNG download is produced whose pixels match the edited circuit.
3. **Given** an edited circuit, **When** the user tries to close the tab or load a different circuit, **Then** they are warned that unsaved changes will be lost.
4. **Given** a saved file, **When** it is reopened, **Then** the wire and gate counts match what was on screen when it was saved.

---

### User Story 4 - Undo a mistake (Priority: P2)

The user draws over something important, presses Ctrl+Z, and gets it back exactly.

**Why this priority**: Drawing directly onto a live circuit is destructive, and the medium
is unforgiving — one stray pixel silently changes a net. Without undo, users will be
reluctant to experiment, which defeats the point.

**Independent Test**: Record the wire and gate counts, draw a stroke, undo it, and confirm
both counts and every pixel return to their previous values.

**Acceptance Scenarios**:

1. **Given** a completed stroke, **When** the user undoes, **Then** every pixel that stroke touched returns to its prior value and the circuit is recompiled to match.
2. **Given** an undone stroke, **When** the user redoes, **Then** the stroke is reapplied exactly.
3. **Given** a stroke drawn after an undo, **When** it completes, **Then** the redo stack is discarded.

---

### User Story 5 - Draw at a readable scale (Priority: P3)

Working at pixel scale on a 2000×1200 schematic, the user zooms in far enough to see
individual pixels, gets a grid and a cursor showing exactly which pixel will be painted,
and can pan while drawing.

**Why this priority**: Not required for correctness, but pixel-accurate editing without a
pixel-accurate cursor is guesswork — the existing viewport already zooms, so this is mostly
overlay work on top of it.

**Independent Test**: Zoom past the threshold and confirm a grid appears and the hovered
pixel is outlined at the position that a click would actually paint.

**Acceptance Scenarios**:

1. **Given** a zoom level above the grid threshold, **When** the user moves the pointer, **Then** the pixel under the cursor is outlined and it is the pixel a click would modify.
2. **Given** the gate tool, **When** the user hovers, **Then** a preview of the 3×3 pattern is shown before committing.

---

### Edge Cases

- What happens when an edit is drawn while the simulation is paused? The pixels change and the recompile happens; the circuit simply does not advance until resumed.
- What happens when a stroke merges two nets that are both driven by gates? The merged net becomes the wired-OR of all its drivers, exactly as the engine already defines for multiple drivers.
- What happens when the user draws on a circuit opened from a bundled example over HTTP, where there is no file handle to write back to? Saving must fall back to download.
- What happens when a stroke is drawn on a 2048×2048 schematic where recompiling costs hundreds of milliseconds? The stroke must stay responsive; the recompile must not be attempted per-pixel.
- What happens when an edit changes the image while the live-reload poller is running? The app must not mistake its own write for an external edit and reload over the user's work.
- What happens if the user revokes or never grants write permission to the file? Saving must degrade to download rather than failing silently.
- What happens when a gate stamp is placed overlapping an existing gate or partially off-canvas? The write must be clipped to the bitmap and must not corrupt neighbouring patterns.
- What happens when the user picks a "wire" colour that is too dark to count as a wire? The editor must not allow a wire colour the engine would read as insulation.

## Requirements *(mandatory)*

### Functional Requirements

**Drawing**

- **FR-001**: Users MUST be able to paint individual bitmap pixels with a pencil tool that follows the pointer, producing a connected stroke even when the pointer moves faster than one pixel per event.
- **FR-002**: Users MUST be able to draw a straight line between two points.
- **FR-003**: Users MUST be able to erase to insulation with an eraser tool.
- **FR-004**: Users MUST be able to pick up an existing pixel's colour with a colour picker.
- **FR-005**: Users MUST be able to stamp a correctly formed inverter in any of the four directions, and a crossover, as a single click.
- **FR-006**: The system MUST reject or correct any chosen wire colour that the engine would not recognise as a wire.
- **FR-007**: Painted pixels MUST appear immediately, without waiting for the circuit to be recompiled.

**Simulation integration**

- **FR-008**: The system MUST recompile the circuit from the edited pixels and continue simulating, preserving the state of every wire that still exists.
- **FR-009**: The system MUST NOT recompile more than once per completed stroke.
- **FR-010**: Wire and gate counts MUST reflect the edited circuit after each recompile.
- **FR-011**: Editing MUST work whether the simulation is running or paused.

**Persistence**

- **FR-012**: Users MUST be able to save edits back to the originating PNG file where the browser permits writing to it.
- **FR-013**: The system MUST offer a PNG download as the save path when writing in place is unavailable.
- **FR-014**: The system MUST NOT treat its own write as an external file change.
- **FR-015**: The system MUST warn before discarding unsaved edits, whether by navigating away or loading another circuit.
- **FR-016**: A saved PNG MUST round-trip: reopening it MUST yield the identical circuit.

**History**

- **FR-017**: Users MUST be able to undo and redo edits, at stroke granularity.
- **FR-018**: History MUST survive recompiles and MUST NOT grow in proportion to the bitmap size.

**Editing aids**

- **FR-019**: The system MUST indicate which pixel a click will affect.
- **FR-020**: The system MUST show a pixel grid when zoomed in far enough for it to be meaningful.
- **FR-021**: Existing navigation (pan, zoom) and existing wire interaction (click to drive a wire) MUST remain available alongside the editing tools, with an unambiguous way to tell which action a click will perform.

### Key Entities

- **Document**: The editable bitmap — the source pixels of the circuit, independent of any rendering of its live state. Owns the undo history and a flag for whether it differs from what is on disk.
- **Edit**: One user-visible change, at stroke granularity. Records only the pixels it touched, with their values before and after, so that it can be reversed.
- **Tool**: A drawing behaviour that translates pointer events into pixel changes — pencil, line, eraser, picker, gate stamp, crossover stamp.
- **Stamp Pattern**: The fixed 3×3 arrangement of wire and insulation that produces each gate direction and the crossover.
- **Circuit**: Unchanged in meaning — the compiled, simulatable form, now derived from the Document rather than straight from a decoded file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can build a working inverter chain — wires plus at least two gates — entirely inside the app, without opening any other program.
- **SC-002**: Drawing stays responsive on every bundled example: painted pixels appear within one frame of the pointer event, including on the 2048×2048 schematic.
- **SC-003**: A completed stroke on a circuit of up to ~12,000 gates is reflected in the running simulation within 250 ms.
- **SC-004**: Wire state is preserved across an edit: any net untouched by a stroke holds the value it had before the stroke.
- **SC-005**: A circuit drawn from scratch in the editor, saved, and reopened produces identical wire and gate counts.
- **SC-006**: Undo restores the bitmap to a bit-exact match of its prior state, verified by comparing every pixel.
- **SC-007**: No edit can produce a gate pattern the engine fails to recognise — every stamped gate registers in the gate count.

## Assumptions

- The existing simulation semantics are fixed. This feature changes how pixels are produced, never how they are interpreted; `UMain.pas` remains the authority and no gate, wire or timing rule is altered.
- Editing targets pointer input (mouse, pen, trackpad). Touch drawing on a phone is out of scope for this feature beyond not regressing existing touch pan/zoom/tap.
- The editable document is the *source* bitmap, not the rendered frame. The dimming applied to inactive wires is a display concern and must never be written back to a file.
- Writing to disk is only expected where the File System Access API is available, which today means Chromium-based browsers; every other browser is served by download.
- Collaborative or concurrent editing of the same file is out of scope.
- The zero-dependency, no-bundler constraint continues to hold: this feature adds no runtime dependency.
