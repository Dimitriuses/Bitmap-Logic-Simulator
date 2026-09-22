// tools/eraser.ts — paint insulation.
//
// Erasing is painting black, not "removing" anything: the bitmap is the netlist,
// so an erased wire pixel is simply insulation. The colour is fixed rather than
// user-selectable, because anything else risks writing a value the engine still
// reads as wire.

import { INSULATION } from '../colors.js';
import { BrushTool } from './pencil.js';
import type { Tool } from './types.js';

export const eraser = (): Tool => new BrushTool('eraser', () => INSULATION);
