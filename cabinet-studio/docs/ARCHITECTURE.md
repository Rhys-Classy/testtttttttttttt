# Cabinet Studio — Architecture

Parametric cabinet design and manufacturing software for the desktop. This document
covers the seven planning deliverables: stack, architecture, folder structure, GPU
rendering strategy, the parametric cabinet data model, the custom drawing engine
strategy and the staged roadmap. Everything marked **built** exists in this repository
and is covered by tests.

```
┌──────────────────────────── Electron main process ─────────────────────────────┐
│ window · native menu · file dialogs · atomic saves · autosave/recovery          │
│ GPU policy (discrete GPU, WebGPU flags, blocklist override, software fallback)  │
└───────────────▲─────────────────────────────────────────────────────────────────┘
                │ typed IPC (src/shared/ipc.ts) — contextIsolation + sandbox
┌───────────────┴──────────────────── Renderer ───────────────────────────────────┐
│  React UI ──commands──▶ Store (immutable ProjectDocument, undo/redo, txns)      │
│     ▲                         │                                                 │
│     │                         ▼                                                 │
│     │                 Deriver (memoised per item)                               │
│     │        walls · faces · auto ends · construction builds                    │
│     │             │                 │                    │                      │
│  Properties  RenderEngine (GPU)   SVG overlay       Cutlist / hardware          │
│  panel       three.js WebGPU      dimensions,       CSV export                  │
│              → WebGL 2 fallback   guides, tools                                 │
└──────────────────────────────────────────┬──────────────────────────────────────┘
                                           │ imports (one-way)
┌──────────────────────────────────────────▼──────────────────────────────────────┐
│  CAD engine (src/engine) — pure TypeScript, no DOM / React / three.js           │
│  math · model · construction rules → parts · library · walls · snapping ·       │
│  adjacency · runs/auto tops · clash detection · cutlist · file format           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Technology stack

| Concern | Choice | Why | Rejected |
|---|---|---|---|
| Desktop shell | **Electron 45** (Chromium) | Same Chromium GPU stack on every PC, so WebGPU behaves identically on all customers' machines. Mature installers, file associations, auto-update path. | **Tauri** — uses the OS web view; WebGPU support differs per platform (WebKitGTK/WKWebView lag), so the GPU path would not be uniform. **Native C++/Qt** — 5–10× the cost for the UI, slower iteration. |
| Language | **TypeScript (strict)** everywhere | One language across engine, UI and main; the engine runs in Node for tests and future CLI/worker exports. | — |
| UI | **React 19 + Zustand** | Simple, fast store with selectors; the document lives outside React so the 3D engine can subscribe without re-rendering the UI. | Redux (ceremony), MobX (implicit reactivity is risky for a CAD model). |
| 3D | **three.js r187 `WebGPURenderer`** with TSL node materials | One renderer, two backends: native **WebGPU**, automatic **WebGL 2** fallback. PBR, PMREM image-based lighting, shadow maps and GTAO ambient occlusion all available on the GPU. | Babylon.js (also good; three chosen for TSL and ecosystem), raw WebGPU (re-implementing an engine), cloud rendering (explicitly out). |
| Geometry kernel | **Own parametric engine** (pure TS) for cabinet construction | Cabinets are rule-driven panel assemblies; exact rectangular solids with known grain, banding and machining are more accurate and faster than a general B-rep. | General B-rep for everything (slow, heavy). |
| Geometry (Phase 3) | **Clipper2** (2D offsets/booleans), **manifold-3d** (robust WASM mesh booleans for cutouts, dados, profiles) | Both are battle-tested, fast, robust to degeneracies. | OpenCascade.js only if STEP/B-rep exchange is needed (30 MB WASM). |
| Persistence | **Versioned JSON project file** (`.cabproj`) now; **SQLite** (main process) for shop-wide libraries in Phase 2 | Projects must be portable single files; libraries (materials, hardware, prices, standards) are shared and queried. | SQLite-per-project (harder to email/backup). |
| Build & package | **electron-vite** (Vite 8), **electron-builder** (Windows NSIS installer) | Fast dev loop with HMR; one command to produce an installer. | webpack. |
| Tests | **Vitest** (engine), **Playwright** (renderer and Electron end-to-end) | Geometry and construction maths are unit-tested; the app is driven like a user in a real Chromium/Electron. | — |

## 2. Software architecture

**Process model.** The main process owns the OS: windows, menus, dialogs, files
(atomic temp-file-then-rename saves), autosave and GPU switches. The renderer is
sandboxed (`contextIsolation`, `sandbox`, no Node) and talks to main only through the
typed bridge in `src/shared/ipc.ts`. The renderer also runs in a plain browser
(`npm run dev:web`) with download/upload/localStorage fallbacks, which is how the UI is
tested headlessly.

**Data flow is one-way:**

1. A user action calls a **command** — a pure function `doc → doc` (`src/engine/document/commands.ts`).
2. The **store** holds the immutable `ProjectDocument`. `commit` records one undo step;
   continuous edits (drag, resize handles, scrubbing a number) use `preview` and
   `endPreview` so a whole drag is one undo step. Dirty = `doc !== savedDoc`.
3. The **Deriver** turns the document into derived data, memoised per item by object
   identity: wall geometry and faces, automatic finished ends, and the construction
   **build** (parts + hardware + warnings) of every item. Editing one cabinet rebuilds
   one cabinet (tested).
4. Consumers read derived data and never write back: the **RenderEngine** (meshes),
   the **overlay** (dimensions), the **properties panel**, the **cutlist**.

Because the 3D model, the drawings and the cutlist are all generated from the same
build, they cannot disagree.

**Invariants**

- The engine has no DOM/three.js imports (`tsconfig.node.json` compiles it for Node).
- Millimetres everywhere in the model; the renderer converts at the boundary (`× 0.001`, Z-up → Y-up).
- Every manufactured thing is a `Part` produced by construction rules; nothing in the cutlist is typed in by hand.
- Impossible parameters produce an `invalid` build with a plain-English warning, never broken geometry.

## 3. Folder structure

```
cabinet-studio/
├─ docs/ARCHITECTURE.md, docs/adr/        decisions and design
├─ electron.vite.config.ts                main / preload / renderer builds
├─ electron-builder.yml                   installer (Windows NSIS, .cabproj association)
├─ src/
│  ├─ main/            index.ts (window, menu, IPC), files.ts (save/open/autosave), gpu.ts (GPU policy)
│  ├─ preload/         index.ts — the only bridge exposed to the renderer
│  ├─ shared/          ipc.ts — typed contract between main and renderer
│  ├─ engine/          pure CAD engine (no UI, no three.js)
│  │  ├─ math/           vectors, 2D geometry, placements/frames
│  │  ├─ model/          project document types, ids
│  │  ├─ construction/   parts, buildCabinet, buildCorner, fronts (overrides/styles), buildPanel
│  │  ├─ library/        cabinet templates, construction standards, materials, hardware
│  │  ├─ room/           walls (mitred faces, openings → wall pieces), room factory
│  │  ├─ layout/         snapping, auto ends, runs + auto tops, clash detection, extents
│  │  ├─ manufacturing/  cutlist, hardware schedule, CSV
│  │  ├─ drawings/       A3 plan and elevation sheets (SVG → PDF)
│  │  └─ document/       project factory, commands, derive cache, file format
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ state/       store (undo, txns, prefs), actions (files, autosave, commands)
│        ├─ platform/    Electron bridge or browser fallback
│        ├─ viewport/    RenderEngine, meshes, materials, textures, quality, GPU detect,
│        │               interaction (drag/resize/draw), overlay (dimensions), views
│        └─ ui/          TopBar, LeftPanel, RightPanel, BottomBar, Dialogs, controls
└─ tests/engine/       construction, layout, document tests
```

## 4. GPU rendering strategy

**Using the local GPU.**

- three.js `WebGPURenderer` requests a WebGPU device (Direct3D 12 on Windows, Metal on
  macOS, Vulkan on Linux). Where WebGPU is unavailable it runs the same scene through
  WebGL 2 (ANGLE → D3D11/OpenGL). Both are hardware accelerated.
- Electron switches (`src/main/gpu.ts`): `force_high_performance_gpu` (discrete GPU on
  dual-GPU laptops), WebGPU flags on Linux, optional *Force GPU acceleration* (ignores
  Chromium's driver blocklist), and the software rasteriser as a last resort so the app
  never shows a dead viewport.
- **Detection and self-healing** (`viewport/gpu-detect.ts`, `RenderEngine.selfTest`):
  the adapter is identified (vendor/architecture, software/fallback flag, texture
  limits) and a quality tier chosen. After start-up the engine renders a known colour
  into a render target **and** to the canvas and reads both back. A device that does
  not rasterise or does not present (seen on some drivers and software adapters), a
  `device.lost` event, or Dawn instance loss rebuilds the viewport on WebGL 2
  automatically. The status bar and *Help → Graphics & GPU* show the live backend,
  adapter, draw calls and triangles.

**Performance.**

- **Render on demand**: frames are drawn only when the model, camera or lighting
  changes; an idle app uses no GPU time.
- **Per-item merged geometry**: each cabinet's parts are merged per material into one
  buffer (≈3–5 draw calls per cabinet). Geometry is rebuilt only when that item's build
  changes; dragging only updates a transform.
- **Engine scale** (tested): 400 cabinets / 5,000+ parts build in well under a second;
  editing one cabinet afterwards rebuilds one cabinet. End detection uses a spatial
  hash, so it stays linear.
- Next steps for very large jobs: `BatchedMesh` per material across items (one draw call
  per material), geometry building in a worker, hardware LODs.

**Look.** Physically based materials (`MeshPhysicalMaterial` → node materials):
procedural wood grain that follows each part's grain direction, stone veining, brushed
metal, glass; imported photo textures. PMREM image-based lighting for reflections, a
sun with PCF shadow maps, GTAO ambient occlusion applied to indirect light only
(`builtinAOContext`), neutral tone mapping for colour-accurate finishes, lighting presets
(studio / daylight / evening with under-cabinet LEDs), exposure and sun controls.

**Quality tiers** (auto-selected from the detected GPU, user-overridable):

| Tier | Pixel ratio | Shadows | AO | Textures |
|---|---|---|---|---|
| Low | 1 | off | off | 512 |
| Medium | ≤ 1.25 | 1024 | off | 1024 |
| High | ≤ 2 | 2048 | half-res GTAO | 1024 |
| Ultra | ≤ 2 | 4096 | full-res GTAO | 2048 |

**Views.** Floor plan, front and side elevations (orthographic, per wall), 3D orbit with
automatic wall cut-away, first-person walkthrough. Stills re-render the current camera
at up to 4K/A3 at Ultra quality on the local GPU and save a PNG.

## 5. Parametric cabinet data model

```
ProjectDocument
 ├─ rooms[] ─ Room { walls[], openings[], items[], ceilingHeight, finishes }
 │              Item = CabinetItem | PanelItem   (placement: x, y, rotation, elevation)
 ├─ standards[] ─ ConstructionStandard { rules: ConstructionRules }
 ├─ materials[] ─ MaterialDef (substrate + finish, stocked thicknesses, sheet, grain, PBR look)
 ├─ materialDefaults ─ slot → material  (carcass, front, back, drawerBox, drawerBottom, kick, panel, benchtop, splashback, handle)
 ├─ render, cameras[], client, notes, counters
```

**CabinetItem** = template id + `params` (width, height, depth, kick, hinge side, handle,
ends, optional blind corner, and a **front stack**: sections listed top to bottom, each
`doors | drawer | open | appliance` with a fixed or *auto* height, door count, shelves
and interior) + optional per-cabinet construction overrides and material overrides.

**ConstructionRules** are data, not code: carcass/back/front thicknesses, back method
(inset / groove / applied), bottom and top joints (between / full width), rails vs full
top, housing (dado) depth, joinery (confirmat, dowel, cam, Rafix, screw, glue), fastener
spacing, overlay or inset fronts, gaps and reveals, hinge rules by door height, banding,
32 mm system pitch, shelf setbacks, kick, drawer box construction and runner lengths.
Three presets ship; shops add their own.

**Construction pipeline** (`construction/build-cabinet.ts`): validate → carcass (sides,
bottom, top or rails, back — all sized from the back method and joints) → interior
envelope → front zone (overlay reveals or inset gaps, blind panel) → vertical layout
of the front stack (fixed heights, auto heights share the rest) → per section: doors
(1 or 2 by width, hinge handing, hinge count/positions, handles), drawers (front, box
sized from runner clearance and the longest runner that fits, bottom in a groove,
runners), shelves snapped to the 32 mm system, appliance openings with fixed shelves,
hanging rails → kickboard and legs → fasteners counted from the joints actually built
→ stock check (warns when a material isn't stocked in the thickness a part needs).

**Part** = item-local box + thickness axis + length (grain) axis, finished size, edge
banding per edge (L1/L2 long edges, W1/W2 ends), and **cut size = finished − banding on
the opposite edges** (verified against the shop's own example: 580 × 870 banded on one
long edge and both ends cuts at 579 × 868).

**Corner cabinets** (`construction/build-corner.ts`): an L carcass with a long wing on the
back wall and a return wing on the side wall; L-shaped bottom, top and shelves are
`Part.profile` outlines (exact for CNC, bounding blank on the cutlist). Doors are a bi-fold
pair or two hinged doors; the right-hand version is an exact mirror of the left.

**Per-front overrides and styles** (`construction/fronts.ts`): every door and drawer
front has a stable `frontKey`; `CabinetItem.frontOverrides[frontKey]` can change its hinge,
handle, profile (slab / shaker / V-groove / J-pull), material and per-edge trim. Profiles
are rendered as real recesses in 3D and recorded as machining notes on the part.

**Drawings** (`drawings/sheets.ts`): A3 SVG sheets generated from the builds — plan and
elevations with width chains, height chains, hinge symbols and a title block — printed to
PDF by the main process in a script-disabled window.

**Automatic behaviour**: wall snapping and face alignment, butting against neighbours,
collision avoidance on drop, finished ends where a side is exposed (built in the front
material, so visible ends always match the doors), runs → benchtops with overhangs only
at exposed ends and splashbacks up to the wall cabinets, clash detection.

## 6. Custom drawing engine strategy (Phase 3)

Already built and reusable: the snapping engine, the wall tool (click to place, typed
lengths, 15° angle snap, node snap, Shift for free angle), the tape measure, the SVG
overlay for previews and dimensions, and transactions for undoable continuous edits.

The drawing environment adds a **sketch model** to the document:

- **Entities**: line, arc (centre/start/end), circle, polyline with bulges (exact arcs,
  so DXF/CNC output is exact), rectangle and polygon as polylines, freehand captured and
  fitted to arcs/lines, construction lines (infinite, non-printing), dimensions and
  text. Every entity has a layer and an optional group.
- **Tools as state machines** (idle → first point → next point → finish), all accepting
  typed values (`length`, `length<angle`, `@dx,dy`) exactly like the wall tool.
- **Object snaps** via a spatial index: endpoint, midpoint, centre, intersection,
  perpendicular, tangent, nearest, grid, construction-line, and extension tracking.
- **Operations**: offset (exact for lines/arcs, Clipper2 for complex polylines with arc
  re-fitting), trim/extend (segment–segment and segment–arc intersection), fillet and
  chamfer, copy/paste, mirror, array, group, layers, undo through the same command system.
- **2D → 3D**: a closed profile becomes a *region*; *extrude* creates a part whose
  `shape` is that outline with holes (benchtops with sink cut-outs, curved ends, shaped
  shelves, angled carcass sides). Parts keep exact outlines for manufacturing; meshes are
  triangulated for display; manifold-3d handles booleans (cut-outs, dados, rebates).
- **Constraints** (Phase 3b): coincident, horizontal/vertical, equal, parallel and
  driving dimensions solved with a Newton–Raphson solver, so drawn shapes stay parametric.

## 7. Staged roadmap

**Phase 1 — desktop app, viewport, rooms, basic library (built)**

- [x] Electron app, secure preload bridge, native menu, title/dirty tracking, unsaved-changes prompt
- [x] Main UI: library / room / materials panel, viewport, properties panel, status bar; resizable, collapsible panels; keyboard shortcuts; context menu
- [x] GPU viewport: WebGPU with WebGL 2 fallback, detection, self-test and auto fallback, quality tiers, on-demand rendering
- [x] Rooms: rectangular rooms, wall drawing with typed lengths, wall editing, windows and doors cut into walls
- [x] Library: 28 cabinet templates (base, wall, tall, oven/microwave towers, blind corner, sink, bin, vanity, laundry, wardrobe, bookcase, custom) + end panels, fillers, benchtops, splashbacks
- [x] Drag and drop with wall snapping, butting, face alignment, collision avoidance; move, rotate, duplicate, mirror, delete; resize handles and numeric/scrub editing with live geometry
- [x] Plan, front and side elevations, 3D orbit, walkthrough; live dimensions and wall clearances
- [x] Save/open (.cabproj), autosave and crash recovery, Save As

**Phase 2 — parametric engine, components, materials, hardware, drawings**

- [x] Rule-driven construction engine with individual parts, three construction presets, per-cabinet overrides
- [x] Doors, drawers (boxes + runners), hinges, handles, shelves, appliance openings, hanging rails, kick/legs, fasteners
- [x] Material slots with project defaults and per-cabinet overrides; imported image textures; stock-thickness check
- [x] Automatic finished ends; auto benchtops and splashbacks; clash detection
- [ ] SQLite shop libraries (materials, hardware with prices, standards) shared across projects
- [x] Per-front overrides: click a door/drawer of the selected cabinet to change its hinge, handle, style, material and edge trims
- [x] Front styles: slab, shaker, V-groove, J-pull (handleless) — shown in 3D and drawings, machining noted on the cutlist
- [x] L-shaped corner cabinets (base and wall, left/right, bi-fold pair or two doors) with shaped L bottoms, tops and shelves
- [x] Dimensioned A3 PDF drawings: floor plan + an elevation for every wall with cabinets (width/height chains, hinge symbols, title block)
- [ ] Sliding doors, lift-up and pull-out hardware, channel handleless systems
- [ ] Angled (45°) corner cabinets; applied end panels from rules; kickboards per run
- [ ] Cabinet detail drawings; project versions (named snapshots)

**Phase 3 — custom drawing and custom geometry**

- [ ] Sketch entities and tools (§6), object snaps, layers and groups
- [x] Shaped (non-rectangular) parts end to end: outline in the model, extruded in 3D, bounding blank + outline banding on the cutlist
- [x] L-shaped kitchens: benchtops butt-join at the corner, splashbacks continue into the corner
- [ ] Extrude drawn profiles to parts; curved ends, angled cabinetry; Clipper2 and manifold-3d integration

**Phase 4 — presentation rendering**

- [x] Lighting presets, sun control, exposure, under-cabinet LEDs, saved camera views, 4K/A3 stills from the GPU
- [ ] Progressive GPU path tracing for photoreal stills, area/IES lights, render queue, presentation board export

**Phase 5 — manufacturing**

- [x] Exact cutlist (cut sizes, banding, grain, item references) and hardware schedule; CSV export
- [ ] Sheet nesting/optimisation with grain and kerf, edge-banding schedules by tape, drilling/machining operations on parts, DXF/CNC export (per machine post-processors), assembly drawings, labels

## 8. Testing

- `npm test` — engine unit tests: cut-size maths, every construction method, resizing,
  drawers, blind corners, appliance towers, hinges, fasteners, all 28 templates, walls
  and openings, snapping, auto ends, benchtops, clash detection, cutlist aggregation,
  undo-friendly commands, file round-trip and refusal of foreign/newer files, and a
  400-cabinet performance check.
- Renderer and desktop were driven end-to-end with Playwright (library drag-and-drop,
  resize, auto tops, plan/front views, cutlist, Electron IPC save/open/autosave, GPU
  fallback).

## 9. Known limitations (honest list)

- WebGPU *rendering* has not been verified on real hardware yet — the build container
  has no GPU (its software WebGPU adapter fails, which is how the self-test/fallback was
  proven). WebGL 2 rendering is verified. First run on a real Windows PC: check
  *Help → Graphics & GPU* shows "WebGPU" and the viewport looks right.
- Kickboards are per cabinet (not per run); no angled corner cabinets or sheet
  optimisation yet.
- Very large scenes still issue a few draw calls per cabinet (BatchedMesh planned).
