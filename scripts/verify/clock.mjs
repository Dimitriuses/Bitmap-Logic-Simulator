// clock.mjs — quickstart Scenario 8.
//
// Two detection signals, because each is blind to the other's case, and one
// honest limit: the structural signal cannot tell a clock from a reset. The
// check that matters most here is not that a clock is found — it is that two
// candidates the evidence cannot separate come back at EQUAL RANK, rather than
// in an order that reads as a judgement.

import {
  REGISTER_4BIT,
  check,
  equal,
  latchFixture,
  loadDist,
  loadEngine,
  netlistOf,
  ringOscillatorFixture,
  summary,
  wiredOrFixture,
} from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist } = await loadDist('netlist.js');
const ST = await loadDist('storage-elements.js');
const C = await loadDist('clock.js');

console.log('Scenario 8: finding the clock\n');

function open(image, label) {
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);
  if (!r.ok) throw new Error(`${label}: ${r.reason}`);
  return { circuit, netlist: r.netlist, image };
}

// --------------------------------------------------------------------------
// 1. Period detection, on its own.
// --------------------------------------------------------------------------

{
  equal('a constant series has no period', C.periodOf([true, true, true, true, true, true]), null);
  equal('  nor an all-low one', C.periodOf([false, false, false, false]), null);
  // Alternating is period 2, not 1: period 1 would mean every sample equals
  // the next, which is the definition of constant.
  equal('alternating is period 2', C.periodOf([true, false, true, false, true, false]), 2);
  equal('a 4-cycle square wave is period 4',
    C.periodOf([true, true, false, false, true, true, false, false, true, true, false, false]), 4);
  equal('a short series is not judged', C.periodOf([true, false]), null);
  check('a non-repeating series has no period',
    C.periodOf([true, false, false, true, true, true, false, false, false, false]) === null);
}

// --------------------------------------------------------------------------
// 2. Behavioural: a ring oscillator is found, with its period.
// --------------------------------------------------------------------------

{
  const f = ringOscillatorFixture();
  const { netlist, image } = open(f.image, 'ring');
  const found = C.oscillatingNets(image, netlist, { transient: 60, samples: 64 });
  check('the ring oscillator is found behaviourally', found.size >= 1, `${found.size} nets`);
  if (found.size >= 1) {
    const period = [...found.values()][0];
    check('with a plausible period', period >= 1 && period <= 32, `period ${period}`);
  }

  const { elements } = ST.findStorageElements(netlist);
  const candidates = C.findClockCandidates(netlist, image, elements);
  check('and offered as a clock candidate', candidates.length >= 1);
  if (candidates.length >= 1) {
    equal('  on behavioural evidence', candidates[0].evidence.kind, 'oscillates');
    check('  which names the period', /period \d+ cycles/.test(C.describeCandidate(candidates[0])),
      C.describeCandidate(candidates[0]));
    check('  and says where to look', /\(\d+,\d+\)/.test(C.describeCandidate(candidates[0])));
  }
}

{
  // A settled circuit must offer no behavioural candidate at all.
  const f = wiredOrFixture();
  const { netlist, image } = open(f.image, 'wired-OR');
  const found = C.oscillatingNets(image, netlist, { transient: 60, samples: 64 });
  equal('a settled circuit has no oscillating nets', found.size, 0);
}

{
  // A latch rings only if it fails to settle; its state net must not be offered
  // as a clock even then — that is the memory misbehaving, not a clock.
  const f = latchFixture();
  const { netlist, image } = open(f.image, 'latch');
  const { elements } = ST.findStorageElements(netlist);
  const candidates = C.findClockCandidates(netlist, image, elements);
  const stateNets = new Set(elements.flatMap((e) => e.stateNets));
  check('a storage element’s own state net is never offered as the clock',
    !candidates.some((c) => stateNets.has(c.net) && c.evidence.kind === 'oscillates'));
}

// --------------------------------------------------------------------------
// 3. Structural: a hand-pulsed input, which behaviour cannot see.
// --------------------------------------------------------------------------

{
  const netlist = REGISTER_4BIT();
  const { elements } = ST.findStorageElements(netlist);
  const reach = C.storageReach(netlist, elements);
  equal('the shared write line reaches all four bits', reach.get(1), 4);

  // No image, so no behavioural evidence at all — structural must still work.
  const candidates = C.findClockCandidates(netlist, null, elements);
  check('it is offered as a candidate', candidates.some((c) => c.net === 1));
  const top = candidates[0];
  equal('  and ranks first', top.net, 1);
  equal('  on structural evidence', top.evidence.kind, 'fansOutToStorage');
  check('  which names the count', /4 storage element/.test(C.describeCandidate(top)),
    C.describeCandidate(top));
}

// --------------------------------------------------------------------------
// 4. CK-4 — a clock and a reset are indistinguishable, so they tie.
// --------------------------------------------------------------------------

{
  // Two free inputs, each reaching all four storage bits. Nothing in the
  // netlist says which is the clock and which is the reset.
  const gates = [];
  for (let bit = 0; bit < 4; bit++) {
    const a = 10 + bit * 2;
    const b = 11 + bit * 2;
    gates.push([a, b], [b, a]);
    gates.push([1, a]); // net 1
    gates.push([2, b]); // net 2 — equally connected
  }
  const netlist = netlistOf(gates);
  const { elements } = ST.findStorageElements(netlist);
  const reach = C.storageReach(netlist, elements);
  equal('both inputs reach four elements — net 1', reach.get(1), 4);
  equal('  and net 2', reach.get(2), 4);

  const candidates = C.findClockCandidates(netlist, null, elements);
  const one = candidates.find((c) => c.net === 1);
  const two = candidates.find((c) => c.net === 2);
  check('both are offered', !!one && !!two);
  equal('AT EQUAL RANK, because the evidence cannot separate them', one.rank, two.rank);

  const tied = C.tiedWith(candidates, 1);
  check('and each knows what it is tied with', tied.some((c) => c.net === 2),
    tied.map((c) => c.net).join(','));
}

// --------------------------------------------------------------------------
// 5. Nothing is designated silently.
// --------------------------------------------------------------------------

{
  const f = wiredOrFixture();
  const { netlist, image } = open(f.image, 'wired-OR');
  const { elements } = ST.findStorageElements(netlist);
  const candidates = C.findClockCandidates(netlist, image, elements);
  equal('a circuit with no storage offers no clock', candidates.length, 0);
}

{
  const netlist = REGISTER_4BIT();
  const { elements } = ST.findStorageElements(netlist);
  const candidates = C.findClockCandidates(netlist, null, elements);
  check('every candidate carries its evidence',
    candidates.every((c) => c.evidence && typeof c.evidence.kind === 'string'));
  check('and a place to look', candidates.every((c) => Number.isFinite(c.probe.x)));
}

// --------------------------------------------------------------------------
// 6. Stepping.
// --------------------------------------------------------------------------

{
  // A latch with no external clock: stepping a generated clock. The fixture
  // has no free input, so this exercises the "cannot be driven" path.
  const f = ringOscillatorFixture();
  const { netlist, image } = open(f.image, 'ring');
  const found = C.oscillatingNets(image, netlist, { transient: 60, samples: 64 });
  const clockNet = [...found.keys()][0];
  if (clockNet !== undefined) {
    const result = C.stepClock(image, netlist, clockNet, [clockNet], 6, { maxCycles: 400 });
    equal('stepping 6 edges gives exactly 6 transitions', result.transitions.length, 6);
    check('each transition records the clock level',
      result.transitions.every((t) => typeof t.clock === 'boolean'));
    check('and is numbered in order',
      result.transitions.every((t, i) => t.edge === i + 1));
    check('the clock alternates across edges',
      result.transitions.every((t, i) => i === 0 || t.clock !== result.transitions[i - 1].clock));
  }
}

{
  // A driven clock: net 1 of the register is a free input.
  const netlist = REGISTER_4BIT();
  check('the register’s write line is a free input', netlist.inputs.includes(1));
}

summary('clock');
