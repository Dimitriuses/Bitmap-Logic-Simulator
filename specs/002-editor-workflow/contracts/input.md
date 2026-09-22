# Contract: Input — keys, wheel and camera

**Feature**: `002-editor-workflow` | **Modules**: `src/keymap.ts`,
`src/viewport-camera.ts`, `src/palette.ts`, plus editor and UI wiring

---

## Key precedence

Three features want the same keys. There is one resolver, and this table is its
specification (FR-026). It is evaluated top to bottom; the first row that applies wins.

| State | Arrows | Enter | Escape | Space | Delete |
| --- | --- | --- | --- | --- | --- |
| A floating paste exists | move it 1px | **commit** | **cancel** | — | — |
| The keyboard cursor is active | move it 1px | — | deactivate it | **apply tool** | — |
| A selection exists | *activate cursor* | — | clear selection | pause/resume | **clear region** |
| Otherwise (incl. simulate mode) | *activate cursor* (edit mode only) | — | toggle settings | pause/resume | — |

```ts
export type InputContext = {
  readonly mode: 'simulate' | 'edit';
  readonly hasFloating: boolean;
  readonly cursorActive: boolean;
  readonly hasSelection: boolean;
};

export type InputAction =
  | { kind: 'move'; target: 'paste' | 'cursor'; dx: number; dy: number }
  | { kind: 'commit' } | { kind: 'cancel' }
  | { kind: 'activateCursor'; dx: number; dy: number }
  | { kind: 'deactivateCursor' }
  | { kind: 'applyTool' } | { kind: 'clearSelection' } | { kind: 'clearRegion' }
  | { kind: 'togglePause' } | { kind: 'toggleSettings' }
  | { kind: 'undo' } | { kind: 'redo' } | { kind: 'save' }
  | { kind: 'copy' } | { kind: 'cut' } | { kind: 'paste' }
  | null;

/** Pure: an event plus a context gives an action, or null to ignore. */
export function resolveKey(e: KeyboardEvent, ctx: InputContext): InputAction;
```

- **KM-1 — Pure and total.** `resolveKey` reads nothing but its arguments and always returns
  an action or `null`. That is what makes the whole precedence table testable without a
  browser, which is the only way it stays correct as features are added.
- **KM-2 — Escape keeps its old meaning last.** It toggles the settings panel only when
  nothing else is open, matching how every other application behaves.
- **KM-3 — Space is unchanged unless the keyboard cursor is visible.** This is the
  resolution of the conflict between "Space still pauses while editing" and "Space applies
  the tool": if you can see the cursor, Space paints; otherwise it pauses (research R4).
- **KM-4 — Typing is never intercepted.** While focus is in an input or select, only the
  existing exceptions apply.
- **KM-5 — Ctrl/Cmd combinations resolve before the table**: Z, Y, S, C, X, V.
- **KM-6 — Arrow auto-repeat accelerates.** Held keys move faster the longer they are held,
  clamped so a held key cannot cross a 2048-pixel bitmap instantly.
- **KM-7 — A focused toolbar button must not swallow Enter or Space.** Both are the HTML
  activation keys for `<button>`, and the toolbar is all buttons, so after clicking a tool
  the focused button competes for exactly the keys this table depends on.

  Measured on the shipped build, with a tool button focused:

  | Key | Button re-activated | Reached the app |
  | --- | --- | --- |
  | Space | no — the existing `preventDefault` suppresses it | yes |
  | **Enter** | **yes** | **no** |

  So Enter, as the paste-commit key, is currently unreachable whenever the user's last
  click was a toolbar button — which after rotating a floating paste is the common case.

  **Required**: toolbar buttons call `preventDefault()` on `mousedown` so clicking one does
  not move focus to it, while leaving them reachable by Tab for keyboard users. Enter and
  Space are then handled at the window level as this table specifies. A keyboard user who
  has deliberately tabbed to a button still activates it normally, because focus there was
  intentional.

### Why the apply key is Space and not Enter

Both were considered. Enter loses on three counts:

1. It is already the commit key. Giving it "apply tool" as well means one key with two
   destructive meanings, separated only by whether a paste floats.
2. Committing and applying would then be the *same keystroke in sequence* — commit a paste,
   press Enter again from habit, and a pixel is painted.
3. It is the platform's activation key, so it fights focused buttons as measured above.

Space's overload is milder: its other meaning, pause, is non-destructive and instantly
reversible. Its one wart is that with the cursor active, a user reaching for pause paints
instead; Escape deactivates the cursor first, and the cursor being visible is the signal
that Space has changed meaning.

---

## Wheel routing

- **WH-1 — The target decides.** Over a toolbar control with a `ToolParameter`, the wheel
  adjusts that parameter. Over the canvas, the wheel belongs to the camera. They never
  contend, because the toolbar is not inside the canvas.
- **WH-2 — Every wheel listener suppresses the browser.** `preventDefault`, and therefore
  registration with `{ passive: false }`. Without it a plain notch scrolls the page and
  Ctrl+wheel zooms the whole document, which would make the Paint.NET scheme unusable.
- **WH-3 — A control with no parameter ignores the wheel**, and the canvas must not act on
  its behalf.
- **WH-4 — One notch, one step.** Normalised across `deltaMode` exactly as the existing
  camera code already does for lines and pages.

---

## Camera schemes

```ts
export type CameraScheme = 'classic' | 'paint';

/** Apply one wheel event to the viewport under the given scheme. */
export function applyWheel(
  scheme: CameraScheme, viewport: Viewport, e: WheelEvent, local: Point
): void;
```

| | Wheel | Shift+wheel | Ctrl+wheel |
| --- | --- | --- | --- |
| `classic` | zoom at cursor | zoom at cursor | zoom at cursor |
| `paint` | pan vertically | pan horizontally | zoom at cursor |

- **CM-1 — `classic` is bit-for-bit today's behaviour**, including the 120/256 notch
  constant. Anyone who never opens the setting must not be able to tell this feature landed.
- **CM-2 — Zoom is always at the cursor**, in whichever scheme reaches it, so the two agree
  about the thing they share.
- **CM-3 — Pan distance is in screen pixels**, divided by zoom, so a notch moves the same
  visible distance at any magnification.
- **CM-4 — Persisted** with the other editor preferences, validated on read.

---

## `src/palette.ts`

```ts
export const DEFAULT_PALETTE: readonly Rgba[];   // exactly 16

export class Palette {
  get colors(): readonly Rgba[];    // defaults then custom
  get active(): Rgba;
  get activeIndex(): number;

  select(index: number): void;
  /** Wheel: +1 or -1 notches, wrapping. */
  cycle(delta: number): void;
  /** Returns false when the engine would read it as insulation. */
  add(color: Rgba): boolean;
  remove(index: number): boolean;   // custom entries only
}
```

- **PL-1 — Every entry passes the engine's own wire test**, defaults included. Asserted at
  module load, so a bad default cannot ship.
- **PL-2 — Rejection is reported, not corrected.** A colour that fails is refused with a
  reason; silently brightening it would teach the user the wrong rule.
- **PL-3 — Cycling wraps** both ways and never lands outside the list.
- **PL-4 — Defaults cannot be removed**, so the palette cannot be emptied.
- **PL-5 — Adding a duplicate selects the existing entry** instead of appending.

---

## Verification

`resolveKey` is a pure function over a small state space, so the precedence table is
checked exhaustively in `scripts/verify/keymap.mjs` — every key in the table against every
combination of `hasFloating`, `cursorActive`, `hasSelection` and both modes. The table in
this contract is the expected-value table for that check, which is the point of writing it
as a table.

`Palette` is likewise pure: all 16 defaults are asserted against `isWire`, and cycling is
checked for wrap in both directions.
