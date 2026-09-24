# Bitmap Logic Simulator

A logic simulator where **the picture is the circuit**. Load a PNG and the
pixels *are* the netlist: bright pixels are wires, little `+` shapes are
inverters. Nothing is uploaded — it all runs in the tab.

The simulator itself lives in [`src/`](src): a TypeScript port that runs in the
browser, published to GitHub Pages from the repository root.

It is a reimplementation of the original Delphi/VCL Win32 desktop app,
**Bitmap Logic Simulator** by Zoltán Hetesi, whose `UMain.pas` is the reference
for every simulation rule below. That program is not redistributed here — it is
someone else's work — so you will need to obtain it separately if you want to
compare behaviour against the original.

The schematics live in [`projects/`](projects) and are what the app's **Examples**
menu is built from.

## Running it locally

```sh
npm install
npm run build     # scripts/gen-examples.mjs + tsc  ->  dist/
npm run serve     # python -m http.server 8000, from the repository root
# open http://localhost:8000
```

`npm start` does the build and the server in one go, and `npm run watch` keeps
`tsc` recompiling while you work.

`npm run verify` checks the engine without a browser: it compiles all 22
schematics and compares them against a recorded baseline, then confirms every
gate stamp the editor can place is one the simulator actually recognises.

Serving over HTTP (rather than opening `index.html` off disk) is required:
browsers will not let a page read pixels back out of a `file://` image, which is
exactly what the simulator needs to do. Drag-and-drop still works either way.

## Layout

```
index.html          the app shell
css/style.css
src/*.ts            TypeScript source
dist/               build output — generated, not committed
projects/           the schematics, grouped into folders
scripts/            build helpers
```

| Module | What it does |
| --- | --- |
| [`src/simulator.ts`](src/simulator.ts) | The engine: wire extraction, gate detection, simulation, rendering. The port of `UMain.pas`. |
| [`src/renderer.ts`](src/renderer.ts) | Viewport maths and canvas presentation. |
| [`src/fileHandler.ts`](src/fileHandler.ts) | Decoding PNGs, the examples manifest, and live reload. |
| [`src/document.ts`](src/document.ts) | The editable circuit. Owns the source pixels and undo history; a `Circuit` is compiled *from* it. |
| [`src/editor.ts`](src/editor.ts) + [`src/tools/`](src/tools) | Drawing mode, the six tools, and pointer routing. |
| [`src/stamps.ts`](src/stamps.ts) | The five 3×3 gate/crossover patterns, transcribed from the engine. |
| [`src/geometry.ts`](src/geometry.ts) | Connected rasterisation and bus spacing — what makes drawn wires conduct. |
| [`src/block.ts`](src/block.ts) + [`src/clipboard.ts`](src/clipboard.ts) | Selection, the clipboard and the floating paste. |
| [`src/keymap.ts`](src/keymap.ts) | The one place a key decides what it means. |
| [`src/palette.ts`](src/palette.ts) | The 16 default colours and any custom ones. |
| [`src/png.ts`](src/png.ts) | Encoding a circuit back to a PNG, and saving it. |
| [`src/netlist.ts`](src/netlist.ts) | What a selection contains, in engine terms. Refuses rather than disagree with the engine. |
| [`src/boolean.ts`](src/boolean.ts) | Expressions and truth tables, derived from the netlist alone. |
| [`src/oracle.ts`](src/oracle.ts) | Drives the real engine through every combination and diffs it against the logic. |
| [`src/sequential.ts`](src/sequential.ts) | Feedback: strongly connected components, state variables, next-state functions. |
| [`src/minimise.ts`](src/minimise.ts) + [`src/cost.ts`](src/cost.ts) | Quine–McCluskey, and what a circuit costs when the only gate is an inverter. |
| [`src/layout.ts`](src/layout.ts) | Turns an expression back into pixels — and proves the pixels before offering them. |
| [`src/netlist-json.ts`](src/netlist-json.ts) | Netlist interchange with the Python tool. |
| [`src/analysis.ts`](src/analysis.ts) + [`src/analysis-panel.ts`](src/analysis-panel.ts) | Orchestration, and the panel that presents it. |
| [`src/gates.ts`](src/gates.ts) | Reads NAND/NOR/AND/OR/NOT out of a netlist of inverters, and verifies each symbol before offering it. |
| [`src/graph-layout.ts`](src/graph-layout.ts) | Layered graph layout: break cycles, assign layers, reduce crossings. Deterministic by construction. |
| [`src/schematic.ts`](src/schematic.ts) + [`src/schematic-view.ts`](src/schematic-view.ts) | The diagram model, and drawing it with its own camera. |
| [`src/storage-elements.ts`](src/storage-elements.ts) | What remembers, and whether it starts from a known value. |
| [`src/clock.ts`](src/clock.ts) | Clock candidates, from period and from fan-out; stepping by edge. |
| [`src/labels.ts`](src/labels.ts) | Names anchored to pixels, with a sidecar file and a browser working copy. |
| [`src/ui.ts`](src/ui.ts) | Controls, input handling, frame loop. |
| [`src/main.ts`](src/main.ts) | Entry point; the only module `index.html` loads. |

The build is plain `tsc` — no bundler, no runtime dependencies. Each module
compiles 1:1 to a native ES module in `dist/`, which is what the browser loads.

## How a circuit is drawn

| Pixel | Meaning |
| --- | --- |
| Any channel ≥ 224 | **Wire.** Colour is yours to choose; only brightness matters. |
| Everything darker | Insulation. |

Wires connect horizontally and vertically, never diagonally. To make a gate,
draw a `+`: a dark centre with wire on all four sides. The **corners** decide
what it does:

```
 ██ ▓▓ ██        ▓▓ ██ ██        no corners      →  crossover, the two
 ▓▓ ·· ▓▓        ▓▓ ·· ▓▓                           wires cross without
 ██ ▓▓ ██        ▓▓ ██ ██                           touching
                                 two corners on
 crossover       gate pointing   one side        →  inverter pointing
 (no corners)    right                              away from them
```

- **No corners** → the horizontal and vertical wires cross over without connecting.
- **Two adjacent corners** → an inverter (NOT gate) pointing away from the filled
  side: top two corners → points down, right two → points left, bottom two →
  points up, left two → points right.
- Any other corner combination is ignored.

Every gate is an inverter. Everything else — AND, OR, latches, adders, whole
CPUs — is built from inverters plus one more rule: **when several gates drive
the same wire, the wire is their OR.** So a gate reading a wire driven by two
gates is a NOR, and two cross-coupled gates are a latch.

Gates are not instantaneous. Each one ramps toward its new value with a little
randomness mixed in, and only flips once the ramp saturates. That jitter is
deliberate: it breaks ties in ring oscillators and latches, and without it many
circuits would deadlock.

## Controls

| | |
| --- | --- |
| <kbd>Space</kbd> | Pause / resume |
| <kbd>Esc</kbd> | Settings panel |
| <kbd>R</kbd> | Reset — reload the file, clear all wire states |
| <kbd>F</kbd> | Fit the circuit to the window |
| <kbd>E</kbd> | Toggle edit mode |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo an edit |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save the circuit |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> | Copy, cut, paste a selection |
| <kbd>Delete</kbd> | Clear the selected region |
| Arrows | Move a floating paste, or nudge the pointer one pixel |
| <kbd>Enter</kbd> / <kbd>Escape</kbd> | Confirm or cancel a paste |
| <kbd>+</kbd> <kbd>−</kbd> | Zoom |
| Mouse wheel | Zoom at the cursor |
| Middle drag | Pan |
| Left click | Hold a wire HIGH while the button is down |
| Right click | Toggle a wire |
| One finger | Pan |
| Two fingers | Pinch to zoom |
| Tap | Toggle a wire |

Clicking only sticks on wires that **no gate drives** — the inputs. Every other
wire is rewritten from its driving gates on each cycle, so a manual value there
lasts a single frame. If a click seems to do nothing, you are probably on an
output.

Drop a PNG anywhere on the page to load it, or use **Open File** in the settings
panel.

## Drawing circuits

Press <kbd>E</kbd> (or **✎ Edit**) and the left mouse button paints instead of
driving wires. Everything else — pan, zoom, right-click to toggle a wire, every
keyboard shortcut — behaves exactly as it does in simulate mode.

| Tool | |
| --- | --- |
| ✏️ Pencil | Paint wire in the active colour. **Right-drag erases.** |
| ╱ Line | A straight run, or a bus — scroll over the tool to set the conductor count |
| ◻ Eraser | Paint insulation |
| ⌖ Picker | Adopt an existing wire's colour |
| ▷ Gate | Stamp an inverter — pick the direction with the arrows |
| ✛ Crossover | Stamp wires that cross without connecting |
| ⬚ Select | Drag a rectangle, then copy, cut, delete or paste it |

The gate stamp is the reason this is easier than a paint program: it writes the
exact corner pattern the engine looks for. Drawing a `+` by hand and filling the
wrong two corners produces no error — just a pattern that is silently ignored.

Entering edit mode pauses the simulation, so nothing changes underneath you
while you draw, and leaving restores whatever the run state was before. Press
<kbd>Space</kbd> while editing and it runs anyway: a stroke is recompiled the
moment it ends and wire states carry across, so you can rewire a live circuit
and watch it react if that is what you want.

Nothing in edit mode drives or toggles a wire — both buttons belong to the
tools. A pixel grid and a cursor outline appear once you are zoomed in far
enough for them to help.

Wires drawn at any angle are properly connected. The engine joins pixels only
on their four cardinal sides, so the tools lay down a staircase rather than a
diagonal run; a line that merely *looked* continuous would not conduct.

### Palette

Sixteen colours, plus any you add. Scroll the wheel over the colour swatch to
cycle through them without opening anything. A colour the engine would read as
insulation is refused rather than quietly brightened.

### Buses

Set the line tool's width and one drag lays down that many parallel conductors,
spaced so they stay separate nets — including diagonally, where the spacing has
to be wider than you would guess.

### Selection and clipboard

Drag a rectangle with the select tool, then <kbd>Ctrl</kbd>+<kbd>C</kbd>,
<kbd>Ctrl</kbd>+<kbd>X</kbd> or <kbd>Delete</kbd>. <kbd>Ctrl</kbd>+<kbd>V</kbd>
brings it back as a floating block you can drag, nudge with the arrow keys and
turn with the rotate buttons. Nothing is written until <kbd>Enter</kbd>;
<kbd>Escape</kbd> throws it away and leaves the circuit untouched.

Rotation handles gates with no special cases: a gate's direction is encoded in
which corners are wire, and those corners turn with the pixels.

### Placing a pixel exactly

Hold the mouse button and steer with the arrow keys: one press, one pixel, in
whichever direction. Holding an arrow repeats and speeds up. It is the easy way
to place the pixel a mouse keeps overshooting at high zoom.

A web page cannot move the operating system's cursor, so the editor keeps its
own pointer and the arrows move that. A marker shows where it is whenever it has
drifted from the physical cursor, clicks act where the marker is, and moving the
real mouse snaps everything back together.

<kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo and redo, one
stroke at a time.

**Wire colour** is yours to choose, but at least one channel must be 224 or
brighter — that is the engine's definition of a wire. Anything darker is
rejected rather than quietly accepted, because wire that does not conduct looks
identical to wire that does.

### Saving

<kbd>Ctrl</kbd>+<kbd>S</kbd> or **Save**. In Chrome and Edge, a circuit opened
with **Open File** is written back to that PNG in place — the file on disk
changes, and the app does not mistake its own write for an external edit.
Everywhere else, and for the bundled examples (which are fetched over HTTP and
have no file to write to), Save produces a download instead.

A saved circuit reopens identically. On Safari individual colour channels can
come back off by one on colour-rich schematics; wire detection is unaffected, so
the circuit is the same.

## The status bar

Along the bottom: the pixel under the pointer, the selected region when there is
one, then the circuit's size, wire and gate counts, cycle, rate and frame rate.

The cursor readout follows the physical mouse in both modes — and once the arrow
keys are driving, it follows the editor's pointer instead, so it always agrees
with the marker on the canvas and with the pixel a click will hit.

**Every readout is clickable and copies itself**, and **⧉ Copy all** on the right
copies the whole bar as a block, with the selection given both as displayed and
decomposed:

```
Flip Flop.png
size       45×27 px
wires      27
gates      20
cycle      256
selection  10×7 at 17,9–26,15
           x=17 y=9 w=10 h=7
```

A readout showing `—` refuses rather than copying the placeholder.

## Analysis mode

Press <kbd>A</kbd> or **🔬 Analyse** for a third mode alongside Simulate and Edit. It carries the
selection tool and **nothing that can change the circuit** — no drawing, no copy, cut, delete or
paste. That is the point: a place to explore a circuit that works, with no risk of altering it.
The guarantee is exhaustive rather than careful: every combination of key, modifier and context
is checked to produce no action that writes.

<kbd>E</kbd> and <kbd>A</kbd> each toggle one mode against Simulate, so what a key does never
depends on which mode you are already in. <kbd>Enter</kbd> analyses the selection — it is free to
mean that here because a floating paste, the other claimant on Enter, cannot exist in this mode.

### Seeing the circuit as a circuit

Switch the stage from **Pixels** to **Schematic** and the selection is drawn as a diagram:
one symbol per gate, wires as connections, inputs on one edge and outputs on the other, with
feedback drawn dashed and amber so it cannot be mistaken for an ordinary wire. Pointing at the
circuit highlights the matching part of the diagram.

Two levels of detail:

- **Gates** recognises NAND, NOR, AND, OR and NOT. This medium only has inverters, but a net
  driven by several of them *is* a NAND — the wired-OR does the work — and three further rules
  give the rest. Every recognised symbol is checked against the gates it replaces, on every
  input combination, before it is drawn.
- **Inverters** draws one symbol per gate with the wired-OR as a junction. It is the ground
  truth to check against when a recognised symbol looks wrong.

The diagram has no input-count limit, because it describes structure rather than behaviour: the
4-bit CPU's 241-gate block draws as 129 symbols in a couple of milliseconds, a size at which
truth tables must refuse.

### Naming things

**Point at any net in the list and its pixels light up on the circuit** — inputs, outputs and
internal alike — so a name or an id can be found without hunting for a coordinate. The schematic
lights the same net at the same time, and pointing at the canvas works the other way round.

Click any net in the **Nets** list to name it. The name then replaces its coordinates everywhere
— the list, the diagram, expressions, truth tables and discrepancy reports.

Names are bound to a **pixel**, not to a net id, because ids are assigned per compile and shift
whenever you draw. If you later erase the pixel a name sits on, the name is reported as
unresolved and **kept** — never deleted, and never quietly moved to a neighbouring net, which
would leave a name that still looks right on the wrong wire.

They are saved two ways: a **`<circuit>.labels.json` sidecar** you save and load deliberately,
and a browser copy kept automatically so a forgotten save costs nothing. Note the app cannot
drop the sidecar beside the `.png` on its own — a file handle has no access to its own folder —
so saving offers a location once.

### Memory, and whether it starts

A feedback loop is not automatically memory. A **storage element** is a loop with more than one
rest state; one that always settles is just a circuit with a loop in it. Elements sharing a
control line are reported as a group, so four register bits read as a register rather than as
four loose nets.

Then the question the rest of the tooling cannot ask. **"Does it hold and compute correctly"
and "does it start correctly" are different questions.** The simulator check seeds a consistent
state before releasing the circuit, so a power-on that never resolves is invisible to it. The
Memory section therefore cold-starts the selection **20 times** and reports where it lands:

```
n38@13,3   2 rest states · power-on state is UNDEFINED across 20 cold starts
                            — it settled into 2 different states (1 ×13, 0 ×7)
```

A finding always names its sample size, because twenty starts is evidence and not proof. You
will see circuits that pass every behavioural check and still fail this one — that is the
point.

### Clocks

Candidates come from two signals, because each is blind to the other's case. **Behavioural**:
run with the inputs held and find nets that free-run with a stable period — which is how a clock
is actually built here, as a ring oscillator. **Structural**: free inputs that reach a lot of
storage, which catches a clock you pulse by hand.

Nothing is designated for you. Candidates are ranked with the reason each was chosen, and where
the evidence cannot separate two of them they are shown as **tied** — a structural search cannot
tell a clock from a reset, since both reach every bit. Pick one and **Step** advances the circuit
edge by edge. If the same edge sequence gives different answers on two runs, that is reported
instead of showing one of them.

## Analysing a circuit

Select a region with the selection tool and press <kbd>A</kbd>, or **🔬 Analyse**.
The panel answers three questions about whatever is inside the selection.

**What does this compute?** The selection is compiled on its own and its netlist
extracted: which pixels form which nets, which gates drive what, which nets are
inputs (no gate drives them), which are outputs (driven, and feeding nothing
further), and which the selection boundary cut. From that comes a truth table —
derived from the gates, with no simulation involved.

Output detection is structural, so it only spots nets that feed nothing. If the
net you care about also drives something else, click the ones you do not want in
the **Nets** list and analyse again.

**Does the simulator agree?** With *Check the simulator against the logic* on,
every input combination is driven through the real engine and compared against
the derived table. Agreement is reported explicitly — it is the likely answer and
the reason to run the check at all. Rows that never settle are reported as
non-convergent and show `?` rather than a value: a circuit that keeps changing
has no steady-state answer, and inventing one would hide exactly what you were
looking for. Rows that answer differently on two runs are reported as
timing-dependent; the engine's ramp carries deliberate jitter, so that is a
property of the circuit rather than a fault.

**Could it be smaller?** Each output is minimised and costed in inverters, which
is the unit that matters here — OR is free, because several gates driving one net
*is* an OR. The result is labelled **minimised**, never optimal: the minimiser
optimises sum-of-products while the number shown is inverter cost, and those are
different objectives. Nothing is shown that was not checked against the original
truth table first. **Offer as a paste** draws the minimised form, compiles it,
re-analyses it, compares it against the original table, and only then hands it to
the ordinary floating paste — so you position it, press <kbd>Enter</kbd> to
commit as one undo step, or <kbd>Escape</kbd> to discard it for nothing.

### Limits worth knowing

- **16 inputs.** 2^16 rows is about twelve seconds; beyond that the refusal
  arrives instead of the freeze, with the count, before any work starts. A long
  sweep shows progress and can be stopped.
- **Steady state only.** Each row settles the circuit and reads it at rest. A
  fault that lives in *when* signals arrive rather than in what they compute is
  not something this can see.
- **Relative to the selection.** Nets cut by the boundary become free inputs and
  are listed as cut, because the analysis is only true relative to where you drew
  the box.
- **Feedback is analysed separately.** A selection containing a loop is reported
  as sequential, with state variables located on the canvas and a next-state
  function for each, rather than being forced into a truth table.

### Exchanging netlists

**Export netlist** writes the selection in the same JSON shape the Python
LogicShorter project uses, and **Import netlist** reads one back. An exported
netlist was checked against the engine; an imported one was not, so treat
anything derived from it as a suggestion to verify.

## Settings

- **Mouse wheel** — zoom at the cursor, or the Paint.NET arrangement: scroll to
  pan, <kbd>Shift</kbd> to pan sideways, <kbd>Ctrl</kbd> to zoom.
- **Speed** — simulation ticks per second (1–120).
- **Passes per tick** — cycles run per tick (1–100). Raise this to fast-forward
  a slow circuit; the display still refreshes once per frame.
- **File poll** — how often to check the source PNG for changes.

They persist in `localStorage`.

## Live reload

In Chrome and Edge, a file opened with **Open File** (or dragged in) stays
connected to the file on disk. Edit the PNG in any paint program, save, and the
running circuit picks up the change within one poll interval — **keeping its
current state**, so you can rewire a circuit while it runs. Wires that were lit
before are still lit afterwards.

Firefox and Safari have no equivalent API, so files there load once. Everything
else works normally.

## Examples

The **Examples** menu is generated at build time by
[`scripts/gen-examples.mjs`](scripts/gen-examples.mjs), which walks `projects/`
and writes `dist/examples.json`. Drop a new PNG into a project folder, rebuild,
and it appears in the menu — grouped by folder, no manifest to hand-edit.

Some of what is in there:

| File | What it is |
| --- | --- |
| `External_Shemes/Flip Flop.png` | The smallest interesting circuit: 20 gates, toggles on each pulse |
| `Enigma_v1/counter.png` | Three clocked position counters with decoders and readouts |
| `CPU/4bitAdder.png` | Two 4-bit operands, hex displays, `A + B =` |
| `CPU/ALU.png` | Arithmetic logic unit |
| `CPU/4bitCPU.png` | A complete 4-bit CPU |
| `Calc/Digital_Led.png` | Seven-segment display driver |
| `Enigma_v2/Enigma2.png` | Enigma rotor cipher machine — 11,515 gates |
| `CPU/Flash Memory 256x12.png` | 2048×2048, 45,004 gates — the stress test |

Circuits are interactive rather than free-running: most need you to click an
input to clock them. Look for the small pads and arrows at the edges of the
drawing.

You can deep-link any schematic with `?file=`, relative to the site root:

```
http://localhost:8000/?file=projects/CPU/ALU.png
```

## Deploying to GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the site and
publishes it. Because `dist/` is generated rather than committed, Pages is built
by the workflow instead of served straight from a branch:

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment**.
3. Source: **GitHub Actions**.

That is all — the workflow runs `npm ci && npm run build`, stages `index.html`,
`css/`, `dist/` and `projects/`, and uploads them. Every path in the app is
relative, so it works from a project subpath. The Delphi sources and the
prebuilt `.exe` are deliberately left out of the published site.

## Browser support

Chrome, Edge, Firefox and Safari, recent versions. Needs Canvas 2D, ES modules
and Pointer Events. Live reload additionally needs the File System Access API
(Chrome/Edge only). Everything runs offline once the page has loaded.

Large schematics are memory-hungry — the 2048×2048 example needs roughly 60 MB
of typed arrays — which can be tight on older phones.

## Credits

The original Bitmap Logic Simulator (Delphi/VCL) and all the example schematics
are the work of **Zoltán Hetesi**. Neither the original program nor its source
is included in this repository; only the schematics are, and the credit for
those is his.

This port reimplements the engine in TypeScript from that program's behaviour.
See [`src/simulator.ts`](src/simulator.ts), where each deliberate divergence
from the original is marked `PORT NOTE`.
