// dom.ts — the element handles the shell needs, looked up once and typed.

/** Fetch an element by id, or fail loudly: a missing id is a broken index.html. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`index.html is missing #${id}`);
  return node as T;
}

/** Every element ui.ts touches. Built once, at startup. */
export function queryDom() {
  return {
    canvas: el<HTMLCanvasElement>('view'),
    dropzone: el('dropzone'),
    toast: el('toast'),

    examples: el<HTMLSelectElement>('examples'),
    play: el<HTMLButtonElement>('play'),
    modeToggle: el<HTMLButtonElement>('mode-toggle'),

    toolbar: el('toolbar'),
    tools: [...document.querySelectorAll<HTMLButtonElement>('#toolbar .tool')],
    directions: [...document.querySelectorAll<HTMLButtonElement>('#toolbar .dir')],
    wireColor: el<HTMLInputElement>('wire-color'),
    undo: el<HTMLButtonElement>('undo'),
    redo: el<HTMLButtonElement>('redo'),
    save: el<HTMLButtonElement>('save'),
    dirtyFlag: el('dirty-flag'),
    settings: el('settings'),
    settingsToggle: el<HTMLButtonElement>('settings-toggle'),
    settingsClose: el<HTMLButtonElement>('settings-close'),

    openFile: el<HTMLButtonElement>('open-file'),
    reset: el<HTMLButtonElement>('reset'),
    fit: el<HTMLButtonElement>('fit'),
    fileName: el('file-name'),
    liveNote: el('live-note'),

    speed: el<HTMLInputElement>('speed'),
    speedValue: el('speed-value'),
    passes: el<HTMLInputElement>('passes'),
    passesValue: el('passes-value'),
    refresh: el<HTMLInputElement>('refresh'),
    refreshValue: el('refresh-value'),

    statSize: el('stat-size'),
    statWires: el('stat-wires'),
    statGates: el('stat-gates'),
    statCycle: el('stat-cycle'),
    statRate: el('stat-rate'),
    statFps: el('stat-fps'),
    zoomValue: el('zoom-value'),
  };
}

export type Dom = ReturnType<typeof queryDom>;
