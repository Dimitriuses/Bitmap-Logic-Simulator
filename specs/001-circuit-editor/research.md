# Phase 0 Research: Circuit Editor

**Feature**: `001-circuit-editor` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

Nine questions had to be settled before the design could be written. Measurements
below were taken on this machine (Windows 10, 16 GB, Node 22, Chrome/Firefox/WebKit
via Playwright) against the real engine and the bundled schematics.

---

## R1. Recompiling a live circuit after an edit

**Decision**: Full rebuild of `Circuit` from the edited bitmap, once per completed
stroke, reusing the existing `prevRender` state-carry-over path. No incremental
recompilation.

**Rationale**:

The load pipeline is not incrementally updatable in any honest sense, and the
blocker is specific: **union-find has no delete**. `buildWireMap` merges wire
labels with `WireUnion`, and merging is all it can do. Drawing a pixel that joins
two nets is cheap to express as a union — but *erasing* a pixel can split one net
into two, and there is no way to undo a union without recomputing the component.
Since the eraser is a required tool (FR-003), any incremental scheme would still
need a full path for deletions, i.e. both implementations plus the logic to choose
between them.

Worse, a split is not local. Erasing one pixel in a bus that snakes across the
whole schematic changes the labelling of everything downstream of the cut, so
"only rebuild the affected region" has no bounded region to rebuild.

Measured full-rebuild cost, `new Circuit(imageData, prevRender)`:

| Schematic | Size | Gates | Rebuild |
| --- | --- | --- | --- |
| Flip Flop | 45×27 | 20 | ~3 ms |
| counter | 1200×800 | 1 497 | ~81 ms |
| 4bitAdder | 1024×1024 | 2 472 | ~44 ms |
| Enigma2 | 2000×1200 | 11 515 | ~190 ms |
| Flash Memory | 2048×2048 | 45 004 | ~250 ms |

Against SC-003 (≤250 ms up to ~12k gates), a full rebuild already passes with
Enigma2 at 190 ms. One rebuild per stroke — not per pointer event — is what makes
this viable: a stroke is dozens of events, and rebuilding per event would be
50–100× the necessary work.

This also matches what already ships. Live reload performs exactly this operation
whenever the file changes on disk, preserving wire state through `prevRender`. The
editor is not inventing a mechanism; it is triggering an existing one from a
different source.

**Alternatives considered**:

- *Incremental relabelling with a deletion-capable structure* (link-cut trees, or
  Euler-tour trees for dynamic connectivity). Genuinely solves splits in
  polylogarithmic time, and genuinely wrong here: it would replace the engine's
  most load-bearing, bit-faithful code with a substantially more complex structure
  to save 190 ms on an operation that happens once per stroke. Rejected as
  unjustified complexity — and it would put the port's fidelity to `UMain.pas` at
  risk, which is the one thing the project treats as non-negotiable.
- *Rebuild in a Web Worker* to keep the main thread free. Attractive for the
  2048×2048 case, where 250 ms is a visible hitch. Deferred rather than rejected:
  it needs the bitmap and the resulting typed arrays moved across a boundary, and
  `ImageData`/`Circuit` would have to become transferable. Worth doing only if the
  hitch proves objectionable in practice. Recorded as a follow-up, not scoped here.
- *Dirty-rectangle gate re-detection only* (keep wire labels, re-scan gates near
  the edit). Rejected: gates resolve their source and destination through wire
  labels, so stale labels produce a silently wrong netlist — the worst failure
  mode available in this codebase.

---

## R2. Keeping the stroke responsive while a rebuild is pending

**Decision**: Separate the *document* pixels from the *compiled* circuit. Painting
writes to the document bitmap immediately and marks the canvas dirty; the rebuild
happens on stroke end. Between the two, the renderer composites the document's
edited pixels over the last rendered frame.

**Rationale**: FR-007 requires painted pixels to appear before the recompile, and
SC-002 requires that within one frame. Because `Circuit.render()` only ever writes
wire pixels (non-wire pixels are copied once at construction), a freshly painted
pixel that the current `Circuit` does not know about would otherwise not be drawn
at all until the rebuild lands.

The cheapest correct approach is a *pending-edit overlay*: a small list of
`(index, rgba)` pairs written since the last rebuild. The renderer draws the
circuit frame, then blits the pending pixels on top. The list is cleared when the
rebuild completes and those pixels become part of the compiled circuit. The list
is bounded by stroke length, not bitmap size.

**Alternatives considered**:

- *Rebuild per pointer event.* Simple, and unusable at 190 ms per event.
- *Paint into `Circuit.frame` directly.* Would show immediately, but the next
  `render()` overwrites wire pixels from `states`, so edits would flicker, and
  writing into the compiled frame muddles the one-way "document compiles to
  circuit" relationship the redesign is built on.

---

## R3. PNG round-trip fidelity

**Decision**: Encode with `canvas.toBlob('image/png')`. Constrain the editor's
palette so wire pixels are written at 255 and insulation at 0 by default, keeping
every painted value far from the 224 threshold.

**Rationale**: This was measured rather than assumed, because the engine classifies
pixels on an exact numeric boundary (`channel >= 224`) and any encoder drift could
silently change a circuit's meaning.

Test 1 — a 256×256 image spanning the full colour range, opaque alpha, round-tripped
through `putImageData → toBlob('image/png') → Image → drawImage → getImageData`:

| Engine | Channels differing | Max drift | Wire-classification flips |
| --- | --- | --- | --- |
| Chrome | 0 / 196 608 | 0 | 0 |
| Firefox | 0 / 196 608 | 0 | 0 |
| **WebKit** | **260 / 196 608** | **±1** | 0 |

WebKit is not bit-exact on colour-rich images, and its PNG came back markedly
smaller (1 150 bytes vs Firefox's 2 234 and Chrome's 3 817), which points at a
lossier encode path rather than random noise.

Test 2 — the case that actually matters: an image made entirely of values sitting
*on* the threshold (alternating 223 and 224), and a second made of 255/0:

| Engine | On-boundary flips | Max drift | Safe-palette flips |
| --- | --- | --- | --- |
| Chrome | 0 / 262 144 | 0 | 0 / 262 144 |
| WebKit | 0 / 262 144 | 0 | 0 / 262 144 |

With a small palette, WebKit round-trips exactly — the drift in test 1 is tied to
colour-rich images. Real schematics are low-colour (`Flip Flop.png` has four
distinct colours), so the round-trip is safe in practice on every engine.

The 255/0 default costs nothing and removes even the theoretical risk: a ±1 drift
cannot move 255 or 0 across a boundary at 224. FR-016's requirement is satisfied at
the level it is written — the reopened *circuit* is identical — with the caveat
recorded below.

**Known caveat**: on Safari, a colour-rich schematic may come back with individual
channels off by one. Wire/insulation classification is unaffected, so the circuit
simulates identically, but a user's chosen wire colours may shift imperceptibly.
Not worth engineering around; worth knowing when a bug report mentions colours.

**Alternatives considered**:

- *Hand-rolled PNG encoder* (deflate + CRC by hand). Guarantees bit-exactness
  everywhere and adds a few hundred lines of code the platform already provides.
  Rejected against the simplicity constraint; revisit only if exactness is ever
  required beyond classification.
- *Writing the rendered frame instead of the document.* Rejected outright — the
  frame has inactive wires dimmed to `& 0x7F`, so saving it would permanently
  darken every unlit wire below the wire threshold and destroy the circuit. This
  is the single most dangerous mistake available in this feature and is called out
  again in the data model.

---

## R4. Writing back to the source file

**Decision**: Use the existing `FileSystemFileHandle` with `createWritable()`,
requesting read-write permission on the first save from a user gesture. Fall back
to an anchor-triggered download when the handle is absent or permission is refused.

**Rationale**: The app already holds a handle for files opened via **Open File** or
drag-and-drop (`FileSource`'s `handle` origin), which is what makes live reload
work. The same handle can write.

Two details are easy to get wrong:

1. **Permission is read-only until asked.** A handle from `showOpenFilePicker()`
   grants read access; writing requires
   `handle.requestPermission({ mode: 'readwrite' })`, which must be called from a
   user gesture. Saving is a button press, so this is satisfiable — but the request
   must happen inside the click handler, not after an `await` that breaks the
   gesture chain.
2. **The app must not reload its own write.** `FileSource.poll()` compares
   `file.lastModified` against a stored stamp; writing the file changes
   `lastModified`, so the very next poll would see an "external" change and
   recompile over the user's in-progress work. After a successful write, the stamp
   must be refreshed from the file before the next poll runs.

Sources opened over HTTP (bundled examples, `?file=` deep links) have no handle at
all, so download is the only path for them regardless of browser.

**Alternatives considered**:

- *Always download.* Simpler and loses the whole point of an in-app editor for the
  users whose browser can do better.
- *Origin Private File System.* Persists without prompts but is invisible to the
  user's paint program, which breaks the hybrid workflow the project is built
  around.

---

## R5. Undo representation

**Decision**: Per-stroke sparse diffs — each history entry stores only the pixel
indices the stroke touched, with their previous and new RGBA values. Cap the stack
by cumulative touched-pixel count, not by entry count.

**Rationale**: FR-018 forbids history that scales with bitmap size. A naive
full-bitmap snapshot is 16 MB per entry on the 2048×2048 example; twenty entries
would be 320 MB. A stroke touches hundreds of pixels at most, so a sparse diff is
four to five orders of magnitude smaller and makes undo a bounded, trivially
reversible operation.

Storing both old and new values (rather than old only) makes redo symmetric — apply
forward, apply backward — with no re-execution of tool logic.

A pixel touched repeatedly within one stroke is recorded once, at its pre-stroke
value, so overlapping scribbles do not inflate the diff.

**Alternatives considered**:

- *Command replay* (store the tool and its parameters, re-execute from a base
  state). Compact, but undo becomes "replay everything from the start", which is
  O(history) per undo and interacts badly with the colour picker's dependence on
  current pixel state. Rejected.
- *Full snapshots with a small cap.* Simple and blows the memory budget on exactly
  the schematics where editing is most tedious.

---

## R6. Exact gate stamp patterns

**Decision**: Stamps write a fixed 3×3 block, transcribed directly from
`detectGates` in [src/simulator.ts](../../src/simulator.ts).

**Rationale**: The corner encoding is the part users get wrong by hand, and a wrong
corner produces no error — just a pattern the engine ignores, which is why FR-007
of the original port exists at all. Transcribing it once into a table removes the
whole class of mistake (SC-007).

The engine's conditions, for a centre at (x, y): the centre must be insulation; the
four cardinal neighbours must all be wire; the four corners select behaviour via
`NW=1, NE=2, SE=4, SW=8`.

| Corners set | Value | Meaning | Source → destination |
| --- | --- | --- | --- |
| none | 0 | crossover | H and V cross, unconnected |
| NW + NE | 3 | inverter pointing **down** | N → S |
| NE + SE | 6 | inverter pointing **left** | E → W |
| SE + SW | 12 | inverter pointing **up** | S → N |
| SW + NW | 9 | inverter pointing **right** | W → E |

Anything else is ignored by the engine, so the stamp table contains exactly these
five patterns and no others. As 3×3 grids (`#` wire, `.` insulation):

```
 down        left        up          right       crossover
 # # #       . # #       . # .       # # .       . # .
 # . #       # . #       # . #       # . #       # . #
 . # .       . # #       # # #       # # .       . # .
```

**Alternatives considered**: deriving the corners programmatically from a direction
vector. Fewer characters, and it re-implements the encoding a second time in a
second place — precisely the duplication that lets the two drift apart. A literal
table that mirrors the switch statement is easier to verify against the source of
truth.

---

## R7. Constraining the wire colour

**Decision**: The colour picker offers arbitrary colours but validates that at
least one channel is ≥ 224; the default wire colour is pure white and the eraser
writes pure black.

**Rationale**: FR-006. Colour in this simulator is decorative *except* for the
brightness test — `isWire` returns true if any single channel reaches 224. A user
picking a pleasant mid-grey would be drawing insulation that looks like wire,
producing a circuit that is visibly "connected" and electrically dead. The
validation converts a baffling failure into an immediate one.

Note the rule is per-channel and not luminance: saturated blue `#0000FF` is a
perfectly good wire despite being dark to the eye, which is why several bundled
schematics use blue and green wiring.

---

## R8. Arbitrating between editing and the existing click-to-drive interaction

**Decision**: An explicit mode toggle. In **Simulate** mode the pointer behaves
exactly as it does today (left-click drives a wire HIGH, right-click toggles). In
**Edit** mode the left button draws with the active tool, and driving a wire moves
to a modifier (right-click continues to toggle). Pan, zoom and all keyboard
shortcuts are unchanged in both.

**Rationale**: FR-021 requires an unambiguous answer to "what will this click do".
Left-click cannot both paint a pixel and pulse a wire, and inferring intent from
context would make the most common action unpredictable. A visible mode with a
distinct cursor is the honest solution.

This also preserves the existing behaviour exactly for users who never open the
editor, which matters because the current interaction is verified and shipped.

**Alternatives considered**: a modifier-held drawing mode (draw only while a key is
down). Avoids modes, and makes every stroke a two-handed operation; rejected for
sustained drawing.

---

## R9. Where the editor sits in the architecture

**Decision**: Introduce a `CircuitDocument` layer that owns the editable pixels and
the history. `Circuit` becomes a *derived* artefact compiled from the document,
rather than something constructed directly from a decoded file.

**Rationale**: This is the "redesign" the request asks for, and it is a small
change with a large clarifying effect. Today `ui.ts` holds a `Circuit` and a
`FileSource`, and the file decodes straight into the circuit. The editor needs a
mutable thing to draw on, an immutable-per-compile thing to simulate, and a clear
one-way relationship between them:

```
FileSource ──decode──▶ CircuitDocument ──compile──▶ Circuit ──render──▶ Renderer
                        (mutable pixels,             (readonly,
                         undo history,                simulatable)
                         dirty flag)
```

Everything already built stays where it is. `Circuit` keeps its readonly fields and
its bit-faithful pipeline — it simply gets its `ImageData` from the document
instead of from `FileSource.read()`. Live reload becomes "replace the document's
pixels, recompile", which is the same operation the editor performs, so the two
paths converge instead of competing.

**Alternatives considered**: making `Circuit` itself mutable with pixel-edit
methods. Rejected firmly — `Circuit`'s readonly, compile-once structure is what
makes its fidelity to `UMain.pas` reviewable, and threading mutation through it
would entangle the simulation core with UI concerns for no benefit.

---

## Resolved unknowns

Every `NEEDS CLARIFICATION` raised in the Technical Context is closed above:
recompile strategy (R1), responsiveness mechanism (R2), encoder fidelity (R3),
write-back and permissions (R4), history bounds (R5), stamp patterns (R6), colour
validity (R7), input arbitration (R8), and module placement (R9).

One item is deliberately deferred rather than resolved: moving the rebuild into a
Web Worker (R1). It is not needed to meet any stated success criterion, and the
decision to add it should be driven by whether the 250 ms hitch on the largest
schematic actually bothers anyone.
