# Web-based BmpLogicSim Specification

## Overview
A web-based logic circuit simulator that runs entirely in the browser, compatible with GitHub Pages. Users can open PNG schematics, simulate logic circuits in real-time, and interact with the circuits by clicking on wires.

## Technical Architecture

### Technology Stack
- **Frontend**: Pure HTML5, CSS3, JavaScript (ES6+)
- **Canvas API**: For rendering and image processing
- **No build tools required**: Single-page application that runs directly
- **File Structure**:
  ```
  /docs (GitHub Pages root)
    ├── index.html
    ├── js/
    │   ├── simulator.js (core simulation engine)
    │   ├── renderer.js (canvas rendering)
    │   ├── ui.js (user interface controls)
    │   └── fileHandler.js (PNG loading)
    ├── css/
    │   └── style.css
    └── examples/
        ├── counter.png
        ├── Flip Flop.png
        ├── 4bitAdder.png
        └── [other example schematics]
  ```

## Core Features

### 1. File Loading
- **Drag & Drop**: Drop PNG files anywhere on the canvas
- **File Picker**: Click "Open File" button to browse
- **Example Gallery**: Click to load pre-included example schematics
- **URL Parameter**: Support `?file=examples/counter.png` for direct linking

### 2. Simulation Engine

#### Wire Detection Algorithm
```javascript
// Detect wires: pixels with any RGB channel >= 224
function isWire(r, g, b) {
  return r >= 224 || g >= 224 || b >= 224;
}
```

#### Wire Connectivity (Flood Fill)
1. Scan horizontally left-to-right, assigning wire IDs to connected bright pixels
2. Create remap table for vertical connections
3. Merge wire segments that touch vertically
4. Result: Each connected wire segment has unique ID

#### Gate Detection
Detect "+" patterns (cross shapes) at position (x, y):
- Center pixel: non-wire (dark)
- Four cardinal directions: wire pixels (bright)
- Check four corners to determine gate type:

```
Pattern interpretation:
  NW N NE
  W  +  E     Corner bits: NW=1, NE=2, SE=4, SW=8
  SW S SE

Patterns:
- 0000 (0): Cross (connect horizontal and vertical)
- 0011 (3): Gate pointing down (input: N, output: S)
- 0110 (6): Gate pointing left (input: E, output: W)
- 1100 (12): Gate pointing up (input: S, output: N)
- 1001 (9): Gate pointing right (input: W, output: E)
```

Each gate is a NOT gate (inverter).

#### Logic Simulation
```javascript
class Gate {
  constructor(srcWireId, dstWireId) {
    this.src = srcWireId;      // Input wire ID
    this.dst = dstWireId;      // Output wire ID
    this.state = false;        // Current output state
    this.slowState = 0.0;      // Smooth transition [0.0 to 1.0]
    this.srcGates = [];        // Gates feeding this gate's input
  }

  updateState(inputActive) {
    // NOT gate: invert input
    const targetState = !inputActive;

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
}
```

#### Simulation Loop
```javascript
function simulate() {
  // Randomize gate evaluation order each cycle (optional for stability)
  const order = shuffleArray([...Array(gates.length).keys()]);

  for (const idx of order) {
    const gate = gates[idx];

    // Determine input state
    let inputActive;
    if (gate.srcGates.length === 0) {
      // Input comes from wire state
      inputActive = wireStates[gate.src];
    } else {
      // Input comes from OR of source gates
      inputActive = gate.srcGates.some(g => gates[g].state);
    }

    gate.updateState(inputActive);
  }

  // Write gate outputs to wire states
  for (const gate of gates) {
    wireStates[gate.dst] = gate.state;
  }
}
```

### 3. Rendering

#### Canvas Display
- Use OffscreenCanvas or secondary canvas for image processing
- Main canvas for zoomed/panned display
- Render at 60 FPS or configurable rate

#### State Visualization
```javascript
function renderWireStates(ctx, imageData, wireMap, wireStates) {
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const wireId = wireMap[i / 4];

    if (wireId !== 0) {
      const active = wireStates[wireId];

      if (active) {
        // Keep original bright color
        // pixels[i], pixels[i+1], pixels[i+2] unchanged
      } else {
        // Dim by 50%
        pixels[i] = (pixels[i] & 0xFE) >> 1;
        pixels[i+1] = (pixels[i+1] & 0xFE) >> 1;
        pixels[i+2] = (pixels[i+2] & 0xFE) >> 1;
      }
      pixels[i+3] = 255; // Alpha
    }
  }
}
```

### 4. User Interaction

#### Pan & Zoom
- **Mouse wheel**: Zoom in/out (zoom at cursor position)
- **Middle mouse drag**: Pan the view
- **Touch gestures**: Pinch to zoom, drag to pan

#### Wire Manipulation
- **Left click**: Set wire to HIGH while held, LOW when released
- **Right click**: Toggle wire state (HIGH ↔ LOW)
- Click detection: Convert screen coordinates to world coordinates, check wireMap

#### Viewport Transformation
```javascript
// Screen to world coordinates
function toWorld(screenX, screenY) {
  const worldX = (screenX - canvas.width / 2) / zoom + centerX + bitmapWidth / 2;
  const worldY = (screenY - canvas.height / 2) / zoom + centerY + bitmapHeight / 2;
  return { x: worldX, y: worldY };
}

// World to screen coordinates
function toScreen(worldX, worldY) {
  const screenX = (worldX - bitmapWidth / 2 - centerX) * zoom + canvas.width / 2;
  const screenY = (worldY - bitmapHeight / 2 - centerY) * zoom + canvas.height / 2;
  return { x: screenX, y: screenY };
}
```

### 5. UI Controls

#### Settings Panel (Collapsible)
- **File name display**: Shows current loaded file
- **Open File button**: Browse for PNG files
- **Simulation Speed**: Slider (1-60 steps per second)
- **Steps per Frame**: Slider (1-100 simulation steps per render)
- **Start/Pause button**: Toggle simulation (or press SPACE)
- **Reset button**: Reload file and reset state
- **Show Settings**: Toggle with ESC key

#### Keyboard Shortcuts
- **ESC**: Toggle settings panel
- **SPACE**: Pause/resume simulation
- **R**: Reset to initial state
- **+/-**: Zoom in/out

### 6. Performance Optimizations
- Use Uint8ClampedArray for pixel data
- Pre-allocate arrays for wire maps and states
- Use TypedArrays where possible
- RequestAnimationFrame for rendering
- Web Workers for simulation (optional, for large circuits)

## File Format
**Input**: PNG images with the following conventions:
- **Wires**: Any pixel with R≥224 OR G≥224 OR B≥224
- **Gates**: "+" patterns (5 pixels in cross shape)
  - Center: Non-wire (dark)
  - NSEW: Wire (bright)
  - Corners determine gate direction
- **Background**: Any dark pixel (all RGB < 224)

**State Preservation**: When loading a new version of the same file, preserve logic states from previous version by checking pixel brightness at wire positions.

## Example Schematics to Include
Copy from project root to `/docs/examples/`:
- counter.png
- Flip Flop.png
- 4bitAdder.png
- 4bitCPU.png
- ALU.png
- Digital_Led.png
- Enigma2.png
- Flash Memory 256x12.png

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│ BmpLogicSim Web         [Settings] [Examples ▼]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│                                                     │
│              [Canvas Display Area]                  │
│                                                     │
│                                                     │
│              (Drag PNG file here)                   │
│                                                     │
│                                                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Controls: SPACE=Pause | ESC=Settings | Wheel=Zoom  │
│ Click: LEFT=Pulse HIGH | RIGHT=Toggle              │
└─────────────────────────────────────────────────────┘
```

### Settings Panel (Slide-in from right)
```
┌─────────────────────┐
│ Settings        [×] │
├─────────────────────┤
│ File:               │
│ [Open File]         │
│ counter.png         │
│                     │
│ Simulation:         │
│ Speed: [====··] 30  │
│ Steps: [==····] 10  │
│ [⏸ Pause]           │
│ [↻ Reset]           │
│                     │
│ Zoom: 200%          │
└─────────────────────┘
```

## Browser Compatibility
- **Target**: Modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- **Required APIs**: Canvas 2D, File API, Drag & Drop API
- **No external dependencies**: Pure vanilla JavaScript

## GitHub Pages Deployment
1. Place all files in `/docs` directory
2. Enable GitHub Pages in repository settings
3. Select `/docs` as source folder
4. Access at: `https://username.github.io/repository-name/`

## Success Criteria
✅ Load any BmpLogicSim PNG schematic
✅ Correctly detect wires and gates
✅ Simulate logic with smooth state transitions
✅ Interactive wire manipulation (click to set state)
✅ Pan and zoom viewport
✅ Run at 30+ FPS for circuits with <10,000 gates
✅ Mobile-responsive (touch support)
✅ No build process required
✅ Works offline after initial load

## Future Enhancements (Optional)
- Save/export circuit state as PNG
- Circuit editor (draw wires and gates)
- Performance profiling overlay
- Multiple gate types (AND, OR, XOR, etc.)
- Sub-circuit modules
- Waveform/oscilloscope view for signals
