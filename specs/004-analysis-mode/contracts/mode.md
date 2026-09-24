# Contract: Analysis Mode

**Modules**: `src/editor.ts`, `src/keymap.ts`, `src/ui.ts`, `src/settings.ts`

The mode's whole value is a guarantee — that nothing in it can change the circuit — so the
contract is written as things that must be impossible, not things that must work.

## MO-1 — Three modes, one mechanism

`EditorMode` is `'simulate' | 'edit' | 'analysis'`, and `InputContext.mode` carries the same
three values. There is no second flag that also decides whether writing is allowed.

## MO-2 — Analysis mode cannot write

No input path available in analysis mode reaches `CircuitDocument`. After exercising every key
in the key table and every pointer gesture, `doc.canUndo`, `doc.canRedo` and `doc.dirty` are
unchanged.

This is stated over the mode as a whole rather than per handler, because a per-handler statement
is satisfied by a handler nobody remembered to check.

## MO-3 — Editing actions are inert

`copy`, `cut`, `clearRegion`, `paste`, `commit` and `cancelPaste` resolve to `null` when
`ctx.mode === 'analysis'`. Several are unconditional today; they become guarded.

## MO-4 — Selection is shared, and survives

Selection behaves identically in analysis and edit modes for creating, adjusting and clearing.
Switching mode preserves it in both directions.

## MO-5 — No floating paste

`hasFloating` is never true while in analysis mode. Entering with a paste pending requires it to
be committed or cancelled first, so a pending write cannot survive into a read-only mode.

## MO-6 — Run state

Entering analysis pauses the simulation; leaving restores what was running before. Identical to
the existing edit-mode behaviour, so a user moving between the two never has to think about it.

## MO-7 — Key precedence stays in one place

`resolveKey` remains pure and total over all three modes. Its table is verified exhaustively —
every combination of mode × floating × selection × key. The verification grows in the same task
as the table, never later.

## MO-8 — The toolbar belongs to the mode

Analysis mode's toolbar offers analysis tools only. No drawing tool, colour control, bus width
or rotation control is present or reachable.

## MO-9 — Buttons do not keep focus

Analysis-mode controls `preventDefault` on `mousedown`, as the editor toolbar and status bar
already do. Enter and Space are the HTML activation keys for `<button>`, and they are keys the
mode needs.

## MO-10 — Handing work back to Edit mode

Where analysis produces something that would modify the circuit, analysis mode does not apply
it. Taking it requires an explicit, user-initiated switch to edit mode, after which the existing
paste mechanism applies it. The read-only guarantee has no exceptions.

## Verification

| Contract | How |
|----------|-----|
| MO-1, MO-3, MO-7 | `scripts/verify/keymap.mjs` — exhaustive over the enlarged table |
| MO-2 | Browser: exercise every key and gesture in analysis mode, assert undo depth and dirty flag unchanged |
| MO-4, MO-5, MO-6 | Browser: mode round-trips with a selection, with a paste pending, and while running |
| MO-8, MO-9 | Browser: toolbar contents; focus after click; Space still pauses |
| MO-10 | Browser: the replacement offer switches mode and does not write until Enter in edit mode |
