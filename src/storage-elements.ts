// storage-elements.ts — what remembers, and whether it starts from a known value.
//
// Two ideas, and the second is why this module exists.
//
// FEEDBACK IS NOT MEMORY. A loop that settles to the same state every time is
// just a circuit with a loop in it. A storage element is a strongly connected
// group with MORE THAN ONE rest state — that is what gives it something to
// remember. Getting this distinction wrong is how "four register bits" gets
// reported as "19 state variables".
//
// SCALE COMES FROM ANALYSING GROUPS, NOT SELECTIONS. Rest states are enumerated
// per group: 2^|state| where |state| is that one group's feedback cut. Nineteen
// state variables across a block is hopeless as a single table and trivial as
// five groups of two to four. This is the whole reason a real register is
// analysable at all.
//
// AND THE PART THAT MOTIVATED THE FEATURE:
//
// "Does it hold correctly once started" and "does it start correctly" are
// different questions, and the existing oracle can only answer the first —
// sweepSequential seeds a consistent state before releasing the circuit, so a
// power-on that never resolves is invisible to it. The 4-bit CPU's six-inverter
// loop passes every behavioural check in feature 003 and still fails to reach a
// defined state in roughly three cold starts out of four.
//
// So power-on is measured by COLD-STARTING REPEATEDLY. The engine re-rolls gate
// evaluation order and its jitter table on every Circuit construction, which
// makes each start an independent sample. One run cannot establish anything,
// and the result is reported as sampling — "defined across 20 starts" — never
// as a proof.

import { evaluate, expressionFor, not, or, type BooleanExpr } from './boolean.js';
import { netById, type NetId, type Netlist } from './netlist.js';
import { components, feedbackNets } from './sequential.js';
import { Circuit } from './simulator.js';

export type PowerOnFinding =
  | { readonly kind: 'defined'; readonly value: readonly boolean[]; readonly starts: number }
  | {
      readonly kind: 'undefined';
      readonly distribution: ReadonlyMap<string, number>;
      readonly starts: number;
    }
  | { readonly kind: 'neverSettles'; readonly settled: number; readonly starts: number };

export interface StorageElement {
  /** The mutually reachable group. */
  readonly nets: readonly NetId[];
  /** What holds the value: the group's own feedback cut. */
  readonly stateNets: readonly NetId[];
  /** Nets from outside that can change it. */
  readonly writeNets: readonly NetId[];
  /** Assignments of `stateNets` that reproduce themselves. More than one. */
  readonly restStates: readonly (readonly boolean[])[];
  /** The external assignment the rest states were measured at. */
  readonly at: ReadonlyMap<NetId, boolean>;
  readonly powerOn: PowerOnFinding | null;
  /** Where to look on the canvas. */
  readonly probe: { readonly x: number; readonly y: number };
}

export interface StorageGroup {
  /** Elements sharing a control signal — a register rather than loose bits. */
  readonly elements: readonly StorageElement[];
  readonly sharedControl: readonly NetId[];
}

export interface StorageReport {
  readonly elements: readonly StorageElement[];
  readonly groups: readonly StorageGroup[];
  /** Feedback groups that settle to one state: loops, but not memory. */
  readonly settlingLoops: number;
  readonly starts: number;
}

/** Cold starts used to decide a power-on state. Sampling, and reported as such. */
export const DEFAULT_STARTS = 20;

/** Above this many state nets a group is described but not enumerated. */
const MAX_GROUP_STATE = 16;
/** Above this many external inputs, assignments are sampled rather than swept. */
const MAX_EXTERNAL_SWEEP = 8;

const key = (values: readonly boolean[]): string => values.map((v) => (v ? '1' : '0')).join('');

function adjacency(netlist: Netlist): Map<NetId, NetId[]> {
  const g = new Map<NetId, NetId[]>();
  for (const gate of netlist.gates) {
    const list = g.get(gate.src);
    if (list) list.push(gate.dst);
    else g.set(gate.src, [gate.dst]);
  }
  return g;
}

/** Groups that genuinely loop: more than one net, or a self-edge. */
function feedbackGroups(netlist: Netlist): NetId[][] {
  const adj = adjacency(netlist);
  return components(netlist).filter(
    (c) => c.length > 1 || (adj.get(c[0]) ?? []).includes(c[0])
  );
}

/**
 * Next-state functions for one group, in terms of its own state and the nets
 * that drive it from outside.
 *
 * Expansion stops at the group boundary. Following signals out of the group
 * would drag the rest of the circuit back in and lose exactly the locality that
 * makes this affordable.
 */
function nextStateOf(
  netlist: Netlist,
  stateNets: readonly NetId[],
  externals: readonly NetId[]
): Map<NetId, BooleanExpr> {
  const treatAsInput = new Set<NetId>([...stateNets, ...externals]);
  const out = new Map<NetId, BooleanExpr>();
  for (const s of stateNets) {
    const sources = netlist.gates.filter((g) => g.dst === s).map((g) => g.src);
    const terms = sources.map((src) => not(expressionFor(netlist, src, { treatAsInput })));
    out.set(s, terms.length === 0 ? { kind: 'var', net: s } : terms.length === 1 ? terms[0] : or(terms));
  }
  return out;
}

/** Assignments of the state nets that reproduce themselves. */
function restStatesAt(
  stateNets: readonly NetId[],
  nextState: ReadonlyMap<NetId, BooleanExpr>,
  external: ReadonlyMap<NetId, boolean>
): boolean[][] {
  const out: boolean[][] = [];
  const total = 2 ** stateNets.length;
  for (let i = 0; i < total; i++) {
    const state = stateNets.map((_, b) => ((i >> b) & 1) === 1);
    const env = new Map<NetId, boolean>(external);
    stateNets.forEach((n, b) => env.set(n, state[b]));
    const next = stateNets.map((n) => {
      const e = nextState.get(n);
      return e ? evaluate(e, env) : false;
    });
    if (next.every((v, b) => v === state[b])) out.push(state);
  }
  return out;
}

/**
 * Find the storage in a selection.
 *
 * Structural only — no simulation. `samplePowerOn` adds the part that needs to
 * run the circuit.
 */
export function findStorageElements(netlist: Netlist): {
  elements: StorageElement[];
  settlingLoops: number;
} {
  const cut = new Set(feedbackNets(netlist));
  const elements: StorageElement[] = [];
  let settlingLoops = 0;

  for (const group of feedbackGroups(netlist)) {
    const inGroup = new Set(group);
    const stateNets = group.filter((n) => cut.has(n)).sort((a, b) => a - b);
    if (stateNets.length === 0 || stateNets.length > MAX_GROUP_STATE) {
      settlingLoops++;
      continue;
    }

    // Nets from outside that drive something inside: the group's controls.
    const externals = [
      ...new Set(
        netlist.gates
          .filter((g) => inGroup.has(g.dst) && !inGroup.has(g.src))
          .map((g) => g.src)
      ),
    ].sort((a, b) => a - b);

    let nextState: Map<NetId, BooleanExpr>;
    try {
      nextState = nextStateOf(netlist, stateNets, externals);
    } catch {
      settlingLoops++;
      continue;
    }

    // Rest states depend on what the controls are doing, so several assignments
    // are tried: a group that holds only when its write line is idle is still
    // storage, and looking at one assignment would miss it.
    const assignments: Map<NetId, boolean>[] = [];
    if (externals.length === 0) {
      assignments.push(new Map());
    } else if (externals.length <= MAX_EXTERNAL_SWEEP) {
      const total = 2 ** externals.length;
      for (let i = 0; i < total; i++) {
        const m = new Map<NetId, boolean>();
        externals.forEach((n, b) => m.set(n, ((i >> b) & 1) === 1));
        assignments.push(m);
      }
    } else {
      // Too many to sweep: all-low, all-high, and alternating. Enough to find a
      // holding state without pretending to be exhaustive.
      for (const pick of [() => false, () => true, (i: number) => i % 2 === 0]) {
        const m = new Map<NetId, boolean>();
        externals.forEach((n, b) => m.set(n, pick(b)));
        assignments.push(m);
      }
    }

    let best: { states: boolean[][]; at: Map<NetId, boolean> } | null = null;
    for (const at of assignments) {
      const states = restStatesAt(stateNets, nextState, at);
      if (!best || states.length > best.states.length) best = { states, at };
      if (states.length > 1) break; // enough to call it storage
    }

    if (!best || best.states.length <= 1) {
      // A loop with one rest state settles. It is a loop, not memory.
      settlingLoops++;
      continue;
    }

    const info = netById(netlist, stateNets[0]);
    elements.push({
      nets: [...group].sort((a, b) => a - b),
      stateNets,
      writeNets: externals,
      restStates: best.states,
      at: best.at,
      powerOn: null,
      probe: info ? { x: info.probe.x, y: info.probe.y } : { x: 0, y: 0 },
    });
  }

  elements.sort((a, b) => a.stateNets[0] - b.stateNets[0]);
  return { elements, settlingLoops };
}

/** Elements sharing a control signal belong together — that is a register. */
export function groupElements(elements: readonly StorageElement[]): StorageGroup[] {
  const used = new Set<number>();
  const groups: StorageGroup[] = [];

  elements.forEach((element, i) => {
    if (used.has(i)) return;
    const shared = new Set(element.writeNets);
    const members = [element];
    used.add(i);

    elements.forEach((other, j) => {
      if (j <= i || used.has(j)) return;
      if (other.writeNets.some((n) => shared.has(n))) {
        members.push(other);
        used.add(j);
      }
    });

    const common = members.reduce<NetId[]>(
      (acc, m) => acc.filter((n) => m.writeNets.includes(n)),
      [...element.writeNets]
    );
    groups.push({ elements: members, sharedControl: common });
  });

  return groups;
}

/**
 * Cold-start the selection repeatedly and see where each element lands.
 *
 * Never from one run. Each `new Circuit` re-rolls the gate evaluation order and
 * the jitter table, so every start is an independent sample of a genuinely
 * nondeterministic process.
 */
export function samplePowerOn(
  image: ImageData,
  netlist: Netlist,
  elements: readonly StorageElement[],
  opts: { starts?: number; maxCycles?: number; stableWindow?: number } = {}
): StorageElement[] {
  const starts = opts.starts ?? DEFAULT_STARTS;
  const maxCycles = opts.maxCycles ?? 1500;
  const stableWindow = opts.stableWindow ?? 16;
  if (elements.length === 0) return [];

  const probes = elements.map((e) =>
    e.stateNets.map((n) => netById(netlist, n)?.probe ?? { x: 0, y: 0 })
  );

  const observations = elements.map(() => [] as string[]);

  for (let run = 0; run < starts; run++) {
    const circuit = new Circuit(image, null);
    const settled = settle(circuit, maxCycles, stableWindow);

    const frame = circuit.frame;
    elements.forEach((_, i) => {
      const values = probes[i].map((p) => {
        const k = (p.y * frame.width + p.x) << 2;
        return Math.max(frame.data[k], frame.data[k + 1], frame.data[k + 2]) >= 224;
      });
      observations[i].push(settled ? key(values) : '');
    });
  }

  return elements.map((element, i) => {
    const seen = observations[i].filter((v) => v !== '');
    if (seen.length === 0) {
      return { ...element, powerOn: { kind: 'neverSettles', settled: 0, starts } as const };
    }
    if (seen.length < starts) {
      return {
        ...element,
        powerOn: { kind: 'neverSettles', settled: seen.length, starts } as const,
      };
    }
    const distribution = new Map<string, number>();
    for (const v of seen) distribution.set(v, (distribution.get(v) ?? 0) + 1);

    if (distribution.size === 1) {
      const only = [...distribution.keys()][0];
      return {
        ...element,
        powerOn: {
          kind: 'defined',
          value: [...only].map((c) => c === '1'),
          starts,
        } as const,
      };
    }
    return { ...element, powerOn: { kind: 'undefined', distribution, starts } as const };
  });
}

/** Step until the WHOLE circuit stops moving, not just the probed nets. */
function settle(circuit: Circuit, maxCycles: number, stableWindow: number): boolean {
  let last: number | null = null;
  let same = 0;
  for (let i = 0; i < maxCycles; i++) {
    circuit.simulate();
    const frame = circuit.render();
    let h = 0x811c9dc5;
    const d = frame.data;
    for (let k = 0; k < d.length; k += 4) {
      h ^= d[k] + d[k + 1] + d[k + 2];
      h = Math.imul(h, 0x01000193);
    }
    h >>>= 0;
    if (h === last) {
      if (++same >= stableWindow) return true;
    } else {
      same = 0;
      last = h;
    }
  }
  return false;
}

/** Structure and power-on together. */
export function analyseStorage(
  netlist: Netlist,
  image: ImageData | null,
  opts: { starts?: number } = {}
): StorageReport {
  const { elements, settlingLoops } = findStorageElements(netlist);
  const starts = opts.starts ?? DEFAULT_STARTS;
  const withPowerOn = image ? samplePowerOn(image, netlist, elements, opts) : elements;
  return {
    elements: withPowerOn,
    groups: groupElements(withPowerOn),
    settlingLoops,
    starts,
  };
}

/** One line of plain English. Always names the number of starts (PO-4). */
export function describePowerOn(finding: PowerOnFinding | null): string {
  if (!finding) return 'power-on not measured';
  switch (finding.kind) {
    case 'defined':
      return `starts at ${key(finding.value)}, the same in all ${finding.starts} cold starts`;
    case 'undefined': {
      const parts = [...finding.distribution]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v} ×${n}`)
        .join(', ');
      return (
        `power-on state is UNDEFINED across ${finding.starts} cold starts — ` +
        `it settled into ${finding.distribution.size} different states (${parts})`
      );
    }
    case 'neverSettles':
      return (
        `never settled in ${finding.starts - finding.settled} of ${finding.starts} cold ` +
        'starts, so no held value is reported'
      );
  }
}
