// stamps.mjs — prove every stamp the editor can place is one the engine reads.
//
// This is the guard against the feature's quietest failure: a gate with the
// wrong corners is not an error, it is simply not a gate. Nothing throws,
// nothing looks different, and the circuit is dead. So each pattern is checked
// for the gate count AND the direction it actually carries signal.
//
// Run: node scripts/verify/stamps.mjs   (after npm run build)

import { blank, check, equal, hLine, loadEngine, run, stamp, summary, vLine, WIRE } from './harness.mjs';

const { Circuit } = await loadEngine();

// Mirrors src/stamps.ts, which mirrors detectGates(). Kept here as an
// independent copy on purpose: if someone "simplifies" the table in src, this
// catches the divergence instead of agreeing with it.
const STAMPS = {
  down: ['###', '#.#', '.#.'],
  left: ['.##', '#.#', '.##'],
  up: ['.#.', '#.#', '###'],
  right: ['##.', '#.#', '##.'],
  crossover: ['.#.', '#.#', '.#.'],
};

// Where each gate reads from and drives to.
const FLOW = {
  down: { src: 'N', dst: 'S' },
  left: { src: 'E', dst: 'W' },
  up: { src: 'S', dst: 'N' },
  right: { src: 'W', dst: 'E' },
};

const C = 10; // centre of a 21x21 test bitmap
const FAR = 5; // how far each arm reaches from the centre

/** The far end of the arm on a given side. */
const armEnd = {
  N: { x: C, y: C - FAR },
  S: { x: C, y: C + FAR },
  W: { x: C - FAR, y: C },
  E: { x: C + FAR, y: C },
};

function buildBitmap(pattern) {
  const img = blank(21, 21);
  // Arms first, then the stamp on top, so the pattern's insulation cells win.
  vLine(img, C, C - FAR, C - 1, WIRE);
  vLine(img, C, C + 1, C + FAR, WIRE);
  hLine(img, C - FAR, C - 1, C, WIRE);
  hLine(img, C + 1, C + FAR, C, WIRE);
  stamp(img, C, C, pattern);
  return img;
}

/** Brightness of a pixel in the rendered frame: >=224 is a lit wire. */
function brightness(circuit, x, y) {
  const d = circuit.frame.data;
  const p = (y * circuit.width + x) * 4;
  return Math.max(d[p], d[p + 1], d[p + 2]);
}

const isLit = (circuit, side) => brightness(circuit, armEnd[side].x, armEnd[side].y) >= 224;

console.log('Gate stamps\n');

for (const [direction, pattern] of Object.entries(STAMPS)) {
  if (direction === 'crossover') continue;
  const { src, dst } = FLOW[direction];
  console.log(`  ${direction} (${src} -> ${dst})`);

  // --- the gate is recognised at all
  const circuit = new Circuit(buildBitmap(pattern), null);
  equal(`    ${direction}: gateCount`, circuit.gateCount, 1);

  // --- inverter, with the source LOW: destination settles HIGH
  run(circuit, 40);
  circuit.render();
  check(`    ${direction}: src LOW -> ${dst} HIGH`, isLit(circuit, dst));

  // --- drive the source HIGH: destination settles LOW
  const driven = new Circuit(buildBitmap(pattern), null);
  for (let i = 0; i < 40; i++) {
    // Re-assert every cycle: the source arm is an input wire, but re-driving
    // it mirrors what holding the mouse button does.
    driven.setStateAt(armEnd[src].x, armEnd[src].y, '1');
    driven.simulate();
  }
  driven.render();
  check(`    ${direction}: src HIGH -> ${dst} LOW`, !isLit(driven, dst));

  // --- and it really is THAT side being driven, not merely some side.
  // The perpendicular arms belong to the source net (the two filled corners
  // bridge them), so they must follow the source, not the destination.
  check(
    `    ${direction}: ${dst} is the only driven side`,
    isLit(driven, src) === true && isLit(driven, dst) === false
  );
}

console.log('\n  crossover (H and V must not connect)');
const cross = new Circuit(buildBitmap(STAMPS.crossover), null);
equal('    crossover: gateCount', cross.gateCount, 0);
equal('    crossover: distinct nets', cross.wireCount, 2);

// Drive the horizontal run; the vertical one must stay dark.
for (let i = 0; i < 20; i++) {
  cross.setStateAt(armEnd.W.x, armEnd.W.y, '1');
  cross.simulate();
}
cross.render();
check('    crossover: W drives E', isLit(cross, 'E'));
check('    crossover: N stays dark', !isLit(cross, 'N'));
check('    crossover: S stays dark', !isLit(cross, 'S'));

summary('stamps');
