# ADR 0003 — Materials are substrate + finish; construction is data

**Status:** accepted

**Decision.** A `MaterialDef` is a board *and* its finish, with the thicknesses it is
stocked in. Parts get thickness from construction rules and material from slots
(carcass, fronts, backs…). Cutlists group by `thickness + material`. Construction
methods (back method, joints, housing, joinery, gaps, hinge rules, runners…) are fields
on `ConstructionRules`, not code paths chosen by cabinet type.

**Why.** In existing tools, changing a part's "material template" can leave its colour
behind and silently split a cutlist into the wrong groups. Tying finish to substrate and
checking stocked thicknesses (the engine warns when, e.g., a 3 mm back is assigned a
board only stocked in 16/18 mm) removes that class of error. Exposed ends are built in
the front material automatically, so visible ends always match the doors.

**Consequences.** Shops define standards once and every cabinet follows them;
per-cabinet overrides remain possible and are shown in the properties panel.
