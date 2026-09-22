// viewport-camera.ts — the two wheel schemes.
//
// `classic` is bit-for-bit what the app has always done, including the 120/256
// notch constant from UMain.pas. Anyone who never opens the setting must not be
// able to tell this landed.

import type { Point, Viewport } from './renderer.js';

export type CameraScheme = 'classic' | 'paint';

export const CAMERA_SCHEMES: readonly CameraScheme[] = ['classic', 'paint'];

// One Windows wheel notch is 120 units and the original scales by 1/256.
const WHEEL_EXP = 120 / 256;

/** Screen pixels panned per notch in the Paint.NET scheme. */
const PAN_PER_NOTCH = 90;

/** deltaMode 1 is lines, 2 is pages; normalise everything to notches. */
function notches(e: WheelEvent): number {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 100;
  return -e.deltaY / unit;
}

/**
 * Apply one wheel event to the viewport.
 *
 * The caller is responsible for preventDefault — without it a plain notch
 * scrolls the page and Ctrl+notch zooms the whole document, which would make
 * the Paint.NET scheme unusable rather than merely different.
 */
export function applyWheel(
  scheme: CameraScheme,
  viewport: Viewport,
  e: WheelEvent,
  local: Point
): void {
  const n = notches(e);

  // Zoom is always at the cursor, in whichever scheme reaches it, so the two
  // schemes agree about the one thing they share.
  if (scheme === 'classic' || e.ctrlKey || e.metaKey) {
    viewport.zoomAt(local.x, local.y, n * WHEEL_EXP);
    return;
  }

  // Pan in screen pixels, divided by zoom inside panBy, so a notch moves the
  // same visible distance at any magnification.
  const distance = n * PAN_PER_NOTCH;
  if (e.shiftKey) viewport.panBy(distance, 0);
  else viewport.panBy(0, distance);
}
