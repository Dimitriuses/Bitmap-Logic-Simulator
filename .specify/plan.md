# Implementation Plan: Web-based BmpLogicSim

**Branch**: `main` | **Date**: 2026-07-25 | **Spec**: [spec.md](.specify/spec.md)

**Input**: Feature specification from `.specify/spec.md`

## Summary

Create a web-based version of the BmpLogicSim150902 simulator that runs entirely in the browser on GitHub Pages. The application will load PNG schematics (bright pixels = wires, + patterns = NOT gates), simulate logic circuits with smooth state transitions, and provide interactive pan/zoom/click controls. Implementation uses pure vanilla JavaScript with HTML5 Canvas API, requiring no build process.

## Technical Context

**Language/Version**: JavaScript ES6+ (browser-native, no transpilation)

**Primary Dependencies**: None (zero external dependencies)

**Storage**: N/A (client-side only, PNG files loaded via File API)

**Testing**: Manual testing with example schematics + browser DevTools

**Target Platform**: Modern web browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)

**Project Type**: Single-page web application (GitHub Pages static site)

**Performance Goals**:
- 30+ FPS rendering for circuits with <10,000 gates
- <100ms wire/gate detection for typical schematics (<500KB PNG)
- Smooth 60 FPS pan/zoom interactions

**Constraints**:
- No build process (direct .js file loading)
- No external dependencies (CDN or npm)
- GitHub Pages compatible (static files only)
- Works offline after initial page load

**Scale/Scope**:
- ~10 example schematics included
- Support circuits up to 2048×2048 pixels
- Target circuits: 100-10,000 gates typical

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Simplicity**: Pure JavaScript, no frameworks or build tools
✅ **Single Responsibility**: Each module handles one concern (simulation/rendering/UI/files)
✅ **No Premature Optimization**: Start with simple algorithms, optimize if needed
✅ **Security**: Client-side only, no server interaction, no user data storage

## Project Structure

### Documentation (this feature)

```text
.specify/
├── plan.md              # This file
├── spec.md              # Feature specification
└── templates/
    └── plan-template.md # Template reference
```

### Source Code (repository root)

```text
docs/                    # GitHub Pages root
├── index.html           # Main application page
├── css/
│   └── style.css        # Application styles
├── js/
│   ├── simulator.js     # Core simulation engine
│   ├── renderer.js      # Canvas rendering & viewport
│   ├── fileHandler.js   # PNG loading & drag-drop
│   └── ui.js            # Controls, settings, interaction
└── examples/
    ├── counter.png
    ├── Flip Flop.png
    ├── 4bitAdder.png
    ├── 4bitCPU.png
    ├── ALU.png
    ├── Digital_Led.png
    ├── Enigma2.png
    └── Flash Memory 256x12.png

[Project root - existing files remain]
├── BmpLogicSim150902/   # Original Pascal simulator (reference)
├── *.png                # Source schematics (copied to docs/examples/)
└── .specify/            # Specification documents
```

**Structure Decision**: Single-page application with modular JavaScript files loaded via `<script type="module">`. All web app files in `/docs` for GitHub Pages. Original Pascal source remains in `/BmpLogicSim150902` as reference.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

N/A - No violations. Architecture follows simplicity principles with minimal abstractions.

## Implementation Phases

### Phase 0: Directory Structure & Core Engine

**Tasks**:
1. Create `/docs` directory structure for GitHub Pages
   - Create `/docs/js/`, `/docs/css/`, `/docs/examples/` directories

2. Implement `simulator.js` - Core simulation engine
   - `isWire(r, g, b)` - Detect wire pixels (any channel ≥ 224)
   - `detectWires(imageData)` - Flood-fill horizontal, merge vertical
   - `detectGates(wireMap)` - Find + patterns, classify by corners
   - `class Gate` - State management with smooth transitions (Schmidt trigger)
   - `simulate(gates, wireStates)` - Evaluation loop with randomization

**Deliverables**:
- Working wire detection algorithm
- Working gate detection algorithm
- Basic simulation loop (gates update states)

**Validation**:
- Load simple circuit (Flip Flop.png)
- Verify wires detected correctly
- Verify gates detected correctly
- Console log gate states per cycle

---

### Phase 1: Rendering & File Handling

**Tasks**:
3. Implement `renderer.js` - Canvas rendering system
   - `toScreen(worldX, worldY)` - World to screen coordinates
   - `toWorld(screenX, screenY)` - Screen to world coordinates
   - `renderCircuit(ctx, imageData, wireStates)` - Dim inactive wires
   - `animationLoop()` - requestAnimationFrame rendering
   - Pan/zoom state management (center, zoomExp)

4. Implement `fileHandler.js` - File I/O
   - `loadPNG(file)` - Load PNG into ImageData
   - `setupDragDrop(element)` - Drag-and-drop handlers
   - `loadExample(filename)` - Load from /examples/
   - State preservation on reload (compare pixel brightness)

**Deliverables**:
- Working canvas rendering with pan/zoom
- Drag-and-drop PNG loading
- Example file loading

**Validation**:
- Drag Flip Flop.png onto canvas
- Pan with middle mouse
- Zoom with mouse wheel
- See active wires bright, inactive wires dimmed

---

### Phase 2: User Interface

**Tasks**:
5. Implement `ui.js` - User interface controls
   - Settings panel toggle (ESC key)
   - Play/pause button (SPACE key)
   - Simulation speed slider
   - Steps-per-frame slider
   - Mouse click handlers (left=pulse, right=toggle)
   - Example gallery dropdown
   - Keyboard shortcut handlers

6. Create `style.css` - Visual styling
   - Full-viewport canvas layout
   - Settings panel (slide-in from right)
   - Control bar at bottom
   - Responsive design (media queries)
   - Mobile touch-friendly controls

7. Create `index.html` - Main application page
   - Canvas element (full viewport)
   - Settings panel structure
   - Control bar structure
   - Module script loading (`<script type="module">`)
   - Application initialization

**Deliverables**:
- Complete functional UI
- All keyboard shortcuts working
- All mouse interactions working
- Mobile-responsive layout

**Validation**:
- Toggle settings with ESC
- Pause/resume with SPACE
- Click wires to set HIGH/LOW
- Adjust speed/steps sliders
- Test on mobile device/emulator

---

### Phase 3: Content & Testing

**Tasks**:
8. Copy example schematics to `/docs/examples/`
   - Copy all .png files from root to docs/examples/
   - Verify file sizes reasonable for web
   - Create example manifest (JSON file listing examples)

9. Test with example circuits
   - Flip Flop.png - Basic SR latch behavior
   - counter.png - Multi-bit counter increments
   - 4bitAdder.png - Addition logic works
   - Digital_Led.png - Display segments work
   - Performance test with largest circuit

10. Verify GitHub Pages compatibility
    - Test with `python -m http.server` locally
    - Verify all paths are relative
    - Test on Chrome, Firefox, Safari
    - Test on mobile (iOS/Android)
    - Create README.md with usage instructions

**Deliverables**:
- All example schematics functional
- Cross-browser compatibility verified
- Mobile compatibility verified
- Documentation complete

**Validation**:
- Each example loads and simulates correctly
- No console errors in any browser
- Touch controls work on mobile
- GitHub Pages deployment ready

---

## Success Criteria

- ✅ Load any BmpLogicSim PNG schematic via drag-drop or file picker
- ✅ Correctly detect wires (bright pixels) and gates (+ patterns)
- ✅ Simulate logic with smooth state transitions (Schmidt trigger)
- ✅ Interactive wire manipulation (left click = pulse, right click = toggle)
- ✅ Pan with middle mouse, zoom with wheel
- ✅ Run at 30+ FPS for circuits with <10,000 gates
- ✅ Mobile-responsive with touch support
- ✅ No build process required (pure HTML/CSS/JS)
- ✅ Works offline after initial load
- ✅ GitHub Pages compatible

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Large PNGs cause performance issues | Medium | High | Implement max size warning, optimize with OffscreenCanvas |
| Cross-browser canvas compatibility | Low | Medium | Test early on all target browsers, use standard APIs only |
| Complex circuits too slow | Medium | Medium | Add steps-per-frame control, Web Worker option for simulation |
| Mobile touch controls awkward | Medium | Low | Iterative UX testing, add touch gesture library if needed |

## Future Enhancements (Post-MVP)

- Circuit editor (draw wires and gates directly)
- Save circuit state as PNG
- Waveform viewer for signal analysis
- Performance profiling overlay
- Multiple gate types (AND, OR, XOR beyond NOT)
- Sub-circuit modules/components
- Share circuits via URL parameters (base64 encoded)
