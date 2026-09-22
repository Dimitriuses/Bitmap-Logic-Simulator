// tools/picker.ts — adopt an existing pixel's colour.
//
// The only read-only tool. It writes nothing, so it produces no Edit and never
// triggers a recompile.

import { isWireColor, type Rgba } from '../colors.js';
import { NO_PREVIEW, type PixelPoint, type Tool, type ToolContext } from './types.js';

class PickerTool implements Tool {
  readonly id = 'picker' as const;
  readonly mutates = false;

  label(): string {
    return 'pick colour';
  }

  down(p: PixelPoint, ctx: ToolContext): void {
    const found = ctx.doc.get(p.x, p.y);
    // Picking insulation would leave the user drawing dead wire; ignore it and
    // let the toolbar keep the last usable colour.
    if (isWireColor(found)) ctx.setColor(found);
  }

  move(): void {}
  up(): void {}

  preview(): ReadonlyMap<number, Rgba> {
    return NO_PREVIEW;
  }
}

export const picker = (): Tool => new PickerTool();
