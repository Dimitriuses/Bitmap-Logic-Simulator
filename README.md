# Bitmap Logic Simulator

A logic simulator where **the picture is the circuit**. Load a PNG and the
pixels *are* the netlist: bright pixels are wires, little `+` shapes are
inverters. Nothing is uploaded — it all runs in the tab.

This repository holds two implementations:

| | |
| --- | --- |
| [`src/`](src) | A TypeScript web port that runs in the browser, published to GitHub Pages from the repository root. |
| [`BmpLogicSim150902/`](BmpLogicSim150902) | The original Delphi/VCL Win32 desktop app by Zoltán Hetesi. Reference implementation and source of truth for simulation semantics ([`UMain.pas`](BmpLogicSim150902/UMain.pas)). |

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
BmpLogicSim150902/  the original Delphi implementation
```

| Module | What it does |
| --- | --- |
| [`src/simulator.ts`](src/simulator.ts) | The engine: wire extraction, gate detection, simulation, rendering. The port of `UMain.pas`. |
| [`src/renderer.ts`](src/renderer.ts) | Viewport maths and canvas presentation. |
| [`src/fileHandler.ts`](src/fileHandler.ts) | Decoding PNGs, the examples manifest, and live reload. |
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

## Running the original desktop version

`BmpLogicSim150902/BmpLogicSim.exe` is a prebuilt Win32 binary and runs as-is.
Rebuilding needs RAD Studio (Win32, `ProjectVersion` 12.2): open
`BmpLogicSim150902/BmpLogicSim.dproj`, or run `msbuild BmpLogicSim.dproj
/p:Config=Release` after Delphi's `rsvars.bat`.

## Credits

Original Bitmap Logic Simulator (Delphi/VCL) and all example schematics by
Zoltán Hetesi. This port reimplements the engine in TypeScript; see
[`src/simulator.ts`](src/simulator.ts), where the deliberate divergences from
the original are marked `PORT NOTE`.
