# Implementation Tasks: Web-based BmpLogicSim

**Spec**: [spec.md](.specify/spec.md) | **Plan**: [plan.md](.specify/plan.md)

## Phase 0: Directory Structure & Core Engine

### Task 0.1: Create Directory Structure
**Priority**: P0 (Blocking)
**Estimate**: 5 minutes

**Description**: Create `/docs` directory structure for GitHub Pages deployment.

**Steps**:
1. Create `/docs` directory in project root
2. Create `/docs/js` subdirectory
3. Create `/docs/css` subdirectory
4. Create `/docs/examples` subdirectory

**Acceptance Criteria**:
- [X] Directory structure exists
- [X] All subdirectories created

---

### Task 0.2: Implement Wire Detection
**Priority**: P0 (Blocking)
**Estimate**: 45 minutes

**Description**: Implement wire detection algorithm that identifies bright pixels (RGB ≥ 224) and connects them into wire segments.

**Steps**:
1. Create `docs/js/simulator.js`
2. Implement `isWire(r, g, b)` function
3. Implement horizontal wire scanning with ID assignment
4. Implement wire remap table for vertical connections
5. Implement wire merging for vertical touches

**Technical Details**:
```javascript
// Wire detection: any channel >= 224
function isWire(r, g, b) {
  return r >= 224 || g >= 224 || b >= 224;
}

// Scan imageData, return wireMap (same size as image)
// Each pixel gets wireId (0 = not wire, >0 = wire segment ID)
function detectWires(imageData, width, height) {
  // 1. Horizontal scan: assign IDs
  // 2. Build remap table
  // 3. Merge vertical connections
  // 4. Compact IDs
  return { wireMap, wireRemap, wireCount };
}
```

**Acceptance Criteria**:
- [X] `isWire()` correctly identifies bright pixels
- [X] Horizontal wire segments assigned unique IDs
- [X] Vertical connections merged via remap table
- [X] Returns wireMap array (length = width × height)

---

### Task 0.3: Implement Gate Detection
**Priority**: P0 (Blocking)
**Estimate**: 60 minutes

**Description**: Detect "+" patterns in the circuit that represent NOT gates, classify by corner configuration.

**Steps**:
1. Implement `detectGates(wireMap, width, height)` function
2. Scan for + patterns (center dark, NSEW bright)
3. Check 4 corners (NW, NE, SE, SW) to determine gate direction
4. For corner pattern 0 (cross), connect wires without gate
5. For corner patterns 3/6/9/12, create gate with src/dst wires
6. Resolve gate src/dst through wireRemap
7. Build gate dependency graph (srcGates array)

**Technical Details**:
```javascript
// Gate patterns (corner bits: NW=1, NE=2, SE=4, SW=8)
// 0: Cross (connect both)
// 3: Down gate (N→S)
// 6: Left gate (E→W)
// 9: Right gate (W→E)
// 12: Up gate (S→N)

class Gate {
  constructor(srcWireId, dstWireId) {
    this.src = srcWireId;
    this.dst = dstWireId;
    this.state = false;
    this.slowState = 0.0;
    this.srcGates = []; // Indices of gates feeding this input
  }
}
```

**Acceptance Criteria**:
- [X] + patterns correctly detected
- [X] Crosses (pattern 0) merge wires
- [X] Gates (patterns 3/6/9/12) created with correct src/dst
- [X] Gate dependency graph built (srcGates)
- [X] Returns array of Gate objects

---

### Task 0.4: Implement Gate Logic & Simulation
**Priority**: P0 (Blocking)
**Estimate**: 45 minutes

**Description**: Implement Schmidt trigger state transitions and simulation loop.

**Steps**:
1. Implement `Gate.updateState(inputActive)` method
2. Add smooth state transitions (slowState 0.0 to 1.0)
3. Implement randomized rise/fall speeds
4. Implement `gateInput(gate, wireStates)` to read input
5. Implement `simulate(gates, wireStates)` loop
6. Randomize gate evaluation order each cycle
7. Write gate outputs back to wireStates

**Technical Details**:
```javascript
updateState(inputActive) {
  const targetState = !inputActive; // NOT gate

  if (targetState) {
    // Rising edge
    this.slowState += 0.5 + Math.random() * 0.5;
    if (this.slowState >= 1.0) {
      this.slowState = 1.0;
      this.state = true;
    }
  } else {
    // Falling edge
    this.slowState -= 0.5 + Math.random() * 0.5;
    if (this.slowState <= 0.0) {
      this.slowState = 0.0;
      this.state = false;
    }
  }
}
```

**Acceptance Criteria**:
- [X] Schmidt trigger behavior implemented
- [X] Smooth state transitions working
- [X] NOT gate logic correct (output = !input)
- [X] Simulation loop updates all gates
- [X] Wire states updated from gate outputs

---

## Phase 1: Rendering & File Handling

### Task 1.1: Implement Viewport Transformations
**Priority**: P0 (Blocking)
**Estimate**: 30 minutes

**Description**: Implement coordinate transformations for pan and zoom.

**Steps**:
1. Create `docs/js/renderer.js`
2. Implement `toScreen(worldX, worldY, viewport)` function
3. Implement `toWorld(screenX, screenY, viewport)` function
4. Create viewport state object (center, zoomExp)
5. Implement `getZoom(zoomExp)` helper (2^zoomExp)

**Technical Details**:
```javascript
function toScreen(worldX, worldY, viewport, canvas) {
  const zoom = Math.pow(2, viewport.zoomExp);
  const screenX = (worldX - viewport.bitmapWidth / 2 - viewport.centerX) * zoom + canvas.width / 2;
  const screenY = (worldY - viewport.bitmapHeight / 2 - viewport.centerY) * zoom + canvas.height / 2;
  return { x: screenX, y: screenY };
}
```

**Acceptance Criteria**:
- [X] World to screen conversion correct
- [X] Screen to world conversion correct
- [X] Zoom scales around cursor position
- [X] Pan moves viewport correctly

---

### Task 1.2: Implement Canvas Rendering
**Priority**: P0 (Blocking)
**Estimate**: 45 minutes

**Description**: Render circuit with wire states (bright = active, dimmed = inactive).

**Steps**:
1. Implement `renderCircuit(ctx, imageData, wireMap, wireStates, viewport)`
2. Create working canvas and result canvas
3. Process pixels: dim inactive wires (divide RGB by 2)
4. Keep active wires at original brightness
5. Use `ctx.putImageData()` to draw processed image
6. Implement `ctx.drawImage()` with viewport transform
7. Set up `requestAnimationFrame()` loop

**Technical Details**:
```javascript
function updateWireColors(imageData, originalData, wireMap, wireRemap, wireStates) {
  const pixels = imageData.data;
  const origPixels = originalData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const pixelIdx = i / 4;
    const wireId = wireRemap[wireMap[pixelIdx]];

    if (wireId !== 0) {
      const active = wireStates[wireId];
      if (active) {
        pixels[i] = origPixels[i];
        pixels[i+1] = origPixels[i+1];
        pixels[i+2] = origPixels[i+2];
      } else {
        pixels[i] = (origPixels[i] & 0xFE) >> 1;
        pixels[i+1] = (origPixels[i+1] & 0xFE) >> 1;
        pixels[i+2] = (origPixels[i+2] & 0xFE) >> 1;
      }
      pixels[i+3] = 255;
    }
  }
}
```

**Acceptance Criteria**:
- [X] Circuit renders on canvas
- [X] Active wires appear bright
- [X] Inactive wires appear dimmed
- [X] Rendering loop runs smoothly (60 FPS)  <!-- 60 fps in Chrome, Edge and Firefox; 43 in WebKit-on-Windows, see notes -->

---

### Task 1.3: Implement Pan & Zoom Controls
**Priority**: P1 (High)
**Estimate**: 30 minutes

**Description**: Add mouse wheel zoom and middle mouse drag pan.

**Steps**:
1. Add `wheel` event listener for zoom
2. Implement zoom at cursor position (adjust center)
3. Add `mousedown`/`mousemove`/`mouseup` for pan
4. Track middle mouse button state
5. Update viewport center on drag
6. Request repaint on viewport change

**Acceptance Criteria**:
- [X] Mouse wheel zooms at cursor position
- [X] Middle mouse drag pans viewport
- [X] Zoom is smooth and responsive  <!-- 12 wheel notches, 63% -> 6400%, 60 fps in Chrome/Edge -->
- [X] Pan is smooth and responsive  <!-- middle-drag moves the view in every desktop engine -->

---

### Task 1.4: Implement PNG File Loading
**Priority**: P0 (Blocking)
**Estimate**: 40 minutes

**Description**: Load PNG files into ImageData for processing.

**Steps**:
1. Create `docs/js/fileHandler.js`
2. Implement `loadPNGFromFile(file)` using FileReader
3. Create temporary Image object to decode PNG
4. Draw to OffscreenCanvas or temp canvas
5. Extract ImageData via `ctx.getImageData()`
6. Return { imageData, width, height }

**Technical Details**:
```javascript
async function loadPNGFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        resolve({ imageData, width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

**Acceptance Criteria**:
- [X] PNG files load correctly
- [X] ImageData extracted successfully
- [X] Width and height correct
- [X] Handles errors gracefully

---

### Task 1.5: Implement Drag & Drop
**Priority**: P1 (High)
**Estimate**: 30 minutes

**Description**: Add drag-and-drop support for PNG files.

**Steps**:
1. Add `dragover` event listener (prevent default)
2. Add `drop` event listener
3. Extract file from `dataTransfer.files`
4. Validate file type (image/png)
5. Call `loadPNGFromFile()` with dropped file
6. Trigger circuit reload on successful drop

**Acceptance Criteria**:
- [X] Drag-and-drop zone works anywhere on canvas
- [X] Only PNG files accepted
- [X] Visual feedback on drag over  <!-- dropzone display none -> grid, dashed border, restored on dragleave -->
- [X] Circuit loads on drop

---

### Task 1.6: Implement Example File Loading
**Priority**: P1 (High)
**Estimate**: 25 minutes

**Description**: Load example schematics from `/docs/examples/` directory.

**Steps**:
1. Create example manifest (hardcoded array of filenames)
2. Implement `loadExample(filename)` using fetch()
3. Convert blob to ImageData
4. Populate example dropdown in UI
5. Add click handlers to load examples

**Acceptance Criteria**:
- [X] Examples load from `/docs/examples/`
- [X] Example dropdown populated
- [X] Clicking example loads circuit

---

## Phase 2: User Interface

### Task 2.1: Implement Settings Panel HTML/CSS
**Priority**: P1 (High)
**Estimate**: 40 minutes

**Description**: Create collapsible settings panel UI.

**Steps**:
1. Create `docs/css/style.css`
2. Define settings panel structure (fixed position right)
3. Add slide-in/out animation (transform translateX)
4. Style form controls (sliders, buttons)
5. Make panel collapsible with toggle button
6. Add mobile-responsive styles (media query)

**Acceptance Criteria**:
- [X] Settings panel appears on right side
- [X] Slide animation smooth  <!-- 0.22s transform transition, sampled mid-flight in all 5 engines -->
- [X] Controls styled consistently  <!-- one font family and one corner radius across all 6 buttons; select fixed for WebKit -->
- [X] Mobile-friendly layout  <!-- verified at 412x839 and 393x659; a horizontal-scroll bug was found and fixed -->

---

### Task 2.2: Implement UI Controls
**Priority**: P0 (Blocking)
**Estimate**: 50 minutes

**Description**: Wire up all UI controls (sliders, buttons, keyboard).

**Steps**:
1. Create `docs/js/ui.js`
2. Add simulation speed slider (1-60 Hz)
3. Add steps-per-frame slider (1-100)
4. Add play/pause button
5. Add reset button
6. Add file open button
7. Add example dropdown
8. Wire all controls to simulation state

**Acceptance Criteria**:
- [X] Speed slider changes simulation rate
- [X] Steps slider changes steps per frame
- [X] Play/pause toggles simulation
- [X] Reset reloads circuit
- [X] File picker opens file dialog

---

### Task 2.3: Implement Keyboard Shortcuts
**Priority**: P2 (Medium)
**Estimate**: 20 minutes

**Description**: Add keyboard shortcuts for common actions.

**Steps**:
1. Add `keydown` event listener
2. ESC: Toggle settings panel visibility
3. SPACE: Toggle play/pause
4. R: Reset circuit
5. +/-: Zoom in/out
6. Prevent default browser actions where needed

**Acceptance Criteria**:
- [X] ESC toggles settings panel
- [X] SPACE pauses/resumes simulation
- [X] R resets circuit
- [X] +/- zoom in/out

---

### Task 2.4: Implement Wire Click Interaction
**Priority**: P1 (High)
**Estimate**: 35 minutes

**Description**: Allow users to set wire states by clicking.

**Steps**:
1. Add `mousedown`/`mouseup`/`contextmenu` listeners
2. Convert click position to world coordinates
3. Look up wireId from wireMap at click position
4. Left click: Set wire HIGH on down, LOW on up
5. Right click: Toggle wire state
6. Prevent context menu on right click

**Acceptance Criteria**:
- [X] Left click pulses wire HIGH then LOW
- [X] Right click toggles wire state
- [X] Click detection accurate at all zoom levels
- [X] No context menu on right click

---

### Task 2.5: Implement Touch Gestures (Mobile)
**Priority**: P2 (Medium)
**Estimate**: 45 minutes

**Description**: Add touch support for mobile devices.

**Steps**:
1. Add `touchstart`/`touchmove`/`touchend` listeners
2. Implement single-finger drag for pan
3. Implement pinch-to-zoom (two-finger)
4. Implement tap for wire interaction
5. Prevent default touch behaviors (zoom, scroll)
6. Test on mobile emulator

**Acceptance Criteria**:
- [X] Single-finger drag pans
- [X] Pinch zooms smoothly  <!-- 861% -> 3270% via real two-finger injection (Chromium); not injectable on WebKit -->
- [X] Tap sets wire state
- [X] No unwanted page scrolling/zooming  <!-- scroll 0,0 and visualViewport scale 1 after touch input -->

---

### Task 2.6: Create Main HTML Page
**Priority**: P0 (Blocking)
**Estimate**: 35 minutes

**Description**: Create `index.html` with application structure.

**Steps**:
1. Create `docs/index.html`
2. Add HTML5 boilerplate
3. Create full-viewport canvas element
4. Create settings panel structure
5. Create control bar at bottom
6. Load JavaScript modules (`<script type="module">`)
7. Add meta tags for mobile (viewport, theme-color)
8. Initialize application on DOMContentLoaded

**Acceptance Criteria**:
- [X] HTML structure complete
- [X] Canvas fills viewport
- [X] All UI elements present
- [X] Scripts load as modules
- [X] Mobile meta tags set

---

## Phase 3: Content & Testing

### Task 3.1: Copy Example Schematics
**Priority**: P0 (Blocking)
**Estimate**: 10 minutes

**Description**: Copy PNG schematics to `/docs/examples/`.

**Steps**:
1. Copy `Flip Flop.png` to `docs/examples/`
2. Copy `counter.png` to `docs/examples/`
3. Copy `4bitAdder.png` to `docs/examples/`
4. Copy `4bitCPU.png` to `docs/examples/`
5. Copy `ALU.png` to `docs/examples/`
6. Copy `Digital_Led.png` to `docs/examples/`
7. Copy `Enigma2.png` to `docs/examples/`
8. Copy `Flash Memory 256x12.png` to `docs/examples/`

**Acceptance Criteria**:
- [X] All 8 example files copied
- [X] Files accessible at `/docs/examples/*.png`

---

### Task 3.2: Test Flip Flop Circuit
**Priority**: P1 (High)
**Estimate**: 20 minutes

**Description**: Verify basic SR latch behavior.

**Steps**:
1. Load `Flip Flop.png`
2. Verify wires and gates detected
3. Click Set input (should latch HIGH)
4. Click Reset input (should latch LOW)
5. Verify state persists after input release
6. Check rendering performance (FPS)

**Acceptance Criteria**:
- [X] Circuit loads without errors
- [X] Set/Reset inputs work correctly
- [X] Latch holds state
- [X] Runs at 30+ FPS  <!-- 60 fps in Chrome/Edge/Firefox, 43 in WebKit -->

---

### Task 3.3: Test Counter Circuit
**Priority**: P1 (High)
**Estimate**: 25 minutes

**Description**: Verify multi-bit counter increments.

**Steps**:
1. Load `counter.png`
2. Verify complex wire routing detected
3. Start simulation
4. Observe counter incrementing over time
5. Verify carry propagation between bits
6. Check performance with complex circuit

**Acceptance Criteria**:
- [X] Counter circuit loads
- [X] Counter increments correctly
- [X] Carry logic works
- [X] Performance acceptable (20+ FPS)  <!-- 60 fps in Chrome/Edge/Firefox, 30 in WebKit -->

---

### Task 3.4: Test 4-bit Adder Circuit
**Priority**: P1 (High)
**Estimate**: 25 minutes

**Description**: Verify addition logic.

**Steps**:
1. Load `4bitAdder.png`
2. Set input bits manually (click wires)
3. Verify sum output correct
4. Test carry propagation
5. Test all corner cases (0+0, 15+15, etc.)

**Acceptance Criteria**:
- [X] Adder circuit loads
- [X] Addition logic correct
- [X] Carry propagation works
- [X] Manual input setting works

---

### Task 3.5: Cross-Browser Testing
**Priority**: P1 (High)
**Estimate**: 40 minutes

**Description**: Test on all target browsers.

**Steps**:
1. Test on Chrome (latest)
2. Test on Firefox (latest)
3. Test on Safari (latest, Mac/iOS)
4. Test on Edge (latest)
5. Check console for errors in each
6. Verify performance in each
7. Document any browser-specific issues

**Acceptance Criteria**:
- [X] Works in Chrome without errors  <!-- real installed Chrome, 15/15 checks -->
- [X] Works in Firefox without errors  <!-- 14/15; only the 2048x2048 stress circuit falls short -->
- [X] Works in Safari without errors  <!-- WebKit 26.6 engine via Playwright; real Safari on Apple hardware NOT tested -->
- [X] Works in Edge without errors  <!-- real installed Edge, 15/15 checks -->
- [X] Performance acceptable in all browsers  <!-- meets the plan's 30+ fps under 10k gates everywhere; see the Firefox note -->

---

### Task 3.6: Mobile Testing
**Priority**: P2 (Medium)
**Estimate**: 35 minutes

**Description**: Test on mobile devices.

**Steps**:
1. Test on iOS Safari (physical device or simulator)
2. Test on Android Chrome (physical device or emulator)
3. Verify touch gestures work
4. Verify layout responsive
5. Check performance on mobile
6. Test file loading on mobile

**Acceptance Criteria**:
- [X] Works on iOS Safari  <!-- iPhone 15 emulation on WebKit; emulated viewport/touch, not a physical device -->
- [X] Works on Android Chrome  <!-- Pixel 7 emulation on real Chrome; emulated viewport/touch, not a physical device -->
- [X] Touch gestures functional  <!-- tap, one-finger pan and pinch, all via real touch-event injection -->
- [X] Layout adapts to small screen  <!-- no horizontal overflow, topbar fits, panel fills the viewport -->
- [ ] Usable performance (15+ FPS)  <!-- NOT verifiable by emulation: it runs on desktop silicon, so it says nothing about phone hardware -->

---

### Task 3.7: Create Documentation
**Priority**: P1 (High)
**Estimate**: 30 minutes

**Description**: Create user-facing README.

**Steps**:
1. Create `docs/README.md`
2. Add project description
3. Add usage instructions (drag-drop, controls)
4. Add keyboard shortcut reference
5. Add example circuit descriptions
6. Add GitHub Pages deployment link
7. Add credits to original BmpLogicSim

**Acceptance Criteria**:
- [X] README.md exists in `/docs`
- [X] Usage instructions clear
- [X] Keyboard shortcuts documented
- [X] Examples described

---

### Task 3.8: GitHub Pages Setup
**Priority**: P1 (High)
**Estimate**: 15 minutes

**Description**: Prepare for GitHub Pages deployment.

**Steps**:
1. Verify all paths are relative (no absolute URLs)
2. Test locally with simple HTTP server
3. Create `.nojekyll` file in `/docs` (disable Jekyll)
4. Verify no build artifacts required
5. Document deployment steps in root README

**Acceptance Criteria**:
- [X] All paths relative
- [X] Works with local HTTP server
- [X] `.nojekyll` file present
- [X] Deployment instructions documented

---

## Summary

**Total Tasks**: 28
**Estimated Time**: ~13 hours

**Phase Breakdown**:
- Phase 0 (Core Engine): 4 tasks, ~3 hours
- Phase 1 (Rendering & Files): 6 tasks, ~4 hours
- Phase 2 (UI): 6 tasks, ~4 hours
- Phase 3 (Testing & Deploy): 12 tasks, ~4 hours

**Critical Path** (P0 tasks):
1. Directory structure → 2. Wire detection → 3. Gate detection → 4. Simulation loop → 5. Viewport transforms → 6. Canvas rendering → 7. File loading → 8. UI controls → 9. HTML page → 10. Copy examples

**Dependencies**:
- Rendering requires simulation engine
- UI requires rendering
- Testing requires all features complete

---

## Verification Status

All 28 tasks are implemented and 27 of the 28 are fully verified.

Two rounds of verification stand behind this:

1. **Headless, in Node** — the engine directly, plus the UI through a stub DOM
   that dispatches the same events a browser would. This is what established
   simulation correctness.
2. **In real browsers, driven by Playwright** — five engines plus two phone
   emulations, against `python -m http.server` at the repository root. This is
   what closed out the rendering, styling, interaction and cross-browser
   criteria that the first round could not reach.

> **Layout note.** These tasks were written against an earlier layout that put
> the app in `docs/` with its own `docs/examples/`. The port has since moved to
> TypeScript in `src/`, compiled to `dist/`, served from the repository root,
> with the schematics read straight out of `projects/`. Paths in the task
> descriptions above are historical; the code they describe lives on under the
> new names.

### Engine correctness (Node)

| Suite | What it covers | Result |
| --- | --- | --- |
| Engine unit tests | Inverter truth table, all four gate directions, crossovers, wired-OR (`out = A AND B`), 3-inverter ring oscillation, state carry-over on reload, `& 0x7F` dim mask, non-wire pixels untouched | 27/27 pass |
| App integration | Boot, example list, viewport fit, frame loop, every keyboard shortcut, wheel-zoom-at-cursor, middle-drag pan, left/right click wire control, touch pan/pinch/tap, sliders, play/pause/reset, example switching, drag-and-drop, `?file=` deep link | 47/47 pass |
| `Flip Flop.png` (task 3.2) | Pulse toggles it, state held after release, second pulse returns it, stable when undisturbed | 4/4 pass |
| `counter.png` (task 3.3) | Toggle rates form an exact binary ladder 64→32→16→8→4→2 over 32 pulses, 32/32 distinct states | pass |
| `4bitAdder.png` (task 3.4) | All **256** operand pairs give the correct sum, read off the hex displays by segment fingerprint; carry verified at every bit position | 256/256 pass |
| Gate counts after the TypeScript rewrite | `Flip Flop` 20, `Enigma2` 11 515, `Flash Memory` 45 004 at 2048×2048 — unchanged from the JavaScript implementation | pass |

### Browser verification (Playwright)

Each target runs the same battery: boot and render, stylesheet and control
consistency, settings-panel animation, drag-over feedback, wheel zoom, middle
drag, per-circuit frame rates, wire interaction and a console/network error
sweep. Phone targets swap the mouse checks for tap, one-finger pan, pinch and
layout.

| Target | Kind | Result |
| --- | --- | --- |
| Chrome (installed, stable) | real browser | **15/15** |
| Edge (installed, stable) | real browser | **15/15** |
| Firefox 155 | real browser | 14/15 — see the Firefox note |
| WebKit 26.6 (Safari engine) | real engine, Windows port | 12/15 — see the WebKit note |
| Pixel 7 | emulated viewport + touch on real Chrome | **17/17** |
| iPhone 15 | emulated viewport + touch on WebKit | 13/16 — see both notes |

Frame rates, measured from the app's own counter with the window focused and
raised (an occluded window throttles `requestAnimationFrame`, which the harness
now detects rather than believes). Simulation held 300 cycles/s — the
configured 60 Hz × 5 passes — in every engine and on every circuit except one.

| Circuit | Gates | Chrome | Edge | Firefox | WebKit |
| --- | --- | --- | --- | --- | --- |
| Flip Flop | 20 | 60 | 60 | 60 | 43 |
| counter | 1 497 | 60 | 60 | 60 | 30 |
| Enigma2 | 11 515 | 60 | 60 | 34 | 18 |
| Flash Memory | 45 004 | 33 | 34 | 4 | 6 |

The plan's target — 30+ fps under 10 000 gates — is met by every engine, with
Chrome and Edge holding 60 fps on a circuit 15% past that ceiling.

Figures for the 2048×2048 example are sensitive to what else the machine is
doing: on a box with 16 GB and a large browser session already resident, one
Chrome run reported 4 fps where three consecutive runs either side of it
reported 31–33. The smaller circuits were stable across every repetition.

### Bugs found and fixed

Two defects that only a browser could reveal:

1. **Opening the settings panel scrolled the whole app sideways on a phone.**
   The closed panel parks at `translateX(100%)`, which still counts as
   scrollable overflow, so focusing the toggle button let the browser scroll
   `body` to its maximum — 127 px on a 412 px viewport, with no way to scroll
   back under `overflow: hidden`. Fixed with `overflow: hidden` on `#app`, plus
   letting the title and example picker shrink so the top bar fits a phone
   (it was 539 px wide in a 412 px viewport).
2. **The examples dropdown rendered as a white box in WebKit.** Safari paints
   `<select>` as a native control and ignores an author background unless the
   native appearance is switched off — and computed style still reports the
   author value, so only a screenshot shows it. Fixed with
   `appearance: none` and an inline SVG chevron, keeping the page at zero
   external requests. Verified identical in Chrome, Firefox and WebKit after.

### Notes

**Firefox.** `putImageData` of the 2048×2048 frame buffer costs ~41 ms per call
in Firefox against ~9 ms in Chrome — measured directly, same machine. That one
primitive sets the ceiling for the largest example, hence 4 fps there while
simulation still runs at 273 cycles/s. Every other circuit is 34–60 fps. A fix
would mean not uploading the full-resolution bitmap when it is heavily
downscaled; that is a rendering change, not a bug, and is not attempted here.

**WebKit.** Playwright's WebKit on Windows is not Safari: it is the same engine
behind a different graphics stack, and its presentation path is slower than
Safari's on Apple hardware (43 fps on a 20-gate circuit, where blank-page
`requestAnimationFrame` measures a healthy 62 fps). Treat its **correctness**
results as meaningful — every interaction, layout and console check passes —
and its **frame rates** as not representative of real Safari.

### Not verified

- **Mobile performance on real hardware.** Device emulation runs on this
  machine's CPU and GPU, so its frame rates describe a desktop at a phone-sized
  viewport and say nothing about a phone. Layout and touch behaviour *are*
  properly evidenced by emulation; performance is not. This is the one
  acceptance criterion left unchecked.
- **Real Safari, real iOS, real Android.** No Apple hardware and no physical
  device was available. Engine-level and emulated evidence is recorded above
  and the relevant boxes are annotated accordingly.
- **Pinch on WebKit.** The WebKit automation protocol cannot inject
  multi-touch, so pinch was confirmed on Chromium only (861% → 3270% on a
  two-finger spread). The code path is shared.

Recommended before release: open the site on one physical phone, confirm the
touch gestures and check the frame rate on `counter.png`.
