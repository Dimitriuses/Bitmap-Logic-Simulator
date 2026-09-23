// keymap.mjs — the precedence table, checked exhaustively.
//
// Several features want Enter, Escape and the arrow keys. resolveKey is a pure
// function over a small state space, so rather than trusting a table in a
// selection, in both modes. The expected values below are contracts/input.md.
// document, every key is checked against every combination of floating paste and
// contracts/input.md transcribed.

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

/** The row of the precedence table that should win for a given state. */
function expected(key, ctx) {
  if (ctx.hasFloating) {
    if (key === 'ArrowLeft') return 'move:paste';
    if (key === 'Enter') return 'commit';
    if (key === 'Escape') return 'cancelPaste';
  }
  if (!ctx.hasFloating && ctx.hasSelection) {
    if (key === 'Delete') return 'clearRegion';
    if (key === 'Escape') return 'clearSelection';
  }
  if (key === 'ArrowLeft' && !ctx.hasFloating) {
    return ctx.mode === 'edit' ? 'move:pointer' : 'none';
  }
  if (key === 'Escape') return 'toggleSettings';
  // Space always pauses. There is no apply key: the arrows move the pointer
  // itself, so a held mouse button is what makes them draw.
  if (key === ' ') return 'togglePause';
  // Analysis is defined relative to a selection, so A is bound only when there
  // is one -- and it must lose to Escape's selection/paste rows above, which
  // is what puts it here rather than earlier.
  if (key === 'a') return ctx.hasSelection ? 'analyse' : 'none';
  return 'none';
}

const describe = (a) =>
  a === null ? 'none' : a.kind === 'move' ? `move:${a.target}` : a.kind;

console.log('Precedence table (exhaustive)\n');

const KEYS = [' ', 'Enter', 'Escape', 'Delete', 'ArrowLeft', 'a'];
let cases = 0;
let mismatches = [];

for (const mode of ['simulate', 'edit']) {
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

console.log('\nSpace is never overloaded\n');

// An earlier design had the arrows drive a separate cursor with Space to apply
// the tool at it, which put Space in conflict with pause. Moving the arrows onto
// the pointer itself removed the need for an apply key, so Space means one thing
// everywhere. This is the check that it stays that way.
const cursorOff = { mode: 'edit', hasFloating: false, hasSelection: false };
const everyState = [];
for (const mode of ['simulate', 'edit'])
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

summary('keymap');
