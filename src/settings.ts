// settings.ts — the three persisted knobs, mirroring BmpLogicSim.ini.

export interface Settings {
  /** Simulation ticks per second (tSimulationRefresh, 16 ms in the original). */
  speedHz: number;
  /** Cycles run per tick (seSimulationPasses). */
  passes: number;
  /** How often the source PNG is checked for changes (seFileRefresh). */
  fileRefreshMs: number;
}

export const DEFAULTS: Settings = {
  speedHz: 60,
  passes: 5,
  fileRefreshMs: 500,
};

/** Slider bounds, matching the range inputs in index.html. */
const LIMITS: Record<keyof Settings, readonly [number, number]> = {
  speedHz: [1, 120],
  passes: [1, 100],
  fileRefreshMs: [100, 3000],
};

const STORAGE_KEY = 'bmplogicsim.settings';

function sanitise(key: keyof Settings, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const [lo, hi] = LIMITS[key];
  return Math.min(Math.max(Math.round(value), lo), hi);
}

/** Read the stored settings, ignoring anything corrupt or out of range. */
export function readSettings(): Settings {
  const settings: Settings = { ...DEFAULTS };
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return settings;
    stored = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (typeof stored !== 'object' || stored === null) return settings;

  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = sanitise(key, (stored as Record<string, unknown>)[key]);
    if (value !== null) settings[key] = value;
  }
  return settings;
}

export function writeSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // private mode, storage disabled — not worth surfacing
  }
}

// ---------------------------------------------------------------------------
// Editor preferences
//
// Kept separate from the numeric settings above, which are range-validated as a
// group. These are enumerations and a colour, so they validate by membership.
// ---------------------------------------------------------------------------

import { isWireColor, WIRE_WHITE, type Rgba } from './colors.js';
import type { EditorMode } from './editor.js';
import type { GateDirection } from './stamps.js';
import type { ToolId } from './tools/types.js';

export interface EditorPrefs {
  mode: EditorMode;
  tool: ToolId;
  color: Rgba;
  direction: GateDirection;
}

const EDITOR_KEY = 'bmplogicsim.editor';

const MODES: readonly EditorMode[] = ['simulate', 'edit'];
const TOOLS: readonly ToolId[] = ['pencil', 'line', 'eraser', 'picker', 'gate', 'crossover'];
const DIRECTIONS: readonly GateDirection[] = ['up', 'down', 'left', 'right'];

export const EDITOR_DEFAULTS: EditorPrefs = {
  // Opening in Simulate mode means nothing changes for someone who never wants
  // the editor: the left button keeps driving wires, exactly as before.
  mode: 'simulate',
  tool: 'pencil',
  color: WIRE_WHITE,
  direction: 'right',
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function readEditorPrefs(): EditorPrefs {
  const prefs: EditorPrefs = { ...EDITOR_DEFAULTS };
  let stored: unknown;
  try {
    const raw = localStorage.getItem(EDITOR_KEY);
    if (!raw) return prefs;
    stored = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (typeof stored !== 'object' || stored === null) return prefs;
  const s = stored as Record<string, unknown>;

  const mode = oneOf(s.mode, MODES);
  if (mode) prefs.mode = mode;
  const tool = oneOf(s.tool, TOOLS);
  if (tool) prefs.tool = tool;
  const direction = oneOf(s.direction, DIRECTIONS);
  if (direction) prefs.direction = direction;
  // A stored colour the engine would read as insulation is discarded, not
  // restored — it would leave the user drawing wire that does not conduct.
  if (typeof s.color === 'number' && Number.isFinite(s.color) && isWireColor(s.color >>> 0)) {
    prefs.color = s.color >>> 0;
  }
  return prefs;
}

export function writeEditorPrefs(prefs: EditorPrefs): void {
  try {
    localStorage.setItem(EDITOR_KEY, JSON.stringify(prefs));
  } catch {
    // private mode, storage disabled — not worth surfacing
  }
}
