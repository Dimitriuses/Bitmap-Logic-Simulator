// keymap.ts — the one place a key decides what it means.
//
// Several features want Enter, Escape and the arrow keys: the floating paste,
// the selection, and pointer nudging. If each grabbed what it could, Escape
// would end up doing two things depending on which listener ran first. So there
// is a single resolver, it is pure, and the precedence table in
// contracts/input.md is its specification.
//
// Note Space is NOT in the table: it always pauses. An earlier design had the
// arrows drive a separate keyboard cursor with Space to apply the tool at it,
// which put Space in conflict with pause. Moving the arrows onto the pointer
// itself removed the need for an apply key at all — you hold the mouse button
// as usual and steer with the arrows.
//
// Being pure is the point: the whole table is checked exhaustively in
// scripts/verify/keymap.mjs with no browser, which is the only way it stays
// correct as features are added.

/** The parts of a KeyboardEvent this resolver reads. Kept minimal so it can be
 *  driven from a plain object in a headless check. */
export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  /** Tag name of the focused element, uppercase, if any. */
  readonly targetTag?: string;
}

export interface InputContext {
  readonly mode: 'simulate' | 'edit';
  readonly hasFloating: boolean;
  readonly hasSelection: boolean;
}

export type InputAction =
  | { kind: 'move'; target: 'paste' | 'pointer'; dx: number; dy: number }
  | { kind: 'commit' }
  | { kind: 'cancelPaste' }
  | { kind: 'clearSelection' }
  | { kind: 'clearRegion' }
  | { kind: 'togglePause' }
  | { kind: 'toggleSettings' }
  | { kind: 'toggleMode' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'save' }
  | { kind: 'copy' }
  | { kind: 'cut' }
  | { kind: 'paste' }
  | { kind: 'reset' }
  | { kind: 'fit' }
  | { kind: 'zoom'; direction: 1 | -1 }
  | null;

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/** Focus is somewhere that owns the keyboard. */
function isTyping(tag: string | undefined): boolean {
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

/**
 * Resolve a key press to an action, or null to ignore it.
 *
 * Evaluated in the order of the precedence table: modifier combinations first,
 * then floating paste, then keyboard cursor, then selection, then the defaults
 * that have always applied.
 */
export function resolveKey(e: KeyEventLike, ctx: InputContext): InputAction {
  const typing = isTyping(e.targetTag);

  // --- Ctrl/Cmd combinations resolve before everything else (KM-5).
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z':
        return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
      case 'y':
        return { kind: 'redo' };
      case 's':
        return { kind: 'save' };
      case 'c':
        return ctx.hasSelection ? { kind: 'copy' } : null;
      case 'x':
        return ctx.hasSelection ? { kind: 'cut' } : null;
      case 'v':
        return { kind: 'paste' };
      default:
        return null;
    }
  }

  const arrow = ARROWS[e.key];

  // --- 1. A floating paste is the innermost thing open.
  if (ctx.hasFloating) {
    if (arrow) return { kind: 'move', target: 'paste', dx: arrow.dx, dy: arrow.dy };
    if (e.key === 'Enter') return { kind: 'commit' };
    if (e.key === 'Escape') return { kind: 'cancelPaste' };
  }

  // --- 2. A selection exists.
  if (!ctx.hasFloating && ctx.hasSelection) {
    if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'clearRegion' };
    if (e.key === 'Escape') return { kind: 'clearSelection' };
  }

  // --- 3. Otherwise the arrows nudge the pointer itself, one pixel at a time.
  // With a button held this feeds the active tool exactly as a mouse move does,
  // so holding the pencil and tapping an arrow draws one pixel. Edit mode only:
  // in simulate mode the arrows do nothing at all.
  if (arrow && !ctx.hasFloating) {
    if (ctx.mode === 'edit' && !typing) {
      return { kind: 'move', target: 'pointer', dx: arrow.dx, dy: arrow.dy };
    }
    return null;
  }

  // --- 5. The defaults.
  switch (e.key) {
    case 'Escape':
      return { kind: 'toggleSettings' };
    case ' ':
      return typing ? null : { kind: 'togglePause' };
    case 'e':
    case 'E':
      return typing ? null : { kind: 'toggleMode' };
    case 'r':
    case 'R':
      return typing ? null : { kind: 'reset' };
    case 'f':
    case 'F':
      return typing ? null : { kind: 'fit' };
    case '+':
    case '=':
      return { kind: 'zoom', direction: 1 };
    case '-':
    case '_':
      return { kind: 'zoom', direction: -1 };
    default:
      return null;
  }
}
