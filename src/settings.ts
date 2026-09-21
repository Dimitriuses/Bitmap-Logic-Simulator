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
