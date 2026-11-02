# ADR 0002 — Pure CAD engine, immutable document, derived everything

**Status:** accepted

**Decision.** The CAD engine (`src/engine`) is pure TypeScript with no DOM or three.js.
The project is one immutable document; edits are pure `doc → doc` commands. Geometry,
drawings and manufacturing data are *derived* from it and memoised per item.

**Why.** Manufacturing accuracy: the 3D view, elevations and cutlist are produced from
the same construction build, so they cannot disagree. Testability: construction and
snapping run in Node under Vitest. Undo/redo, autosave and dirty tracking become
reference operations. The renderer can be replaced (path tracer, CNC preview) without
touching the model.

**Consequences.** UI code must never mutate the document or read model state back from
three.js objects. Continuous edits use store transactions (`preview` → `endPreview`)
so a drag is one undo step.
