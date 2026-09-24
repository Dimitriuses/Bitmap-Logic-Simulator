# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two things live here:

1. **`BmpLogicSim150902/`** — the original Delphi/VCL Win32 desktop simulator ("Bitmap Logic Simulator") by Zoltán Hetesi. It is the **reference implementation** and the source of truth for simulation semantics. **It is untracked and gitignored**: it is someone else's program, it was purged from this repository's history, and it is never pushed. Every `BmpLogicSim150902/...` path below therefore resolves on this machine but *not* in a fresh clone — if it is missing, the folder has to be obtained separately, and nothing that needs it can be checked against the original until then.
2. **`src/`** — the web port, in TypeScript, compiled by plain `tsc` to native ES modules in `dist/`. The site root *is* the repo root: `index.html`, `css/`, `dist/` and `projects/`. There is no bundler and no runtime dependency; `typescript` is the only devDependency.

### The document layer

Since the circuit editor ([specs/001-circuit-editor/](specs/001-circuit-editor/)), a decoded PNG no longer becomes a `Circuit` directly. The derivation is one way and it matters:

```
FileSource ──decode──▶ CircuitDocument ──compile──▶ Circuit ──render──▶ Renderer
                        (mutable pixels,             (readonly,
                         undo history, dirty)         simulatable)
```

- [src/document.ts](src/document.ts) owns the **source** pixels. Drawing tools mutate it; `compile(prevRender)` produces a fresh `Circuit`, carrying wire state across exactly as live reload does. Nothing compiled ever writes back.
- [src/simulator.ts](src/simulator.ts) is **unchanged and stays that way**. If a change seems to require editing it, the design is wrong. Everything below about the engine still holds verbatim.
- One recompile per completed stroke, never per pointer event — a rebuild is ~190 ms on Enigma2. Pixels painted mid-stroke are shown by the renderer's overlay ([src/renderer.ts](src/renderer.ts) `drawOverlay`) until the rebuild lands.
- **The most damaging mistake available in this codebase**: writing `Circuit.frame` anywhere near the document or the PNG encoder. `render()` masks inactive wires down with `& 0x7F`, so saving a frame would drop every unlit wire from 255 to 127 — below the 224 threshold — and silently destroy the circuit. [src/png.ts](src/png.ts) encodes `doc.pixels`, never the frame.
- Gate patterns live in [src/stamps.ts](src/stamps.ts) as **literal 3×3 tables transcribed from `detectGates`**, deliberately not derived from a direction vector. A wrong corner is not an error; it is a pattern the engine ignores.

### Editor workflow ([specs/002-editor-workflow/](specs/002-editor-workflow/))

- **Everything the editor draws must be 4-connected.** [src/geometry.ts](src/geometry.ts) `walkConnected` is the only rasteriser; the pencil, the line tool and buses all go through it. Bresenham steps diagonally and the engine joins wire only on the four cardinal sides, so a diagonal Bresenham run was **nine separate nets** pretending to be a wire. Never rasterise by hand anywhere else.
- **Bus spacing is not one pixel.** A 4-connected staircase occupies two rows per column, so conductors need a pitch of 2 only when the run is axis-aligned, and 3 otherwise. Proven exhaustively for widths 1–16 across five slopes.
- **Rotation needs no gate logic.** A gate's direction is its corner mask, and the corners rotate with the pixels, so `PixelBlock.rotateCW` is a plain pixel transform. Verified by driving each rotated gate.
- **Key precedence lives only in [src/keymap.ts](src/keymap.ts).** `resolveKey` is pure and total, and its table is checked exhaustively against every combination of floating paste / keyboard cursor / selection. If a second place starts deciding what a key means, Escape will begin doing two things.
- **Space always pauses; there is no apply key.** The arrow keys move the editor's own pointer, and a held mouse button is what makes them draw — so nothing competes for Space. A browser cannot move the OS cursor, hence the app-side pointer and the marker drawn whenever it has drifted from the physical one.
- **A floating paste is editor state, never document state.** It is drawn by the renderer overlay and reaches the document only on Enter, which is what makes cancelling free and keeps a paste at one recompile.
- **Toolbar buttons must not keep focus.** Enter and Space are the HTML activation keys for `<button>`, so a focused toolbar button swallows exactly the keys the editor needs — measured. `mousedown` is `preventDefault`ed to stop focus-on-click while leaving Tab working.
- **The status bar's readouts are `<button>` too**, so the focus rule above applies there as
  well — `#statusbar` gets the same `mousedown` `preventDefault`. Clicking one copies its value;
  without that, a click would leave focus on the button and Space would both pause *and* re-copy.
- **[src/copy.ts](src/copy.ts) is not [src/clipboard.ts](src/clipboard.ts).** `copy.ts` puts plain
  text on the *system* clipboard, for the status bar. `clipboard.ts` holds a rectangle of pixels
  for the editor's copy/cut/paste and never touches the system clipboard at all. Both reasonably
  want the word "clipboard"; only one of them means it.
- **`navigator.clipboard` needs a secure context**, which plain `http://` on a non-localhost host
  is not — so `copy.ts` falls back to the off-screen-textarea `execCommand` trick and reports
  failure rather than silently doing nothing. Note that a paste probe cannot verify any of this
  under Playwright: synthetic key events do not invoke the native paste action in *any* engine
  (checked with a textarea-to-textarea control). Only Chromium/Edge can read the clipboard back.
- **`#toolbar` scrolls horizontally, so it clips.** `overflow-x: auto` forces `overflow-y: auto`, which silently hid the palette popover entirely. Anything that must escape the toolbar's box has to be a sibling of it, not a child.

### Circuit analysis ([specs/003-circuit-analysis/](specs/003-circuit-analysis/))

- **`Circuit.wireAt` is the authority on connectivity, and it is never re-derived.**
  [src/netlist.ts](src/netlist.ts) asks the engine which net a pixel belongs to rather than
  running a second union-find. A private disagreement between analysis and simulation about
  which pixels form one wire would have been the hardest failure here to notice, and this
  makes it impossible rather than unlikely.
- **The netlist self-checks against `gateCount` and refuses on mismatch.** Gates *are*
  re-detected (the engine keeps its gate table private), so detection is checked against
  `Circuit.gateCount` and returns `ok: false` naming both counts rather than a netlist. This
  tool draws conclusions about the simulator; a netlist that quietly disagrees with the
  engine would make those conclusions confidently wrong. `scripts/verify/netlist.mjs` proves
  the check fires by handing extraction a deliberately corrupted image.
- **A crop must come from `doc.pixels`, never `Circuit.frame`.** Same trap `CLAUDE.md` flags
  for the PNG encoder, in a new place: `render()` masks inactive wires with `& 0x7F`, so a
  crop of the frame analyses a circuit with most of its wiring missing.
- **Results are "minimised", never "optimal".** [src/minimise.ts](src/minimise.ts) optimises
  sum-of-products; the number shown is inverter cost ([src/cost.ts](src/cost.ts)). Different
  objectives — reporting one while optimising the other and calling it optimal is a lie the
  UI must not tell.
- **Driving a gate-driven net does nothing.** `#gateInput` reads the *driving gate's* state
  whenever a net has drivers, so `setStateAt` only works on inputs — which is also why manual
  clicks only stick on input wires. Sequential state must be seeded via
  `loadGateStatesFromWires` and then released, and **every** net must be seeded, not just the
  cut ones: a two-inverter latch whose partner keeps the previous row's value starts
  inconsistent and lands wherever the gate shuffle takes it.
- **A latch has more than one valid rest state — that is what makes it a latch.** Comparing a
  settled state against a single iterated fixed point measures `randomizePerm`, not the
  circuit, and reports different "discrepancies" on every run. The only defensible test is
  whether the settled state *is* a fixed point.
- **Quiescence is a property of the whole selection.** Watching only the probed nets reports
  "settled" while something else still oscillates, which produced rows resting in states that
  satisfied no equation. [src/oracle.ts](src/oracle.ts) hashes the whole rendered frame.
- **[src/layout.ts](src/layout.ts) is the only module that writes a circuit.** Everything else
  is read-only analysis whose worst failure is a wrong report. So it compiles what it drew,
  re-extracts it, and compares against the original truth table before anything is offered —
  and the offer goes through the ordinary floating paste, so declining it costs nothing.

The schematics live under [`projects/`](projects), grouped into folders (`CPU/`, `Calc/`, `Enigma_v1/`, `Enigma_v2/`, `External_Shemes/`, plus a few loose at the top). They are both test data and the contents of the app's Examples menu, which [scripts/gen-examples.mjs](scripts/gen-examples.mjs) generates into `dist/examples.json` at build time — there is no hand-maintained manifest and no second copy of the PNGs.

An earlier layout kept the web app in `docs/` with its own `docs/examples/`. Both are gone; anything still referring to them (notably [.specify/spec.md](.specify/spec.md) and [.specify/plan.md](.specify/plan.md)) predates the move.

This directory **is** a git repository, pushed to `github.com/Dimitriuses/Bitmap-Logic-Simulator` and published via GitHub Pages by [.github/workflows/pages.yml](.github/workflows/pages.yml).

## Build & run

**No Delphi toolchain is installed on this machine** (no `msbuild`, `dcc32`, or RAD Studio). The Pascal source cannot be compiled here — treat it as read-only reference. `BmpLogicSim150902/BmpLogicSim.exe` is a prebuilt binary and can be run directly to observe behavior. Building requires opening `BmpLogicSim150902/BmpLogicSim.dproj` in RAD Studio (Win32, `ProjectVersion` 12.2), or `msbuild BmpLogicSim.dproj /p:Config=Release` after running Delphi's `rsvars.bat`.

Available locally: Python 3.13 and Node 22. The web port builds with `npm install && npm run build` (which runs `scripts/gen-examples.mjs`, then `tsc`) and is served with `npm run serve` — `python -m http.server` from the **repo root**, not a subfolder. HTTP is mandatory: a `file://` page cannot read pixels back out of an image. `npm run watch` recompiles on change, `npm run typecheck` is `tsc --noEmit`.

There is no test framework, but there is a zero-dependency harness in [scripts/verify/](scripts/verify/). **`npm run verify`** runs twelve suites in order: the 22 schematics against `scripts/verify/baseline.json`; every gate stamp the editor can place (21 assertions, including which way each gate carries signal); connectivity and bus spacing (33, including 80 bus cases); block rotation and the behaviour of rotated gates (18); the key-precedence table, exhaustively (14, covering 48 state/key combinations); netlist extraction against every schematic plus a corrupted-detector refusal (80); expressions and truth tables (53); minimisation and inverter cost (34); feedback, state variables and a latch driven through the engine (34); the differential oracle, including a planted discrepancy and an oscillator that is never sampled (37); netlist JSON round-trips and malformed-input refusals (86); and layout, which lays out every non-constant function of 1–3 variables and compiles each one back (23). `npm run verify:baseline` re-records the baseline — only do that when a count is *supposed* to change.

`scripts/verify/harness.mjs` shims `globalThis.ImageData` and builds bitmaps in memory; `decode.py` handles real PNGs via Pillow. `roundtrip.mjs <file.png>` prints any file's counts, which is how a saved circuit is checked against its original. Known-good oracles: `Flip Flop` = 27 wires / 20 gates, `Enigma2` = 11,515 gates, `Flash Memory 256x12` = 2048×2048 / 45,004 gates.

Browser-level behaviour needs Playwright, which is deliberately **not** a dependency of this repo — install it outside the project and point it at `python -m http.server`.

`BmpLogicSim.ini` sits next to the exe and is written on form destroy via `IniWrite([pSettings])`; it persists the last file path and the three timer/pass settings.

## Simulation model (the core of the project)

The entire engine is [UMain.pas](BmpLogicSim150902/UMain.pas) — ~575 lines. Everything below must be preserved bit-for-bit by any port; the JS pseudocode in `.specify/spec.md` is a paraphrase, and where the two disagree, **UMain.pas wins**.

A circuit *is* a PNG. Pixels are the netlist:

- **Wire pixel**: any channel ≥ 224 (`isWire`, [UMain.pas:224](BmpLogicSim150902/UMain.pas#L224)). Everything darker is insulation.
- **Gate**: a `+` pattern — dark center, wire on all four cardinal neighbors. The four *corners* select the behavior. All gates are **inverters (NOT)**; direction comes from which two adjacent corners are wire ([UMain.pas:310-332](BmpLogicSim150902/UMain.pas#L310-L332)):
  - no corners → **crossover** (H and V pass through without connecting)
  - N+E corners → gate points down; E+S → left; S+W → up; W+N → right
  - any other corner combination is ignored

`preprocessBitmap` ([UMain.pas:257](BmpLogicSim150902/UMain.pas#L257)) runs the whole pipeline on every file load:

1. **Horizontal run labeling** into `wireMap` (one integer per pixel; `0` = not a wire).
2. **`wireRemap`** merges labels that touch vertically. Note `connectWires` ([UMain.pas:238](BmpLogicSim150902/UMain.pas#L238)) does a **full linear relabel pass** over the table rather than union-find — so `wireRemap` is always flat (one indirection, never a chain), but merging is O(n) per union. This is the main scaling bottleneck; a port using union-find must still produce flat final labels.
3. **Gate detection**, then `src`/`dst` pixel offsets are resolved to remapped wire IDs.
4. **`srcGates`**: an O(n²) nested scan linking each gate to every gate driving its source wire.
5. **`perm`**: gate evaluation order, shuffled **once at load** (`randomizePerm`). The per-cycle reshuffle at [UMain.pas:427](BmpLogicSim150902/UMain.pas#L427) is deliberately commented out — `spec.md` shows it shuffling every cycle, which is *not* what the original does.
6. **State carry-over**: `prevBitmap` (the previous render) is re-read to restore wire states across a reload, so live-editing the PNG doesn't reset the circuit.

Per-cycle `simulate` ([UMain.pas:422](BmpLogicSim150902/UMain.pas#L422)):

- Gate input is **wired-OR of `srcGates`** if any exist, otherwise the raw `states[src]` value ([UMain.pas:411](BmpLogicSim150902/UMain.pas#L411)). That fallback is what makes user clicks work: `StoreGateStatesToWires` clears and rewrites every gate-driven wire each cycle, so a manually set state only survives on wires no gate drives — hence the UI's "only on input wires".
- Each gate is a **Schmitt trigger with an analog ramp**: `slowState` moves by `raiseSpeed`/`fallSpeed` (0.5) plus a value from a precomputed 4096-entry random table, and `state` flips only when it saturates at 0 or 1 ([UMain.pas:140](BmpLogicSim150902/UMain.pas#L140)). This jitter is what breaks oscillator ties and makes ring oscillators / latches behave — it is load-bearing, not decoration.

`makeBitmapFromState` ([UMain.pas:438](BmpLogicSim150902/UMain.pas#L438)) renders by compositing against the untouched `original` bitmap: active wires keep their color, inactive wires are halved (`and $fefefe shr 1`). Non-wire pixels are never written.

**Live reload**: `tFileRefresh` polls `FileAge` on the PNG and re-runs the whole pipeline when it changes — you draw in any paint program, hit save, and the running circuit updates. Preserve this in the port.

**Known quirk**: mouse picking flips Y (`w.y := bh - w.y` at [UMain.pas:558](BmpLogicSim150902/UMain.pas#L558)) while rendering does not. Decide deliberately whether to replicate this.

Controls: `Esc` settings panel, `Space` pause, wheel zoom (at cursor), middle-drag pan, left-click pulse HIGH while held, right-click toggle.

## The `het.*` units

`het.utils.pas` (6.2k lines), `het.gfx.pas` (3.4k), `het.arrays.pas`, `UVector.pas`, `UMatrix.pas` are a large general-purpose Delphi library vendored wholesale; comments are partly in Hungarian. Only a thin surface is actually used: `IniRead`/`IniWrite`, `CheckAndSet`, `switch`, `TMouseState`, `pinc`, `V2f`/`TV2f`, and the `THetBitmap` class helper (`CreateFromFile`, `CreateNew`, `CopyTo`, `Image`, `Components`). **Do not port these units** — reimplement the handful of used primitives natively. `UVector.pas` is generated from macro-style `{ define ... }` blocks and is not meant to be hand-edited.

## Spec-kit workflow

The repo is initialized with GitHub Spec Kit 0.14.2 (PowerShell variant, Claude integration). Skills in [.claude/skills/](.claude/skills/) provide `speckit-specify`, `speckit-plan`, `speckit-tasks`, `speckit-implement`, `speckit-analyze`, `speckit-clarify`, `speckit-checklist`, `speckit-converge`, `speckit-constitution`, `speckit-taskstoissues`. Scripts are PowerShell only, in [.specify/scripts/powershell/](.specify/scripts/powershell/).

Two things to know before running any of them:

- **Feature resolution does not use git branches here.** `create-new-feature.ps1` creates `specs/NNN-name/` and exports `SPECIFY_FEATURE` / `SPECIFY_FEATURE_DIRECTORY`, persisted in `.specify/feature.json`. Since env vars don't survive between tool calls, expect `Get-FeaturePathsEnv` to resolve via `feature.json`.
- **The existing `spec.md` and `plan.md` sit at `.specify/` root, not under `specs/NNN-*/`** — they predate the normal flow. New spec-kit commands will look in `specs/`, so point them explicitly at the existing files or migrate them rather than letting a second, competing spec appear.

[.specify/memory/constitution.md](.specify/memory/constitution.md) is still an unfilled template — its placeholders carry no rules. The plan's own "Constitution Check" (simplicity, no frameworks, no build tools, no external dependencies, client-side only) was the original constraint set. It still holds with one deliberate exception: the port is TypeScript, so `tsc` is a build step and `typescript` a devDependency. Everything else stands — no framework, no bundler, no runtime dependency, client-side only.
