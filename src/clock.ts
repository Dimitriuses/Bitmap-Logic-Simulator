// clock.ts — finding the clock, and stepping by it.
//
// TWO SIGNALS, BECAUSE EACH IS BLIND TO THE OTHER'S CASE.
//
//   behavioural   hold the inputs steady, run, and find nets whose value
//                 repeats with a stable period. This catches the RING
//                 OSCILLATOR — an odd-length loop of inverters — which is how
//                 a clock is actually built in this medium. A purely
//                 structural search cannot see one at all, because it is not
//                 an input.
//
//   structural    free inputs that fan out to many storage elements. This
//                 catches a clock the user pulses by hand, which the
//                 behavioural search cannot see because a held input never
//                 toggles.
//
// AND THE LIMIT, STATED RATHER THAN PAPERED OVER: the structural signal cannot
// tell a clock from a reset or an enable line. Both reach every bit, and
// nothing in the netlist distinguishes them. So candidates it cannot separate
// come back at EQUAL RANK — an arbitrary order would read as a judgement the
// evidence does not support. The user confirms; nothing is designated silently.

import { netById, type NetId, type Netlist } from './netlist.js';
import { Circuit } from './simulator.js';
import type { StorageElement } from './storage-elements.js';

export type ClockEvidence =
  | { readonly kind: 'oscillates'; readonly period: number }
  | { readonly kind: 'fansOutToStorage'; readonly count: number };

export interface ClockCandidate {
  readonly net: NetId;
  readonly evidence: ClockEvidence;
  /** 1 is best. Equal values mean the evidence cannot separate them. */
  readonly rank: number;
  readonly probe: { readonly x: number; readonly y: number };
}

export interface ClockOptions {
  /** Cycles to discard before measuring, so a transient is not read as a period. */
  readonly transient?: number;
  /** Cycles recorded per net. */
  readonly samples?: number;
}

const DEFAULTS = { transient: 120, samples: 96 };

/**
 * Nets that free-run with a stable period, with the period measured.
 *
 * Runs a private copy of the circuit: finding the clock must not disturb
 * whatever the caller is doing with theirs.
 */
export function oscillatingNets(
  image: ImageData,
  netlist: Netlist,
  opts: ClockOptions = {}
): Map<NetId, number> {
  const transient = opts.transient ?? DEFAULTS.transient;
  const samples = opts.samples ?? DEFAULTS.samples;

  const circuit = new Circuit(image, null);
  for (let i = 0; i < transient; i++) circuit.simulate();

  const probes = netlist.nets.map((n) => n.probe);
  const series: boolean[][] = netlist.nets.map(() => []);

  for (let i = 0; i < samples; i++) {
    circuit.simulate();
    const frame = circuit.render();
    probes.forEach((p, k) => {
      const q = (p.y * frame.width + p.x) << 2;
      series[k].push(Math.max(frame.data[q], frame.data[q + 1], frame.data[q + 2]) >= 224);
    });
  }

  const found = new Map<NetId, number>();
  netlist.nets.forEach((net, k) => {
    const period = periodOf(series[k]);
    if (period !== null) found.set(net.id, period);
  });
  return found;
}

/**
 * The smallest period a series repeats with, or null.
 *
 * A constant series is not oscillating, however perfectly it "repeats" — a net
 * that never changes has no period worth reporting, and treating one as a clock
 * would offer every settled net in the circuit as a candidate.
 */
export function periodOf(series: readonly boolean[]): number | null {
  if (series.length < 4) return null;
  const first = series[0];
  if (series.every((v) => v === first)) return null;

  for (let p = 1; p <= Math.floor(series.length / 2); p++) {
    let repeats = true;
    for (let i = 0; i + p < series.length; i++) {
      if (series[i] !== series[i + p]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return p;
  }
  return null;
}

/** For each free input, how many storage elements it can influence. */
export function storageReach(
  netlist: Netlist,
  elements: readonly StorageElement[]
): Map<NetId, number> {
  const forward = new Map<NetId, NetId[]>();
  for (const g of netlist.gates) {
    const list = forward.get(g.src);
    if (list) list.push(g.dst);
    else forward.set(g.src, [g.dst]);
  }

  const out = new Map<NetId, number>();
  for (const input of netlist.inputs) {
    const seen = new Set<NetId>([input]);
    const queue: NetId[] = [input];
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (const w of forward.get(v) ?? []) {
        if (seen.has(w)) continue;
        seen.add(w);
        queue.push(w);
      }
    }
    const touched = elements.filter((e) => e.nets.some((n) => seen.has(n))).length;
    if (touched > 0) out.set(input, touched);
  }
  return out;
}

/**
 * Ranked clock candidates, each with the reason it was chosen.
 *
 * Oscillators rank above structural candidates because their evidence is
 * direct: the net was observed toggling on its own. Structural candidates are
 * ranked by how much storage they reach, and equal counts share a rank.
 */
export function findClockCandidates(
  netlist: Netlist,
  image: ImageData | null,
  elements: readonly StorageElement[],
  opts: ClockOptions = {}
): ClockCandidate[] {
  const probeOf = (net: NetId) => {
    const info = netById(netlist, net);
    return info ? { x: info.probe.x, y: info.probe.y } : { x: 0, y: 0 };
  };

  const oscillators = image ? oscillatingNets(image, netlist, opts) : new Map<NetId, number>();
  const reach = storageReach(netlist, elements);

  // An oscillator that IS a storage element's own state net is the memory
  // ringing, not a clock driving it.
  const stateNets = new Set(elements.flatMap((e) => e.stateNets));

  const behavioural = [...oscillators.entries()]
    .filter(([net]) => !stateNets.has(net))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map(([net, period]) => ({ net, period }));

  const structural = [...reach.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([net, count]) => ({ net, count }));

  const out: ClockCandidate[] = [];
  let rank = 0;
  let lastPeriod: number | null = null;

  for (const { net, period } of behavioural) {
    // Two oscillators of the same period are equally good evidence.
    if (period !== lastPeriod) rank++;
    lastPeriod = period;
    out.push({ net, evidence: { kind: 'oscillates', period }, rank, probe: probeOf(net) });
  }

  let lastCount: number | null = null;
  for (const { net, count } of structural) {
    if (out.some((c) => c.net === net)) continue;
    // CK-4: the structural signal cannot tell a clock from a reset, so equal
    // fan-out means equal rank. Ordering them would imply a distinction the
    // evidence does not make.
    if (count !== lastCount) rank++;
    lastCount = count;
    out.push({ net, evidence: { kind: 'fansOutToStorage', count }, rank, probe: probeOf(net) });
  }

  return out;
}

/** One line of plain English for a candidate. */
export function describeCandidate(candidate: ClockCandidate): string {
  const where = `(${candidate.probe.x},${candidate.probe.y})`;
  return candidate.evidence.kind === 'oscillates'
    ? `${where} oscillates on its own, period ${candidate.evidence.period} cycles`
    : `${where} is a free input reaching ${candidate.evidence.count} storage element(s)`;
}

/** Candidates the evidence cannot separate from this one. */
export function tiedWith(
  candidates: readonly ClockCandidate[],
  net: NetId
): ClockCandidate[] {
  const self = candidates.find((c) => c.net === net);
  if (!self) return [];
  return candidates.filter((c) => c.rank === self.rank && c.net !== net);
}

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

export interface ClockTransition {
  readonly edge: number;
  readonly clock: boolean;
  readonly before: readonly boolean[];
  readonly after: readonly boolean[];
  readonly changed: readonly NetId[];
  readonly settled: boolean;
}

export interface StepResult {
  readonly transitions: readonly ClockTransition[];
  readonly stateNets: readonly NetId[];
  /** True when the same edge sequence gave a different answer on a second run. */
  readonly repeatable: boolean;
}

/**
 * Advance the circuit edge by edge and report what the state did.
 *
 * Two kinds of clock need two kinds of stepping, and conflating them would
 * make one of them wrong:
 *
 *   a FREE INPUT is driven — held at each level while the circuit settles;
 *   a GENERATED clock (a ring oscillator) cannot be driven at all, because a
 *     gate-driven net is rewritten every cycle. There the circuit is simply run
 *     until the clock changes on its own, and that is the edge.
 */
export function stepClock(
  image: ImageData,
  netlist: Netlist,
  clockNet: NetId,
  stateNets: readonly NetId[],
  edges: number,
  opts: { maxCycles?: number; stableWindow?: number } = {}
): StepResult {
  const run = () => runEdges(image, netlist, clockNet, stateNets, edges, opts);
  const first = run();
  const second = run();

  const same =
    first.length === second.length &&
    first.every(
      (t, i) =>
        t.clock === second[i].clock &&
        t.after.length === second[i].after.length &&
        t.after.every((v, k) => v === second[i].after[k])
    );

  return { transitions: first, stateNets: [...stateNets], repeatable: same };
}

function runEdges(
  image: ImageData,
  netlist: Netlist,
  clockNet: NetId,
  stateNets: readonly NetId[],
  edges: number,
  opts: { maxCycles?: number; stableWindow?: number }
): ClockTransition[] {
  const maxCycles = opts.maxCycles ?? 600;
  const stableWindow = opts.stableWindow ?? 10;

  const circuit = new Circuit(image, null);
  const driven = netlist.inputs.includes(clockNet);
  const clockProbe = netById(netlist, clockNet)?.probe ?? { x: 0, y: 0 };
  const probes = stateNets.map((n) => netById(netlist, n)?.probe ?? { x: 0, y: 0 });

  const read = (): boolean[] => {
    const frame = circuit.frame;
    return probes.map((p) => {
      const q = (p.y * frame.width + p.x) << 2;
      return Math.max(frame.data[q], frame.data[q + 1], frame.data[q + 2]) >= 224;
    });
  };
  const clockValue = (): boolean => {
    const frame = circuit.frame;
    const q = (clockProbe.y * frame.width + clockProbe.x) << 2;
    return Math.max(frame.data[q], frame.data[q + 1], frame.data[q + 2]) >= 224;
  };

  // Let the circuit come up before the first edge is counted.
  for (let i = 0; i < 40; i++) circuit.simulate();
  circuit.render();

  const transitions: ClockTransition[] = [];
  let level = clockValue();

  for (let edge = 0; edge < edges; edge++) {
    const before = read();
    const wanted = !level;
    let settled = false;

    if (driven) {
      // Hold the new level and let the circuit settle under it.
      let same = 0;
      let last: string | null = null;
      for (let i = 0; i < maxCycles; i++) {
        circuit.setStateAt(clockProbe.x, clockProbe.y, wanted ? '1' : '0');
        circuit.simulate();
        circuit.render();
        const key = read().map((v) => (v ? '1' : '0')).join('');
        if (key === last) {
          if (++same >= stableWindow) {
            settled = true;
            break;
          }
        } else {
          same = 0;
          last = key;
        }
      }
    } else {
      // Generated: run until the clock flips itself.
      for (let i = 0; i < maxCycles; i++) {
        circuit.simulate();
        circuit.render();
        if (clockValue() === wanted) {
          settled = true;
          break;
        }
      }
    }

    level = wanted;
    const after = read();
    const changed = stateNets.filter((_, k) => before[k] !== after[k]);
    transitions.push({ edge: edge + 1, clock: level, before, after, changed, settled });
  }

  return transitions;
}
