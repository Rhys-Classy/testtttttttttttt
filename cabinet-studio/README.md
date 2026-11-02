# Cabinet Studio

Desktop cabinet design and manufacturing software: draw the room, drag in parametric
cabinets, edit them live in a GPU-accelerated 3D viewport, and get an exact cutlist.

Architecture, GPU strategy, data model and roadmap: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it

```bash
cd cabinet-studio
npm ci
npm run dev        # desktop app (Electron) with hot reload
npm run dev:web    # same UI in a browser at http://localhost:5199
npm test           # engine tests (geometry, construction, snapping, cutlist, files)
npm run typecheck
npm run build      # production build into out/
npm run dist       # Windows installer into release/ (run on Windows for signing)
```

## Use it

1. **Room** tab → set width/depth/ceiling → *Create room*, or *Draw walls* (click points, type a length + Enter, Esc to finish). Drag windows/doors onto walls.
2. **Library** tab → drag a cabinet onto a wall. It snaps to the wall, butts against neighbours, and never drops on top of another cabinet. Double-click a card to add it at the room centre.
3. Select a cabinet → edit width/height/depth/kick (type, use arrow keys, drag the ↔ label, or drag the blue handles in the viewport). Every part rebuilds instantly.
4. **Fronts & interior** → add drawers or door sections, set fixed or auto heights, shelves, hanging rails, appliance openings.
5. **Auto tops** → benchtops and splashbacks for every run. **Cutlist** → exact cut sizes per material, hardware schedule, CSV export. **Render** → PNG up to 4K from your GPU.

## Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| 1–5 | Plan / Front / Side / 3D / Walk | V / W / T | Select / Walls / Tape measure |
| R (Shift+R) | Rotate 90° | M | Mirror handing |
| Ctrl+D | Duplicate | Del | Delete |
| Arrows (Shift) | Nudge 1 mm (10 mm) | F | Frame room |
| G / E | Grid snap / part edges | Esc | Cancel / deselect |
| Ctrl+Z / Ctrl+Y | Undo / redo | Ctrl+S / Ctrl+O | Save / open |
| Ctrl+L / Ctrl+R | Cutlist / render | | |

Number fields accept arithmetic: `600+18`, `(900-3)/2`.

## Files

Projects save as `.cabproj` (versioned JSON). Unsaved work is autosaved every 20 s and offered back after a crash.
