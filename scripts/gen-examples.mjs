// gen-examples.mjs — build dist/examples.json by scanning projects/.
//
// The Examples dropdown is generated from the real schematics in the repo
// rather than a curated copy, so adding a PNG under projects/ and rebuilding is
// all it takes to make it selectable. Run via `npm run examples` (part of
// `npm run build`).

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = 'projects';
const OUT_FILE = join(root, 'dist', 'examples.json');

/** Schematics that a mechanical prettifier would render badly. */
const LABELS = {
  '34segments': '34 Segments',
  '4bitAdder': '4-bit Adder',
  '4bitCPU': '4-bit CPU',
  'Digital_Led': 'Digital LED',
  'Enigma2': 'Enigma 2',
  'Flash Memory 256x12': 'Flash Memory 256×12',
  'HOqUbyL': 'HOqUbyL',
  'LookKeypad': 'Look Keypad',
  'Memory new': 'Memory (new)',
  'Memory old': 'Memory (old)',
  'prog1': 'Program 1',
  'prog2': 'Program 2',
  'reg': 'Register',
};

/** Groups worth showing first; anything else follows alphabetically. */
const GROUP_ORDER = ['CPU', 'Calc', 'Enigma v1', 'Enigma v2', 'External Shemes'];

/** Files sitting directly in projects/, with no project folder of their own. */
const UNGROUPED = 'Misc';

function prettify(stem) {
  if (LABELS[stem]) return LABELS[stem];
  const spaced = stem
    .replace(/[_-]+/g, ' ')
    // counter2 -> counter 2, but leave 4bitCPU-style stems to the override map.
    .replace(/([a-z])(\d)/g, '$1 $2')
    // camelCase -> camel Case
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function prettifyGroup(folder) {
  return folder.replace(/_/g, ' ');
}

/** Every .png under dir, as paths relative to the project root. */
function collect(dir, entries = []) {
  let listing;
  try {
    listing = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const item of listing) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) {
      collect(path, entries);
    } else if (item.name.toLowerCase().endsWith('.png')) {
      const stem = item.name.slice(0, -4);
      const folder = dirname(path).split(/[\\/]/).pop();
      entries.push({
        path,
        label: prettify(stem),
        group: folder === SOURCE_DIR ? UNGROUPED : prettifyGroup(folder),
      });
    }
  }
  return entries;
}

function groupRank(group) {
  if (group === UNGROUPED) return GROUP_ORDER.length + 1;
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

const examples = collect(SOURCE_DIR).sort((a, b) => {
  const rank = groupRank(a.group) - groupRank(b.group);
  if (rank !== 0) return rank;
  const byGroup = a.group.localeCompare(b.group);
  return byGroup !== 0 ? byGroup : a.label.localeCompare(b.label);
});

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(examples, null, 2)}\n`);

if (examples.length === 0) {
  console.warn(`gen-examples: no PNGs found under ${SOURCE_DIR}/ — the menu will be empty.`);
} else {
  const groups = new Set(examples.map((e) => e.group));
  console.log(`gen-examples: ${examples.length} schematics in ${groups.size} groups`);
}
