// investigate-ax.mjs — quickstart Scenario 9.
//
// The defect this whole feature was built to settle: the AX register in
// projects/CPU/4bitCPU.png works only partially, and it is not known whether
// the circuit or the simulator is at fault.
//
// Rather than guess at the register's coordinates, this finds the isolated
// circuits in the scratch area below the CPU -- where the register is
// duplicated alongside its simplified elements -- and analyses each one. Every
// number it prints comes from the same modules the UI uses.
//
//   node scripts/verify/investigate-ax.mjs [--region x,y,w,h] [--max-inputs N]

import { join } from 'node:path';
import { ROOT, loadDist, loadEngine, loadPng } from './harness.mjs';

const { Circuit } = await loadEngine();
const { extractNetlist, netById } = await loadDist('netlist.js');
const B = await loadDist('boolean.js');
const S = await loadDist('sequential.js');
const { sweep, sweepSequential } = await loadDist('oracle.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const [rx, ry, rw, rh] = arg('--region', '190,560,510,220').split(',').map(Number);
const MAX_INPUTS = Number(arg('--max-inputs', '12'));
// Combinations to spot-check when a circuit is too wide to enumerate. A sample
// can find a defect but can never establish its absence, and the report says so.
const SAMPLE = Number(arg('--sample', '0'));

const source = loadPng(join(ROOT, 'projects', 'CPU', '4bitCPU.png'));
console.log(`4bitCPU.png  ${source.width}x${source.height}`);
console.log(`scratch region  x=${rx} y=${ry} w=${rw} h=${rh}\n`);

// --------------------------------------------------------------------------
// Find the separate circuits in the region.
// --------------------------------------------------------------------------
//
// Wire pixels, dilated so that a circuit's own internal gaps do not split it,
// then 8-connected components. The dilation radius is the one knob: too small
// and one register becomes several fragments, too large and neighbouring
// circuits merge. Each cluster's bounding box is taken from the *undilated*
// pixels and padded, so nothing is clipped.

const GAP = 6;

function wireMask() {
  const mask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = ((y + ry) * source.width + (x + rx)) << 2;
      const d = source.data;
      if (Math.max(d[p], d[p + 1], d[p + 2]) >= 224) mask[y * rw + x] = 1;
    }
  }
  return mask;
}

function dilate(mask, radius) {
  const out = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (!mask[y * rw + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rh) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= rw) continue;
          out[yy * rw + xx] = 1;
        }
      }
    }
  }
  return out;
}

function clusters() {
  const mask = wireMask();
  const grown = dilate(mask, GAP);
  const seen = new Uint8Array(rw * rh);
  const found = [];

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (!grown[i] || seen[i]) continue;

      const stack = [i];
      seen[i] = 1;
      let x0 = rw;
      let y0 = rh;
      let x1 = -1;
      let y1 = -1;
      let pixels = 0;

      while (stack.length) {
        const j = stack.pop();
        const jx = j % rw;
        const jy = (j - jx) / rw;
        if (mask[j]) {
          pixels++;
          if (jx < x0) x0 = jx;
          if (jy < y0) y0 = jy;
          if (jx > x1) x1 = jx;
          if (jy > y1) y1 = jy;
        }
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx;
            const ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
            const k = ny * rw + nx;
            if (grown[k] && !seen[k]) {
              seen[k] = 1;
              stack.push(k);
            }
          }
        }
      }

      if (pixels < 40) continue; // stray marks, not circuits
      const pad = 2;
      found.push({
        x: Math.max(0, x0 - pad) + rx,
        y: Math.max(0, y0 - pad) + ry,
        width: Math.min(rw - 1, x1 + pad) - Math.max(0, x0 - pad) + 1,
        height: Math.min(rh - 1, y1 + pad) - Math.max(0, y0 - pad) + 1,
        pixels,
      });
    }
  }
  return found.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Crop the source pixels. Never the rendered frame. */
function crop(rect) {
  const out = new globalThis.ImageData(
    new Uint8ClampedArray(rect.width * rect.height * 4),
    rect.width,
    rect.height
  );
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const s = ((y + rect.y) * source.width + (x + rect.x)) << 2;
      const d = (y * rect.width + x) << 2;
      out.data[d] = source.data[s];
      out.data[d + 1] = source.data[s + 1];
      out.data[d + 2] = source.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Analyse each cluster.
// --------------------------------------------------------------------------

const found = clusters();
console.log(`${found.length} separate circuits found\n`);

const summaries = [];

for (const [n, rect] of found.entries()) {
  const label = `#${n + 1}`;
  const image = crop(rect);
  const circuit = new Circuit(image, null);
  const r = extractNetlist(circuit, image);

  const head =
    `${label}  x=${rect.x} y=${rect.y} ${rect.width}x${rect.height}  ` +
    `${circuit.wireCount} nets  ${circuit.gateCount} gates`;

  if (!r.ok) {
    console.log(`${head}\n    REFUSED: ${r.reason}\n`);
    summaries.push({ label, verdict: 'refused', detail: r.reason });
    continue;
  }

  const netlist = r.netlist;
  const sequential = S.isSequential(netlist);
  console.log(head);
  console.log(
    `    ${netlist.inputs.length} inputs, ${netlist.outputs.length} structural outputs, ` +
      `${netlist.cut.length} cut by the crop, ${sequential ? 'SEQUENTIAL' : 'combinational'}`
  );

  const where = (id) => {
    const info = netById(netlist, id);
    return info ? `(${info.probe.x + rect.x},${info.probe.y + rect.y})` : '?';
  };

  try {
    if (sequential) {
      const model = S.analyseSequential(netlist, netlist.outputs);
      const width = netlist.inputs.length + model.stateNets.length;
      console.log(
        `    ${model.stateNets.length} state variable(s) at ` +
          `${model.stateNets.map(where).join(' ')}`
      );
      if (width > MAX_INPUTS && SAMPLE <= 0) {
        console.log(`    not swept: ${width} inputs + state exceeds ${MAX_INPUTS}\n`);
        summaries.push({ label, verdict: 'too wide', detail: `${width} variables` });
        continue;
      }
      const res = sweepSequential(
        circuit, netlist, netlist.inputs, model.stateNets, model.nextState, B.evaluate,
        { maxCycles: 2000, sampleRows: width > MAX_INPUTS ? SAMPLE : 0 }
      );
      report(label, res, where, summaries, `${width} variables, sequential`);
    } else {
      if (netlist.inputs.length > MAX_INPUTS) {
        console.log(`    not swept: ${netlist.inputs.length} inputs exceeds ${MAX_INPUTS}\n`);
        summaries.push({ label, verdict: 'too wide', detail: `${netlist.inputs.length} inputs` });
        continue;
      }
      if (netlist.outputs.length === 0) {
        console.log('    not swept: no structural outputs to observe\n');
        summaries.push({ label, verdict: 'no outputs', detail: '' });
        continue;
      }
      const exprs = new Map(
        netlist.outputs.map((o) => [o, B.expressionFor(netlist, o)])
      );
      const built = B.truthTable(netlist.inputs, netlist.outputs, exprs);
      if (!built.ok) {
        console.log(`    not swept: ${built.reason}\n`);
        summaries.push({ label, verdict: 'refused', detail: built.reason });
        continue;
      }
      const res = sweep(circuit, netlist, built.table, { maxCycles: 2000 });
      report(label, res, where, summaries, `${netlist.inputs.length} inputs, combinational`);
    }
  } catch (err) {
    console.log(`    ERROR: ${err.message}\n`);
    summaries.push({ label, verdict: 'error', detail: err.message });
  }
}

function report(label, res, where, acc, shape) {
  const rows = res.observed.rows.length;
  console.log(
    `    swept ${rows} rows (${shape}): ${res.discrepancies.length} discrepancies, ` +
      `${res.nonConvergentRows} non-convergent, ${res.timingDependentRows} timing-dependent`
  );

  for (const d of res.discrepancies.slice(0, 4)) {
    console.log(
      `      inputs ${d.inputs.map((v) => (v ? 1 : 0)).join('')}  ` +
        `expected ${d.expected.map((v) => (v ? 1 : 0)).join('')}  ` +
        `observed ${d.observed.map((v) => (v ? 1 : 0)).join('')}  ` +
        `first divergence at ${d.firstDivergentNet === null ? '?' : where(d.firstDivergentNet)}`
    );
  }
  if (res.discrepancies.length > 4) {
    console.log(`      ... and ${res.discrepancies.length - 4} more`);
  }

  if (!res.exhaustive) {
    console.log(
      `    NOTE: only ${rows} of 2^${res.observed.inputs.length} combinations were tried. ` +
        'A sample can find a defect, never rule one out.'
    );
  }

  const verdict =
    res.discrepancies.length > 0
      ? 'SIMULATOR DISAGREES'
      : res.nonConvergentRows > 0
        ? 'non-convergent rows'
        : res.timingDependentRows > 0
          ? 'timing-dependent rows'
          : 'agrees';
  console.log(`    => ${verdict}\n`);
  acc.push({
    label,
    verdict: res.exhaustive ? verdict : `${verdict} (sampled)`,
    detail:
      `${rows} rows, ${res.discrepancies.length} disagree, ` +
      `${res.nonConvergentRows} non-convergent, ${res.timingDependentRows} timing-dependent`,
  });
}

// --------------------------------------------------------------------------

console.log('summary');
console.log('-------');
for (const s of summaries) {
  console.log(`  ${s.label.padEnd(5)} ${s.verdict.padEnd(22)} ${s.detail}`);
}
