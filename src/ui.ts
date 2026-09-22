// ui.ts — application shell: controls, input handling and the frame loop.

import { fromHex, toHex, type Rgba } from './colors.js';
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

// One Windows wheel notch is 120 units and the original scales by 1/256.
const WHEEL_EXP = 120 / 256;

/** Movement in CSS pixels below which a touch still counts as a tap. */
const TAP_SLOP = 8;

/** Simulation catch-up limits, so a backgrounded tab does not stall on return. */
const MAX_CATCHUP_MS = 250;
const MAX_TICKS_PER_FRAME = 16;

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
  private readonly settings: Settings = readSettings();
  private readonly prefs: EditorPrefs = readEditorPrefs();

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
  /** World point of the wire being pulsed by the left button. */
  private held: Point | null = null;
  /** Bitmap pixel under the pointer, for the editor's hover cursor. */
  private hover: PixelPoint | null = null;
  /** A manual state change needs a repaint even if paused. */
  private dirty = false;

  constructor() {
    this.dom = queryDom();
    this.renderer = new Renderer(this.dom.canvas);
    this.canvasRect = this.dom.canvas.getBoundingClientRect();
    this.editor = new Editor(() => this.recompile());

    this.editor.mode = this.prefs.mode;
    this.editor.tool = this.prefs.tool;
    this.editor.direction = this.prefs.direction;
    this.editor.setColor(this.prefs.color);

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
    this.#applyEditorToInputs();

    // An edited circuit that has not been saved must not vanish silently.
    window.addEventListener('beforeunload', (e) => {
      if (!this.doc?.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /** Populate the examples menu, load the first circuit, start the loop. */
  async start(): Promise<void> {
    requestAnimationFrame(this.frame);
    await this.#populateExamples();
    await this.#bootstrap();
  }

  // -------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------

  async #bootstrap(): Promise<void> {
    // ?file= is a site-relative path, e.g. ?file=projects/CPU/ALU.png
    const param = new URLSearchParams(location.search).get('file');
    if (param && !/^[a-z]+:/i.test(param)) {
      const name = param.split('/').pop() ?? param;
      this.dom.examples.value = '';
      await this.load(FileSource.fromUrl(name, param));
      return;
    }

    const first =
      this.examples.find((e) => e.path === DEFAULT_EXAMPLE) ?? this.examples[0] ?? null;
    if (!first) {
      this.toast('No example schematics found. Drop a PNG to start.', true);
      return;
    }
    this.dom.examples.value = first.path;
    await this.load(exampleSource(first));
  }

  /**
   * @param source    where the schematic comes from
   * @param preloaded already-decoded pixels (live reload)
   * @param keepState carry wire states over from the running circuit
   */
  async load(source: FileSource, preloaded: ImageData | null = null, keepState = false) {
    try {
      const imageData = preloaded ?? (await source.read());

      const t0 = performance.now();
      const doc = CircuitDocument.fromImageData(source.name, imageData);
      const circuit = doc.compile(keepState ? this.prevRender() : null);
      // A recompile builds a fresh Circuit, whose cycle counter starts at zero.
      // Carrying it over keeps a live reload or an edit from looking like a
      // restart in the status bar, which is the one place the user would see one.
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
      this.#refreshEditorState();
      if (!keepState) {
        const gates = circuit.gateCount.toLocaleString();
        this.toast(`${source.name} — ${gates} gates in ${loadMs.toFixed(0)} ms`);
      }
    } catch (err) {
      if (isAbort(err)) return;
      this.toast(`Could not load ${source.name}: ${errorMessage(err)}`, true);
    }
  }

  /** The previous frame, so wire state carries across a recompile. */
  private prevRender() {
    const previous = this.circuit;
    if (!previous) return null;
    return { data: previous.frame.data, width: previous.width, height: previous.height };
  }

  /**
   * Rebuild the circuit from the document. Called once per completed stroke and
   * once per undo/redo — never per pointer event, which at ~190 ms for Enigma2
   * would look like a hang.
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

  /** Build the Examples dropdown, one <optgroup> per folder under projects/. */
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

  /** Guard against throwing away unsaved drawing. */
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
      if (!entry) return;
      if (!this.confirmDiscard()) return;
      void this.load(exampleSource(entry));
    });

    dom.play.addEventListener('click', () => this.togglePlay());
    dom.reset.addEventListener('click', () => void this.reset());
    dom.fit.addEventListener('click', () => this.viewport.fit());

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
  }

  // -------------------------------------------------------------------
  // Editor controls
  // -------------------------------------------------------------------

  #bindEditorControls(): void {
    const { dom } = this;

    dom.modeToggle.addEventListener('click', () => this.setMode(
      this.editor.mode === 'edit' ? 'simulate' : 'edit'
    ));

    for (const button of dom.tools) {
      button.addEventListener('click', () => {
        this.editor.tool = button.dataset.tool as ToolId;
        // Reaching for a tool means you intend to draw.
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

    dom.wireColor.addEventListener('input', () => {
      const parsed = fromHex(dom.wireColor.value);
      if (parsed === null) return;
      if (!this.editor.setColor(parsed)) {
        // Rejected rather than silently corrected: a colour the engine reads as
        // insulation would draw wire that looks right and does not conduct.
        this.toast('Too dark to be a wire — one channel must be 224 or brighter.', true);
        dom.wireColor.value = toHex(this.editor.color);
        return;
      }
      this.persistEditor();
    });

    dom.undo.addEventListener('click', () => this.undo());
    dom.redo.addEventListener('click', () => this.redo());
    dom.save.addEventListener('click', () => void this.save());
  }

  setMode(mode: EditorMode): void {
    this.editor.mode = mode;
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

    for (const button of dom.tools) {
      button.classList.toggle('active', button.dataset.tool === editor.tool);
    }
    for (const button of dom.directions) {
      button.classList.toggle('active', button.dataset.dir === editor.direction);
    }
    dom.wireColor.value = toHex(editor.color);
    this.#refreshEditorState();
  }

  /** Undo/redo availability and the unsaved marker. */
  #refreshEditorState(): void {
    const { dom, doc } = this;
    dom.undo.disabled = !doc?.canUndo;
    dom.redo.disabled = !doc?.canRedo;
    dom.dirtyFlag.hidden = !doc?.dirty;
  }

  private persistEditor(): void {
    this.prefs.mode = this.editor.mode;
    this.prefs.tool = this.editor.tool;
    this.prefs.color = this.editor.color;
    this.prefs.direction = this.editor.direction;
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

  /** Reload the file from scratch, discarding all wire states. */
  async reset(): Promise<void> {
    if (!this.source) return;
    if (!this.confirmDiscard()) return;
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

  /** The bitmap pixel under an event, which is what tools operate on. */
  #pixelAt(e: PointerEvent): PixelPoint {
    const w = this.#worldAt(e);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  #bindPointer(): void {
    const canvas = this.dom.canvas;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.#local(e);
        // deltaMode 1 is lines, 2 is pages; normalise everything to notches.
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 100;
        this.viewport.zoomAt(p.x, p.y, (-e.deltaY / unit) * WHEEL_EXP);
      },
      { passive: false }
    );

    // Touch pointers live in `pointers` and drive the gestures; mouse and pen
    // are handled by button and never enter that map, so a mouse button whose
    // release went missing can never be mistaken for a pinching finger.
    //
    // Touch never draws: editing targets pointer input, and taking the single
    // -finger drag for drawing would cost the pan gesture on phones.
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

      // Edit mode claims the left button; everything else is unchanged.
      if (this.editor.handlePointerDown(e, this.#pixelAt(e))) {
        this.dirty = true;
        return;
      }

      if (e.button === 1) {
        this.panning = true;
        e.preventDefault();
      } else if (e.button === 0) {
        // Left click pulses the wire HIGH for as long as it is held. The
        // original resolves press and release against the *press* position, so
        // dragging away and letting go still releases the wire you grabbed.
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
          // tapCandidate is null when this finger is the survivor of a pinch.
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
        // A touch that barely moved is a tap: toggle the wire under it.
        const tap = this.tapCandidate;
        if (tap && tap.moved < TAP_SLOP) {
          this.#poke(this.viewport.toWorld(tap.x, tap.y), 'x');
        }
        if (this.pointers.size === 0) this.tapCandidate = null;
        return;
      }

      if (this.editor.handlePointerUp(e, this.#pixelAt(e))) {
        this.dirty = true;
        return;
      }

      if (e.button === 1) this.panning = false;
      if (e.button === 0 && this.held) {
        this.#poke(this.held, '0');
        this.held = null;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', (e) => {
      if (this.editor.drawing) this.editor.cancel();
      release(e);
    });

    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
  }

  /** Apply a manual wire state and make sure it shows even while paused. */
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

  #bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Leave the sliders and the select alone while they have focus.
      const tag = e.target instanceof HTMLElement ? e.target.tagName : '';
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) this.redo();
          else this.undo();
          return;
        }
        if (key === 'y') {
          e.preventDefault();
          this.redo();
          return;
        }
        if (key === 's') {
          e.preventDefault();
          void this.save();
          return;
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          this.toggleSettings();
          break;
        case ' ':
          if (typing) return;
          e.preventDefault();
          this.togglePlay();
          break;
        case 'e':
        case 'E':
          if (typing) return;
          this.setMode(this.editor.mode === 'edit' ? 'simulate' : 'edit');
          break;
        case 'r':
        case 'R':
          if (typing) return;
          void this.reset();
          break;
        case 'f':
        case 'F':
          if (typing) return;
          this.viewport.fit();
          break;
        case '+':
        case '=':
          this.#zoomCentre(WHEEL_EXP);
          break;
        case '-':
        case '_':
          this.#zoomCentre(-WHEEL_EXP);
          break;
        default:
          break;
      }
    });
  }

  #zoomCentre(deltaExp: number): void {
    this.viewport.zoomAt(this.viewport.canvasWidth / 2, this.viewport.canvasHeight / 2, deltaExp);
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
      // Pixels painted since the last compile: the circuit does not know about
      // them yet, and render() would not draw them.
      pending: doc ? doc.pendingEdits() : EMPTY_PIXELS,
      preview: editing && this.hover ? this.editor.previewAt(this.hover) : EMPTY_PIXELS,
      hover: editing ? this.hover : null,
      showGrid: editing,
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
      // An external change while the user has unsaved drawing is a genuine
      // conflict. Reloading would silently destroy their work, so say so and
      // leave the document alone. (Our own writes never reach here: write()
      // refreshes the poll stamp.)
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
