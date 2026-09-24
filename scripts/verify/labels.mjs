// labels.mjs — quickstart Scenario 10.
//
// A label is a name bound to a pixel. Almost everything here is about what must
// NOT happen to it when the circuit changes: the failure mode that matters is
// not losing a name, it is a name silently ending up on a different wire, where
// it still looks right.

import {
  blank,
  check,
  equal,
  gateFixture,
  get,
  hLine,
  loadDist,
  loadEngine,
  put,
  summary,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const L = await loadDist('labels.js');

console.log('Scenario 10: labels\n');

// --------------------------------------------------------------------------
// 1. Anchored to a pixel, resolved by asking.
// --------------------------------------------------------------------------

{
  const f = gateFixture('right');
  const circuit = new Circuit(f.image, null);
  const src = circuit.wireAt(f.probes.src.x, f.probes.src.y);
  const dst = circuit.wireAt(f.probes.dst.x, f.probes.dst.y);

  const store = new L.LabelStore('fixture.png');
  store.set(f.probes.src, 'clk');
  store.set(f.probes.dst, 'q');

  const r = store.resolve(circuit);
  equal('two labels resolve', r.byNet.size, 2);
  equal('the source is named', r.byNet.get(src)?.name, 'clk');
  equal('the destination is named', r.byNet.get(dst)?.name, 'q');
  equal('nothing is unresolved', r.unresolved.length, 0);

  const name = L.makeNamer(r);
  equal('the namer returns the name', name(src), 'clk');
  equal('and null for an unnamed net', name(9999), null);
}

// --------------------------------------------------------------------------
// 2. THE CASE THAT MATTERS: erase under an anchor.
// --------------------------------------------------------------------------
//
// The label must become unresolved — not deleted, and above all not moved to
// whichever net is now nearest. A name on the wrong wire is worse than no name.

{
  const f = gateFixture('right');
  const before = new Circuit(f.image, null);
  const src = before.wireAt(f.probes.src.x, f.probes.src.y);

  const store = new L.LabelStore('fixture.png');
  store.set(f.probes.src, 'clk');
  equal('it resolves before the edit', store.resolve(before).byNet.get(src)?.name, 'clk');

  // Erase exactly the anchored pixel.
  const edited = blank(f.image.width, f.image.height);
  for (let y = 0; y < f.image.height; y++) {
    for (let x = 0; x < f.image.width; x++) put(edited, x, y, get(f.image, x, y));
  }
  put(edited, f.probes.src.x, f.probes.src.y, [0, 0, 0]);
  const after = new Circuit(edited, null);

  const r = store.resolve(after);
  equal('the label is kept, not deleted', store.size, 1);
  equal('it is reported as unresolved', r.unresolved.length, 1);
  equal('  by name', r.unresolved[0].name, 'clk');
  equal('and is attached to NO net', r.byNet.size, 0);
  check('specifically not to a neighbouring net',
    ![...r.byNet.values()].some((l) => l.name === 'clk'));
}

{
  // A subtler version: the pixel survives but the circuit around it changes, so
  // net ids are reassigned. The label must follow the PIXEL, not an id.
  const image = blank(20, 9);
  hLine(image, 1, 8, 4);
  hLine(image, 12, 18, 4);
  const separate = new Circuit(image, null);
  const rightNet = separate.wireAt(15, 4);

  const store = new L.LabelStore('two-wires.png');
  store.set({ x: 15, y: 4 }, 'bus');
  equal('named on the right-hand wire', store.resolve(separate).byNet.get(rightNet)?.name, 'bus');

  // Join the two wires: one net now, and the ids are not what they were.
  const joined = blank(20, 9);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 20; x++) put(joined, x, y, get(image, x, y));
  hLine(joined, 8, 12, 4);
  const merged = new Circuit(joined, null);

  const r = store.resolve(merged);
  equal('after joining, the label still resolves', r.byNet.size, 1);
  const named = [...r.byNet.entries()][0];
  equal('  to the net now at that pixel', named[0], merged.wireAt(15, 4));
  equal('  with the same name', named[1].name, 'bus');
  check('and that net really does contain the anchor', merged.wireAt(15, 4) !== 0);
}

// --------------------------------------------------------------------------
// 3. Selections: outside is not unresolved.
// --------------------------------------------------------------------------

{
  const f = gateFixture('down');
  const circuit = new Circuit(f.image, null);
  const store = new L.LabelStore('fixture.png');
  store.set({ x: 4, y: 1 }, 'in');
  store.set({ x: 400, y: 400 }, 'elsewhere');

  const r = store.resolve(circuit);
  equal('the in-range label resolves', r.byNet.size, 1);
  equal('the far one is reported as outside', r.outside.length, 1);
  equal('and NOT as unresolved', r.unresolved.length, 0);
}

{
  // An anchor in document space, resolved against a cropped selection.
  const f = gateFixture('down');
  const crop = blank(5, 9);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 5; x++) put(crop, x, y, get(f.image, x + 2, y));
  const circuit = new Circuit(crop, null);

  const store = new L.LabelStore('fixture.png');
  store.set({ x: 4, y: 1 }, 'in'); // document coords
  const r = store.resolve(circuit, { x: 2, y: 0 });
  equal('a document anchor resolves against a crop', r.byNet.size, 1);
  equal('  with its name', [...r.byNet.values()][0].name, 'in');
}

// --------------------------------------------------------------------------
// 4. Round trip, and refusing malformed input.
// --------------------------------------------------------------------------

{
  const store = new L.LabelStore('4bitCPU.png');
  store.set({ x: 542, y: 634 }, 'AX.hold');
  store.set({ x: 551, y: 631 }, 'AX.set', 'net');

  const text = store.toJson();
  const parsed = L.parseSidecar(text);
  check('a sidecar round-trips', parsed.ok, parsed.ok ? '' : parsed.reason);
  if (parsed.ok) {
    equal('both labels survive', parsed.labels.length, 2);
    // Order is by position, not by insertion — so a sidecar written twice is
    // byte-identical however the names were added.
    equal('sorted by anchor: topmost first', parsed.labels[0].anchor.y, 631);
    equal('  which is AX.set', parsed.labels[0].name, 'AX.set');
    equal('  then AX.hold', parsed.labels[1].name, 'AX.hold');
    equal('  with its anchor intact', parsed.labels[1].anchor.x, 542);
    equal('the circuit hint travels too', parsed.circuit, '4bitCPU.png');

    const again = new L.LabelStore('4bitCPU.png');
    again.replaceAll(parsed.labels);
    equal('and a second export is byte-identical', again.toJson(), text);

    // Added in the opposite order, the file must still come out the same.
    const reversed = new L.LabelStore('4bitCPU.png');
    reversed.set({ x: 551, y: 631 }, 'AX.set');
    reversed.set({ x: 542, y: 634 }, 'AX.hold');
    equal('insertion order does not change the file', reversed.toJson(), text);
  }

  equal('the sidecar is named after the circuit', store.sidecarName, '4bitCPU.labels.json');
}

{
  const rejects = [
    ['not JSON', '{oh no'],
    ['not an object', '42'],
    ['wrong format', JSON.stringify({ format: 'something', version: 1, labels: [] })],
    ['wrong version', JSON.stringify({ format: 'bitmap-logic-labels', version: 7, labels: [] })],
    ['missing labels', JSON.stringify({ format: 'bitmap-logic-labels', version: 1 })],
    ['anchor is not a point', JSON.stringify({ format: 'bitmap-logic-labels', version: 1, labels: [{ anchor: { x: 'a', y: 1 }, name: 'x' }] })],
    ['anchor is not whole pixels', JSON.stringify({ format: 'bitmap-logic-labels', version: 1, labels: [{ anchor: { x: 1.5, y: 1 }, name: 'x' }] })],
    ['empty name', JSON.stringify({ format: 'bitmap-logic-labels', version: 1, labels: [{ anchor: { x: 1, y: 1 }, name: '  ' }] })],
    ['duplicate anchors', JSON.stringify({ format: 'bitmap-logic-labels', version: 1, labels: [{ anchor: { x: 1, y: 1 }, name: 'a' }, { anchor: { x: 1, y: 1 }, name: 'b' }] })],
  ];
  for (const [label, text] of rejects) {
    const r = L.parseSidecar(text);
    check(`refused: ${label}`, r.ok === false, r.ok === false ? r.reason : 'ACCEPTED');
  }
}

// --------------------------------------------------------------------------
// 5. Setting, clearing, divergence.
// --------------------------------------------------------------------------

{
  const store = new L.LabelStore('x.png');
  store.set({ x: 1, y: 1 }, 'a');
  equal('a label is stored', store.size, 1);
  store.set({ x: 1, y: 1 }, 'b');
  equal('naming the same anchor replaces rather than duplicates', store.size, 1);
  equal('  with the new name', store.labels[0].name, 'b');
  store.set({ x: 1, y: 1 }, '   ');
  equal('an empty name clears it', store.size, 0);

  store.set({ x: 2, y: 2 }, ' padded ');
  equal('names are trimmed', store.labels[0].name, 'padded');
  store.clear({ x: 2, y: 2 });
  equal('and can be cleared explicitly', store.size, 0);
}

{
  const a = [{ anchor: { x: 1, y: 1 }, name: 'a', kind: 'net' }];
  const b = [{ anchor: { x: 1, y: 1 }, name: 'a', kind: 'net' }];
  const c = [{ anchor: { x: 1, y: 1 }, name: 'different', kind: 'net' }];
  check('identical sets do not differ', L.labelsDiffer(a, b) === false);
  check('a changed name differs', L.labelsDiffer(a, c) === true);
  check('a different size differs', L.labelsDiffer(a, []) === true);
}

// --------------------------------------------------------------------------
// 6. Two labels on one net resolve deterministically.
// --------------------------------------------------------------------------

{
  const image = blank(12, 9);
  hLine(image, 1, 10, 4);
  const circuit = new Circuit(image, null);

  const first = new L.LabelStore('w.png');
  first.set({ x: 8, y: 4 }, 'second');
  first.set({ x: 2, y: 4 }, 'first');

  const second = new L.LabelStore('w.png');
  second.set({ x: 2, y: 4 }, 'first');
  second.set({ x: 8, y: 4 }, 'second');

  const a = [...first.resolve(circuit).byNet.values()][0].name;
  const b = [...second.resolve(circuit).byNet.values()][0].name;
  equal('two names on one net resolve the same way regardless of order', a, b);
}

summary('labels');
