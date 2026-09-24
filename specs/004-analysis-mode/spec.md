# Feature Specification: Analysis Mode

**Feature Branch**: `004-analysis-mode`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Move the analysis out of editing mode into a separate analysis mode containing dedicated analysis tools: a separate analysis mode carrying the existing selection tool but without editing capabilities (copy/cut/delete); a netlist visualisation with labels for inputs/outputs/logic gates; conversion of the selected area into a more schematic representation of a logic circuit. Other analysis tools may be added. The analyser must be capable of handling loops in circuits, circuits operating at clock frequencies, and circuits that act as memory."

## Context

Feature [003](../003-circuit-analysis/spec.md) built the analysis machinery — netlist extraction, boolean
expressions, truth tables, a differential oracle, feedback analysis, minimisation — and
reached it through a button in the **editing** toolbar. That placement has three costs:

1. Analysis is a *reading* activity, but it is only reachable from the one mode whose entire
   purpose is writing. A stray keystroke while studying a circuit modifies it.
2. Analysis tools compete with drawing tools for toolbar space and for keys.
3. The results are presented as text — lists of nets, expressions, tables. A 241-gate block
   of the 4-bit CPU is correct in that presentation and still unreadable.

This feature gives analysis its own mode and its own way of showing a circuit: as a circuit.

It also widens what the analyser can describe. Today it answers well for combinational logic
and adequately for small feedback loops. The circuits the user actually wants to understand —
registers, the CPU's control path — have loops, are driven by a clock, and store values. Those
three are named explicitly in scope.

## Clarifications

### Session 2026-09-24

- Q: Where should labels be stored, given that PNG text metadata does not survive an ordinary
  re-save by an image editor? → A: A sidecar `*.labels.json` beside the circuit as the portable
  record, with a browser-side working copy so nothing is lost between saves. Image metadata was
  rejected on evidence: an open-modify-save round trip silently drops the text chunk, and
  editing the PNG in an external paint program is this project's core live-reload workflow.

- Q: How should the analyser recognise which input is the clock? → A: Both a behavioural and a
  structural signal, combined into a ranked list of candidates, each shown with the reason it
  was chosen. Behavioural: run the selection with inputs held steady and find nets that
  oscillate with a stable period — which is how a clock is actually built in this medium, as a
  ring oscillator. Structural: find free inputs that fan out to many storage elements, which
  catches a clock the user pulses by hand. Neither alone is sufficient; the first is blind to a
  hand-pulsed input, and the second cannot tell a clock from a reset line.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A mode that cannot change the circuit (Priority: P1) 🎯 MVP

The user switches to Analysis mode. The circuit is shown as usual and they drag out a
selection to choose what to study. Nothing available in this mode alters a single pixel:
no drawing, no stamping, no copy, no cut, no delete, no paste, no undo. Selection is the
only gesture, and it exists solely to say *what to look at*.

**Why this priority**: every other story lives inside this mode, so nothing else can be built
until it exists. It also carries the feature's central promise on its own — a place to explore
a circuit that is working, without risk of changing it. That promise is worth nothing unless
it is total, which is why it is stated as an absolute rather than as "editing is discouraged".

**Independent Test**: enter Analysis mode and attempt every editing gesture and every editing
shortcut the application knows. The document's unsaved-changes flag and undo history are
unchanged throughout.

**Acceptance Scenarios**:

1. **Given** a loaded circuit, **When** the user switches to Analysis mode and drags on the
   canvas, **Then** a selection rectangle is created and no pixel changes.
2. **Given** a selection in Analysis mode, **When** the user presses the copy, cut or delete
   shortcuts, **Then** nothing is copied, cut or deleted, and the document is unchanged.
3. **Given** Analysis mode, **When** the user presses any key that draws in Edit mode,
   **Then** nothing is drawn and the document is unchanged.
4. **Given** content already on the editor's clipboard from a previous Edit-mode session,
   **When** the user presses paste in Analysis mode, **Then** no floating paste appears.
5. **Given** a selection made in Analysis mode, **When** the user switches to Edit mode and
   back, **Then** the same selection is still active.
6. **Given** a running simulation, **When** the user enters Analysis mode, **Then** the
   simulation pauses, and **When** they leave, **Then** the previous run state is restored.
7. **Given** Analysis mode, **When** the user inspects the toolbar, **Then** it offers analysis
   tools only — no drawing tool, colour, bus width or rotation control is present.

---

### User Story 2 - Read the selection as a schematic (Priority: P1)

The user selects a region and asks to see it as a schematic. Instead of pixels, they get a
conventional circuit diagram: one symbol per gate, wires drawn as connections between them,
inputs entering from one side and outputs leaving from the other. Signal flow reads in a
consistent direction. Feedback — a connection that runs back against that flow — is drawn so
that it is obviously feedback and not an ordinary wire.

**Why this priority**: this is the capability that turns a bitmap into something a person can
reason about, and it is the one the user named most concretely. Critically it has **no
input-count limit**: it describes structure, not behaviour, so it works on exactly the parts
of the CPU that truth tables must refuse.

**Independent Test**: select a region containing a known gate arrangement; the schematic
contains exactly the gates and connections the netlist reports, and the same region drawn
twice produces the same diagram.

**Acceptance Scenarios**:

1. **Given** a selection containing gates, **When** the faithful view is shown, **Then** it
   contains exactly one symbol per gate and one connection per driver-to-net relationship,
   matching the netlist's counts exactly.
1a. **Given** a net driven by two or more inverters, **When** the recognised view is shown,
   **Then** it is drawn as a single NAND of those inverters' sources.
1b. **Given** a recognised gate symbol, **When** its behaviour is compared against the gates it
   replaced, **Then** the two agree for every input combination; a symbol that fails this is
   never shown, and the underlying gates are drawn faithfully instead.
1c. **Given** a schematic, **When** the user switches between the recognised and faithful
   views, **Then** both describe the same selection and the switch does not require re-analysis.
2. **Given** a selection whose signals flow left to right, **When** the schematic is produced,
   **Then** inputs appear on one edge, outputs on the opposite edge, and gates in between.
3. **Given** a selection containing a feedback loop, **When** the schematic is produced,
   **Then** the connections that close the loop are visually distinguished from forward ones.
4. **Given** a selection containing a crossover, **When** the schematic is produced, **Then**
   the two signals are shown crossing without joining.
5. **Given** a schematic, **When** the user points at a symbol or connection, **Then** the
   corresponding pixels are highlighted on the circuit, and vice versa.
6. **Given** a selection of at least 250 gates, **When** the schematic is requested, **Then**
   it is produced without refusing on size.
7. **Given** the same unchanged selection, **When** the schematic is produced twice, **Then**
   the two diagrams are identical.
8. **Given** a displayed schematic, **When** the circuit changes underneath it, **Then** the
   schematic is marked as no longer describing the current circuit.
9. **Given** a schematic on the stage, **When** the user switches back to the pixel view and
   returns, **Then** both views are where they were left, each at its own zoom and position.

---

### User Story 3 - Name what you are looking at (Priority: P2)

The selection's nets and gates are listed, grouped as inputs, outputs and internal. Each entry
says where it is and what it is. The user can give any of them a meaningful name — `clk`,
`reset`, `AX.bit0` — and from then on that name is used everywhere the item appears: in the
list, in the schematic, in expressions, in truth tables and in discrepancy reports.

**Why this priority**: without names, every finding is expressed in coordinates, and a report
saying `n279@542,634 disagrees` is one the user must decode by hand every time. Names are what
make the other tools' output readable, so this raises the value of everything else — but each
of those tools is useful before it, which is why it is P2 rather than P1.

**Independent Test**: name a net, then confirm the name replaces its coordinates in every view
that mentions it.

**Acceptance Scenarios**:

1. **Given** an analysed selection, **When** the user opens the netlist list, **Then** inputs,
   outputs and internal nets are shown in labelled groups with their locations, and each gate
   is identified with its direction.
2. **Given** a net in the list, **When** the user gives it a name, **Then** that name replaces
   its default identifier everywhere it appears.
3. **Given** a named net, **When** the user selects an overlapping region and analyses it
   again, **Then** the name is still applied to the same physical net.
4. **Given** a named net, **When** the user clears the name, **Then** the default identifier
   returns.
5. **Given** a list entry, **When** the user points at it, **Then** the corresponding pixels
   are highlighted on the circuit.
6. **Given** names applied to a circuit, **When** the netlist is exported, **Then** the names
   travel with it, and re-importing restores them.
7. **Given** names applied to a circuit, **When** the sidecar label file is saved and the
   circuit's image is then edited and saved by an external paint program, **Then** reopening
   the circuit restores the names.
8. **Given** a sidecar file that disagrees with the browser's working copy, **When** the circuit
   is opened, **Then** the user is told and chooses which to keep.

---

### User Story 4 - Understand circuits that remember (Priority: P2)

The selection contains storage — a latch, a register bit, a row of them. The analyser says so
in those terms: here is a storage element, here is what holds its value, here is what writes
to it, and here is what it currently holds. Crucially it also reports whether the element has
a **defined state at power-on**, and says plainly when it does not.

**Why this priority**: the user named memory explicitly, and it is where the existing tools are
weakest — they report "19 state variables" where the user needs "four register bits and a
write-enable". The power-on question is included because this session established it as a real,
measured defect class: a storage loop in the 4-bit CPU settles into a valid state only when the
engine's analog jitter happens to break a symmetry, and from a cold start it failed to settle in
9 of 12 runs. The existing oracle cannot see this, because it seeds a consistent state before
releasing the circuit — it answers "does this hold and compute correctly", never "does this
start correctly". Reporting such a circuit as working would be a serious false negative.

**Independent Test**: analyse a known latch; it is reported as one storage element with a
defined hold behaviour. Analyse the 4-bit CPU's six-inverter storage loop; it is reported as
storage whose power-on state is undefined.

**Acceptance Scenarios**:

1. **Given** a selection containing a feedback loop that holds a value, **When** it is
   analysed, **Then** it is reported as a storage element rather than as a list of
   feedback nets.
2. **Given** a storage element, **When** it is reported, **Then** the report names the nets
   that hold its value and the nets that can change it.
3. **Given** a storage element whose value is determined at power-on, **When** it is analysed,
   **Then** the report says the initial state is defined and what it is.
4. **Given** a storage element whose value is **not** determined at power-on, **When** it is
   analysed, **Then** the report says the initial state is undefined, and says how many of the
   possible rest states the circuit may settle into.
5. **Given** a storage element that fails to settle at all from a cold start, **When** it is
   analysed, **Then** the report says so and does not present a held value.
6. **Given** several storage elements that share control signals, **When** they are analysed,
   **Then** they are reported as a group rather than as unrelated elements.
7. **Given** a selection with more state than can be enumerated exhaustively, **When** it is
   analysed, **Then** the structural findings are still reported and any sampled finding is
   labelled as sampled.

---

### User Story 5 - Understand circuits driven by a clock (Priority: P3)

The selection is synchronous: something acts as a clock, and the circuit's behaviour is defined
per clock edge rather than by settling. The user identifies the clock (or accepts the
analyser's suggestion), and the analyser then describes the circuit edge by edge: what the
state is before the edge, what it becomes after, and what the outputs do.

**Why this priority**: the user named it explicitly, and it is what makes the CPU's control
path describable. It is P3 because it builds directly on US4's storage model, and because a
clocked circuit can still be read usefully through US2 and US3 before this exists.

**Independent Test**: designate a clock net on a known clocked circuit and step it; the
reported state sequence matches the circuit's intended behaviour.

**Acceptance Scenarios**:

1. **Given** a selection containing a net that behaves like a clock, **When** it is analysed,
   **Then** a ranked list of clock candidates is offered, each with the reason it was chosen.
1a. **Given** clock candidates, **When** the inputs are listed or drawn, **Then** the leading
   candidate is visually distinguished from the other inputs, so the clock can be picked out at
   a glance rather than read for.
1b. **Given** a selection containing a net that oscillates on its own, **When** candidates are
   ranked, **Then** that net is offered with its observed period.
1c. **Given** a selection whose clock is a free input driven from outside, **When** candidates
   are ranked, **Then** that input is offered on the strength of how many storage elements it
   reaches.
2. **Given** a suggested clock, **When** the user designates a different net instead,
   **Then** the analysis uses the user's choice.
3. **Given** a designated clock, **When** the circuit is analysed, **Then** the result is a
   sequence of states across clock edges rather than a single settled value.
4. **Given** a designated clock, **When** the user steps forward one edge, **Then** the
   reported state advances by exactly one edge and the change is shown.
5. **Given** a clocked circuit whose behaviour differs between two runs of the same edge
   sequence, **When** it is analysed, **Then** the report says the behaviour is not repeatable
   rather than presenting one of the results as the answer.
6. **Given** a selection with no net that behaves like a clock, **When** it is analysed,
   **Then** the analyser says so rather than choosing one arbitrarily.

---

### Edge Cases

- **A selection with no gates.** Reported as wiring, with the schematic showing the nets and no
  symbols — not an error.
- **A selection containing nothing at all.** Refused with a reason, before any work starts.
- **A selection cut through the middle of a gate.** The severed nets are reported as cut and
  treated as free inputs, and the schematic shows them entering from the boundary.
- **A selection larger than can be drawn legibly.** The schematic is still produced; the view
  must allow the user to navigate it rather than refusing or silently truncating.
- **A circuit that never settles.** No value is reported for it. This already holds for truth
  tables and must hold for every new view: a circuit that keeps changing has no steady-state
  answer, and inventing one hides the finding.
- **The circuit changes while a result is on screen.** Every view derived from a selection is
  marked stale, not silently left describing a circuit that no longer exists.
- **Names pointing at nets that no longer exist** after an edit. The name is kept and reported
  as unresolved rather than silently deleted or silently reattached to a different net.
- **A clock designated on a net that is driven by a gate.** Accepted, but the report must state
  that the clock is internally generated rather than free.
- **Two storage elements sharing a net.** Reported as sharing, not double-counted.
- **Entering Analysis mode with a floating paste in progress in Edit mode.** The paste must be
  resolved or cancelled first; a pending write may not survive into a read-only mode.

## Requirements *(mandatory)*

### Functional Requirements — the mode

- **FR-001**: The application MUST offer three modes — Simulate, Edit and Analysis — and make
  the current one visible at all times.
- **FR-002**: Analysis mode MUST NOT permit any change to the document. No gesture, key or
  control available in the mode may alter a pixel, the undo history or the unsaved-changes
  state.
- **FR-003**: Analysis mode MUST provide region selection, and that selection MUST behave
  identically to the existing one for creating, adjusting and clearing.
- **FR-004**: Analysis mode MUST NOT provide copy, cut, delete or paste, and the shortcuts for
  those actions MUST do nothing while it is active.
- **FR-005**: The selection MUST be shared across modes, so a region chosen in one mode is
  still chosen in another.
- **FR-006**: Entering Analysis mode MUST pause the simulation, and leaving it MUST restore the
  previous run state.
- **FR-007**: The meaning of every key in Analysis mode MUST be decided in the same single place
  that decides it for the other modes, and MUST be exhaustively verifiable.
- **FR-008**: Analysis MUST be reachable only from Analysis mode; the Edit-mode entry point is
  removed.
- **FR-009**: Where analysis produces something that would modify the circuit — such as an
  offered replacement — Analysis mode MUST NOT apply it. It MUST hand it to Edit mode through
  an explicit, user-initiated switch, after which the existing paste mechanism applies it.
- **FR-010**: Adding a further analysis tool MUST require no change to mode switching, key
  handling or selection behaviour — demonstrated by the fact that this feature adds more than
  one tool to the mode and none of the three changes between them.

### Functional Requirements — the schematic view

- **FR-011**: The system MUST render a selected region as a gate-level diagram, offering two
  levels of detail that describe the same selection and can be switched between without
  re-analysis.
- **FR-011a**: The **faithful** view MUST draw one symbol per gate and one connection per
  driver-to-net relationship, with wired-OR shown as a junction. It is the ground truth against
  which the other view is checked.
- **FR-011b**: The **recognised** view MUST draw standard gate symbols — at minimum NOT, NAND,
  NOR, AND and OR — inferred from inverter and wired-OR patterns, and MUST fall back to
  faithful symbols wherever no pattern matches.
- **FR-011c**: Every recognised symbol MUST be verified to compute the same function as the
  gates it replaces before it is shown. A symbol that fails MUST NOT be drawn; the underlying
  gates are drawn faithfully instead.
- **FR-011d**: The recognised view MUST NOT change what the circuit is understood to do. It is a
  way of reading the same netlist, never a simplification of it.
- **FR-012**: The diagram MUST place inputs and outputs on opposite edges and arrange gates so
  that signal flow reads in one consistent direction.
- **FR-013**: The diagram MUST visually distinguish connections that close a feedback loop from
  those that carry signal forward.
- **FR-014**: The diagram MUST show crossovers as signals that cross without joining.
- **FR-015**: The faithful diagram MUST agree with the netlist exactly on the number of gates,
  nets, inputs and outputs; a diagram that does not MUST NOT be shown.
- **FR-015a**: The recognised diagram MUST account for every gate in the netlist — each gate is
  either drawn or absorbed into exactly one recognised symbol, and none is dropped or counted
  twice.
- **FR-016**: The diagram MUST be deterministic — the same unchanged selection produces the same
  diagram every time.
- **FR-017**: The schematic MUST occupy the main stage, with Analysis mode offering a switch
  between the pixel view and the schematic view of the same selection. Each view keeps its own
  zoom and pan, and switching MUST NOT lose either.
- **FR-017a**: The system MUST support navigating a diagram too large to fit on screen.
- **FR-018**: Pointing at an element of the diagram MUST highlight the corresponding pixels of
  the circuit, and pointing at the circuit MUST highlight the corresponding diagram element.
- **FR-019**: The diagram MUST be produced for selections far beyond the truth-table input
  limit, since it describes structure rather than behaviour.

### Functional Requirements — the netlist view and labels

- **FR-020**: The system MUST list a selection's nets grouped as inputs, outputs, internal and
  cut, and list its gates with direction and location.
- **FR-021**: Users MUST be able to assign a name to any net or gate, and to clear it.
- **FR-022**: An assigned name MUST be used in place of the default identifier in every view
  that mentions that item.
- **FR-023**: Names MUST survive re-analysis of an overlapping region, remaining attached to the
  same physical net.
- **FR-024**: Names MUST be storable in a sidecar file beside the circuit, named after it
  (for example `4bitCPU.labels.json` next to `4bitCPU.png`), and MUST be restored when that
  circuit is opened again.
- **FR-024a**: Names MUST also be held in browser storage as a working copy, so that names
  survive a reload without requiring an explicit save, and so that naming still works where the
  browser cannot write files.
- **FR-024b**: Where the working copy and the sidecar file disagree, the system MUST say so and
  let the user choose, rather than silently preferring either.
- **FR-024c**: Names MUST NOT be written into the circuit image — neither into its pixels nor
  into its metadata. Pixels are the circuit, and image metadata does not survive an ordinary
  re-save by an external editor, which is how circuits in this project are routinely edited.
- **FR-025**: A name whose target no longer exists MUST be reported as unresolved rather than
  discarded or reattached.
- **FR-026**: Names MUST be included in netlist export and restored on import.

### Functional Requirements — feedback, memory and clocks

- **FR-027**: The system MUST identify storage elements in a selection and report them as
  storage, naming the nets that hold each value and the nets that can change it.
- **FR-027a**: A storage element is a group of nets and gates that is mutually reachable
  through feedback and that has more than one state it can rest in. A feedback group with
  exactly one rest state is not storage — it settles — and MUST NOT be reported as such.
- **FR-028**: The system MUST report whether each storage element has a defined state at
  power-on, and MUST say explicitly when it does not.
- **FR-029**: Where a power-on state is undefined, the system MUST report how many rest states
  the element may settle into.
- **FR-029a**: Power-on state MUST be determined by cold-starting the selection repeatedly and
  observing where it lands, never from a single run. A state is reported as **defined** only if
  every run reaches the same one; if runs disagree, it is **undefined** and the observed
  distribution is reported; if runs fail to settle, that count is reported separately.
- **FR-029b**: The number of cold starts MUST be stated alongside the result, so that a finding
  of "defined" is understood as "defined across N starts" rather than as a proof.
- **FR-030**: Where a circuit fails to settle from a cold start, the system MUST report that and
  MUST NOT present a held value.
- **FR-031**: The system MUST distinguish "holds and computes correctly once started" from
  "starts correctly", and MUST NOT let a pass on the first imply a pass on the second.
- **FR-032**: The system MUST group storage elements that share control signals rather than
  reporting them as unrelated.
- **FR-033**: The system MUST allow a net to be designated as a clock.
- **FR-033a**: The system MUST offer a ranked list of clock candidates, each accompanied by the
  reason it was chosen, and MUST NOT select one silently.
- **FR-033b**: Candidate detection MUST combine a behavioural signal — nets that oscillate with
  a stable period when the inputs are held steady — with a structural one — free inputs that
  fan out to many storage elements — because neither alone covers both a generated clock and a
  hand-pulsed one.

- Q: How should gates be drawn in the schematic, given that several inverters driving one net
  already constitute a NAND? → A: Two levels, switchable. The default recognises standard gates
  — NAND, NOR, AND, OR, NOT — from inverter and wired-OR patterns, each verified against the
  netlist before it is shown. A toggle drops to a faithful one-symbol-per-gate view, which is
  the ground truth to check against when a recognised symbol looks wrong. Recognition alone was
  rejected because a surprising symbol would then have no lower-level view to check it against;
  a faithful view alone was rejected because 241 inverter triangles leave the reader to do the
  very work the feature exists to do.
- **FR-033c**: Where a candidate is found by oscillation, the system MUST report its observed
  period.
- **FR-033d**: The leading clock candidate MUST be visually distinguished from the other inputs
  wherever inputs are listed or drawn, so that it can be identified at a glance.
- **FR-033e**: Where a candidate is indistinguishable from a reset or enable line on the
  structural signal alone, the system MUST present them together as equally ranked rather than
  choosing between them.
- **FR-034**: With a clock designated, the system MUST describe behaviour as a sequence of
  states across clock edges, and MUST allow stepping one edge at a time.
- **FR-035**: The system MUST report when a clocked circuit's behaviour is not repeatable across
  identical runs, rather than presenting one run's result as the answer.
- **FR-036**: Where a capability is bounded, the system MUST state the bound and refuse before
  starting work rather than part way through; where a result is sampled rather than exhaustive,
  it MUST be labelled as sampled.
- **FR-037**: Every result derived from a selection MUST be marked stale when the circuit
  changes.

### Key Entities

- **Mode**: which of Simulate, Edit or Analysis is active. Determines what every input means and
  whether the document can change.
- **Analysis Selection**: the region under study. Shared with the other modes, but in Analysis
  mode it is a question, not a target for edits.
- **Schematic**: a diagram derived from a selection — symbols for gates, connections for nets,
  a layout, and a two-way correspondence with the pixels it came from.
- **Label**: a user-supplied name bound to a physical net or gate, independent of any one
  analysis run, and resolvable to "missing" when the circuit no longer contains its target.
- **Storage Element**: a group of nets and gates that holds a value, together with what writes
  it, what it holds, and whether its power-on value is defined.
- **Clock**: a net designated as the timing reference, against which state sequences are
  described.
- **Finding**: anything the analyser reports, carrying whether it is exhaustive or sampled, and
  whether it is still current.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In Analysis mode, no input changes the document — demonstrated by exercising every
  key in the application's key table and every pointer gesture, with the unsaved-changes flag
  and undo depth unchanged throughout.
- **SC-002**: A selection of at least 250 gates is rendered as a schematic in under 2 seconds.
- **SC-003**: For every bundled schematic, the faithful diagram's gate, net, input and output
  counts match the netlist's exactly.
- **SC-003a**: In the recognised diagram, every gate in the netlist is accounted for exactly
  once — drawn, or absorbed into one symbol.
- **SC-003b**: Every recognised symbol computes the same function as the gates it replaced, on
  every input combination, checked before it is shown.
- **SC-003c**: For a selection of at least 250 gates, the recognised view uses measurably fewer
  symbols than the faithful view, so the recognition earns the reading it is there to provide.
- **SC-004**: A user can find a specific named signal in a 200-gate schematic within 15 seconds.
- **SC-005**: 100% of feedback connections in a diagram are visually distinguishable from
  forward connections.
- **SC-006**: A name given to a net appears in place of its coordinates in every view that
  mentions it, and survives a reload of the same circuit.
- **SC-007**: Across 20 cold starts of the 4-bit CPU's six-inverter storage loop, the analyser
  reports storage with an **undefined** power-on state and names both rest states — the case that a settle-based
  analysis alone reports as healthy.
- **SC-008**: For a circuit with a designated clock, stepping N edges produces exactly N state
  transitions, each showing what changed.
- **SC-008a**: For a selection containing a free-running oscillator, that net is among the
  offered clock candidates, with its period reported.
- **SC-008b**: The leading clock candidate is distinguishable from the other inputs without
  reading any text.
- **SC-009**: Schematic and netlist views succeed on a selection of 241 gates, 180 nets and 19
  state variables — far beyond the 16-input truth-table limit — without refusing on size.
- **SC-010**: No action taken in Analysis mode writes to the document; applying a suggested
  replacement requires an explicit switch to Edit mode.
- **SC-011**: Switching between the pixel and schematic views preserves each view's zoom and
  position, so neither is re-found by hand on every switch.
- **SC-012**: Names given to a circuit are still present after closing and reopening the
  browser, and are carried by a netlist export/import round trip.
- **SC-012a**: Names survive editing the circuit's `.png` in an external image editor and
  reloading it — the case that storing them inside the image would lose.
- **SC-013**: Every capability that is bounded states its bound, and refuses before starting
  rather than part way through.

## Assumptions

- **Analysis works on its own compiled copy of the selection**, as it does today, so a running
  or paused simulation can never corrupt a result, and analysis can never disturb the live
  circuit.
- **The existing analysis machinery is reused, not rebuilt.** Netlist extraction, expressions,
  truth tables, the differential oracle, feedback analysis and minimisation all move into the
  new mode as they stand.
- **Gate recognition is a reading of the netlist, not a rewrite of it.** The medium has one
  gate, the inverter, and gets every other function from the wired-OR that happens when several
  gates drive one net. Recognition names those combinations; it never changes them, and it is
  distinct from the minimisation in feature 003, which does change the circuit.
- **The netlist remains the single source of structural truth.** The schematic is derived from
  it and must agree with it; it is never derived from the pixels independently.
- **Labels are anchored to a pixel location rather than to a net identifier**, because net
  identifiers are assigned per compile and change when the circuit is edited, whereas a
  position remains meaningful. A label is resolved by asking which net currently occupies its
  anchor.
- **Labels are stored in a sidecar `*.labels.json`, with a browser working copy** (decided).
  The sidecar is the portable record: it commits to git, follows the project to another machine,
  and is unaffected by editing the `.png` in any paint program. The browser copy is the
  everyday convenience, so names are never lost merely because a save was forgotten.
- **Writing the sidecar in place requires the same browser support that saving the circuit
  already requires**; elsewhere it is offered as a download, exactly as the PNG save is. This is
  an accepted, already-understood limitation rather than a new one.
- **Image metadata was considered and rejected on evidence.** A text chunk written into a PNG is
  silently dropped by an ordinary open-modify-save round trip, which is precisely the workflow
  live reload is built around. The app also encodes through a canvas, which cannot emit custom
  chunks without hand-splicing them.
- **The schematic occupies the main stage** (decided), switched against the pixel view rather
  than shown beside it. A 241-gate diagram needs the width, and cross-highlighting on hover
  covers the case that a side-by-side layout would have served.
- **A clock is designated by the user**, with the analyser offering ranked candidates and its
  reasons. Automatic detection alone is not assumed to be reliable enough to be trusted
  silently — the structural signal in particular cannot distinguish a clock from a reset line,
  since both reach every storage element.
- **The idiomatic clock in this medium is a ring oscillator** — an odd-length loop of inverters,
  which free-runs. That is why a behavioural signal is required and not merely nice to have: a
  purely structural search would miss the most common case entirely.
- **"Handling" a clocked circuit means describing its behaviour per edge**, not reproducing
  real-world timing. There is no notion of propagation delay in this medium beyond the engine's
  own ramp.
- **Truth tables keep their 16-input limit.** Structural views (schematic, netlist, storage
  identification) are not bounded by it and must scale well past it.
- **Power-on analysis means cold-starting the compiled selection repeatedly** and observing
  where it lands, because the engine re-randomises gate evaluation order and its jitter table on
  every compile. A single run cannot establish that a power-on state is defined. The default is
  20 cold starts, chosen because the known failure in the 4-bit CPU appeared in roughly three
  runs in four — a handful of starts would find it, and twenty makes a rarer split visible
  without making the check slow. This is a sampling method and is reported as one: "defined
  across 20 starts" is evidence, not proof, and the spec requires it to be worded that way.
- **A storage element is a feedback group with more than one rest state.** Feedback alone is not
  memory: a loop that settles to one state every time is just a circuit with a loop in it.
  This distinction is what lets the report say "four register bits" instead of "19 state
  variables".
- **Existing verified behaviour is preserved**: the editor's tools, key precedence, paste
  mechanism and the 003 analysis results all continue to work unchanged.
- **Constitution constraints continue to hold**: no framework, no bundler, no runtime
  dependency, client-side only.

## Out of Scope

- Editing a circuit through the schematic view. The schematic is a way of reading the circuit;
  the pixels remain the only representation that can be changed.
- Importing or displaying schematics from other tools.
- Modelling propagation delay, setup and hold times, or any electrical behaviour beyond what the
  simulation engine itself implements.
- Changing the simulation engine in any way.
- Automatic recognition of higher-level structures such as adders, decoders or ALUs by name.
