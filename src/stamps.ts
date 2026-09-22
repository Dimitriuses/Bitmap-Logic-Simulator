// stamps.ts — the 3x3 patterns the engine recognises.
//
// TRANSCRIBED, NOT DERIVED. Every row below mirrors a case in detectGates()
// in simulator.ts. Computing the corners from a direction vector would express
// the engine's encoding a second time, in a second place, where the two can
// drift apart without anything failing loudly — a wrong corner produces no
// error, just a pattern the engine silently ignores.
//
// The engine's rule, for a centre at (x, y):
//   - the centre must NOT be wire
//   - all four cardinal neighbours MUST be wire
//   - the corners form a mask: NW=1, NE=2, SE=4, SW=8
//
//   mask 0  (no corners)  -> crossover: H and V cross without connecting
//   mask 3  (NW|NE)       -> inverter pointing down,  N -> S
//   mask 6  (NE|SE)       -> inverter pointing left,  E -> W
//   mask 12 (SE|SW)       -> inverter pointing up,    S -> N
//   mask 9  (SW|NW)       -> inverter pointing right, W -> E
//
// A gate points away from its filled corners. Any other mask is ignored.

export type GateDirection = 'up' | 'down' | 'left' | 'right';
export type StampId = GateDirection | 'crossover';

/** Three rows of three: '#' is wire, '.' is insulation. */
export type Pattern = readonly [string, string, string];

export const STAMPS: Readonly<Record<StampId, Pattern>> = {
  // mask 3 — NW and NE filled, so it points away from them: down.
  down: ['###', '#.#', '.#.'],
  // mask 6 — NE and SE filled: points left.
  left: ['.##', '#.#', '.##'],
  // mask 12 — SE and SW filled: points up.
  up: ['.#.', '#.#', '###'],
  // mask 9 — SW and NW filled: points right.
  right: ['##.', '#.#', '##.'],
  // mask 0 — no corners: the two wires cross without touching.
  crossover: ['.#.', '#.#', '.#.'],
};

export const GATE_DIRECTIONS: readonly GateDirection[] = ['up', 'down', 'left', 'right'];

/** Human-readable label, for the undo entry and the toolbar. */
export function stampLabel(id: StampId): string {
  return id === 'crossover' ? 'crossover' : `gate ${id}`;
}

/**
 * Which way a gate carries signal, for documentation and verification.
 * Source is the side the gate reads; destination is the side it drives.
 */
export const GATE_FLOW: Readonly<Record<GateDirection, { src: string; dst: string }>> = {
  down: { src: 'N', dst: 'S' },
  left: { src: 'E', dst: 'W' },
  up: { src: 'S', dst: 'N' },
  right: { src: 'W', dst: 'E' },
};
