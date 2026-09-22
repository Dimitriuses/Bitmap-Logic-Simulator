// counts.mjs — compile every schematic and report its wire/gate counts.
//
// Two modes:
//   node scripts/verify/counts.mjs --save   write scripts/verify/baseline.json
//   node scripts/verify/counts.mjs          compare against the saved baseline
//
// The comparison is the regression guard for quickstart Scenario 0: the
// CircuitDocument refactor must not change a single count. It also reports
// compile time, which is the number SC-003 is measured against.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadEngine, loadPng } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'baseline.json');
const save = process.argv.includes('--save');

/** Every .png under projects/, repo-relative, sorted for stable output. */
function schematics(dir = 'projects', found = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) schematics(path, found);
    else if (entry.name.toLowerCase().endsWith('.png')) found.push(path);
  }
  return found.sort();
}

const { Circuit } = await loadEngine();
const results = {};

for (const path of schematics()) {
  const image = loadPng(join(ROOT, path));
  const t0 = performance.now();
  const circuit = new Circuit(image, null);
  const compileMs = performance.now() - t0;
  results[path] = {
    size: `${circuit.width}x${circuit.height}`,
    wires: circuit.wireCount,
    gates: circuit.gateCount,
  };
  console.log(
    `${path.padEnd(42)} ${results[path].size.padEnd(11)} ` +
      `${String(results[path].wires).padStart(6)} wires  ` +
      `${String(results[path].gates).padStart(6)} gates  ` +
      `${compileMs.toFixed(0).padStart(4)} ms`
  );
}

if (save) {
  writeFileSync(BASELINE, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nbaseline written: ${Object.keys(results).length} schematics`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('\nNo baseline.json. Run with --save first.');
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
let drift = 0;

for (const [path, now] of Object.entries(results)) {
  const was = baseline[path];
  if (!was) {
    console.log(`\n  NEW    ${path} (not in baseline)`);
    continue;
  }
  for (const key of ['size', 'wires', 'gates']) {
    if (was[key] !== now[key]) {
      console.log(`\n  DRIFT  ${path} ${key}: ${was[key]} -> ${now[key]}`);
      drift++;
    }
  }
}
for (const path of Object.keys(baseline)) {
  if (!results[path]) {
    console.log(`\n  GONE   ${path} (in baseline, not found)`);
    drift++;
  }
}

console.log(
  drift === 0
    ? `\nAll ${Object.keys(results).length} schematics match the baseline.`
    : `\n${drift} difference(s) against the baseline.`
);
process.exitCode = drift === 0 ? 0 : 1;
