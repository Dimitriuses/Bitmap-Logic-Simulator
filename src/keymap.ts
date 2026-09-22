// keymap.ts — the one place a key decides what it means.
//
// Three features want Enter, Escape and the arrow keys: the floating paste, the
// keyboard cursor, and the selection. If each grabbed what it could, Escape
// would end up doing two things depending on which listener ran first. So there
// is a single resolver, it is pure, and the precedence table in
// contracts/input.md is its specification.
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
  readonly cursorActive: boolean;
  readonly hasSelection: boolean;
}

export type InputAction =
  | { kind: 'move'; target: 'paste' | 'cursor'; dx: number; dy: number }
  | { kind: 'activateCursor'; dx: number; dy: number }
  | { kind: 'commit' }
  | { kind: 'cancelPaste' }
  | { kind: 'deactivateCursor' }
  | { kind: 'clearSelection' }
  | { kind: 'clearRegion' }
  | { kind: 'applyTool' }
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

  // --- 2. The keyboard cursor. While it is visible, Space applies the tool;
  // while it is not, Space pauses, exactly as it always has. That visibility is
  // what makes the rule discoverable rather than surprising.
  if (!ctx.hasFloating && ctx.cursorActive) {
    if (arrow) return { kind: 'move', target: 'cursor', dx: arrow.dx, dy: arrow.dy };
    if (e.key === ' ' && !typing) return { kind: 'applyTool' };
    if (e.key === 'Escape') return { kind: 'deactivateCursor' };
  }

  // --- 3. A selection exists.
  if (!ctx.hasFloating && ctx.hasSelection) {
    if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'clearRegion' };
    if (e.key === 'Escape') return { kind: 'clearSelection' };
  }

  // --- 4. Arrows with nothing open start the keyboard cursor, but only while
  // editing: in simulate mode they should do nothing at all.
  if (arrow && !ctx.hasFloating && !ctx.cursorActive) {
    if (ctx.mode === 'edit' && !typing) {
      return { kind: 'activateCursor', dx: arrow.dx, dy: arrow.dy };
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
