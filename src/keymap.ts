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
  readonly mode: 'simulate' | 'edit' | 'analysis';
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
  | { kind: 'toggleMode'; target: 'edit' | 'analysis' }
  | { kind: 'analyse' }
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

  // Analysis mode is read-only, and that is enforced here rather than in each
  // handler. Every action below that could change the document is gated on
  // this one predicate, so there is one place to check and one place to break.
  const canEdit = ctx.mode !== 'analysis';

  // --- Ctrl/Cmd combinations resolve before everything else (KM-5).
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z':
        if (!canEdit) return null;
        return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
      case 'y':
        return canEdit ? { kind: 'redo' } : null;
      case 's':
        // Saving is not editing: it writes the file, not the document, and a
        // read-only mode has no reason to forbid keeping your work.
        return { kind: 'save' };
      case 'c':
        return canEdit && ctx.hasSelection ? { kind: 'copy' } : null;
      case 'x':
        return canEdit && ctx.hasSelection ? { kind: 'cut' } : null;
      case 'v':
        return canEdit ? { kind: 'paste' } : null;
      default:
        return null;
    }
  }

  const arrow = ARROWS[e.key];

  // --- 1. A floating paste is the innermost thing open.
  //
  // MO-5 says a paste cannot exist in analysis mode, but resolveKey is total
  // over every context it is handed, not only the reachable ones — so the
  // guard is here too rather than relying on a caller's discipline.
  if (ctx.hasFloating && canEdit) {
    if (arrow) return { kind: 'move', target: 'paste', dx: arrow.dx, dy: arrow.dy };
    if (e.key === 'Enter') return { kind: 'commit' };
    if (e.key === 'Escape') return { kind: 'cancelPaste' };
  }

  // Enter runs the analysis. It is free to mean this only because a floating
  // paste — the other claimant on Enter — cannot exist in analysis mode.
  if (ctx.mode === 'analysis' && e.key === 'Enter' && !typing) {
    return ctx.hasSelection ? { kind: 'analyse' } : null;
  }

  // --- 2. A selection exists.
  if (!ctx.hasFloating && ctx.hasSelection) {
    // Delete clears pixels, so it is an edit. Escape only drops the selection,
    // which changes nothing in the document and stays available.
    if (canEdit && (e.key === 'Delete' || e.key === 'Backspace')) return { kind: 'clearRegion' };
    if (e.key === 'Escape') return { kind: 'clearSelection' };
  }

  // --- 3. Otherwise the arrows nudge the pointer itself, one pixel at a time.
  // With a button held this feeds the active tool exactly as a mouse move does,
  // so holding the pencil and tapping an arrow draws one pixel. Edit mode only:
  // in simulate mode the arrows do nothing at all.
  if (arrow && !ctx.hasFloating) {
    // Both editing and analysis own the pointer, and both want precise
    // positioning — one to place a pixel, the other to place a selection edge.
    if ((ctx.mode === 'edit' || ctx.mode === 'analysis') && !typing) {
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
    // E and A each toggle one mode against Simulate. With three modes a single
    // "next mode" key would make Simulate unreachable without cycling through
    // the other one, and would make what a key does depend on where you already
    // are — which is the thing this table exists to prevent.
    case 'e':
    case 'E':
      return typing ? null : { kind: 'toggleMode', target: 'edit' };
    case 'a':
    case 'A':
      return typing ? null : { kind: 'toggleMode', target: 'analysis' };
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
