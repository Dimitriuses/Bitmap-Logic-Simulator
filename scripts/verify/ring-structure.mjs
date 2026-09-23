// ring-structure.mjs — the loop the ringing nets sit in, and its length.
//
// Every gate in this medium is an inverter. So a closed loop of gates inverts
// its own input once per lap, and the parity of the lap decides everything:
//
//   even number of inverters  ->  a latch: two stable states, it holds
//   odd number of inverters   ->  a ring oscillator: no stable state at all
//
// ringing.mjs localises which nets never stop moving. This says why.

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const S = await loadDist('sequential.js');

const RECT = { x: 412, y: 623, width: 166, height: 133 }; // cluster #8
const BOX = { x0: 540, x1: 553, y0: 632, y1: 647 }; // where ringing.mjs pointed

const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
const image = new globalThis.ImageData(
  new Uint8ClampedArray(RECT.width * RECT.height * 4),
  RECT.width,
  RECT.height
);
for (let y = 0; y < RECT.height; y++) {
  for (let x = 0; x < RECT.width; x++) {
    const s = ((y + RECT.y) * source.width + (x + RECT.x)) << 2;
    const d = (y * RECT.width + x) << 2;
    image.data[d] = source.data[s];
    image.data[d + 1] = source.data[s + 1];
    image.data[d + 2] = source.data[s + 2];
    image.data[d + 3] = 255;
  }
}

const circuit = new Circuit(image, null);
const r = extractNetlist(circuit, image);
if (!r.ok) throw new Error(r.reason);
const netlist = r.netlist;

const abs = (p) => ({ x: p.x + RECT.x, y: p.y + RECT.y });
const inBox = (p) => {
  const a = abs(p);
  return a.x >= BOX.x0 && a.x <= BOX.x1 && a.y >= BOX.y0 && a.y <= BOX.y1;
};

const localGates = netlist.gates.filter((g) => inBox(g.at));
console.log(
  `cluster #8: ${netlist.gates.length} gates total, ` +
    `${localGates.length} inside x ${BOX.x0}..${BOX.x1}, y ${BOX.y0}..${BOX.y1}\n`
);

console.log('  gate at (image coords)   direction   src -> dst');
console.log('  ----------------------   ---------   ----------');
for (const g of localGates) {
  const a = abs(g.at);
  console.log(
    `  (${String(a.x).padStart(4)},${String(a.y).padStart(4)})` +
      `              ${g.direction.padEnd(9)}   ${String(g.src).padStart(4)} -> ${g.dst}`
  );
}

// --- the cycles these gates form
const local = new Set(localGates.flatMap((g) => [g.src, g.dst]));
const adj = new Map();
for (const g of netlist.gates) {
  if (!local.has(g.src) || !local.has(g.dst)) continue;
  if (!adj.has(g.src)) adj.set(g.src, []);
  adj.get(g.src).push(g.dst);
}

console.log(`\n${local.size} nets involved. Cycles among them:\n`);

// Enumerate simple cycles by DFS. The subgraph is a dozen nodes, so this is
// fine here -- it is exactly what would be unaffordable on the whole circuit,
// and why sequential.ts uses SCCs instead.
const cycles = [];
const seen = new Set();
for (const start of local) {
  const stack = [[start, [start]]];
  while (stack.length) {
    const [v, path] = stack.pop();
    for (const w of adj.get(v) ?? []) {
      if (w === start) {
        const key = [...path].sort((a, b) => a - b).join(',');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...path]);
        }
      } else if (!path.includes(w) && path.length < 12) {
        stack.push([w, [...path, w]]);
      }
    }
  }
}

cycles.sort((a, b) => a.length - b.length);
for (const c of cycles.slice(0, 12)) {
  const where = c
    .map((id) => {
      const n = netlist.nets.find((x) => x.id === id);
      const a = abs(n.probe);
      return `(${a.x},${a.y})`;
    })
    .join(' -> ');
  const parity = c.length % 2 === 0 ? 'EVEN: latches, two stable states' : 'ODD: OSCILLATES';
  console.log(`  ${c.length} inverters  ${parity}`);
  console.log(`    ${where} -> back to start`);
}
if (cycles.length > 12) console.log(`  … and ${cycles.length - 12} more cycles`);

const odd = cycles.filter((c) => c.length % 2 === 1);
const even = cycles.filter((c) => c.length % 2 === 0);
console.log(`\n  ${cycles.length} cycles: ${even.length} even (latching), ${odd.length} ODD (oscillating)`);

void S;
