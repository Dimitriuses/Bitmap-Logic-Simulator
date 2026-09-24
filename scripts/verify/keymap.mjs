// keymap.mjs — the precedence table, checked exhaustively.
//
// Several features want Enter, Escape and the arrow keys. resolveKey is a pure
// function over a small state space, so rather than trusting a table in a
// document, every key is checked against every combination of mode, floating
// paste and selection.
//
// Since 004 there are three modes, and one of them — analysis — promises it
// cannot change the circuit. That promise is only worth what this file proves,
// so there is a dedicated section below that sweeps every key and every
// modifier combination in analysis mode and asserts none of them produces an
// action that writes.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { check, ROOT, summary } from './harness.mjs';

const { resolveKey } = await import(pathToFileURL(join(ROOT, 'dist', 'keymap.js')).href);

const ev = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

const MODES = ['simulate', 'edit', 'analysis'];

/** The row of the precedence table that should win for a given state. */
function expected(key, ctx) {
  // Analysis mode is read-only, and every action that could change the
  // document is gated on this one fact.
  const canEdit = ctx.mode !== 'analysis';

  if (ctx.hasFloating && canEdit) {
    if (key === 'ArrowLeft') return 'move:paste';
    if (key === 'Enter') return 'commit';
    if (key === 'Escape') return 'cancelPaste';
  }
  // Enter runs the analysis, and can only mean that because a floating paste —
  // the other claimant on Enter — cannot exist in this mode.
  if (ctx.mode === 'analysis' && key === 'Enter') {
    return ctx.hasSelection ? 'analyse' : 'none';
  }
  if (!ctx.hasFloating && ctx.hasSelection) {
    // Delete clears pixels, so it is an edit. Escape only drops the selection,
    // which changes nothing in the document.
    if (canEdit && key === 'Delete') return 'clearRegion';
    if (key === 'Escape') return 'clearSelection';
  }
  if (key === 'ArrowLeft' && !ctx.hasFloating) {
    // Both modes that own the pointer want precise positioning — one to place
    // a pixel, the other to place a selection edge.
    return ctx.mode === 'edit' || ctx.mode === 'analysis' ? 'move:pointer' : 'none';
  }
  if (key === 'Escape') return 'toggleSettings';
  // Space always pauses. There is no apply key: the arrows move the pointer
  // itself, so a held mouse button is what makes them draw.
  if (key === ' ') return 'togglePause';
  // E and A each toggle one mode against Simulate, so what they mean never
  // depends on which mode you are already in.
  if (key === 'a') return 'toggleMode';
  return 'none';
}

const describe = (a) =>
  a === null ? 'none' : a.kind === 'move' ? `move:${a.target}` : a.kind;

console.log('Precedence table (exhaustive)\n');

const KEYS = [' ', 'Enter', 'Escape', 'Delete', 'ArrowLeft', 'a'];
let cases = 0;
let mismatches = [];

for (const mode of MODES) {
  for (const hasFloating of [false, true]) {
    for (const hasSelection of [false, true]) {
      const ctx = { mode, hasFloating, hasSelection };
      for (const key of KEYS) {
        cases++;
        const got = describe(resolveKey(ev(key), ctx));
        const want = expected(key, ctx);
        if (got !== want) {
          mismatches.push(
            `${key} @ ${mode}/f=${hasFloating}/s=${hasSelection}: want ${want}, got ${got}`
          );
        }
      }
    }
  }
}

check(`  ${cases} state/key combinations`, mismatches.length === 0, mismatches.slice(0, 5).join(' | '));

// -------------------------------------------------------------------------
// Analysis mode writes nothing.
//
// The check the whole mode rests on. Not "each handler was careful" but "no
// combination of context, key and modifier produces a writing action at all",
// which is the only form of that claim that cannot rot.
// -------------------------------------------------------------------------

console.log('\nAnalysis mode writes nothing\n');

const WRITING_ACTIONS = new Set([
  'copy',
  'cut',
  'clearRegion',
  'paste',
  'commit',
  'cancelPaste',
  'undo',
  'redo',
]);

const ALL_KEYS = [
  ' ', 'Enter', 'Escape', 'Delete', 'Backspace', 'Tab',
  'a', 'A', 'e', 'E', 'r', 'R', 'f', 'F',
  'z', 'Z', 'y', 'Y', 'c', 'C', 'x', 'X', 'v', 'V', 's', 'S',
  '+', '-', '=', '_',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
];

const MODIFIERS = [
  {},
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { ctrlKey: true, shiftKey: true },
  { metaKey: true, shiftKey: true },
];

const writes = [];
let analysisCases = 0;
for (const hasFloating of [false, true]) {
  for (const hasSelection of [false, true]) {
    const ctx = { mode: 'analysis', hasFloating, hasSelection };
    for (const key of ALL_KEYS) {
      for (const mods of MODIFIERS) {
        analysisCases++;
        const got = describe(resolveKey(ev(key, mods), ctx));
        if (WRITING_ACTIONS.has(got)) {
          const m = Object.keys(mods).join('+') || 'none';
          writes.push(`${m}+${key} @ f=${hasFloating}/s=${hasSelection} -> ${got}`);
        }
      }
    }
  }
}
check(
  `  ${analysisCases} analysis-mode combinations produce no writing action`,
  writes.length === 0,
  writes.slice(0, 5).join(' | ')
);

const inAnalysis = (key, mods = {}, extra = {}) =>
  describe(
    resolveKey(ev(key, mods), { mode: 'analysis', hasFloating: false, hasSelection: true, ...extra })
  );

// Saving is not editing: it writes the file, not the document, so a read-only
// mode has no reason to forbid keeping your work.
check('  Ctrl+S still saves in analysis mode', inAnalysis('s', { ctrlKey: true }) === 'save');
check('  Escape still clears a selection in analysis mode', inAnalysis('Escape') === 'clearSelection');
check('  Enter runs the analysis when something is selected', inAnalysis('Enter') === 'analyse');
check(
  '  Enter does nothing with no selection',
  inAnalysis('Enter', {}, { hasSelection: false }) === 'none'
);
check('  arrows still nudge the pointer in analysis mode', inAnalysis('ArrowLeft') === 'move:pointer');

// The same keys in edit mode must be unaffected by all of this.
const inEdit = (key, mods = {}) =>
  describe(resolveKey(ev(key, mods), { mode: 'edit', hasFloating: false, hasSelection: true }));
check('  edit mode still copies', inEdit('c', { ctrlKey: true }) === 'copy');
check('  edit mode still deletes a region', inEdit('Delete') === 'clearRegion');

console.log('\nModifier combinations\n');

const base = { mode: 'edit', hasFloating: false, hasSelection: true };
const ctrl = (key, mods = {}) => describe(resolveKey(ev(key, { ctrlKey: true, ...mods }), base));

check('  Ctrl+Z is undo', ctrl('z') === 'undo', ctrl('z'));
check('  Ctrl+Shift+Z is redo', ctrl('z', { shiftKey: true }) === 'redo');
check('  Ctrl+Y is redo', ctrl('y') === 'redo');
check('  Ctrl+S is save', ctrl('s') === 'save');
check('  Ctrl+C is copy when something is selected', ctrl('c') === 'copy');
check('  Ctrl+X is cut when something is selected', ctrl('x') === 'cut');
check('  Ctrl+V is paste', ctrl('v') === 'paste');

const noSel = { ...base, hasSelection: false };
check(
  '  Ctrl+C does nothing with no selection',
  describe(resolveKey(ev('c', { ctrlKey: true }), noSel)) === 'none'
);

console.log('\nMode keys\n');

// E and A each toggle one mode against Simulate. A single "next mode" key
// would make what the key does depend on where you already are, which is the
// thing this table exists to prevent.
const modeKey = (key, mode) =>
  resolveKey(ev(key), { mode, hasFloating: false, hasSelection: false });
for (const mode of MODES) {
  check(
    `  E targets edit from ${mode}`,
    modeKey('e', mode)?.kind === 'toggleMode' && modeKey('e', mode)?.target === 'edit'
  );
  check(
    `  A targets analysis from ${mode}`,
    modeKey('a', mode)?.kind === 'toggleMode' && modeKey('a', mode)?.target === 'analysis'
  );
}

console.log('\nSpace is never overloaded\n');

// An earlier design had the arrows drive a separate cursor with Space to apply
// the tool at it, which put Space in conflict with pause. Moving the arrows onto
// the pointer itself removed the need for an apply key, so Space means one thing
// everywhere. This is the check that it stays that way.
const cursorOff = { mode: 'edit', hasFloating: false, hasSelection: false };
const everyState = [];
for (const mode of MODES)
  for (const hasFloating of [false, true])
    for (const hasSelection of [false, true])
      everyState.push({ mode, hasFloating, hasSelection });
check(
  '  Space pauses in every state',
  everyState.every((c) => describe(resolveKey(ev(' '), c)) === 'togglePause')
);
check(
  '  arrows in edit mode move the pointer',
  describe(resolveKey(ev('ArrowLeft'), cursorOff)) === 'move:pointer'
);
check(
  '  arrows in simulate mode do nothing',
  resolveKey(ev('ArrowLeft'), { ...cursorOff, mode: 'simulate' }) === null
);

console.log('\nTyping is never intercepted\n');

const typing = { key: ' ', ctrlKey: false, metaKey: false, shiftKey: false, targetTag: 'INPUT' };
check('  Space in a text field is ignored', resolveKey(typing, cursorOff) === null);
check(
  '  arrows in a text field do not move the pointer',
  resolveKey({ ...typing, key: 'ArrowLeft' }, cursorOff) === null
);
check(
  '  A in a text field does not switch mode',
  resolveKey({ ...typing, key: 'a' }, { ...cursorOff, mode: 'analysis' }) === null
);

summary('keymap');
