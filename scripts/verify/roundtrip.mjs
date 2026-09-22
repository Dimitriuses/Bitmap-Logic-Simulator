// roundtrip.mjs — compile any PNG and print its counts.
//
// Used to confirm that a circuit saved by the editor reopens as the same
// circuit (quickstart Scenario 3). The failure this guards against is loud:
// encoding the rendered frame instead of the source pixels writes unlit wires
// at 127, below the 224 threshold, so the reopened file would lose most of its
// wires and nearly all of its gates.
//
// Usage: node scripts/verify/roundtrip.mjs <file.png> [...more]

import { loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('usage: node scripts/verify/roundtrip.mjs <file.png> [...]');
  process.exit(2);
}

for (const file of files) {
  const circuit = new Circuit(loadPng(file), null);
  console.log(
    `${String(circuit.width + 'x' + circuit.height).padEnd(11)} ` +
      `${String(circuit.wireCount).padStart(6)} wires  ` +
      `${String(circuit.gateCount).padStart(6)} gates   ${file}`
  );
}
