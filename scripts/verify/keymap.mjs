// keymap.mjs — the precedence table, checked exhaustively.
//
// Three features want Enter, Escape and the arrow keys. resolveKey is a pure
// function over a small state space, so rather than trusting a table in a
// document, every key is checked against every combination of floating paste /
// keyboard cursor / selection, in both modes. The expected values below are
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
  if (!ctx.hasFloating && ctx.cursorActive) {
    if (key === 'ArrowLeft') return 'move:cursor';
    if (key === ' ') return 'applyTool';
    if (key === 'Escape') return 'deactivateCursor';
  }
  if (!ctx.hasFloating && ctx.hasSelection) {
    if (key === 'Delete') return 'clearRegion';
    if (key === 'Escape') return 'clearSelection';
  }
  if (key === 'ArrowLeft' && !ctx.hasFloating && !ctx.cursorActive) {
    return ctx.mode === 'edit' ? 'activateCursor' : 'none';
  }
  if (key === 'Escape') return 'toggleSettings';
  if (key === ' ') return 'togglePause';
  if (key === 'Enter') return 'none';
  if (key === 'Delete') return 'none';
  return 'none';
}

const describe = (a) =>
  a === null ? 'none' : a.kind === 'move' ? `move:${a.target}` : a.kind;

console.log('Precedence table (exhaustive)\n');

const KEYS = [' ', 'Enter', 'Escape', 'Delete', 'ArrowLeft'];
let cases = 0;
let mismatches = [];

for (const mode of ['simulate', 'edit']) {
  for (const hasFloating of [false, true]) {
    for (const cursorActive of [false, true]) {
      for (const hasSelection of [false, true]) {
        const ctx = { mode, hasFloating, cursorActive, hasSelection };
        for (const key of KEYS) {
          cases++;
          const got = describe(resolveKey(ev(key), ctx));
          const want = expected(key, ctx);
          if (got !== want) {
            mismatches.push(
              `${key} @ ${mode}/f=${hasFloating}/c=${cursorActive}/s=${hasSelection}: ` +
                `want ${want}, got ${got}`
            );
          }
        }
      }
    }
  }
}

check(`  ${cases} state/key combinations`, mismatches.length === 0, mismatches.slice(0, 5).join(' | '));

console.log('\nModifier combinations\n');

const base = { mode: 'edit', hasFloating: false, cursorActive: false, hasSelection: true };
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

console.log('\nThe Space conflict\n');

// The whole point of making the keyboard cursor a visible state: while it is on
// screen Space paints, and while it is not, Space pauses exactly as it always has.
const cursorOn = { mode: 'edit', hasFloating: false, cursorActive: true, hasSelection: false };
const cursorOff = { ...cursorOn, cursorActive: false };
check('  Space applies the tool while the cursor is visible', describe(resolveKey(ev(' '), cursorOn)) === 'applyTool');
check('  Space pauses while it is not', describe(resolveKey(ev(' '), cursorOff)) === 'togglePause');

console.log('\nTyping is never intercepted\n');

const typing = { key: ' ', ctrlKey: false, metaKey: false, shiftKey: false, targetTag: 'INPUT' };
check('  Space in a text field is ignored', resolveKey(typing, cursorOff) === null);
check(
  '  arrows in a text field do not start the cursor',
  resolveKey({ ...typing, key: 'ArrowLeft' }, cursorOff) === null
);

summary('keymap');
