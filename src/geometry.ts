// geometry.ts — rasterisation that produces wires, not pictures of wires.
//
// The engine joins wire pixels only on the four cardinal sides. Bresenham, which
// the editor used until now, moves diagonally — so a 45 degree "line" was nine
// separate nets that happened to look like one conductor, and a fast diagonal
// pencil drag laid down wire that did not conduct. Nothing reported an error,
// because a gap in a wire is not an error; it is a different circuit.
//
// Everything here is pure: no DOM, no document, no circuit. That is what lets
// the rules be checked headlessly in scripts/verify/geometry.mjs.

/** One conductor of a bus, as an offset from the drawn run. */
export interface BusOffset {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Visit every pixel of a 4-connected run from (x0,y0) to (x1,y1), inclusive.
 *
 * Exactly one axis advances per iteration, so consecutive pixels are always
 * edge-adjacent. On an axis-aligned run the other axis never steps, which is
 * why straight lines come out byte-identical to the Bresenham this replaces.
 */
export function walkConnected(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);

  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx - dy;

  visit(x, y);
  while (x !== tx || y !== ty) {
    const e2 = 2 * err;
    // The guards on x !== tx / y !== ty keep the walk from overshooting once
    // one axis has arrived, which is what makes the run terminate exactly on
    // the endpoint rather than stepping past it.
    if (e2 > -dy && x !== tx) {
      err -= dy;
      x += sx;
    } else if (y !== ty) {
      err += dx;
      y += sy;
    } else {
      break; // unreachable for finite inputs; guards against a hang on NaN
    }
    visit(x, y);
  }
}

/**
 * Perpendicular offsets for the N conductors of a bus drawn along a run.
 *
 * Spacing is not the obvious "one pixel apart". A 4-connected staircase occupies
 * two rows in some columns, so two diagonal runs offset by 2 touch and merge
 * into one net. Axis-aligned runs need a pitch of 2; everything else needs 3.
 * Verified exhaustively for widths 1-16 across five slopes.
 */
export function busOffsets(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  count: number
): BusOffset[] {
  const n = Math.max(1, Math.floor(count));
  const axisAligned = x0 === x1 || y0 === y1;
  const pitch = axisAligned ? 2 : 3;
  // Offset across the run, not along it: shallow runs stack vertically, steep
  // ones stack horizontally, so a bus reads as parallel at any slope.
  const shallow = Math.abs(x1 - x0) >= Math.abs(y1 - y0);

  const offsets: BusOffset[] = [];
  for (let k = 0; k < n; k++) {
    offsets.push(shallow ? { dx: 0, dy: k * pitch } : { dx: k * pitch, dy: 0 });
  }
  return offsets;
}
