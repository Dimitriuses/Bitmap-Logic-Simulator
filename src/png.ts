// png.ts — encoding a document and getting it onto disk.
//
// Round-trip fidelity was measured rather than assumed, because the engine
// classifies pixels on an exact boundary (any channel >= 224) and encoder drift
// would silently change a circuit's meaning. Chrome and Firefox are bit-exact;
// WebKit drifts by ±1 on colour-rich images but not on the small palettes real
// schematics use. The editor's default palette (255 for wire, 0 for insulation)
// keeps every painted value far from the threshold, so even that drift cannot
// flip a classification.

import type { CircuitDocument } from './document.js';
import { errorMessage } from './errors.js';
import type { FileSource } from './fileHandler.js';

export type SaveOutcome =
  | { kind: 'written'; name: string }
  | { kind: 'downloaded'; name: string }
  | { kind: 'cancelled' };

/**
 * Encode the document's SOURCE pixels.
 *
 * Never encode Circuit.frame: the renderer masks inactive wires down with
 * `& 0x7F`, so saving a frame would drive every unlit wire from 255 to 127 —
 * below the 224 threshold — and permanently destroy the circuit.
 */
export function encodePng(doc: CircuitDocument): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D is not available in this browser.'));
  ctx.putImageData(doc.pixels, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the circuit as a PNG.'));
    }, 'image/png');
  });
}

/** Offer the document as a download. The universal fallback. */
export async function downloadPng(doc: CircuitDocument): Promise<void> {
  const blob = await encodePng(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.name.toLowerCase().endsWith('.png') ? doc.name : `${doc.name}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Write the document back to its source file where the browser allows it, and
 * download it otherwise.
 *
 * MUST be called from a user gesture: requesting readwrite permission is the
 * first await precisely so the gesture is still valid when the prompt appears.
 */
export async function saveDocument(
  doc: CircuitDocument,
  source: FileSource | null
): Promise<SaveOutcome> {
  if (source?.canWrite) {
    const granted = await source.requestWriteAccess();
    if (granted) {
      const blob = await encodePng(doc);
      await source.write(blob);
      doc.markSaved();
      return { kind: 'written', name: source.name };
    }
    // A refusal is not an error; fall through to the download path.
  }

  try {
    await downloadPng(doc);
  } catch (err) {
    throw new Error(`Could not save: ${errorMessage(err)}`);
  }
  doc.markSaved();
  return { kind: 'downloaded', name: doc.name };
}
