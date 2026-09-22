// geometry.mjs — the wires must actually be wires.
//
// Before this, the editor rasterised with Bresenham, which steps diagonally,
// while the engine joins wire pixels only on the four cardinal sides. A 45
// degree "line" was nine separate nets. Nothing reported an error, because a
// gap in a wire is not an error — it is a different circuit. These checks are
// the guard against that coming back.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { blank, check, equal, loadEngine, put, ROOT, summary, WIRE } from './harness.mjs';

const { Circuit } = await loadEngine();
const { walkConnected, busOffsets } = await import(
  pathToFileURL(join(ROOT, 'dist', 'geometry.js')).href
);

/** How many nets does a set of drawn pixels compile to? */
function netsFor(draw, size = 140) {
  const img = blank(size, size);
  draw((x, y) => put(img, x, y, WIRE));
  return new Circuit(img, null).wireCount;
}

const collect = (x0, y0, x1, y1) => {
  const out = [];
  walkConnected(x0, y0, x1, y1, (x, y) => out.push([x, y]));
  return out;
};

console.log('Connectivity\n');

const RUNS = [
  ['horizontal', 4, 4, 60, 4],
  ['vertical', 4, 4, 4, 60],
  ['45 degrees', 4, 4, 40, 40],
  ['shallow', 4, 4, 60, 18],
  ['steep', 4, 4, 18, 60],
  ['reverse diagonal', 40, 40, 4, 4],
];

for (const [label, x0, y0, x1, y1] of RUNS) {
  equal(
    `  ${label}: one net`,
    netsFor((visit) => walkConnected(x0, y0, x1, y1, visit)),
    1
  );
}

// Every consecutive pair must differ on exactly one axis, by exactly one.
let worst = null;
for (const [, x0, y0, x1, y1] of RUNS) {
  const pts = collect(x0, y0, x1, y1);
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    if (dx + dy !== 1) worst = `${pts[i - 1]} -> ${pts[i]}`;
  }
}
check('  every step moves one axis by one', worst === null, worst ?? '');

// Direction independence, as actually specified: same endpoints, same length and
// equally connected either way. The staircase *mirrors* when drawn backwards —
// the steps fall on the other side of the ideal line — which is cosmetic and is
// why set-equality is deliberately not asserted here (see contracts/geometry.md).
for (const [label, x0, y0, x1, y1] of RUNS) {
  const fwd = collect(x0, y0, x1, y1);
  const rev = collect(x1, y1, x0, y0);
  const key = (p) => `${p[0]},${p[1]}`;
  check(`  ${label}: same length drawn backwards`, fwd.length === rev.length, `${fwd.length} vs ${rev.length}`);
  check(
    `  ${label}: hits both endpoints`,
    key(fwd[0]) === `${x0},${y0}` && key(fwd[fwd.length - 1]) === `${x1},${y1}`,
    ''
  );
  check(
    `  ${label}: connected in both directions`,
    netsFor((visit) => walkConnected(x1, y1, x0, y0, visit)) === 1
  );
}

// Axis-aligned runs must not have gained pixels (FR-002): a straight run of
// length n is exactly n pixels, same as Bresenham produced.
equal('  horizontal run length unchanged', collect(4, 4, 60, 4).length, 57);
equal('  vertical run length unchanged', collect(4, 4, 4, 60).length, 57);

console.log('\nBus spacing\n');

let busFailures = 0;
for (const [label, x0, y0, x1, y1] of RUNS.slice(0, 5)) {
  const bad = [];
  for (let n = 1; n <= 16; n++) {
    const nets = netsFor((visit) => {
      for (const { dx, dy } of busOffsets(x0, y0, x1, y1, n)) {
        walkConnected(x0 + dx, y0 + dy, x1 + dx, y1 + dy, visit);
      }
    });
    if (nets !== n) bad.push(`n=${n} gave ${nets}`);
  }
  busFailures += bad.length;
  check(`  ${label}: widths 1-16 each give exactly N nets`, bad.length === 0, bad.join(' '));
}

// A bus of one must be exactly the plain line.
const single = busOffsets(4, 4, 40, 40, 1);
check(
  '  bus of 1 is the drawn line',
  single.length === 1 && single[0].dx === 0 && single[0].dy === 0,
  JSON.stringify(single)
);
void busFailures;

summary('geometry');
