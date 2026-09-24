// analysis-panel.ts — the analysis side panel.
//
// Presentation only. Every number here comes from analysis.ts and its
// modules, and this file is careful about two things:
//
//   1. It never says "optimal". The minimiser optimises sum-of-products while
//      the number shown is inverter cost; those are different objectives, so
//      the word for the result is "minimised".
//   2. It reports agreement out loud. "The simulator matches the logic" is the
//      likely finding and the whole point of running the check, and a finding
//      that arrives as silence is a finding nobody reads.

import { analyse, type AnalysisResult } from './analysis.js';
import type { PixelBlock, Rect } from './block.js';
import { evaluate, formatExpr, MAX_INPUTS, type TruthTable } from './boolean.js';
import type { CircuitDocument } from './document.js';
import type { Dom } from './dom.js';
import { layout } from './layout.js';
import { netById, type NetId, type Netlist } from './netlist.js';
import type { Circuit } from './simulator.js';
import { makeNamer, resolveLabels, type Label, type Resolution } from './labels.js';
import { importNetlist, labelsFrom, toJsonText } from './netlist-json.js';
import { sweep, sweepSequential, type Discrepancy } from './oracle.js';
import { describePowerOn, type StorageElement, type StorageReport } from './storage-elements.js';
import { describeCandidate, stepClock, tiedWith } from './clock.js';

export interface PanelHost {
  doc(): CircuitDocument | null;
  selection(): Rect | null;
  toast(message: string, isError?: boolean): void;
  /** Hand a generated block to the editor's floating-paste mechanism. */
  offerPaste(block: PixelBlock): boolean;
  /** Analysis drives its own copy of the circuit; the live one should hold still. */
  pause(): void;
  /** Both panels occupy the same edge of the stage, so only one may be open. */
  closeSettings(): void;
  /**
   * Hand a finished analysis's netlist to the stage so it can be drawn.
   *
   * The panel does not build the diagram itself: a schematic is a view, and
   * views belong to the stage. This keeps one netlist behind both.
   */
  showSchematic(
    netlist: Netlist,
    rect: Rect,
    nameOf: (n: NetId) => string | null,
    clockNet: NetId | null
  ): void;
  /**
   * Every name the user has given, anchored in DOCUMENT coordinates.
   *
   * Raw rather than resolved, because resolution depends on which circuit the
   * ids came from — and the panel's ids come from the analysed crop, not the
   * whole document. Resolving here keeps the two in step.
   */
  labels(): readonly Label[];
  /** Name the net at this document pixel; an empty name clears it. */
  rename(anchor: { x: number; y: number }, name: string): void;
  /**
   * Light up a net's pixels on the circuit, because it is being pointed at in
   * the panel. `circuit` is the analysed crop — its net ids mean nothing
   * against the document's own compile — and `origin` is where that crop sits.
   * Pass null to clear.
   */
  highlightNet(net: NetId | null, circuit: Circuit | null, origin: { x: number; y: number }): void;
}

/** Rows swept between yields to the browser. */
const SLICE = 256;

export class AnalysisPanel {
  #result: AnalysisResult | null = null;
  /** The net the user picked as the clock. Never chosen for them. */
  #clock: NetId | null = null;
  #markedOutputs: NetId[] | null = null;
  #abort = false;
  #busy = false;

  constructor(
    private readonly dom: Dom,
    private readonly host: PanelHost
  ) {
    // Analysis is reachable only from analysis mode now (FR-008); the button
    // lives in that mode's own toolbar rather than the editing one.
    dom.analysisRunToolbar.addEventListener('click', () => {
      this.open(true);
      void this.run();
    });
    dom.analysisPanelToggle.addEventListener('click', () => this.open());
    dom.analysisClockStep.addEventListener('click', () => this.#stepClock());
    dom.analysisClose.addEventListener('click', () => this.open(false));
    dom.analysisRun.addEventListener('click', () => void this.run());
    dom.analysisAbort.addEventListener('click', () => {
      this.#abort = true;
    });
    dom.analysisReplace.addEventListener('click', () => this.#offerReplacement());
    dom.analysisExport.addEventListener('click', () => this.#exportNetlist());
    dom.analysisImport.addEventListener('click', () => void this.#importNetlist());

    for (const button of [dom.analysisRunToolbar, dom.analysisPanelToggle, dom.analysisRun,
      dom.analysisAbort, dom.analysisReplace, dom.analysisExport, dom.analysisImport,
      dom.analysisClose]) {
      // Enter and Space activate a focused <button>, which are exactly the keys
      // the editor needs. Same reason the toolbar does this.
      button.addEventListener('mousedown', (e) => e.preventDefault());
    }
  }

  get isOpen(): boolean {
    return this.dom.analysis.classList.contains('open');
  }

  open(force?: boolean): void {
    const open = force ?? !this.isOpen;
    this.dom.analysis.classList.toggle('open', open);
    if (open) this.host.closeSettings();
  }

  /** A displayed result describes a circuit that may no longer exist. */
  markStale(): void {
    if (!this.#result) return;
    this.#result.stale = true;
    this.dom.analysisStale.hidden = false;
  }

  /** Called whenever the selection, mode or document changes. */
  refreshAvailability(): void {
    const has = this.host.selection() !== null && this.host.doc() !== null;
    const ready = has && !this.#busy;
    this.dom.analysisRunToolbar.disabled = !ready;
    this.dom.analysisRun.disabled = !ready;
  }

  // -------------------------------------------------------------------

  async run(): Promise<void> {
    const doc = this.host.doc();
    const rect = this.host.selection();
    if (!doc || !rect) {
      this.#status('Select a region first.', true);
      return;
    }

    this.host.pause();
    this.#busy = true;
    this.#abort = false;
    this.refreshAvailability();
    this.dom.analysisStale.hidden = true;
    this.#status('Extracting…');

    // Yield once so the status paints before the extraction blocks.
    await frame();

    // The structural pass is fast; only the sweep is sliced, below.
    const outcome = analyse({
      doc,
      rect,
      markedOutputs: this.#markedOutputs ?? undefined,
      clock: this.#clock,
      runOracle: false,
      simplify: this.dom.analysisSimplify.checked,
      runPowerOn: this.dom.analysisPowerOn.checked,
    });

    if (!outcome.ok) {
      this.#busy = false;
      this.refreshAvailability();
      this.#clearResults();
      this.#status(outcome.reason, true);
      return;
    }

    this.#result = outcome.result;
    // The diagram gets the same names as everything else — one naming
    // function, so a label cannot appear in the list but not on the symbol.
    this.host.showSchematic(
      outcome.result.netlist,
      rect,
      makeNamer(this.#resolve(outcome.result)),
      this.#clock ?? outcome.result.clocks.find((c) => c.rank === 1)?.net ?? null
    );
    this.#render(outcome.result);
    this.#status('');

    if (this.dom.analysisOracle.checked && outcome.result.table) {
      await this.#runSweep(outcome.result, outcome.result.table);
    } else if (this.dom.analysisOracle.checked && outcome.result.sequential) {
      await this.#runSequentialSweep(outcome.result);
    }

    this.#busy = false;
    this.refreshAvailability();
  }

  /**
   * Drive the sweep in slices.
   *
   * A 16-input sweep is around twelve seconds. Run whole, it freezes the tab,
   * which is indistinguishable from a crash and leaves no way to stop it.
   */
  async #runSweep(result: AnalysisResult, expected: TruthTable): Promise<void> {
    const total = expected.rows.length;
    const { dom } = this;
    dom.analysisProgress.hidden = false;
    dom.analysisProgress.max = total;
    dom.analysisProgress.value = 0;
    dom.analysisAbort.hidden = false;

    const discrepancies: Discrepancy[] = [];
    let nonConvergent = 0;
    let timingDependent = 0;
    let done = 0;
    let stopped = false;

    for (let from = 0; from < total; from += SLICE) {
      if (this.#abort) {
        stopped = true;
        break;
      }
      const to = Math.min(total, from + SLICE);
      const slice = sweep(result.circuit, result.netlist, expected, {
        window: { from, to },
      });
      discrepancies.push(...slice.discrepancies);
      nonConvergent += slice.nonConvergentRows;
      timingDependent += slice.timingDependentRows;
      done = to;
      dom.analysisProgress.value = done;
      await frame();
    }

    dom.analysisProgress.hidden = true;
    dom.analysisAbort.hidden = true;
    this.#renderOracle(result, discrepancies, nonConvergent, timingDependent, done, total, stopped);
  }

  /**
   * The sequential check, in one pass.
   *
   * Unlike the combinational sweep this is not sliced: a sequential row seeds
   * the whole circuit and lets it settle, so rows are not independent of the
   * work that sets them up, and splitting them across frames would be more
   * machinery than the sizes involved justify. The width is bounded before it
   * starts instead.
   */
  async #runSequentialSweep(result: AnalysisResult): Promise<void> {
    const model = result.sequential;
    if (!model) return;
    const width = result.inputs.length + model.stateNets.length;
    if (width > MAX_INPUTS) {
      this.#renderOracleNote(
        `Not checked: ${result.inputs.length} inputs plus ${model.stateNets.length} state ` +
          `variable(s) is ${width} variables, beyond the limit of ${MAX_INPUTS}. ` +
          'Select a smaller region.'
      );
      return;
    }

    this.#status(`Driving ${2 ** width} combinations through the simulator…`);
    await frame();

    const res = sweepSequential(
      result.circuit,
      result.netlist,
      result.inputs,
      model.stateNets,
      model.nextState,
      evaluate,
      { shouldAbort: () => this.#abort }
    );
    this.#status('');
    this.#renderOracle(
      result,
      res.discrepancies,
      res.nonConvergentRows,
      res.timingDependentRows,
      res.observed.rows.length,
      2 ** width,
      res.aborted
    );
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  #status(text: string, isError = false): void {
    const el = this.dom.analysisStatus;
    el.textContent = text;
    el.classList.toggle('warn', isError);
    el.hidden = text === '';
  }

  #clearResults(): void {
    const { dom } = this;
    this.#result = null;
    for (const group of [
      dom.analysisShapeGroup,
      dom.analysisIoGroup,
      dom.analysisTableGroup,
      dom.analysisOracleGroup,
      dom.analysisSimplifyGroup,
      dom.analysisStorageGroup,
      dom.analysisClockGroup,
    ]) {
      group.hidden = true;
    }
    dom.analysisExport.disabled = true;
    dom.analysisReplace.disabled = true;
  }

  #render(result: AnalysisResult): void {
    const { dom } = this;
    // The chips are about to be replaced; a highlight owned by one of them
    // would otherwise outlive the element that set it.
    this.host.highlightNet(null, null, { x: 0, y: 0 });
    const resolution = this.#resolve(result);
    const name = nameFor(result.netlist, resolution);

    dom.analysisShapeGroup.hidden = false;
    dom.analysisShape.textContent =
      `${result.rect.width}×${result.rect.height} px · ${result.netlist.nets.length} nets · ` +
      `${result.netlist.gates.length} gates · ` +
      (result.kind === 'sequential'
        ? `sequential, ${result.sequential?.stateNets.length ?? 0} state variable(s)`
        : 'combinational');

    dom.analysisNotes.replaceChildren(
      ...result.notes.map((n) => {
        const li = document.createElement('li');
        li.textContent = n;
        return li;
      })
    );

    // --- nets
    dom.analysisIoGroup.hidden = false;
    const named = new Set([...result.inputs, ...result.outputs, ...result.netlist.cut]);
    const internal = result.netlist.nets
      .map((n) => n.id)
      .filter((id) => !named.has(id))
      .slice(0, 60);

    dom.analysisInputs.replaceChildren(
      label('inputs'),
      ...result.inputs.map((id) => this.#netChip(result, id, name, 'input'))
    );
    dom.analysisOutputs.replaceChildren(
      label('outputs'),
      ...result.outputs.map((id) => this.#netChip(result, id, name, 'output', () => this.#unmarkOutput(id)))
    );
    dom.analysisInternal.replaceChildren(
      ...(internal.length
        ? [label('internal'), ...internal.map((id) => this.#netChip(result, id, name, 'internal'))]
        : [])
    );
    dom.analysisCut.replaceChildren(
      ...(result.netlist.cut.length
        ? [
            label('cut by the selection'),
            ...result.netlist.cut.map((id) => this.#netChip(result, id, name, 'cut')),
          ]
        : [])
    );

    // A name whose pixel is no longer wire is reported, never quietly dropped
    // and never moved to a neighbouring net (LB-3).
    const unresolved = resolution.unresolved;
    dom.analysisUnresolved.hidden = unresolved.length === 0;
    if (unresolved.length > 0) {
      dom.analysisUnresolved.textContent =
        `${unresolved.length} name(s) no longer sit on a wire: ` +
        `${unresolved.map((l) => `${l.name} (${l.anchor.x},${l.anchor.y})`).join(', ')}. ` +
        'They are kept, not moved.';
    }

    // --- truth table
    if (result.table && result.table.outputs.length > 0) {
      dom.analysisTableGroup.hidden = false;
      dom.analysisTable.replaceChildren(renderTable(result.table, name));
    } else {
      dom.analysisTableGroup.hidden = true;
    }

    // --- sequential next-state functions in place of a table
    if (result.kind === 'sequential' && result.sequential) {
      const list = document.createElement('div');
      for (const s of result.sequential.stateNets) {
        const e = result.sequential.nextState.get(s);
        if (!e) continue;
        const p = document.createElement('p');
        p.className = 'expr';
        p.textContent = `next ${name(s)} = ${formatExpr(e, name)}`;
        list.appendChild(p);
      }
      dom.analysisTableGroup.hidden = false;
      dom.analysisTable.replaceChildren(list);
    }

    // --- memory
    this.#renderStorage(result.storage, name);

    // --- clock
    this.#renderClocks(result, name);

    // --- simplification
    this.#renderSimplification(result, name);

    dom.analysisExport.disabled = false;
    dom.analysisOracleGroup.hidden = true;
  }

  /**
   * Storage, and whether it starts from a known value.
   *
   * Kept in its own section, above the simulator verdict, because the two
   * answer different questions and a reader must not take a pass on one as a
   * pass on the other. An undefined power-on state is stated as a fault, not
   * mentioned in passing.
   */
  #renderStorage(report: StorageReport | null, name: (n: NetId) => string): void {
    const { dom } = this;
    if (!report || (report.elements.length === 0 && report.settlingLoops === 0)) {
      dom.analysisStorageGroup.hidden = true;
      return;
    }
    dom.analysisStorageGroup.hidden = false;

    const parts: string[] = [];
    if (report.elements.length > 0) {
      parts.push(
        `${report.elements.length} storage element(s) in ${report.groups.length} group(s).`
      );
    } else {
      parts.push('No storage: every loop here settles to a single state.');
    }
    if (report.settlingLoops > 0) {
      parts.push(`${report.settlingLoops} feedback loop(s) settle — loops, not memory.`);
    }
    dom.analysisStorageSummary.textContent = parts.join(' ');

    const list = document.createElement('div');
    report.groups.forEach((group, i) => {
      const box = document.createElement('div');
      box.className = 'storage-group';

      const heading = document.createElement('p');
      heading.className = 'expr';
      heading.textContent =
        group.elements.length > 1
          ? `Group ${i + 1}: ${group.elements.length} bits sharing ` +
            `${group.sharedControl.map(name).join(', ') || 'no control'}`
          : `Group ${i + 1}: one element`;
      box.appendChild(heading);

      for (const element of group.elements) {
        box.appendChild(this.#storageLine(element, name));
      }
      list.appendChild(box);
    });
    dom.analysisStorageList.replaceChildren(list);
  }

  #storageLine(element: StorageElement, name: (n: NetId) => string): HTMLElement {
    const row = document.createElement('p');
    row.className = 'storage-line';

    const where = document.createElement('span');
    where.className = 'chip';
    where.textContent = element.stateNets.map(name).join(' ');
    row.appendChild(where);

    const rest = document.createElement('span');
    rest.className = 'storage-rest';
    rest.textContent = ` ${element.restStates.length} rest states · `;
    row.appendChild(rest);

    const finding = element.powerOn;
    const verdict = document.createElement('span');
    // Colour follows the finding, but the words carry it: a reader who cannot
    // see the colour still gets the whole answer.
    verdict.className =
      !finding ? 'warn' : finding.kind === 'defined' ? 'good' : 'bad';
    verdict.textContent = describePowerOn(finding);
    row.appendChild(verdict);
    return row;
  }

  /**
   * Clock candidates, ranked, each showing why.
   *
   * Candidates that share a rank are shown as tied rather than listed in an
   * order that would imply a distinction the evidence does not make — the
   * structural signal cannot tell a clock from a reset (CK-4).
   */
  #renderClocks(result: AnalysisResult, name: (n: NetId) => string): void {
    const { dom } = this;
    if (result.clocks.length === 0) {
      dom.analysisClockGroup.hidden = true;
      return;
    }
    dom.analysisClockGroup.hidden = false;

    // Drop a designation that this analysis no longer offers.
    if (this.#clock !== null && !result.clocks.some((c) => c.net === this.#clock)) {
      this.#clock = null;
    }

    const list = document.createElement('div');
    for (const candidate of result.clocks) {
      const row = document.createElement('p');
      row.className = 'clock-line';
      if (candidate.net === this.#clock) row.classList.add('chosen');
      // The leading candidate is marked so it can be picked out at a glance
      // (CK-6), but the word "suggested" carries it too.
      if (candidate.rank === 1) row.classList.add('leading');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'chip clock-pick';
      pick.textContent = name(candidate.net);
      pick.title = 'Use this net as the clock';
      pick.addEventListener('mousedown', (e) => e.preventDefault());
      pick.addEventListener('click', () => {
        this.#clock = this.#clock === candidate.net ? null : candidate.net;
        if (this.#result) this.#render(this.#result);
      });
      row.appendChild(pick);

      const why = document.createElement('span');
      why.className = 'clock-why';
      const tied = tiedWith(result.clocks, candidate.net);
      why.textContent =
        ` ${candidate.rank === 1 ? '(suggested) ' : ''}${describeCandidate(candidate)}` +
        (tied.length > 0
          ? ` — indistinguishable from ${tied.map((t) => name(t.net)).join(', ')} on this evidence`
          : '');
      row.appendChild(why);
      list.appendChild(row);
    }
    dom.analysisClockList.replaceChildren(list);

    dom.analysisClockStep.disabled = this.#clock === null;
    dom.analysisClockVerdict.textContent =
      this.#clock === null
        ? 'Pick a candidate to step the circuit by its edges.'
        : `Stepping by ${name(this.#clock)}.`;
    dom.analysisClockVerdict.className = '';
    dom.analysisClockTable.replaceChildren();
  }

  /** Advance the circuit edge by edge and show what the state did. */
  #stepClock(): void {
    const result = this.#result;
    if (!result || this.#clock === null || !result.sequential) return;
    const doc = this.host.doc();
    if (!doc) return;

    const name = nameFor(result.netlist, this.#resolve(result));
    const edges = Math.max(1, Math.min(64, Number(this.dom.analysisClockEdges.value) || 8));
    const stateNets = result.storage?.elements.flatMap((e) => e.stateNets) ?? [];
    if (stateNets.length === 0) {
      this.host.toast('Nothing with memory to step.', true);
      return;
    }

    const image = doc.cropImage(result.rect);
    const r = stepClock(image, result.netlist, this.#clock, stateNets, edges);

    const verdict = this.dom.analysisClockVerdict;
    if (!r.repeatable) {
      // CK-8: the same edge sequence gave a different answer. Report it rather
      // than presenting one run's result as the answer.
      verdict.textContent =
        'The same edge sequence produced different results on two runs, so this ' +
        'circuit’s behaviour is not repeatable. No sequence is shown.';
      verdict.className = 'bad';
      this.dom.analysisClockTable.replaceChildren();
      return;
    }

    verdict.textContent = `${r.transitions.length} edge(s), repeatable across two runs.`;
    verdict.className = 'good';

    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const h of ['edge', 'clk', ...stateNets.map(name), 'changed']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (const t of r.transitions) {
      const row = body.insertRow();
      row.insertCell().textContent = String(t.edge);
      row.insertCell().textContent = t.clock ? '↑' : '↓';
      for (const v of t.after) {
        const cell = row.insertCell();
        cell.className = 'out';
        cell.textContent = t.settled ? (v ? '1' : '0') : '?';
      }
      row.insertCell().textContent = t.changed.length ? t.changed.map(name).join(' ') : '—';
      if (!t.settled) row.className = 'nonConvergent';
    }
    this.dom.analysisClockTable.replaceChildren(table);
  }

  #renderSimplification(result: AnalysisResult, name: (n: NetId) => string): void {
    const { dom } = this;
    const s = result.simplification;
    if (!s) {
      dom.analysisSimplifyGroup.hidden = true;
      return;
    }
    dom.analysisSimplifyGroup.hidden = false;

    if (!s.verified) {
      dom.analysisCost.textContent =
        'The minimised form could not be shown to match the original, so it is not offered.';
      dom.analysisExpressions.replaceChildren();
      dom.analysisReplace.disabled = true;
      return;
    }

    // "minimised", never "optimal": see the header of minimise.ts.
    dom.analysisCost.textContent = s.improved
      ? `Minimised: ${s.minimisedCost} inverters, against ${s.originalCost} as drawn.`
      : `No improvement found. As drawn: ${s.originalCost} inverters; ` +
        `minimised: ${s.minimisedCost}.`;

    dom.analysisExpressions.replaceChildren(
      ...[...s.minimised].map(([net, expr]) => {
        const p = document.createElement('p');
        p.className = 'expr';
        p.textContent = `${name(net)} = ${formatExpr(expr, name)}`;
        return p;
      })
    );

    dom.analysisReplace.disabled = !s.improved || result.inputs.length === 0;
  }

  #renderOracleNote(text: string): void {
    this.dom.analysisOracleGroup.hidden = false;
    this.dom.analysisVerdict.textContent = text;
    this.dom.analysisDiscrepancies.replaceChildren();
  }

  #renderOracle(
    result: AnalysisResult,
    discrepancies: readonly Discrepancy[],
    nonConvergent: number,
    timingDependent: number,
    done: number,
    total: number,
    stopped: boolean
  ): void {
    const { dom } = this;
    const name = nameFor(result.netlist, this.#resolve(result));
    dom.analysisOracleGroup.hidden = false;

    const scope = stopped
      ? `Stopped after ${done} of ${total} combinations.`
      : `All ${total} combinations checked.`;

    const parts: string[] = [scope];
    if (discrepancies.length === 0 && nonConvergent === 0 && timingDependent === 0) {
      // Say it. An agreement that arrives as silence is not a result.
      parts.push('The simulator matches the logic on every row.');
      // Say what this does not cover. The sweep seeds a consistent state before
      // releasing the circuit, so it cannot see a power-on that never resolves
      // — and reporting agreement without that caveat is how a circuit with an
      // undefined start gets called healthy.
      if (result.storage && result.storage.elements.length > 0) {
        parts.push(
          'That covers whether it holds and computes correctly once started, ' +
            'not whether it starts from a known state — see Memory above.'
        );
      }
      dom.analysisVerdict.className = 'good';
    } else {
      if (discrepancies.length > 0) {
        parts.push(`${discrepancies.length} row(s) disagree with the logic.`);
      }
      if (nonConvergent > 0) {
        parts.push(
          `${nonConvergent} row(s) never settled — no value is reported for those, because ` +
            'a circuit that keeps changing has no steady-state answer.'
        );
      }
      if (timingDependent > 0) {
        parts.push(
          `${timingDependent} row(s) gave different answers on two runs. The engine's ramp ` +
            'carries deliberate jitter, so this is a property of the circuit, not a fault.'
        );
      }
      dom.analysisVerdict.className = discrepancies.length > 0 ? 'bad' : 'warn';
    }
    dom.analysisVerdict.textContent = parts.join(' ');

    if (discrepancies.length === 0) {
      dom.analysisDiscrepancies.replaceChildren();
      return;
    }

    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const h of ['inputs', 'expected', 'observed', 'first divergence']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (const d of discrepancies.slice(0, 64)) {
      const row = body.insertRow();
      row.insertCell().textContent = bits(d.inputs);
      row.insertCell().textContent = bits(d.expected);
      row.insertCell().textContent = bits(d.observed);
      row.insertCell().textContent =
        d.firstDivergentNet === null ? '—' : name(d.firstDivergentNet);
    }
    if (discrepancies.length > 64) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.textContent = `… and ${discrepancies.length - 64} more`;
    }
    dom.analysisDiscrepancies.replaceChildren(table);
  }

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  /**
   * A net, as a clickable chip that can be renamed.
   *
   * The anchor for a name is the net's probe pixel translated into document
   * space — a place on the circuit, which is what survives an edit.
   */
  #netChip(
    result: AnalysisResult,
    id: NetId,
    name: (n: NetId) => string,
    kind: string,
    onDismiss?: () => void
  ): HTMLElement {
    const c = chip(name(id), kind);
    const info = netById(result.netlist, id);
    const anchor = info
      ? { x: info.probe.x + result.rect.x, y: info.probe.y + result.rect.y }
      : null;

    // Pointing at a net here lights its pixels on the circuit, so a name in a
    // list can be found on the canvas without hunting for a coordinate.
    c.addEventListener('mouseenter', () =>
      this.host.highlightNet(id, result.circuit, { x: result.rect.x, y: result.rect.y })
    );
    c.addEventListener('mouseleave', () =>
      this.host.highlightNet(null, null, { x: 0, y: 0 })
    );

    if (anchor) {
      c.title = `Click to name this net · pixel ${anchor.x},${anchor.y}`;
      c.addEventListener('click', () => {
        const current = this.#resolve(result).byNet.get(id)?.name ?? '';
        const next = window.prompt(
          `Name for the net at ${anchor.x},${anchor.y}
(blank to clear)`,
          current
        );
        if (next === null) return;
        this.host.rename(anchor, next);
        if (this.#result) this.#render(this.#result);
      });
    }

    if (onDismiss) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-dismiss';
      x.textContent = '✕';
      x.title = 'Stop treating this net as an output';
      x.addEventListener('mousedown', (e) => e.preventDefault());
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        onDismiss();
      });
      c.appendChild(x);
    }
    return c;
  }

  /** Resolve the user's names against the circuit this result was built from. */
  #resolve(result: AnalysisResult): Resolution {
    return resolveLabels(this.host.labels(), result.circuit, {
      x: result.rect.x,
      y: result.rect.y,
    });
  }

  #unmarkOutput(id: NetId): void {
    const result = this.#result;
    if (!result) return;
    const next = result.outputs.filter((o) => o !== id);
    if (next.length === result.outputs.length) return;
    this.#markedOutputs = next;
    this.host.toast(`Net ${id} is no longer treated as an output. Analyse again.`);
    this.markStale();
  }

  #offerReplacement(): void {
    const result = this.#result;
    if (!result?.simplification || !result.table) return;
    if (result.stale) {
      this.host.toast('The circuit changed. Analyse again before replacing anything.', true);
      return;
    }

    const entries = [...result.simplification.minimised];
    if (entries.length !== 1) {
      this.host.toast(
        `A replacement is drawn for one output at a time; this selection has ${entries.length}.`,
        true
      );
      return;
    }
    const [, expr] = entries[0];

    const out = layout(expr, result.inputs, result.table);
    if (!out.ok) {
      this.host.toast(`No replacement offered: ${out.reason}`, true);
      return;
    }
    // MO-10 / FR-009: analysis mode never applies a replacement itself. Taking
    // one leaves the read-only mode, and the user is told that before it
    // happens rather than discovering it afterwards — the guarantee is only
    // worth something if leaving it is deliberate.
    const agreed = window.confirm(
      `Place ${out.result.gateCount} gates as a replacement?\n\n` +
        'This leaves Analysis mode and switches to Edit mode, where you position ' +
        'it and press Enter to commit — or Escape to discard it for nothing.\n\n' +
        'It has been compiled and checked against the original truth table.'
    );
    if (!agreed) return;

    if (this.host.offerPaste(out.result.block)) {
      this.host.toast(
        `Edit mode: ${out.result.gateCount} gates, verified against the original. ` +
          'Position it and press Enter, or Escape to cancel.'
      );
    } else {
      this.host.toast('Finish or cancel the current paste first.', true);
    }
  }

  #exportNetlist(): void {
    const result = this.#result;
    if (!result) return;
    const text = toJsonText(result.netlist, this.host.labels());
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'netlist.json';
    a.click();
    URL.revokeObjectURL(url);
    this.host.toast('Netlist exported.');
  }

  async #importNetlist(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    const chosen = new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    });
    input.click();
    const file = await chosen;
    if (!file) return;

    const raw = await file.text();
    const parsed = importNetlist(raw);
    if (!parsed.ok) {
      this.host.toast(`Could not read that netlist: ${parsed.reason}`, true);
      return;
    }
    const names = labelsFrom(raw);
    this.host.toast(
      `Read ${parsed.netlist.nets.length} nets and ${parsed.netlist.gates.length} gates` +
        `${names.length ? ` and ${names.length} name(s)` : ''}. ` +
        'This was not checked against the engine — treat it as a suggestion to verify.'
    );
  }
}

// ---------------------------------------------------------------------

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function bits(values: readonly boolean[]): string {
  return values.map((v) => (v ? '1' : '0')).join('') || '—';
}

/**
 * The one naming function every view in this panel calls.
 *
 * A user-given name always wins; otherwise the net is identified by id and
 * position. Having exactly one of these is what stops a name appearing in the
 * net list but not in the truth table.
 */
function nameFor(netlist: Netlist, resolution?: Resolution): (n: NetId) => string {
  const given = resolution ? makeNamer(resolution) : () => null;
  return (id) => {
    const name = given(id);
    if (name) return name;
    const info = netById(netlist, id);
    return info ? `n${id}@${info.probe.x},${info.probe.y}` : `n${id}`;
  };
}

function chip(text: string, kind: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `chip ${kind}`;
  span.textContent = text;
  return span;
}

function label(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'chip-label';
  span.textContent = text;
  return span;
}

function renderTable(table: TruthTable, name: (n: NetId) => string): HTMLElement {
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for (const id of table.inputs) {
    const th = document.createElement('th');
    th.textContent = name(id);
    head.appendChild(th);
  }
  for (const id of table.outputs) {
    const th = document.createElement('th');
    th.className = 'out';
    th.textContent = name(id);
    head.appendChild(th);
  }

  const body = el.createTBody();
  // A large table is truncated rather than inserting 65,536 rows into the DOM.
  const shown = Math.min(table.rows.length, 256);
  for (let i = 0; i < shown; i++) {
    const row = table.rows[i];
    const tr = body.insertRow();
    for (const v of row.inputs) tr.insertCell().textContent = v ? '1' : '0';
    for (const v of row.outputs) {
      const cell = tr.insertCell();
      cell.className = 'out';
      // A row that never settled has no value to show, and showing one anyway
      // would be the single most misleading thing this panel could do.
      cell.textContent = row.status === 'settled' ? (v ? '1' : '0') : '?';
    }
    if (row.status !== 'settled') tr.className = row.status;
  }
  if (table.rows.length > shown) {
    const tr = body.insertRow();
    const cell = tr.insertCell();
    cell.colSpan = table.inputs.length + table.outputs.length;
    cell.textContent = `… ${table.rows.length - shown} more rows not shown`;
  }
  return el;
}

/** Re-exported so ui.ts need not import analysis.ts directly. */
export type { AnalysisResult };
