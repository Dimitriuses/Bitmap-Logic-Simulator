# Contract: Labels

**Module**: `src/labels.ts`

A label is a name the user gives to something they clicked. The contract is mostly about what
must *not* happen to it when the circuit changes underneath.

## LB-1 — Anchored to a pixel, never to a net id

A label binds `{x, y}` to a name. Net ids are assigned per compile and change whenever the
circuit is edited, so a label bound to an id would silently follow a different wire after a
single stroke. A coordinate is also what the user actually chose.

## LB-2 — Resolution is a question, not an assumption

Resolving asks the compiled circuit which net occupies the anchor. The answer may be "none".

## LB-3 — Unresolved is a reported state

When no net occupies the anchor, the label is **unresolved**: kept, shown as unresolved, and
never silently deleted or reattached to whatever net is nearest. Both of those would be a lie
about the user's intent.

## LB-4 — One name, everywhere

A resolved label replaces the default identifier in every view that mentions the item — net
lists, schematic symbols, expressions, truth tables, discrepancy reports. There is one naming
function, not one per view.

## LB-5 — Never inside the image

Labels are written neither into the circuit's pixels nor into its metadata. Verified by
experiment during clarification: an ordinary open-modify-save by an image editor silently drops
a PNG text chunk, and editing the PNG externally is this project's core live-reload workflow.

## LB-6 — Two stores, and neither wins silently

- The **sidecar** `*.labels.json` is the portable record: commits to git, survives editing the
  `.png` anywhere, follows the project to another machine.
- The **browser working copy** is the everyday convenience, so names are never lost merely
  because a save was forgotten.

Where they disagree, the user is told and chooses. Silently preferring either would lose work
that someone deliberately created.

## LB-7 — No silent sibling write

A `FileSystemFileHandle` gives no access to its parent directory, so the app cannot write
`4bitCPU.labels.json` beside `4bitCPU.png` on its own. Saving means a save picker with a
suggested name, or a download where that is unavailable — the same fallback the PNG save
already uses. The UI must not imply otherwise.

## LB-8 — Sidecar shape

```jsonc
{
  "format": "bitmap-logic-labels",
  "version": 1,
  "circuit": "4bitCPU.png",
  "labels": [{ "anchor": { "x": 542, "y": 634 }, "kind": "net", "name": "AX.hold" }]
}
```

Malformed input is refused with a reason, not partially read. `circuit` is advisory — a hint for
the user, never a key that blocks loading.

## LB-9 — Round trip

Export then import returns the same labels, and a second export is byte-identical to the first.

## Verification

| Contract | How |
|----------|-----|
| LB-1, LB-2, LB-3 | `scripts/verify/labels.mjs` — label a net, edit the pixels under the anchor, assert unresolved rather than moved |
| LB-4 | `labels.mjs` — one naming function; browser: the name appears in list, schematic and table |
| LB-5 | `labels.mjs` — the saved PNG contains no label data |
| LB-6 | Browser: divergent stores prompt a choice |
| LB-8, LB-9 | `labels.mjs` — round trip, byte-stability, and a set of malformed inputs each refused with a reason |
