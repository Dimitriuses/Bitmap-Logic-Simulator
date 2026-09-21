// ui.ts — application shell: controls, input handling and the frame loop.

import { queryDom, type Dom } from './dom.js';
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
import { Renderer, Viewport, type Point } from './renderer.js';
import { Circuit, type Poke } from './simulator.js';
import { readSettings, writeSettings, type Settings } from './settings.js';

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

class App {
  private readonly dom: Dom;
  private readonly renderer: Renderer;
  private readonly viewport = new Viewport();

  private circuit: Circuit | null = null;
  private source: FileSource | null = null;
  private examples: ExampleEntry[] = [];

  private running = true;
  private readonly settings: Settings = readSettings();

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
  /** A manual state change needs a repaint even if paused. */
  private dirty = false;

  constructor() {
    this.dom = queryDom();
    this.renderer = new Renderer(this.dom.canvas);
    this.canvasRect = this.dom.canvas.getBoundingClientRect();

    this.#bindControls();
    this.#bindPointer();
    this.#bindKeyboard();
    this.#observeSize();

    setupDragDrop(
      document.body,
      (source, err) => {
        if (err) this.toast(errorMessage(err), true);
        else if (source) void this.load(source);
      },
      (active) => this.dom.dropzone.classList.toggle('active', active)
    );

    this.#applySettingsToInputs();
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
      const previous = this.circuit;
      const prevRender =
        keepState && previous
          ? { data: previous.frame.data, width: previous.width, height: previous.height }
          : null;

      const t0 = performance.now();
      const circuit = new Circuit(imageData, prevRender);
      const loadMs = performance.now() - t0;

      const isNewFile = this.source !== source;
      this.circuit = circuit;
      this.source = source;
      this.renderer.setCircuit(circuit);
      this.viewport.bitmapWidth = circuit.width;
      this.viewport.bitmapHeight = circuit.height;
      if (isNewFile && !keepState) this.viewport.fit();

      this.#showCircuitInfo(source, circuit);
      if (!keepState) {
        const gates = circuit.gateCount.toLocaleString();
        this.toast(`${source.name} — ${gates} gates in ${loadMs.toFixed(0)} ms`);
      }
    } catch (err) {
      if (isAbort(err)) return;
      this.toast(`Could not load ${source.name}: ${errorMessage(err)}`, true);
    }
  }

  #showCircuitInfo(source: FileSource, circuit: Circuit): void {
    const { dom } = this;
    dom.fileName.textContent = source.name;
    dom.statSize.textContent = `${circuit.width}×${circuit.height}`;
    dom.statWires.textContent = circuit.wireCount.toLocaleString();
    dom.statGates.textContent = circuit.gateCount.toLocaleString();
    dom.liveNote.textContent = source.canLiveReload
      ? 'Live reload on — edit and save the PNG to update the running circuit.'
      : supportsLiveReload
        ? 'Live reload off for this file. Use Open File to enable it.'
        : 'Live reload needs Chrome or Edge.';
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

  // -------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------

  #bindControls(): void {
    const { dom } = this;

    dom.settingsToggle.addEventListener('click', () => this.toggleSettings());
    dom.settingsClose.addEventListener('click', () => this.toggleSettings(false));

    dom.openFile.addEventListener('click', async () => {
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
      if (entry) void this.load(exampleSource(entry));
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
    if (this.source) await this.load(this.source);
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

      if (e.button === 1) this.panning = false;
      if (e.button === 0 && this.held) {
        this.#poke(this.held, '0');
        this.held = null;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
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

      switch (e.key) {
        case 'Escape':
          this.toggleSettings();
          break;
        case ' ':
          if (typing) return;
          e.preventDefault();
          this.togglePlay();
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
      this.#updateStats(circuit, now, cycles);
    }

    void this.#pollFile(now);
  };

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
      // Reload carrying state over, exactly like the desktop's prevBitmap path.
      if (fresh) await this.load(source, fresh, true);
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
