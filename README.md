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
| [`src/png.ts`](src/png.ts) | Encoding a circuit back to a PNG, and saving it. |
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
| ✏️ Pencil | Paint wire in the active colour |
| ╱ Line | A straight run, committed on release |
| ◻ Eraser | Paint insulation |
| ⌖ Picker | Adopt an existing wire's colour |
| ▷ Gate | Stamp an inverter — pick the direction with the arrows |
| ✛ Crossover | Stamp wires that cross without connecting |

The gate stamp is the reason this is easier than a paint program: it writes the
exact corner pattern the engine looks for. Drawing a `+` by hand and filling the
wrong two corners produces no error — just a pattern that is silently ignored.

Edits go straight into the running circuit. Finish a stroke and the circuit is
recompiled on the spot, keeping the state of every wire that still exists, so
you can rewire something while it runs and watch it react. A pixel grid and a
cursor outline appear once you are zoomed in far enough for them to help.

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

## Settings

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
