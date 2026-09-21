# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two things live here:

1. **`BmpLogicSim150902/`** — the original Delphi/VCL Win32 desktop simulator ("Bitmap Logic Simulator"). It is the **reference implementation** and the source of truth for simulation semantics.
2. **`src/`** — the web port, in TypeScript, compiled by plain `tsc` to native ES modules in `dist/`. The site root *is* the repo root: `index.html`, `css/`, `dist/` and `projects/`. There is no bundler and no runtime dependency; `typescript` is the only devDependency.

The schematics live under [`projects/`](projects), grouped into folders (`CPU/`, `Calc/`, `Enigma_v1/`, `Enigma_v2/`, `External_Shemes/`, plus a few loose at the top). They are both test data and the contents of the app's Examples menu, which [scripts/gen-examples.mjs](scripts/gen-examples.mjs) generates into `dist/examples.json` at build time — there is no hand-maintained manifest and no second copy of the PNGs.

An earlier layout kept the web app in `docs/` with its own `docs/examples/`. Both are gone; anything still referring to them (notably [.specify/spec.md](.specify/spec.md) and [.specify/plan.md](.specify/plan.md)) predates the move.

This directory is **not a git repository**.

## Build & run

**No Delphi toolchain is installed on this machine** (no `msbuild`, `dcc32`, or RAD Studio). The Pascal source cannot be compiled here — treat it as read-only reference. `BmpLogicSim150902/BmpLogicSim.exe` is a prebuilt binary and can be run directly to observe behavior. Building requires opening `BmpLogicSim150902/BmpLogicSim.dproj` in RAD Studio (Win32, `ProjectVersion` 12.2), or `msbuild BmpLogicSim.dproj /p:Config=Release` after running Delphi's `rsvars.bat`.

Available locally: Python 3.13 and Node 22. The web port builds with `npm install && npm run build` (which runs `scripts/gen-examples.mjs`, then `tsc`) and is served with `npm run serve` — `python -m http.server` from the **repo root**, not a subfolder. HTTP is mandatory: a `file://` page cannot read pixels back out of an image. `npm run watch` recompiles on change, `npm run typecheck` is `tsc --noEmit`.

There is no test framework. Verification is manual — load an example and confirm it simulates — but the engine can also be exercised headlessly: shim `globalThis.ImageData`, decode a PNG to raw RGBA (Pillow is installed), and import `dist/simulator.js` directly. Known-good oracles: `Flip Flop` = 20 gates, `Enigma2` = 11,515 gates, `Flash Memory 256x12` = 2048×2048 / 45,004 gates.

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

- **Feature resolution does not use git branches here** (not a repo). `create-new-feature.ps1` creates `specs/NNN-name/` and exports `SPECIFY_FEATURE` / `SPECIFY_FEATURE_DIRECTORY`, persisted in `.specify/feature.json`. Since env vars don't survive between tool calls, expect `Get-FeaturePathsEnv` to resolve via `feature.json`.
- **The existing `spec.md` and `plan.md` sit at `.specify/` root, not under `specs/NNN-*/`** — they predate the normal flow. New spec-kit commands will look in `specs/`, so point them explicitly at the existing files or migrate them rather than letting a second, competing spec appear.

[.specify/memory/constitution.md](.specify/memory/constitution.md) is still an unfilled template — its placeholders carry no rules. The plan's own "Constitution Check" (simplicity, no frameworks, no build tools, no external dependencies, client-side only) was the original constraint set. It still holds with one deliberate exception: the port is TypeScript, so `tsc` is a build step and `typescript` a devDependency. Everything else stands — no framework, no bundler, no runtime dependency, client-side only.
