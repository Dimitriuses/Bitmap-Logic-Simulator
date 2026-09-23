# Feature Specification: Circuit Analysis

**Feature Branch**: `003-circuit-analysis`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: adapt the functionality of the LogicShorter Python project — a
circuit analyser and simplifier for BmpLogicSim schematics — into this project. Also: the
AX register in `projects/CPU/4bitCPU.png` works only partially, and it is not yet known
whether the fault is in the circuit or in the simulator. The analysis tool should help
settle that.

## Context

[LogicShorter](file:///D:/Documents/Projects/GitRepositories/noGitRepositories/Python/LogicShorter)
reads a BmpLogicSim bitmap, extracts wire nets and NOT gates, breaks feedback loops, builds
a boolean expression per output, simplifies it with sympy, costs the result in NOT gates,
and writes a simplified bitmap back out.

It was read before this spec was written, and measured. Four findings shape everything
below.

**1. The extraction half already exists here, and the two agree.** `build_wire_nets` is
union-find over horizontal runs; `find_not_gates` matches a 3×3 pattern in four rotations
whose base case is byte-identical to our `down` stamp; `find_io_nets` defines an input as a
net no gate drives — the same rule our click-to-drive interaction already depends on. Run
against the same files, the two implementations produce identical netlists:

| File | LogicShorter | This engine | |
| --- | --- | --- | --- |
| `circuit2.bmp` | 20 nets / 28 gates | 20 wires / 28 gates | **match** |
| `circuit3_test.bmp` | 10 nets / 13 gates | 10 wires / 13 gates | **match** |

That is two independent implementations agreeing exactly, which removes the extraction step
from the risk register. This feature builds on `Circuit`, not on a port of that Python.

**2. Three of its five fixtures are not trustworthy.** For the 1-bit BMPs, LogicShorter's
hand-written reader and a reference decoder disagree on the *pixels* themselves:

| File | Mode | Their wire pixels | Reference | |
| --- | --- | --- | --- | --- |
| `circuit.bmp` | 1-bit | 696 | 100 | differ |
| `test1.bmp` | 1-bit | 170 | 38 | differ |
| `test2.bmp` | 1-bit | 237 | 29 | differ |
| `circuit2.bmp` | palette | 467 | 467 | match |
| `circuit3_test.bmp` | palette | 154 | 154 | match |

So the netlists and simplification results derived from those three files describe bitmaps
that were misread, most likely a row-padding or palette bug in the 1-bit path. Only the two
palette-mode fixtures are usable as reference cases.

**3. What is genuinely worth adapting** is the analysis, not the plumbing: feedback-vertex-set
cycle breaking to turn a sequential circuit into next-state functions, expression
construction, and — the most valuable piece — a cost model that counts an expression in
*this* medium, where the only gate is an inverter and wired-OR is free.

**4. The scale ceiling is low and has to be designed around.** The largest circuit
LogicShorter has processed is 46 gates with 3 inputs. This project's examples run to 1,497
(counter), 11,515 (Enigma2) and 45,004 gates (Flash Memory). Two independent exponential
walls cause this: enumerating every simple cycle to choose a feedback vertex set, and
minimising a boolean function in the number of inputs. Analysis is therefore something you
point at a **selection**, never at a whole schematic — which is precisely what the selection
tool from [002](../002-editor-workflow/spec.md) provides.

### The motivating defect

The AX register in `projects/CPU/4bitCPU.png` works only partially. The schematic carries a
scratch area at rows 565–754 holding a duplicate of the circuit and a simplified version of
it; the same circuit exists in LogicShorter as `circuit2_simplified_reconstructed.bmp`.

Nobody yet knows whether the circuit is wrong or the simulator is. That question has a
precise shape, and answering it is a first-class story below (US2): derive what the circuit
*should* do from its netlist, run the simulator to see what it *does*, and compare. If they
disagree, the fault is in the simulator or in the extraction; if they agree, the circuit
does not do what its author expected.

One caution already visible: `circuit2_simplified.json` reports the circuit reduced from 28
gates to 10, but `circuit2_simplified_reconstructed.bmp` compiles to **25** gates. Either
the reported figure is a cost estimate rather than a realised count, or the reconstruction
is not the circuit the simplifier described. Any "replace with the simplified version"
feature here must therefore be verified by equivalence, not trusted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what a piece of circuit actually computes (Priority: P1)

A user selects a region, asks what it does, and gets back the inputs it depends on, the
outputs it drives, and a truth table — the thing that is impossible to read off a bitmap by
eye.

**Why this priority**: Everything else in this feature is built on the extracted function.
It is also useful on its own: "what does this block compute" is the question you have while
staring at a 1024×1024 schematic.

**Independent Test**: Select a region containing a known gate arrangement and confirm the
reported truth table matches the gate's definition.

**Acceptance Scenarios**:

1. **Given** a selected region, **When** the user runs analysis, **Then** the nets entering, leaving and contained by the selection are identified and reported separately.
2. **Given** a combinational selection with N inputs, **When** analysis completes, **Then** a truth table of 2^N rows is produced, and the boolean expression for each output is shown.
3. **Given** a selection with more inputs than the tool can enumerate, **When** the user runs analysis, **Then** it declines with the input count and the limit, rather than hanging.
4. **Given** a selection containing no gates, **When** analysis runs, **Then** it reports the region as pure wiring and names the nets that pass through it.

---

### User Story 2 - Settle whether the circuit or the simulator is wrong (Priority: P1)

A user suspects a sub-circuit misbehaves. They select it and ask the tool to check the
simulator against the logic. The tool derives the expected behaviour from the netlist,
drives the real simulator through every input combination, and reports any row where the two
disagree — with the exact inputs that trigger it.

**Why this priority**: This is the reason the feature was asked for. It is also the only
capability here that cannot be obtained any other way: the original Delphi program is the
reference, and it is not runnable headlessly, so a second independent model of the circuit is
the only available oracle. The AX register defect is the first thing it will be pointed at.

**Independent Test**: Take a circuit whose behaviour is known — a single inverter with stubs
— and confirm the tool reports agreement. Then deliberately corrupt the expected value and
confirm it reports the disagreeing row.

**Acceptance Scenarios**:

1. **Given** a combinational selection, **When** the user runs the check, **Then** every input combination is applied to the real simulator, allowed to settle, and compared against the analytically derived output.
2. **Given** a disagreement, **When** it is reported, **Then** the report names the input combination, the expected output and the observed output, so it can be reproduced by hand.
3. **Given** agreement across all combinations, **When** the check completes, **Then** it says so explicitly, because "the simulator is fine, your circuit does what it says" is the more likely answer and must be stated as a result rather than as silence.
4. **Given** a circuit that never settles — a ring oscillator — **When** the check runs, **Then** it reports non-convergence for that input combination rather than reporting a wrong value.
5. **Given** the analysis and the simulator disagree, **When** the user asks, **Then** the tool reports which nets the discrepancy propagates from, narrowing the search.

---

### User Story 3 - Find out whether it could be smaller (Priority: P2)

Having extracted the function, the user asks for a simplified equivalent and is told what it
would cost — in inverters, the only gate this medium has.

**Why this priority**: The original project's purpose, and genuinely useful for a hand-drawn
CPU where every gate is pixels someone placed. It is P2 because knowing what a circuit does
(US1) and whether it is correct (US2) both matter more than knowing it could be smaller.

**Independent Test**: Analyse a deliberately redundant circuit — a doubled inverter pair —
and confirm the simplified form is reported as cheaper, with the cost difference shown.

**Acceptance Scenarios**:

1. **Given** an analysed selection, **When** the user requests simplification, **Then** a minimised expression per output is produced along with its cost in inverters.
2. **Given** a simplified result, **When** it is shown, **Then** the original and simplified gate counts are both given, so the saving is visible.
3. **Given** a circuit already minimal, **When** simplification runs, **Then** it says so rather than presenting an equal-cost alternative as an improvement.
4. **Given** any simplified expression, **When** it is produced, **Then** it is verified against the original truth table before being offered, because a simplifier that is wrong is worse than no simplifier.

---

### User Story 4 - Put the simplified circuit back (Priority: P2)

The user accepts a simplification, and the tool lays out the replacement as a floating paste
they can position and commit — or reject.

**Why this priority**: Without this the tool is advisory only. It is P2 because the analysis
is valuable before any layout exists, and because laying out a circuit from an expression is
the largest single piece of work in the feature.

**Independent Test**: Simplify a small circuit, commit the replacement, and confirm the
committed region's truth table matches the original's.

**Acceptance Scenarios**:

1. **Given** an accepted simplification, **When** it is placed, **Then** it appears as a floating block using the existing paste mechanism, so it is positioned, previewed and committed exactly like any other paste.
2. **Given** a committed replacement, **When** the region is re-analysed, **Then** its truth table is identical to the original's.
3. **Given** a committed replacement, **When** the user undoes, **Then** the original circuit returns in a single step.
4. **Given** a generated layout, **When** it is compiled, **Then** every gate in it is recognised by the engine — a layout that draws an unrecognised pattern is a failure, not a cosmetic issue.

---

### User Story 5 - Analyse circuits that have memory (Priority: P3)

A selection containing feedback — a latch, a register bit — is reported as sequential, with
its state variables named and its next-state functions given, rather than being refused or
silently mis-analysed.

**Why this priority**: The AX register is sequential, so this is needed for the motivating
defect. It is P3 only because a combinational-only tool is already useful and is the
foundation this builds on.

**Independent Test**: Analyse a known latch and confirm it is reported as sequential with one
state variable, and that the next-state function shows the hold behaviour.

**Acceptance Scenarios**:

1. **Given** a selection whose gate graph contains a cycle, **When** analysis runs, **Then** it is reported as sequential and the nets chosen as state variables are named and locatable on the canvas.
2. **Given** a sequential selection, **When** analysis completes, **Then** a next-state function is given for each state variable and an output function for each output, both in terms of inputs and current state.
3. **Given** a sequential selection, **When** the simulator check of US2 runs, **Then** it compares next-state behaviour over (inputs × state) rather than treating the circuit as combinational.
4. **Given** a selection with more feedback than the tool can handle, **When** analysis runs, **Then** it declines with the reason, rather than enumerating cycles until it hangs.

---

### User Story 6 - Exchange netlists with the Python tool (Priority: P3)

A user exports the selection's netlist as JSON, runs the heavier Python analysis on it, and
imports the result.

**Why this priority**: A hedge. The browser tool will have a hard scale ceiling, and sympy
does not. Exporting a netlist is cheap and keeps the existing Python work usable for
anything too large to analyse in the page.

**Independent Test**: Export a netlist, confirm it round-trips back with the same nets, gates
and I/O classification.

**Acceptance Scenarios**:

1. **Given** a selection, **When** the user exports, **Then** a JSON netlist is produced describing nets, gates and inferred I/O.
2. **Given** an exported netlist, **When** it is re-imported, **Then** the nets, gates and I/O are unchanged.

---

### Edge Cases

- What happens when the selection cuts a gate in half? The partial pattern is not a gate; the tool must say which nets are cut and treat them as boundary inputs rather than silently producing a different circuit.
- What happens when a net crosses the selection boundary? It is a boundary net: driven from outside it is an input, driven from inside and read outside it is an output. Both must be reported, because the analysis is only valid relative to that boundary.
- What happens when a selection has no identifiable outputs? Structural inference — "driven by a gate, feeds no gate" — finds nothing in a circuit whose outputs drive a display that loops back. This is not hypothetical: it reduced one of LogicShorter's own fixtures from 46 gates to zero. The user must be able to mark outputs explicitly.
- What happens when an input net is also driven by a gate inside the selection? It is not an input; treating it as one would fabricate a function the circuit does not compute.
- What happens when the circuit does not settle for some input combination? Report non-convergence for that row.
- What happens when a net inside the selection is driven by several gates? It is their wired-OR, which the analysis must model, because it is how every non-inverter gate in this medium is built.
- What happens when a net is driven by no gate at all? Its value is whatever the user last set, which is exactly the fallback that makes clicking work — the analysis must treat it as a free input, not as a constant.
- What happens when analysis is requested with no selection? Decline and say a selection is required; analysing a 45,004-gate schematic is not a meaningful request.
- What happens if the document is edited while a result is on screen? The result is stale and must be marked as such rather than silently describing a circuit that no longer exists.

## Requirements *(mandatory)*

### Functional Requirements

**Extraction and scope**

- **FR-001**: Analysis MUST operate on a selected region, never implicitly on the whole document.
- **FR-002**: The tool MUST classify every net touching the selection as an input, an output, an internal net or a cut net, and report each.
- **FR-003**: Users MUST be able to override the inferred inputs and outputs, because structural inference alone is demonstrably insufficient.
- **FR-004**: The extraction MUST model the engine's own semantics exactly: a gate's input is the wired-OR of the gates driving its source net, or the net's own state when no gate drives it.
- **FR-005**: The tool MUST refuse, with a stated reason and the relevant number, any selection exceeding its input-count or feedback limits.

**Analysis**

- **FR-006**: For a combinational selection the tool MUST produce a truth table and a boolean expression per output.
- **FR-007**: The tool MUST detect feedback and report the selection as sequential rather than analysing it as combinational.
- **FR-008**: For a sequential selection the tool MUST name its state variables, locate them on the canvas, and give next-state and output functions.

**Checking the simulator (the motivating case)**

- **FR-009**: The tool MUST be able to drive the real simulator through every input combination of an analysed selection and compare the result against the analytically derived value.
- **FR-010**: Any disagreement MUST be reported with the input combination, the expected value and the observed value.
- **FR-011**: Agreement MUST be reported explicitly as a result.
- **FR-012**: An input combination that does not settle MUST be reported as non-convergent, never as a value.

**Simplification**

- **FR-013**: The tool MUST produce a minimised expression per output and cost it in inverters, counting wired-OR as free.
- **FR-014**: A simplified expression MUST be checked against the original truth table before it is offered.
- **FR-015**: Original and simplified costs MUST both be shown.

**Replacement**

- **FR-016**: An accepted simplification MUST be laid out as a circuit and offered through the existing floating-paste mechanism, so it is positioned, committed and undone like any other edit.
- **FR-017**: Every gate in a generated layout MUST be one the engine recognises.
- **FR-018**: A committed replacement MUST be re-analysable, and MUST produce the same truth table as the circuit it replaced.

**Interoperability and lifecycle**

- **FR-019**: The netlist of a selection MUST be exportable as JSON and re-importable without loss.
- **FR-020**: A result MUST be marked stale when the document changes beneath it.
- **FR-021**: No part of this feature may alter simulation semantics.

### Key Entities

- **Netlist**: The nets and gates of a selection, with each net classified as input, output, internal or cut, relative to the selection boundary.
- **TruthTable**: Input combinations mapped to output values, with rows that failed to settle marked as such.
- **BooleanExpr**: A boolean function over named nets — the analytical description of what an output computes.
- **StateVariable**: A net chosen to break a feedback cycle, standing for the circuit's memory, with a next-state function.
- **Cost**: The number of inverters an expression needs in this medium, where wired-OR is free.
- **Discrepancy**: One input combination where the simulator and the analysis disagree, with both values.
- **AnalysisResult**: Everything above for one selection, plus whether it is still current.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single inverter with wire stubs analyses to the inverter truth table, and each of the four gate directions does so correctly.
- **SC-002**: A crossover analyses as two independent nets with no functional relationship between them.
- **SC-003**: A net driven by two gates analyses as their OR, matching the engine's wired-OR rule.
- **SC-004**: For every bundled example small enough to analyse, the analysis and the simulator agree on every input combination — or every disagreement is reported with reproducing inputs.
- **SC-005**: A known latch is reported as sequential with exactly one state variable.
- **SC-006**: Every simplified expression offered is verified equal to the original truth table; none is offered unverified.
- **SC-007**: A committed replacement re-analyses to the same truth table as the circuit it replaced.
- **SC-008**: Analysing a selection at the tool's stated input limit completes within a few seconds; beyond it, the tool declines rather than hanging.
- **SC-009**: An exported netlist re-imports with identical nets, gates and I/O classification.
- **SC-010**: All existing verification continues to pass, and the 22 baseline schematics still compile to their recorded counts.
- **SC-011**: The AX register in `projects/CPU/4bitCPU.png` is analysed, and the outcome is recorded as either a reported simulator discrepancy with reproducing inputs, or a statement that the simulator matches the logic and the circuit does not do what was intended.

## Assumptions

- Simulation semantics stay frozen. This feature reads the circuit; it never changes how pixels are interpreted.
- Analysis is a tool for a selection. There is no expectation that a 45,004-gate schematic can be analysed whole, and the tool should say so plainly rather than trying.
- Boolean analysis models steady-state logic only. The engine's Schmitt-trigger ramp and its jitter — which `CLAUDE.md` records as load-bearing rather than decorative — are deliberately outside the model. A circuit that depends on timing or on race conditions cannot be described by a truth table, and the tool must say so rather than producing a confident wrong answer.
- The clipboard, selection and paste mechanisms from 002 are the interaction substrate; this feature adds analysis, not a second way to select things.
- LogicShorter is treated as a design reference, not as a dependency and not as a source of ground truth. Its two palette-mode fixtures are usable for cross-checking; its three 1-bit fixtures are not.
- The constitution holds: no runtime dependency, no bundler, client-side only. A minimiser has to be written rather than imported.
