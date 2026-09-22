// ui.ts — application shell: controls, input handling and the frame loop.

import { fromHex, toCss, toHex, type Rgba } from './colors.js';
import { queryDom, type Dom } from './dom.js';
import { CircuitDocument } from './document.js';
import { Editor, type EditorMode } from './editor.js';
import { errorMessage, isAbort } from './errors.js';
import {
  DEFAULT_EXAMPLE,
  FileSource,
  exampleSource,
  loadExampleList,
  pickFile,
  setupDragDrop,
  supportsLiveReload,
  type ExampleEntry,
} from './fileHandler.js';
import { resolveKey, type InputAction } from './keymap.js';
import { Palette } from './palette.js';
import { saveDocument } from './png.js';
import { Renderer, Viewport, type Overlay, type Point } from './renderer.js';
import { Circuit, type Poke } from './simulator.js';
import {
  readEditorPrefs,
  readSettings,
  writeEditorPrefs,
  writeSettings,
  type EditorPrefs,
  type Settings,
} from './settings.js';
import type { GateDirection } from './stamps.js';
import type { PixelPoint, ToolId } from './tools/types.js';
import { applyWheel, type CameraScheme } from './viewport-camera.js';

/** Movement in CSS pixels below which a touch still counts as a tap. */
const TAP_SLOP = 8;

/** Simulation catch-up limits, so a backgrounded tab does not stall on return. */
const MAX_CATCHUP_MS = 250;
const MAX_TICKS_PER_FRAME = 16;

/** Held-arrow acceleration: repeats between each speed-up, and the cap. */
const REPEAT_RAMP = 6;
const MAX_STEP = 8;

interface TapCandidate {
  readonly x: number;
  readonly y: number;
  moved: number;
}

interface Pinch {
  readonly dist: number;
  readonly mid: Point;
}

const EMPTY_PIXELS: ReadonlyMap<number, Rgba> = new Map();

class App {
  private readonly dom: Dom;
  private readonly renderer: Renderer;
  private readonly viewport = new Viewport();
  private readonly editor: Editor;

  private doc: CircuitDocument | null = null;
  private circuit: Circuit | null = null;
  private source: FileSource | null = null;
  private examples: ExampleEntry[] = [];

  private running = true;
  /** Run state recorded on entering edit mode, restored on leaving it. */
  private runningBeforeEdit: boolean | null = null;

  private readonly settings: Settings = readSettings();
  private readonly prefs: EditorPrefs = readEditorPrefs();
  private cameraScheme: CameraScheme;

  private accumulator = 0;
  private lastFrame = performance.now();
  private lastPoll = performance.now();
  private polling = false;
  private readonly fpsWindow = { frames: 0, cycles: 0, since: performance.now() };
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  private canvasRect: DOMRect;
  /** Touch pointers only; mouse and pen are tracked by button instead. */
  private readonly pointers = new Map<number, Point>();
  private lastMouse: Point | null = null;
  private pinch: Pinch | null = null;
  private panning = false;
  private tapCandidate: TapCandidate | null = null;
  /** World point of the wire being pulsed by the left button, simulate mode only. */
  private held: Point | null = null;
  private hover: PixelPoint | null = null;
  private dirty = false;
  /** Consecutive auto-repeats of a held arrow key, for acceleration. */
  private repeats = 0;

  constructor() {
    this.dom = queryDom();
    this.renderer = new Renderer(this.dom.canvas);
    this.canvasRect = this.dom.canvas.getBoundingClientRect();
    this.cameraScheme = this.prefs.cameraScheme;

    const palette = new Palette(this.prefs.customColors, this.prefs.activeColorIndex);
    this.editor = new Editor(() => this.recompile(), palette);
    this.editor.mode = this.prefs.mode;
    this.editor.tool = this.prefs.tool;
    this.editor.direction = this.prefs.direction;
    this.editor.setBusWidth(this.prefs.busWidth);

    this.#bindControls();
    this.#bindEditorControls();
    this.#bindPointer();
    this.#bindKeyboard();
    this.#observeSize();

    setupDragDrop(
      document.body,
      (source, err) => {
        if (err) this.toast(errorMessage(err), true);
        else if (source && this.confirmDiscard()) void this.load(source);
      },
      (active) => this.dom.dropzone.classList.toggle('active', active)
    );

    this.#applySettingsToInputs();
    this.#renderPalette();
    this.#applyEditorToInputs();

    window.addEventListener('beforeunload', (e) => {
      if (!this.doc?.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  async start(): Promise<void> {
    requestAnimationFrame(this.frame);
    await this.#populateExamples();
    await this.#bootstrap();
  }

  // -------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------

  async #bootstrap(): Promise<void> {
    const param = new URLSearchParams(location.search).get('file');
    if (param && !/^[a-z]+:/i.test(param)) {
      const name = param.split('/').pop() ?? param;
      this.dom.examples.value = '';
      await this.load(FileSource.fromUrl(name, param));
      return;
    }

    const first = this.examples.find((e) => e.path === DEFAULT_EXAMPLE) ?? this.examples[0] ?? null;
    if (!first) {
      this.toast('No example schematics found. Drop a PNG to start.', true);
      return;
    }
    this.dom.examples.value = first.path;
    await this.load(exampleSource(first));
  }

  async load(source: FileSource, preloaded: ImageData | null = null, keepState = false) {
    try {
      const imageData = preloaded ?? (await source.read());

      const t0 = performance.now();
      const doc = CircuitDocument.fromImageData(source.name, imageData);
      const circuit = doc.compile(keepState ? this.prevRender() : null);
      // A recompile builds a fresh Circuit, whose cycle counter starts at zero.
      // Carrying it over keeps an edit from looking like a restart.
      if (keepState) circuit.cycle = this.circuit?.cycle ?? circuit.cycle;
      const loadMs = performance.now() - t0;

      const isNewFile = this.source !== source;
      this.doc = doc;
      this.circuit = circuit;
      this.source = source;
      this.editor.setDocument(doc);
      this.renderer.setCircuit(circuit);
      this.viewport.bitmapWidth = circuit.width;
      this.viewport.bitmapHeight = circuit.height;
      if (isNewFile && !keepState) this.viewport.fit();

      this.#showCircuitInfo(source, circuit);
      this.#applyEditorToInputs();
      if (!keepState) {
        const gates = circuit.gateCount.toLocaleString();
        this.toast(`${source.name} — ${gates} gates in ${loadMs.toFixed(0)} ms`);
      }
    } catch (err) {
      if (isAbort(err)) return;
      this.toast(`Could not load ${source.name}: ${errorMessage(err)}`, true);
    }
  }

  private prevRender() {
    const previous = this.circuit;
    if (!previous) return null;
    return { data: previous.frame.data, width: previous.width, height: previous.height };
  }

  /**
   * Rebuild the circuit from the document. Once per completed action — never
   * per pointer event, which at ~190 ms for Enigma2 would look like a hang.
   */
  private recompile(): void {
    const doc = this.doc;
    if (!doc) return;
    const carryCycle = this.circuit?.cycle ?? 0;
    const circuit = doc.compile(this.prevRender());
    circuit.cycle = carryCycle; // an edit is not a restart
    this.circuit = circuit;
    this.renderer.setCircuit(circuit);
    this.dirty = true;
    this.#showCircuitStats(circuit);
    this.#refreshEditorState();
  }

  #showCircuitInfo(source: FileSource, circuit: Circuit): void {
    const { dom } = this;
    dom.fileName.textContent = source.name;
    dom.liveNote.textContent = source.canLiveReload
      ? 'Live reload on — edit and save the PNG to update the running circuit.'
      : supportsLiveReload
        ? 'Live reload off for this file. Use Open File to enable it.'
        : 'Live reload needs Chrome or Edge.';
    this.#showCircuitStats(circuit);
  }

  #showCircuitStats(circuit: Circuit): void {
    const { dom } = this;
    dom.statSize.textContent = `${circuit.width}×${circuit.height}`;
    dom.statWires.textContent = circuit.wireCount.toLocaleString();
    dom.statGates.textContent = circuit.gateCount.toLocaleString();
  }

  async #populateExamples(): Promise<void> {
    this.examples = await loadExampleList();
    const select = this.dom.examples;
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const entry of this.examples) {
      let group = groups.get(entry.group);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = entry.group;
        groups.set(entry.group, group);
        select.appendChild(group);
      }
      const option = document.createElement('option');
      option.value = entry.path;
      option.textContent = entry.label;
      group.appendChild(option);
    }
  }

  private confirmDiscard(): boolean {
    if (!this.doc?.dirty) return true;
    return window.confirm('This circuit has unsaved edits. Discard them?');
  }

  // -------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------

  #bindControls(): void {
    const { dom } = this;

    dom.settingsToggle.addEventListener('click', () => this.toggleSettings());
    dom.settingsClose.addEventListener('click', () => this.toggleSettings(false));

    dom.openFile.addEventListener('click', async () => {
      if (!this.confirmDiscard()) return;
      try {
        const source = await pickFile();
        dom.examples.value = '';
        await this.load(source);
      } catch (err) {
        if (!isAbort(err)) this.toast(errorMessage(err), true);
      }
    });

    dom.examples.addEventListener('change', () => {
      const entry = this.examples.find((e) => e.path === dom.examples.value);
      if (!entry || !this.confirmDiscard()) return;
      void this.load(exampleSource(entry));
    });

    dom.play.addEventListener('click', () => this.togglePlay());
    dom.reset.addEventListener('click', () => void this.reset());
    dom.fit.addEventListener('click', () => this.viewport.fit());

    dom.camera.addEventListener('change', () => {
      this.cameraScheme = dom.camera.value === 'paint' ? 'paint' : 'classic';
      this.persistEditor();
    });

    this.#bindSlider(dom.speed, dom.speedValue, 'speedHz', (v) => `${v} Hz`);
    this.#bindSlider(dom.passes, dom.passesValue, 'passes', (v) => `${v}×`);
    this.#bindSlider(dom.refresh, dom.refreshValue, 'fileRefreshMs', (v) => `${v} ms`);
  }

  #bindSlider(
    input: HTMLInputElement,
    output: HTMLElement,
    key: keyof Settings,
    format: (v: number) => string
  ): void {
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value);
      output.textContent = format(this.settings[key]);
      writeSettings(this.settings);
    });
  }

  #applySettingsToInputs(): void {
    const { dom, settings } = this;
    dom.speed.value = String(settings.speedHz);
    dom.speedValue.textContent = `${settings.speedHz} Hz`;
    dom.passes.value = String(settings.passes);
    dom.passesValue.textContent = `${settings.passes}×`;
    dom.refresh.value = String(settings.fileRefreshMs);
    dom.refreshValue.textContent = `${settings.fileRefreshMs} ms`;
    dom.camera.value = this.cameraScheme;
  }

  // -------------------------------------------------------------------
  // Editor controls
  // -------------------------------------------------------------------

  #bindEditorControls(): void {
    const { dom } = this;

    // Clicking a toolbar control must not leave focus on it. Enter and Space
    // are the HTML activation keys for <button>, so a focused toolbar button
    // competes for exactly the keys the editor depends on — measured: Enter
    // re-activated the button and never reached the paste-commit handler.
    // preventDefault on mousedown suppresses focus-on-click while leaving Tab
    // navigation working for anyone who deliberately tabs there.
    dom.toolbar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement | null)?.closest('button')) e.preventDefault();
    });

    dom.modeToggle.addEventListener('click', () =>
      this.setMode(this.editor.mode === 'edit' ? 'simulate' : 'edit')
    );

    for (const button of dom.tools) {
      button.addEventListener('click', () => {
        this.editor.tool = button.dataset.tool as ToolId;
        if (this.editor.mode !== 'edit') this.setMode('edit');
        else this.#applyEditorToInputs();
        this.persistEditor();
      });
    }

    for (const button of dom.directions) {
      button.addEventListener('click', () => {
        this.editor.direction = button.dataset.dir as GateDirection;
        this.#applyEditorToInputs();
        this.persistEditor();
      });
    }

    dom.busWidth.addEventListener('input', () => {
      this.editor.setBusWidth(Number(dom.busWidth.value));
      this.#applyEditorToInputs();
      this.persistEditor();
    });

    dom.wireColor.addEventListener('click', () => {
      const open = dom.palette.hidden;
      dom.palette.hidden = !open;
      dom.wireColor.setAttribute('aria-expanded', String(open));
    });

    dom.paletteAdd.addEventListener('click', () => {
      const parsed = fromHex(dom.paletteInput.value);
      if (parsed === null) return;
      if (!this.editor.setColor(parsed)) {
        // Refused rather than silently brightened: wire that does not conduct
        // looks exactly like wire that does.
        this.toast('Too dark to be a wire — one channel must be 224 or brighter.', true);
        return;
      }
      this.#renderPalette();
      this.#applyEditorToInputs();
      this.persistEditor();
    });

    dom.rotateCw.addEventListener('click', () => this.#rotate('cw'));
    dom.rotateCcw.addEventListener('click', () => this.#rotate('ccw'));

    // A notch over a control that owns a parameter adjusts it and is consumed,
    // so it never also scrolls the page or reaches the camera.
    for (const param of this.editor.parameters()) {
      const target = document.getElementById(param.id);
      if (!target) continue;
      target.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          param.step(-Math.sign(e.deltaY));
          this.#renderPalette();
          this.#applyEditorToInputs();
          this.persistEditor();
          this.toast(param.describe());
        },
        { passive: false }
      );
    }

    dom.undo.addEventListener('click', () => this.undo());
    dom.redo.addEventListener('click', () => this.redo());
    dom.save.addEventListener('click', () => void this.save());
  }

  #rotate(direction: 'cw' | 'ccw'): void {
    this.editor.rotatePaste(direction);
    this.dirty = true;
  }

  #renderPalette(): void {
    const { dom, editor } = this;
    dom.paletteGrid.replaceChildren();
    editor.palette.colors.forEach((color, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.style.background = toCss(color);
      swatch.title = toHex(color);
      swatch.classList.toggle('active', index === editor.palette.activeIndex);
      swatch.addEventListener('click', () => {
        editor.palette.select(index);
        this.#renderPalette();
        this.#applyEditorToInputs();
        this.persistEditor();
      });
      dom.paletteGrid.appendChild(swatch);
    });
  }

  setMode(mode: EditorMode): void {
    const wasEditing = this.editor.mode === 'edit';
    this.editor.mode = mode;

    if (mode === 'edit' && !wasEditing) {
      // A circuit that keeps evaluating while you rewire it changes underneath
      // you for reasons that look like your edit. Remember the run state so
      // leaving restores it, rather than always resuming.
      this.runningBeforeEdit = this.running;
      if (this.running) this.togglePlay(false);
    } else if (mode === 'simulate' && wasEditing) {
      this.editor.cancelPaste();
      this.editor.deactivateCursor();
      if (this.runningBeforeEdit !== null) this.togglePlay(this.runningBeforeEdit);
      this.runningBeforeEdit = null;
      this.dirty = true;
    }

    this.#applyEditorToInputs();
    this.persistEditor();
  }

  #applyEditorToInputs(): void {
    const { dom, editor } = this;
    const editing = editor.mode === 'edit';

    dom.modeToggle.setAttribute('aria-pressed', String(editing));
    dom.modeToggle.textContent = editing ? '✎ Editing' : '✎ Edit';
    dom.toolbar.hidden = !editing;
    dom.canvas.classList.toggle('editing', editing);
    dom.canvas.classList.toggle('selecting', editing && editor.tool === 'select');

    for (const button of dom.tools) {
      button.classList.toggle('active', button.dataset.tool === editor.tool);
    }
    for (const button of dom.directions) {
      button.classList.toggle('active', button.dataset.dir === editor.direction);
    }
    dom.busWidth.value = String(editor.busWidth);
    dom.wireSwatch.style.background = toCss(editor.color);
    dom.paletteInput.value = toHex(editor.color);

    const floating = editor.floating !== null;
    dom.rotateCw.disabled = !floating;
    dom.rotateCcw.disabled = !floating;

    this.#refreshEditorState();
  }

  #refreshEditorState(): void {
    const { dom, doc } = this;
    dom.undo.disabled = !doc?.canUndo;
    dom.redo.disabled = !doc?.canRedo;
    dom.dirtyFlag.hidden = !doc?.dirty;
  }

  private persistEditor(): void {
    const { editor } = this;
    this.prefs.mode = editor.mode;
    this.prefs.tool = editor.tool;
    this.prefs.color = editor.color;
    this.prefs.direction = editor.direction;
    this.prefs.customColors = [...editor.palette.custom];
    this.prefs.activeColorIndex = editor.palette.activeIndex;
    this.prefs.busWidth = editor.busWidth;
    this.prefs.cameraScheme = this.cameraScheme;
    writeEditorPrefs(this.prefs);
  }

  undo(): void {
    if (this.doc?.undo()) this.recompile();
  }

  redo(): void {
    if (this.doc?.redo()) this.recompile();
  }

  async save(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    try {
      const outcome = await saveDocument(doc, this.source);
      if (outcome.kind === 'written') this.toast(`Saved to ${outcome.name}`);
      else if (outcome.kind === 'downloaded') this.toast(`Downloaded ${outcome.name}`);
      this.#refreshEditorState();
    } catch (err) {
      if (!isAbort(err)) this.toast(errorMessage(err), true);
    }
  }

  toggleSettings(force?: boolean): void {
    const panel = this.dom.settings;
    const open = force ?? !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    this.dom.settingsToggle.setAttribute('aria-expanded', String(open));
  }

  togglePlay(force?: boolean): void {
    this.running = force ?? !this.running;
    this.dom.play.textContent = this.running ? '⏸ Pause' : '▶ Run';
    this.dom.play.classList.toggle('paused', !this.running);
  }

  async reset(): Promise<void> {
    if (!this.source || !this.confirmDiscard()) return;
    await this.load(this.source);
  }

  toast(message: string, isError = false): void {
    const el = this.dom.toast;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------

  #observeSize(): void {
    const sync = () => {
      this.renderer.resize(this.viewport);
      this.canvasRect = this.dom.canvas.getBoundingClientRect();
    };
    new ResizeObserver(sync).observe(this.dom.canvas);
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  #local(e: PointerEvent | WheelEvent): Point {
    return { x: e.clientX - this.canvasRect.left, y: e.clientY - this.canvasRect.top };
  }

  #worldAt(e: PointerEvent): Point {
    const p = this.#local(e);
    return this.viewport.toWorld(p.x, p.y);
  }

  #pixelAt(e: PointerEvent): PixelPoint {
    const w = this.#worldAt(e);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  /** Bitmap pixel at the centre of the view — where a paste lands by default. */
  #viewCentre(): PixelPoint {
    const w = this.viewport.toWorld(this.viewport.canvasWidth / 2, this.viewport.canvasHeight / 2);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  #bindPointer(): void {
    const canvas = this.dom.canvas;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener(
      'wheel',
      (e) => {
        // Without preventDefault a plain notch scrolls the page and Ctrl+notch
        // zooms the whole document, which would make the paint scheme unusable.
        e.preventDefault();
        applyWheel(this.cameraScheme, this.viewport, e, this.#local(e));
      },
      { passive: false }
    );

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);

      if (e.pointerType === 'touch') {
        const local = this.#local(e);
        this.pointers.set(e.pointerId, local);
        if (this.pointers.size === 2) this.#beginPinch();
        else if (this.pointers.size === 1) this.tapCandidate = { ...local, moved: 0 };
        return;
      }

      this.lastMouse = this.#local(e);

      if (this.editor.handlePointerDown(e, this.#pixelAt(e))) {
        this.dirty = true;
        this.#applyEditorToInputs();
        return;
      }
      // In edit mode the editor owns both buttons, so nothing below can run and
      // no click can drive or toggle a wire.
      if (this.editor.mode === 'edit') return;

      if (e.button === 1) {
        this.panning = true;
        e.preventDefault();
      } else if (e.button === 0) {
        // Left click pulses the wire HIGH for as long as it is held, resolved
        // against the press position so dragging away still releases it.
        const w = this.#worldAt(e);
        this.held = w;
        this.#poke(w, '1');
      } else if (e.button === 2) {
        this.#poke(this.#worldAt(e), 'x');
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const now = this.#local(e);

      if (e.pointerType === 'touch') {
        const prev = this.pointers.get(e.pointerId);
        if (!prev) return;
        this.pointers.set(e.pointerId, now);
        if (this.pointers.size >= 2) {
          this.#updatePinch();
        } else {
          if (this.tapCandidate) {
            this.tapCandidate.moved += Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y);
          }
          this.viewport.panBy(now.x - prev.x, now.y - prev.y);
        }
        return;
      }

      const prev = this.lastMouse;
      this.lastMouse = now;

      if (this.editor.mode === 'edit') {
        this.hover = this.#pixelAt(e);
        // The pointer reclaims control from the keyboard cursor.
        if (this.editor.cursorActive) {
          this.editor.deactivateCursor();
          this.dirty = true;
        }
        if (this.editor.handlePointerMove(e, this.hover)) {
          this.dirty = true;
          return;
        }
      }

      if (this.panning && prev) this.viewport.panBy(now.x - prev.x, now.y - prev.y);
    });

    const release = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

      if (e.pointerType === 'touch') {
        if (!this.pointers.delete(e.pointerId)) return;
        if (this.pointers.size < 2) this.pinch = null;
        const tap = this.tapCandidate;
        // Touch never edits; in edit mode a tap must not poke a wire either.
        if (tap && tap.moved < TAP_SLOP && this.editor.mode !== 'edit') {
          this.#poke(this.viewport.toWorld(tap.x, tap.y), 'x');
        }
        if (this.pointers.size === 0) this.tapCandidate = null;
        return;
      }

      if (this.editor.handlePointerUp(e, this.#pixelAt(e))) {
        this.dirty = true;
        this.#applyEditorToInputs();
        return;
      }
      if (this.editor.mode === 'edit') return;

      if (e.button === 1) this.panning = false;
      if (e.button === 0 && this.held) {
        this.#poke(this.held, '0');
        this.held = null;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', (e) => {
      if (this.editor.drawing) this.editor.cancelStroke();
      release(e);
    });

    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
  }

  #poke(world: Point, what: Poke): void {
    if (!this.circuit) return;
    this.circuit.setStateAt(world.x, world.y, what);
    this.dirty = true;
  }

  #beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    this.tapCandidate = null;
  }

  #updatePinch(): void {
    const previous = this.pinch;
    if (!previous) {
      this.#beginPinch();
      return;
    }
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.viewport.panBy(mid.x - previous.mid.x, mid.y - previous.mid.y);
    this.viewport.zoomAt(mid.x, mid.y, Math.log2(dist / previous.dist));
    this.pinch = { dist, mid };
  }

  // -------------------------------------------------------------------
  // Keyboard — every decision comes from resolveKey
  // -------------------------------------------------------------------

  #bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const action = resolveKey(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          targetTag: e.target instanceof HTMLElement ? e.target.tagName : undefined,
        },
        {
          mode: this.editor.mode,
          hasFloating: this.editor.floating !== null,
          cursorActive: this.editor.cursorActive,
          hasSelection: this.editor.selection !== null,
        }
      );
      if (!action) {
        this.repeats = 0;
        return;
      }
      // Held arrows accelerate; anything else resets the ramp.
      this.repeats = e.repeat ? this.repeats + 1 : 0;
      if (this.#perform(action)) e.preventDefault();
    });

    window.addEventListener('keyup', () => {
      this.repeats = 0;
    });
  }

  /** How far one arrow press moves, growing while the key is held. */
  #step(): number {
    return Math.min(MAX_STEP, 1 + Math.floor(this.repeats / REPEAT_RAMP));
  }

  /** Returns true when the default action should be suppressed. */
  #perform(action: NonNullable<InputAction>): boolean {
    const step = this.#step();
    switch (action.kind) {
      case 'move':
        if (action.target === 'paste') this.editor.moveFloating(action.dx * step, action.dy * step);
        else this.editor.moveCursor(action.dx * step, action.dy * step);
        this.dirty = true;
        return true;
      case 'activateCursor':
        this.editor.activateCursor(action.dx * step, action.dy * step);
        this.dirty = true;
        return true;
      case 'deactivateCursor':
        this.editor.deactivateCursor();
        this.dirty = true;
        return true;
      case 'applyTool':
        this.editor.applyAtCursor();
        this.dirty = true;
        return true;
      case 'commit':
        this.editor.commitPaste();
        this.dirty = true;
        this.#applyEditorToInputs();
        return true;
      case 'cancelPaste':
        this.editor.cancelPaste();
        this.dirty = true;
        this.#applyEditorToInputs();
        return true;
      case 'clearSelection':
        this.editor.clipboard.clearSelection();
        this.dirty = true;
        return true;
      case 'clearRegion':
        this.editor.clearRegion();
        return true;
      case 'copy': {
        const copied = this.editor.copy();
        this.toast(copied ? 'Copied' : 'Nothing selected.', !copied);
        return true;
      }
      case 'cut':
        if (this.editor.cut()) this.toast('Cut');
        return true;
      case 'paste': {
        const centre = this.#viewCentre();
        if (this.editor.mode !== 'edit') this.setMode('edit');
        if (!this.editor.paste(centre.x, centre.y)) {
          this.toast('Nothing to paste — select something and copy it first.', true);
        }
        this.dirty = true;
        this.#applyEditorToInputs();
        return true;
      }
      case 'undo':
        this.undo();
        return true;
      case 'redo':
        this.redo();
        return true;
      case 'save':
        void this.save();
        return true;
      case 'togglePause':
        this.togglePlay();
        return true;
      case 'toggleSettings':
        this.toggleSettings();
        return false;
      case 'toggleMode':
        this.setMode(this.editor.mode === 'edit' ? 'simulate' : 'edit');
        return false;
      case 'reset':
        void this.reset();
        return false;
      case 'fit':
        this.viewport.fit();
        return false;
      case 'zoom':
        this.viewport.zoomAt(
          this.viewport.canvasWidth / 2,
          this.viewport.canvasHeight / 2,
          action.direction * (120 / 256)
        );
        return false;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);

    const now = performance.now();
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;

    const circuit = this.circuit;
    if (circuit) {
      let cycles = 0;
      if (this.running) {
        const interval = 1000 / this.settings.speedHz;
        this.accumulator = Math.min(this.accumulator + elapsed, MAX_CATCHUP_MS);
        let ticks = 0;
        while (this.accumulator >= interval && ticks < MAX_TICKS_PER_FRAME) {
          this.accumulator -= interval;
          for (let i = 0; i < this.settings.passes; i++) circuit.simulate();
          cycles += this.settings.passes;
          ticks++;
        }
      }
      if (cycles || this.dirty) {
        circuit.render();
        this.dirty = false;
      }
      this.renderer.draw(this.viewport);
      this.renderer.drawOverlay(this.viewport, this.#overlay());
      this.#updateStats(circuit, now, cycles);
    }

    void this.#pollFile(now);
  };

  #overlay(): Overlay {
    const editing = this.editor.mode === 'edit';
    const doc = this.doc;
    return {
      pending: doc ? doc.pendingEdits() : EMPTY_PIXELS,
      preview: editing && this.hover ? this.editor.previewAt(this.hover) : EMPTY_PIXELS,
      hover: editing ? this.hover : null,
      showGrid: editing,
      selection: editing ? this.editor.selection : null,
      floating: editing ? this.editor.floating : null,
      cursor: editing && this.editor.cursorActive ? this.editor.cursor : null,
    };
  }

  #updateStats(circuit: Circuit, now: number, cycles: number): void {
    const w = this.fpsWindow;
    w.frames++;
    w.cycles += cycles;
    if (now - w.since >= 500) {
      const seconds = (now - w.since) / 1000;
      this.dom.statFps.textContent = `${Math.round(w.frames / seconds)} fps`;
      this.dom.statRate.textContent = `${Math.round(w.cycles / seconds).toLocaleString()} cyc/s`;
      w.frames = 0;
      w.cycles = 0;
      w.since = now;
    }
    this.dom.statCycle.textContent = circuit.cycle.toLocaleString();
    this.dom.zoomValue.textContent = `${(this.viewport.zoom * 100).toFixed(0)}%`;
  }

  async #pollFile(now: number): Promise<void> {
    const source = this.source;
    if (this.polling || !source || !source.canLiveReload) return;
    if (now - this.lastPoll < this.settings.fileRefreshMs) return;
    this.lastPoll = now;
    this.polling = true;
    try {
      const fresh = await source.poll();
      if (!fresh) return;
      // Our own writes never reach here: write() refreshes the poll stamp.
      if (this.doc?.dirty) {
        this.toast('The file changed on disk, but you have unsaved edits. Save or reset.', true);
        return;
      }
      await this.load(source, fresh, true);
    } catch {
      // A save in progress can momentarily fail; the next poll will retry.
    } finally {
      this.polling = false;
    }
  }
}

export function initApp(): App {
  const app = new App();
  void app.start();
  return app;
}
