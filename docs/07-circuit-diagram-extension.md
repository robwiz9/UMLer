# 07 — Circuit diagram extension

**Status:** implemented. The model, Phase 1 layout, canvas interactions, add-object palette, circuit
standard panel and CeTZ exporter are in place; `scripts/test-circuit.ts` covers the core behaviour.
Two decisions from the review are applied throughout: copy/paste and duplicate never re-enumerate
component labels, and an empty-canvas wire drop requires a deliberate drag before a no-dot Node is
created. A follow-up round added shorter leads, equal wire/lead stroke, occupied-pin junctions,
corner junctions on double-click reroute, Typst-style label scripts, and small/XL filled junction
variants; see §16. See §15 for the remaining product decisions.

**Goal:** add a first-class **Circuit** diagram type to UMLer that uses the existing
skeleton-first pipeline: semantic `SceneDocument` → Phase 1 `LayoutSnapshot` → DOM canvas + Typst/CeTZ
export. Circuit diagrams are drawn by hand; there is no automatic graph layout.

---

## 1. Scope

### 1.1 In scope

- New diagram kind `circuit` with a scene-level **circuit standard** (IEC/EU vs ANSI/US).
- Electronic **components** with fixed schematic symbols and fixed electrical pins.
- **Nodes** (branch points / junctions) with three dot styles: filled, hollow, none.
- **Wires** as plain lines with centre labels and no arrowheads or per-wire stroke styles.
- Automatic reference numbering (`R1`, `R2`, `C1`, `V1`, …) that remains user-editable.
- 45°-snapped **rotation** driven by a rotate handle outside the focused object.
- Extending a wire into empty space: auto-create a no-dot Node at its end.
- Connecting a wire to another wire: auto-create a filled Node and split/rewire the line.
- **Omega bridge** hops at wire crossings that are not electrical connections.
- Searchable, scrollable component table in **Add object**, with recent components on top and an
  Image object below the table.
- Browser rendering **and** CeTZ export for every new object, wire, label, pin and hop.

### 1.2 Out of scope (for this extension)

- SPICE/netlist generation, electrical rule checking or simulation.
- Auto-layout, auto-routing, orthogonal obstacle avoidance, or wire straightening.
- Multi-page schematics, buses, ground/power symbols as a separate net concept.
- PCB footprints, hierarchical sheets, or import from EDA tools.
- Free-value annotation (`10 kΩ`, `0.1 µF`). The data model leaves room for it, but the first
  implementation only guarantees the **reference label**. See §15.

---

## 2. Requirement → design summary

| Requirement | Design response |
|---|---|
| Component palette: resistor, capacitor, coil, sources, battery, diode/LED, potentiometer, transistors/MOSFETs and inverse types, meters | `CircuitComponentKind` catalog in `src/model/circuit-catalog.ts`; each entry owns its size, pins, reference prefix, search keywords and symbol primitives. |
| Node = single dot with small filled / large filled / outlined / none styles | New `CircuitJunctionNode` with `junctionStyle: "filled" \| "solid" \| "hollow" \| "none"`. `filled` is the small default; `solid` is displayed as “Filled XL”. Internally named “junction” to avoid confusion with the generic scene node. |
| Wire = line, no arrows and no line-stroke options | New edge semantic family `"circuit"`; markers forced to `none`, routing fixed to `straight`, line menu hides markers/pattern/width/routing. Wires use the same stroke width as component leads. |
| Omega bridge at unconnected crossings | Derived Phase 1 pass `src/layout/wire-bridges.ts`; shared bridge geometry rendered as SVG path and CeTZ `bezier`. |
| Label on every object and wire, with sub/superscripts | Components/junctions use `NodeBase.name` plus a measured label frame; wires reuse `EdgeLabel` centre zone. `_` and `^` produce Typst-style sub/superscripts in the DOM and CeTZ. |
| Auto-number R/C/L/V etc., editable | `nextComponentLabel(scene, prefix)` uses `max(existing number) + 1` and emits `R_1`, `C_2`, `V_1`; focus-menu input edits the raw label. |
| Line drag handles at component ends and Nodes, fixed positions | New `pin` and `center` port refs. Pins are defined in the component’s local frame and rotate with it; they are not draggable themselves. Hovered pins are hidden while a wire is selected. |
| 45° rotation with an external drag-to-rotate icon | `rotation: 0 \| 45 \| … \| 315`; rotate handle outside the selection AABB; live preview; label stays upright; commit on pointer up. |
| Extend wire to empty space → Node with no circle | Canvas draw interaction gets a circuit-only empty-target path; App creates a `none` junction and a wire to its centre port. A minimum drag distance from the source handle is required so a click or short drag cannot create a node. |
| Wire to wire → Node with a full circle and rewire | Atomic scene edit: create/reuse a small `filled` junction at the intersection, retarget the original wire to it, add a new wire to the original target, add the new source wire. |
| Second wire at an occupied component pin | A small filled junction is placed one grid square out along the pin normal, existing direct wires are retargeted to it, and a short stub keeps the pin connected. |
| Add menu: scrollable searchable component table, recents, image option | New circuit mode in `AddObjectMenu` (or a dedicated `CircuitAddObjectMenu`): sticky search, table rows with symbol previews, recents from `localStorage`, annotations including Image below. |
| Left panel standard switch (EU vs US resistor, etc.) | New `CircuitPanel` in the left rail; scene-level `circuit.standard` drives symbol selection for browser and export. Replaces `LayoutPanel` for circuit scenes. |
| Existing project quality bar | Validation, persistence round-trip, clipboard fidelity (labels preserved exactly), CeTZ serializer checks, fixtures and browser QA. |

---

## 3. Architecture fit

The existing pipeline is the constraint that keeps this feature small and testable:

```text
SceneDocument (persisted, semantic)
  nodes + edges + circuit settings
        │
        ▼
buildLayoutSnapshot(scene, measurer)
  component geometry, rotated pins, junction centre, wire paths, bridge hops,
  labels, bounds                                  ← derived only, never persisted
        │
        ├── CanvasStage / NodeSkeleton / Edges / CircuitSymbols (DOM + SVG)
        └── serializeSceneToCetz(scene, layout) (Typst/CeTZ)
```

Rules inherited from the current codebase:

1. **Ports are references, never coordinates.** Circuit pins are `{ kind: "pin", pinId }`; junction
   centres are `{ kind: "center" }`. Rotation and movement update the resolved point in the layout pass.
2. **Frames are persisted, geometry is derived.** The component node stores its unrotated local box.
   The layout computes the rotated AABB, absolute symbol primitives, pin points and label frame.
3. **DOM and CeTZ consume the same `LayoutSnapshot`.** Symbol primitives are resolved once in the layout
   pass; the exporter never re-derives a symbol from the standard.
4. **No auto-layout for circuit scenes.** A circuit is a manually placed schematic; moving components to
   a Sugiyama layout would scramble nets. The circuit panel replaces the layout panel.
5. **Editor-only overlays stay out of CeTZ.** Selection frames, rotate handles, ghost junctions and hop
   previews are DOM-only, exactly like the existing lock badge.

---

## 4. Data model

All additions are additive and optional where needed, so existing `umler.scene/1` files remain valid.

### 4.1 Diagram kind and settings

```ts
// src/model/circuit.ts — circuit vocabulary lives together
export type CircuitStandard = "iec" | "ansi";

export interface CircuitSettings {
  readonly standard: CircuitStandard;
  /** "bridge" is the required default; "plain" is a print/legacy escape hatch. */
  readonly crossings: "bridge" | "plain";
  readonly bridgeRadius: number;
}

export const DEFAULT_CIRCUIT: CircuitSettings = {
  standard: "iec",
  crossings: "bridge",
  bridgeRadius: 6,
};
```

```ts
// src/model/scene.ts
export type DiagramKind =
  | "er"
  | "uml-use-case"
  | "uml-class"
  | "uml-object"
  | "uml-sequence"
  | "uml-communication"
  | "uml-state-machine"
  | "circuit";

export interface SceneDocument {
  // …
  readonly circuit?: CircuitSettings;
}

export const resolveCircuitSettings = (scene: SceneDocument): CircuitSettings =>
  scene.circuit ?? DEFAULT_CIRCUIT;
```

`createEmptyScene` writes `circuit: DEFAULT_CIRCUIT` only for `diagramKind === "circuit"`, so old
fixtures and serialized scenes do not gain a new key. The resolver keeps every read total.

### 4.2 Component node

```ts
// src/model/circuit.ts
export type Rotation45 = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;
export type CircuitJunctionStyle = "filled" | "solid" | "hollow" | "none";

// src/model/nodes.ts
export interface CircuitComponentNode extends NodeBase {
  readonly kind: "circuitComponent";
  readonly component: CircuitComponentKind;
  /** Clockwise, screen orientation, always a multiple of 45°. */
  readonly rotation: Rotation45;
  /**
   * Label anchor in the component's local (unrotated) frame, relative to its
   * centre. Defaults to the catalog value. The text itself always stays upright.
   */
  readonly labelOffset?: Point;
  readonly style: ShapeNodeStyle;
  /** Optional future value line (e.g. 10 kΩ); not rendered in the first cut. */
  readonly value?: string;
}

export interface CircuitJunctionNode extends NodeBase {
  readonly kind: "circuitJunction";
  readonly junctionStyle: CircuitJunctionStyle;
  readonly style: ShapeNodeStyle;
}
```

`NodeBase.name` is the displayed label:

- Components default to the generated reference (`R1`, `C2`, …).
- Junctions default to an empty string (no label) and can be given one.
- An empty label renders nothing; it remains selectable/editable.

`SceneNode` gains `CircuitComponentNode | CircuitJunctionNode`.

### 4.3 Ports

```ts
// src/model/edges.ts
export interface PinPortRef {
  readonly kind: "pin";
  readonly pinId: string;
}

export interface CenterPortRef {
  readonly kind: "center";
}

export type NodePortRef =
  | RowPortRef
  | PerimeterPortRef
  | AnglePortRef
  | SpinePortRef
  | PinPortRef
  | CenterPortRef;
```

```ts
// portKey
case "pin":    return `${nodeId}:pin:${port.pinId}`;
case "center": return `${nodeId}:center`;
```

Pin refs are validated against the component catalog. `center` is valid only on a junction node.
No perimeter ports are created for components, so a wire can only attach to an electrical pin.

### 4.4 Wire edge

```ts
// src/model/edges.ts
export type EdgeSemantic =
  // …
  | { readonly family: "circuit"; readonly net?: string };
```

Wire defaults:

```ts
{
  routing: {
    mode: "straight",
    avoidObstacles: false,
    obstaclePadding: 0,
    stubLength: 0,
    waypoints: [],
  },
  markers: { source: NO_MARKER, target: NO_MARKER },
  labels: [],
  semantic: { family: "circuit" },
  style: scene.theme.edge, // solid stroke; no per-wire pattern controls
  z: 10,
}
```

`edgeDisplayName` returns `semantic.net ?? "wire"`. The line menu for a circuit edge shows only the
wire label (centre zone) and delete; the endpoint/terminal menu is not opened at all.

### 4.5 Derived layout additions

```ts
// src/model/layout.ts
export interface CircuitPinGeometry extends PortGeometry {
  readonly ref: PinPortRef;
  readonly pinId: string;
  readonly label: string;
}

export interface CircuitComponentLayout extends NodeLayoutBase {
  readonly kind: "circuitComponent";
  readonly component: CircuitComponentKind;
  readonly rotation: Rotation45;
  /** Persisted unrotated frame. */
  readonly localFrame: Rect;
  readonly center: Point;
  /** Rotated corners of localFrame, for selection/outline drawing. */
  readonly outline: readonly Point[];
  readonly pins: readonly CircuitPinGeometry[];
  /** Absolute scene-space primitives. Single source for DOM and CeTZ. */
  readonly primitives: readonly CircuitPrimitive[];
  readonly labelFrame?: Rect;
  readonly label?: TextMeasurement;
}

export interface CircuitJunctionLayout extends NodeLayoutBase {
  readonly kind: "circuitJunction";
  readonly junctionStyle: CircuitJunctionStyle;
  readonly center: Point;
  readonly radius: number;
  readonly labelFrame?: Rect;
  readonly label?: TextMeasurement;
}

export type NodeLayout =
  | TableNodeLayout
  | LifelineNodeLayout
  | ShapeNodeLayout
  | ImageNodeLayout
  | CommentNodeLayout
  | CircuitComponentLayout
  | CircuitJunctionLayout;
```

For components, `layout.frame` is the **axis-aligned bounding box of the rotated local frame**.
This keeps every generic consumer correct with no special cases: marquee selection, obstacle tests,
hit rectangles, content bounds and `frameFullyInside`. `localFrame` remains available for movement
and export diagnostics.

### 4.6 Primitive contract

```ts
// src/model/circuit.ts
export type CircuitStrokeRole = "body" | "thin" | "none";
export type CircuitFillRole = "none" | "paper" | "ink";

export type CircuitGeometryPrimitive =
  | {
      readonly kind: "polyline";
      readonly points: readonly Point[];
      readonly closed?: boolean;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    }
  | {
      readonly kind: "circle";
      readonly center: Point;
      readonly radius: number;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    }
  | {
      readonly kind: "rect";
      readonly frame: Rect;
      readonly radius?: number;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    }
  | {
      readonly kind: "bezier";
      readonly start: Point;
      readonly c1: Point;
      readonly c2: Point;
      readonly end: Point;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    };

/** Catalog symbols are local and carry raw text. The layout measures them. */
export type CircuitSymbolPrimitive =
  | CircuitGeometryPrimitive
  | {
      readonly kind: "text";
      readonly point: Point;
      readonly text: string;
      readonly anchor?: "start" | "center" | "end";
    };

/** Absolute, layout-resolved primitives consumed by DOM and CeTZ. */
export type CircuitPrimitive =
  | CircuitGeometryPrimitive
  | {
      readonly kind: "text";
      readonly point: Point;
      readonly text: string;
      readonly measurement: TextMeasurement;
      readonly anchor?: "start" | "center" | "end";
    };
```

Role mapping:

- `stroke: "body"` → `node.style.stroke`
- `stroke: "thin"` → same colour, `width * 0.65` (internal details)
- `stroke: "none"` → no stroke
- `fill: "paper"` → `node.style.fill` (usually white)
- `fill: "ink"` → `node.style.stroke.color` (diode triangle, dot, arrow head)
- `fill: "none"` → transparent

`CircuitSymbolPrimitive` is what the catalog returns (local coordinates). The layout pass rotates/
translates the geometry and replaces symbol text with `CircuitPrimitive` text carrying an already
measured `TextMeasurement`, so the DOM and the exporter use exactly the same font metrics. Meter
letters (`V`, `A`) and polarity marks use this primitive. Symbol text is measured with the component’s
resolved text style (`node.style.text` + `node.textStyle`); a smaller internal style can be added to the
catalog later if a symbol needs it.

### 4.7 Wire bridges

```ts
// src/model/layout.ts
export interface WireBridge {
  readonly at: Point;
  readonly from: Point;
  readonly to: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly radius: number;
  readonly ownerEdgeId: EdgeId;
}

export interface EdgeLayout {
  // …
  readonly bridges?: readonly WireBridge[];
}
```

`bridges` is optional so existing fixtures and tests do not need to construct it. Accessors use
`layout.bridges ?? []`.

---

## 5. Component catalog

New file `src/model/circuit-catalog.ts`. Each definition is pure data plus a symbol function.

```ts
export interface CircuitPinDef {
  readonly id: string;
  readonly label: string;      // "A", "K", "B", "C", "E", "G", "D", "S", "+", "−"
  readonly x: number;          // local, origin = component centre
  readonly y: number;
  readonly nx: number;         // local outward normal
  readonly ny: number;
}

export interface CircuitComponentDef {
  readonly kind: CircuitComponentKind;
  readonly label: string;             // "Resistor"
  readonly prefix: string;            // "R"
  readonly group: "passive" | "sources" | "semiconductors" | "meters";
  readonly description: string;
  readonly keywords: readonly string[];
  readonly width: number;             // local frame; multiples of the 9 pt grid
  readonly height: number;
  readonly pins: readonly CircuitPinDef[];
  readonly labelOffset: Point;
  readonly symbol: (standard: CircuitStandard) => readonly CircuitSymbolPrimitive[];
}
```

All local coordinates are relative to the component centre. `symbol` returns **local** primitives;
the layout pass rotates, translates and measures them.

### 5.1 Component set and prefixes

| Component | `kind` | Ref prefix | Pins | Notes |
|---|---|---|---|---|
| Resistor | `resistor` | `R` | `A`, `B` | IEC box vs ANSI zigzag. |
| Capacitor | `capacitor` | `C` | `A`, `B` | Two plates, non-polarised. |
| Coil / inductor | `coil` | `L` | `A`, `B` | Bumps; IEC/ANSI variants. |
| Potentiometer | `potentiometer` | `RV` | `A`, `B`, `W` | Wiper arrow, three pins. |
| DC voltage source | `voltage-source` | `V` | `+`, `−` | Circle with polarity. |
| Current source | `current-source` | `I` | `+`, `−` | Circle with arrow. |
| AC source | `ac-source` | `V` | `+`, `−` | Circle with sine; shares the `V` counter with DC sources. |
| Battery | `battery` | `B` | `+`, `−` | Multi-cell long/short plates. |
| Diode | `diode` | `D` | `A`, `K` | Filled triangle + bar. |
| LED | `led` | `D` | `A`, `K` | Diode + two emission arrows. |
| Zener diode | `zener-diode` | `D` | `A`, `K` | Bent cathode bar. |
| NPN transistor | `transistor-npn` | `Q` | `B`, `C`, `E` | Arrow out. |
| PNP transistor | `transistor-pnp` | `Q` | `B`, `C`, `E` | Arrow in. |
| N-MOSFET | `mosfet-n` | `Q` | `G`, `D`, `S` | Enhancement symbol; arrow in. |
| P-MOSFET | `mosfet-p` | `Q` | `G`, `D`, `S` | Enhancement symbol; arrow out. |
| Voltmeter | `voltmeter` | `VM` | `+`, `−` | Circle with upright `V`. |
| Ammeter | `ammeter` | `AM` | `+`, `−` | Circle with upright `A`. |
| Switch | `switch` | `SW` | `A`, `B` | SPST contact dots with an open blade. |
| Lightbulb | `lightbulb` | `LP` | `A`, `B` | Lamp circle with an X filament/load mark. |

“Relevant inverse types” are represented as first-class catalog entries (`transistor-pnp`,
`mosfet-p`), not a mirror flag. This keeps pins, reference prefixes and standard symbols explicit.
Zener is included as the obvious diode variant; more variants (Schottky, photodiode, tunnel) can be
added without a schema change.

Reference numbering is **shared per prefix**, not per component kind: D1/D2 may be a diode and an
LED; Q1/Q2 may be a BJT and a MOSFET; V1/V2 may be DC and AC sources. This matches common schematic
practice.

### 5.2 Default symbol sizes

Sizes are chosen to be multiples of the 9 pt grid so pins land on grid coordinates when the local
frame is placed on the grid:

| Component | Local frame |
|---|---|
| Resistor, coil | `54 × 36` |
| Capacitor | `36 × 36` |
| Diode, LED, zener | `36 × 36` |
| Potentiometer | `54 × 54` |
| Voltage/current/AC source, battery, meters | `36 × 54` |
| Transistor / MOSFET | `54 × 54` |

These are fixed footprint symbols. Circuit components do **not** get the four corner resize handles;
only tables, images, comments and existing UML shapes do. If uniform symbol scaling is wanted later,
it should be an explicit `scale` field, not the generic resize path.

Suggested pin coordinates (local, origin = centre; normals point outward):

| Component | Pins |
|---|---|
| Resistor / coil | `A(-27, 0)`, `B(27, 0)`; normals `(-1, 0)` / `(1, 0)` |
| Capacitor | `A(-18, 0)`, `B(18, 0)`; normals `(-1, 0)` / `(1, 0)` |
| Diode / LED / zener | `A(-18, 0)`, `B(18, 0)`; normals `(-1, 0)` / `(1, 0)` |
| Potentiometer | `A(-27, 0)`, `B(27, 0)`, `W(0, -18)`; wiper normal `(0, -1)` |
| Voltage / current / AC source, battery, meters | `+` `(0, -27)`, `−` `(0, 27)`; normals `(0, -1)` / `(0, 1)` |
| NPN / PNP transistor | `B(-27, 0)`, `C(18, -18)`, `E(18, 18)`; diagonals normalised |
| N / P MOSFET | `G(-27, 0)`, `D(18, -18)`, `S(18, 18)`; diagonals normalised |

The exact coordinates can change without a schema change because pins are catalog data, not persisted
on the node. They only need to stay consistent between the browser layout and the CeTZ anchors, which
both read the same catalog.

### 5.3 IEC vs ANSI standard

The standard is presentation-only. It never changes:

- pin ids, pin coordinates, or topology;
- reference labels or numbering;
- wire geometry or junction styles;
- export semantics.

It only selects a different primitive list from `symbol(standard)`:

| Symbol | IEC / EU | ANSI / US |
|---|---|---|
| Resistor | Plain rectangle | Zigzag |
| Potentiometer | Rectangle + arrow | Zigzag + arrow |
| Coil | Semicircle series | Looped coils |
| Transistor / MOSFET envelope | Circle envelope | No circle (or vice versa, per chosen drawing) |
| Source / battery / diode / LED / meter | Shared (no meaningful difference) | Shared |

The symbol table should be written so most components share one implementation and only the
differing ones branch on `standard`. Every branch stays inside the catalog; the canvas and exporter
only see primitives.

### 5.4 Search keywords

Each catalog entry includes aliases so the search is usable:

| Component | Keywords |
|---|---|
| Resistor | `resistance ohm r` |
| Capacitor | `cap farad c` |
| Coil | `inductor choke henry l` |
| Potentiometer | `pot trimmer rheostat rv` |
| Voltage source | `vsource dc voltage generator` |
| Current source | `isource current generator` |
| AC source | `alternating sine ac generator` |
| Battery | `cell accumulator battery` |
| Diode | `diode rectifier d` |
| LED | `light emitting diode lamp d` |
| Zener | `zener regulator reference` |
| Transistor | `bjt npn pnp q` |
| MOSFET | `fet nmos pmos enhancement q` |
| Meters | `voltmeter ammeter multimeter meter` |

Search matches label, keywords, description and prefix, case-insensitively.

### 5.5 Reference numbering

- On creation, `nextComponentLabel(scene, def.prefix)` scans every `circuitComponent` in the scene for
  names matching `^<prefix>(\d+)$` and returns `<prefix><max+1>`. It does **not** fill gaps left by
  deleted components, so deleting R2 does not make the next resistor R2 again.
- Components sharing a prefix share the counter (D1 diode, D2 LED; Q1 BJT, Q2 MOSFET; V1 DC source,
  V2 AC source). Junctions are never auto-numbered.
- The generated name is written to `NodeBase.name` and is immediately editable in the focus menu. Editing
  never triggers a later renumber.
- **Copy/paste and duplicate preserve labels exactly.** Do not re-enumerate copied components, even when
  the target scene already contains the same reference. This is deliberate: a duplicated sheet, an
  alternate circuit or a copied sub-circuit keeps its user-visible designators. Automatic creation still
  uses `max+1`, so a freshly added component does not collide with the copies.
- Duplicate reference labels are therefore valid and are not an error. No duplicate-label warning is
  emitted for circuit scenes; the inspector may show an informational count if useful.
- Undo/redo restores labels naturally because they are part of the scene snapshot.

---

## 6. Layout pass

### 6.1 Component measurement

`src/layout/build-layout.ts` gets a circuit branch before `measureShape`:

```ts
if (node.kind === "circuitComponent") {
  return measureCircuitComponent(node, scene, measurer, ports);
}
if (node.kind === "circuitJunction") {
  return measureCircuitJunction(node, measurer, ports);
}
```

`measureCircuitComponent`:

1. Resolve the definition from the catalog (unknown kind → a safe fallback box; validation reports it).
2. `center = rectCenter(node.frame)` using the persisted local frame.
3. `outline` = the four local-frame corners rotated around the centre by `node.rotation`.
4. `layout.frame` = axis-aligned bounds of `outline`.
5. For each pin:
   - `point = center + rotate(pinLocal, rotation)`
   - `normal = rotate(normalLocal, rotation)`
   - add a `PortGeometry` with `ref: { kind: "pin", pinId }`, label, point and normal.
6. `primitives` = catalog symbol local primitives, rotated and translated to absolute scene coordinates.
7. Label:
   - `anchor = center + rotate(node.labelOffset ?? def.labelOffset, rotation)`
   - measure `node.name` with `resolveTextStyle(node.style.text, node.textStyle)`;
   - place the label frame centred at `anchor`, kept upright;
   - omit the frame when the name is empty.
8. `bounds = union(layout.frame, labelFrame)` (pins are inside the local frame by construction).
9. `ports` contains exactly the pins, no perimeter ports.

Rotation math (screen y-down, positive clockwise):

```ts
const rotate = (p: Point, degrees: number): Point => {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return point(p.x * cos - p.y * sin, p.x * sin + p.y * cos);
};
```

The label text is deliberately **not** rotated. Reference designators stay readable at every
rotation; only the anchor point travels around the component. This is the conventional schematic
behaviour and avoids upside-down labels at 180°/270°.

### 6.2 Junction measurement

- Persisted `frame` is an `18 × 18` hit box centred on the junction point.
- `center = rectCenter(node.frame)`.
- `layout.frame = node.frame`; `bounds` includes an optional label frame.
- Ports: exactly one `{ kind: "center" }` at `center`, normal `(1, 0)`.
- `radius`: `4.5` scene units for the visible dot; the hit box remains 18 × 18 for easy selection.
- `junctionStyle` is persisted and rendered; `none` renders no dot but keeps the hit box and port.
- Junction labels use the same upright-anchor rule as components, with a default offset of
  `(10, -10)` local units.

Junction frames placed exactly on a wire intersection may be off the grid. `validateScene` exempts
`circuitJunction` from the off-grid warning; free-end junctions are still grid-snapped at creation.
This is intentional: snapping a junction to the grid would pull it off the wire and break the
electrical connection.

### 6.3 Wire layout

- `routing.mode === "straight"` → `[source.point, target.point]` (existing `routeEdge` behaviour).
- No obstacle avoidance, no stub, no bend penalty.
- `sourcePortId` / `targetPortId` resolve to the new pin/centre port ids.
- `bendCount` is 0.
- Wire labels use the existing centre-zone `measureLabel` and collision pass.
- Component and junction label frames are added to the edge-label obstacle list; component
  `layout.frame` is already an obstacle through the existing node-frame list.
- `bounds` is the union of the polyline, labels and bridge extents (see §7).

### 6.4 Port and attachment resolution

`resolveAttachment` needs two new cases:

```ts
if (portRef.kind === "pin") {
  const found = ports[portKey(attachment.nodeId, portRef)];
  return found === undefined
    ? null
    : { point: found.point, normal: found.normal, portId: found.id };
}

if (portRef.kind === "center") {
  const found = ports[portKey(attachment.nodeId, portRef)];
  return found === undefined
    ? null
    : { point: found.point, normal: found.normal, portId: found.id };
}
```

`adjustPerimeterAttachments` already returns early unless the port is `perimeter`, so pins and centres
are left exactly where the symbol places them.

### 6.5 Selection, hit testing and bounds

- NodeSkeleton's generic transparent hit rectangle uses `layout.frame`; for components this is the
  rotated AABB, which is generous but predictable and makes tiny pins easy to reach.
- The selected outline for a component is drawn as a polygon through `layout.outline` instead of the
  generic rectangle, so the selection visibly matches the rotated symbol.
- Four-corner resize handles are suppressed for `circuitComponent` and `circuitJunction`.
- Marquee selection uses `layout.frame` (AABB); a rotated component counts as fully contained when its
  AABB is contained. This is stricter than an exact polygon test but deterministic and easy to explain.
- `placeObjectFrame` needs a small helper for rotated components: obstacles should use the rotated AABB,
  not the persisted local frame. Add `circuitNodeBounds(node)` and use it in the circuit placement path.
- `withNodeFrames` continues to apply local frames for drag previews. Rotation previews use a sibling
  `withNodeRotations(scene, patches)` helper.
- Alignment guides are exact at 0°/90°/180°/270°, where the AABB and local frame edges coincide. At 45°
  they are best-effort: compare AABB candidates for both the moving and other nodes, or suppress
  alignment snapping for rotated components while keeping grid snapping on the local frame. Do not
  silently compare a local edge against a rotated AABB and call it exact.

### 6.6 Fit and content bounds

- `contentBounds` already unions node `bounds` and edge `bounds`; component labels and bridge bumps are
  included there.
- `fitBounds` uses the same generic path; circuit content has no special tails.
- Export padding remains `scene.canvas.exportPadding`.

---

## 7. Crossing bridges (omega hops)

### 7.1 Rule

A crossing is bridged when two wire segments intersect at a point that is not a shared endpoint.
If the intersection is at (or within a small epsilon of) one segment's endpoint, it is treated as a
junction/connection and is **not** bridged. Wires that share a junction node never cross at a
non-endpoint, so they never bridge each other by accident.

### 7.2 Which wire hops

Deterministic over/under rule:

1. If one segment is more horizontal than vertical (`|dx| >= |dy|`) and the other is more vertical,
   the **horizontal** wire owns the hop. The vertical wire passes straight through.
2. If both are horizontal-ish or both vertical-ish, the wire with the lower `(z, id)` tuple owns the
   hop. This is stable across reloads and independent of creation order in all but pathological ties.
3. If the intersection is closer than `radius + 1` to either end of the owner segment, skip the hop
   and leave a plain crossing. This prevents a hop from colliding with a pin, junction or corner.
4. Collinear overlapping segments produce no hop; validation can warn about overlapping wires.

### 7.3 Geometry

The hop is a semicircular “omega” bump spanning `2r` along the owner wire:

```text
        c1            c2
         ·             ·
        /               \
───────from─────at─────to───────   owner wire
              (bridge)
```

```ts
const dir = normalize(sub(b, a));          // owner segment direction
const n = bridgeNormal(dir);                // canonical bump side, see below
const r = clamp(bridgeRadius, 3, min(segmentLength / 4, 12));
const from = sub(hit, scale(dir, r));
const to   = add(hit, scale(dir, r));
const c1   = add(from, scale(n, (4 / 3) * r));
const c2   = add(to,   scale(n, (4 / 3) * r));
```

Bump side is canonical and independent of wire direction:

- horizontal owner (`|dx| >= |dy|`): bump up in screen space (`n = (0, -1)`);
- vertical owner: bump right (`n = (1, 0)`);
- diagonal owner: bump to the left of the segment's canonical direction. Canonicalise the direction
  so `x > 0`, or `x === 0 && y > 0`; then `n = (-dir.y, dir.x)`.

This produces the familiar raised bridge on horizontal wires and a side bridge on vertical ones.
The exact shape is a cubic approximation of a semicircle; one curve is enough and it is identical in
SVG and CeTZ.

### 7.4 Detection pass

New file `src/layout/wire-bridges.ts`, called after `computeEdges`:

```ts
export const computeWireBridges = (
  edges: Readonly<Record<string, EdgeLayout>>,
  junctions: readonly Point[],
  settings: CircuitSettings,
): Readonly<Record<string, readonly WireBridge[]>> => {
  // 1. Flatten every visible circuit edge into segments.
  // 2. Test every segment pair with segmentIntersection(); skip same-edge pairs.
  // 3. Skip shared endpoints, junction hits and near-end hits.
  // 4. Choose the owner using §7.2.
  // 5. Build from/to/c1/c2 and append.
  // 6. Sort each edge's bridges by distance along its polyline.
};
```

Complexity is `O(S²)` for `S` wire segments. A schematic with 200 wires has 200 segments, so this is
trivial. If a scene ever exceeds ~1,000 segments, bucket segments by bounding box/grid cell before the
pair test; that is a pure optimisation and does not change the contract.

### 7.5 Bounds and diagnostics

- Each bridge expands the owner edge's bounds by `radius` in the bump direction.
- `LayoutDiagnostics.edgeCrossings` can be set to the number of bridges (currently always 0).
- The inspector can show “N hops” for a wire or for the scene.

### 7.6 DOM rendering

`Edges.tsx` currently emits a `<polyline>`. Add a path builder:

```ts
const wirePath = (points: readonly Point[], bridges: readonly WireBridge[]): string => {
  // M p0 L from C c1 c2 to L p1 …
};
```

- One `<path>` per wire instead of a polyline when bridges exist (or always, for consistency).
- `stroke` is `edge.style.stroke`; current theme stroke is solid.
- The selected-edge highlight uses the same path so the hop is highlighted too.
- Hit testing still uses the raw polyline points; a click near the bump is within the existing hit
  threshold and selects the wire.

### 7.7 CeTZ rendering

For a wire with bridges, emit one `line` call per unbranched segment and one `bezier` per hop:

```typst
draw.line((x0, y0), (fx, fy), stroke: (paint: black, thickness: 0.75pt))
draw.bezier((fx, fy), (tx, ty), (c1x, c1y), (c2x, c2y),
  stroke: (paint: black, thickness: 0.75pt))
draw.line((tx, ty), (x1, y1), stroke: (paint: black, thickness: 0.75pt))
```

`draw.bezier(start, end, ctrl1, ctrl2, stroke: …)` is available in CeTZ 0.5.3 (verified in
`.typst/packages/preview/cetz/0.5.3/src/draw/shapes.typ`). The live preview uses CeTZ 0.5.2; verify
the same call there during implementation, and fall back to a sampled polyline only if necessary.
No marks are registered or emitted for circuit wires.

---

## 8. Interactions

### 8.1 Add object menu

Keep the existing `AddObjectMenu` for the seven UML/ER kinds. Add a circuit branch, either inside the
same component or as `src/canvas/CircuitAddObjectMenu.tsx`.

Structure:

```text
┌──────────────────────────────────────┐
│ Add component                 Circuit│
│ [ Search components…            ]    │
│ Recently placed                      │
│ [R] [C] [V] [LED] …                  │
│ ┌──────────────────────────────────┐ │
│ │ Symbol  Component      Ref   …   │ │  ← scrollable table
│ │ ▭       Resistor       R     …   │ │
│ │ ═       Capacitor      C     …   │ │
│ │ …                                │ │
│ └──────────────────────────────────┘ │
│ Annotations                          │
│ ▨ Image                              │
│ ▧ Comment                            │
│ Drag from a pin handle to wire.      │
└──────────────────────────────────────┘
```

Details:

- **Search input** is auto-focused, sticky at the top of the menu. Escape closes; ArrowDown moves into
  the table; Enter adds the active row.
- **Table** uses a CSS grid with columns `Symbol | Component | Ref | Description`. Each row is a
  `<button role="menuitem">` with a generated SVG preview from the current standard.
- **Recent components** are shown only when the search is empty. They are component template ids,
  de-duplicated, capped at 6, stored in `localStorage` under `umler.circuit.recent.v1`, and updated
  whenever a circuit component is added. They are not scene data.
- **Image** is always present below the table (and Comment for parity with other diagram types). These
  reuse `createObjectFromTemplate(scene, "image" | "comment", …)`.
- **Scroll**: the table body scrolls (`max-height: min(320px, 45vh)`), not the whole viewport. The
  existing add-menu position clamp must be updated from its hard-coded 474 px to the new menu height.
- **No results**: show “No components match ‘…’” and keep the Image row available.
- **Keyboard/a11y**: `aria-label`, `aria-activedescendant`, Up/Down/Enter/Escape, no mouse required.
- **Standard preview**: the menu receives the current `CircuitStandard` so the resistor row matches the
  left-panel choice.

`handleAddObject` in `App.tsx` records the picked component in the recents store after a successful
create. The recent list is written through a small `use-circuit-recents.ts` hook so the menu stays a
pure view.

Circuit template ids use a template-literal union, `circuit:${CircuitComponentKind}`, so
`ObjectTemplateId` stays exhaustive and `createObjectFromTemplate` can dispatch to the catalog without
a second lookup table. Each `ObjectTemplate` also carries `componentKind` and `keywords` for the table
and search; the seven existing diagram families keep their current entries unchanged.

### 8.2 Left panel circuit menu

New `src/app/CircuitPanel.tsx`, rendered instead of `LayoutPanel` when the scene is a circuit:

```text
Circuit
[ IEC / EU ] [ ANSI / US ]
┌  ──/\/\/\──  ┐  (live resistor preview)
Wire crossings: bridged
```

- Segmented buttons call `onStandardChange`.
- The preview is generated from the selected standard’s resistor primitive.
- “Wire crossings: bridged” is a read-only hint in the first cut; the underlying
  `circuit.crossings` setting leaves room for a later toggle.
- Changing the standard is one `setScene` revision (undoable) and restyles every component because the
  layout pass resolves symbols from `scene.circuit.standard`.
- `ThemePanel` stays below it unchanged; component fill/text/theme still flow through `theme.shape`.

`LayoutPanel` is hidden for circuit scenes. `runAutoLayout` gets an early guard:

```ts
if (scene.meta.diagramKind === "circuit") {
  setLayoutNote("Circuit diagrams are wired manually; automatic layout is disabled.");
  return;
}
```

### 8.3 Drawing a wire from a pin

- Component pins and junction centres appear in `PortHandles` when the object is selected or hovered,
  exactly like row/spine handles today.
- `beginEdgeDraw` is unchanged; it starts a `draw` interaction with the source `PortGeometry`.
- `findDrawTarget` resolves:
  1. nearest port within 18 screen px → that pin/centre;
  2. a containing component with no perimeter ports → no node target (do not attach to the body);
  3. nearest other wire → `{ edgeId, t }` (handled by §8.4);
  4. otherwise empty canvas.
- For circuit scenes, an empty target is valid **only after a deliberate drag**. Both checks live in
  `canExtendToEmpty()` (`src/canvas/circuit-draw.ts`) and must pass before a no-dot Node is created:
  - `MIN_EXTEND_SCREEN_PX = 18` — pointer travel in screen space, so a click or a few pixels of jitter
    never creates a node;
  - `MIN_EXTEND_WORLD = max(2 * grid.size, 18)` scene units — distance from the source pin/centre handle
    to the snapped candidate point.
  These guards apply only to the empty-canvas `none`-node path. Dropping on a pin, junction centre or
  another wire connects normally even with a short drag, because the target is explicit.
- While dragging over empty canvas, do **not** show the ghost junction until the threshold is passed.
  Before that, show only the draft wire and the highlighted source handle.
- If the user releases below the threshold, cancel the draw: no wire, no junction, no scene revision.
  Leave the scene and selection unchanged and show the status note “Drag further from the pin to create a
  wire.” Never create a very short wire or a node that the user did not clearly ask for.
- Once the threshold is passed and the pointer is released on empty canvas, `CanvasStage` calls
  `onExtendWireToPoint(source, worldPoint)`; `App` performs the scene edit below.
- Drop on empty after the threshold passes:
  1. snap the point to the grid (if snapping is enabled);
  2. if it is within ~4 pt of an existing junction, attach to that junction;
  3. otherwise create a `circuitJunction` with `junctionStyle: "none"` and an empty name;
  4. create a wire from the source pin/centre to the junction’s `center` port;
  5. commit one revision and select the new wire.
- Dropping inside a component body but not on a pin does nothing (status note: “Drop on a pin to
  connect”). This avoids silently creating a node on top of a symbol.

### 8.4 Wire-to-wire connection (junction + split)

When the draw target is another wire:

1. Resolve the exact intersection point from `layout.edges[edgeId].points` and `t` (do **not** grid-snap
   it; snapping would move the junction off the wire).
2. Resolve near-end hits first: if `t <= 0.02` or `t >= 0.98`, the target wire already ends at a pin or
   junction. Attach the new wire to that endpoint attachment instead of creating a second junction. This
   prevents zero-length split segments when the user drops near an existing wire end.
3. Find an existing junction within `max(1, grid / 2)` of the point. If one exists, reuse it.
4. Otherwise create a `circuitJunction` at the exact point with `junctionStyle: "filled"` and an empty
   name.
5. Split the target wire atomically:
   - the **original edge keeps its id, source, labels and style**, but its target becomes the new
     junction;
   - a new edge from the junction to the original target is created, copying routing/style/semantic and
     starting with no labels;
   - if the original had a centre label, keep it on the source-side half and re-anchor it to `t = 0.5`
     of that half (so it does not land on the junction);
   - if the original had waypoints (not expected in the first cut), distribute waypoints around the
     split point so both halves keep the original path.
6. Create the new wire from the source pin to the junction.
7. Commit one revision. Select the new wire (and leave the junction unfocused) with a status note
   “Junction created and wires split.”
Invariants:

- No edge-to-edge attachments are left in a circuit scene; validation treats them as a warning/error.
- No duplicate junction nodes at the same point.
- Re-running the edit is idempotent if the same point/junction is hit.
- The operation must be a single `setScene` call so undo restores the original single wire and removes
  the new junction/wire together.

This logic belongs in `src/model/circuit-wires.ts`, not in `CanvasStage`:

```ts
export interface CircuitWireResult {
  readonly scene: SceneDocument;
  readonly junctionId: NodeId;
  readonly newEdgeId: EdgeId;
}

export const connectCircuitWireToWire = (
  scene: SceneDocument,
  source: PortAttachmentRef,
  targetEdgeId: EdgeId,
  point: Point,
): CircuitWireResult | null;

export const connectCircuitWireToPoint = (
  scene: SceneDocument,
  source: PortAttachmentRef,
  point: Point,
  junctionStyle: CircuitJunctionStyle,
): CircuitWireResult | null;
```

`App.tsx` resolves the routed point from `layout` and calls these helpers.

### 8.5 Rotation

- A rotate handle appears when exactly one **component** is focused/selected:
  - anchor: outside the rotated AABB, at the top-right corner plus a screen-constant 22–26 px offset;
  - glyph: circular arrow;
  - `data-rotate-handle`, `aria-label="Rotate component"`, title with the current angle.
- Pointer down starts a `rotate` interaction:

```ts
{
  kind: "rotate",
  pointerId,
  nodeId,
  startPointerAngle,
  startRotation,
  lastRotation,
}
```

- On pointer move: `rotation = snap45(startRotation + (pointerAngle - startPointerAngle))`, normalised to
  `0..315`. Use a screen-space angle from the component centre; the handle does not have to follow the
  cursor exactly.
- The layout preview applies the transient rotation through `withNodeRotations`, so pins, wires and
  labels follow live. This must not create history entries.
- On pointer up: one `onUpdateNode(nodeId, { rotation })` commit. On cancel/Escape: discard the preview.
- Alignment guides and grid snapping do not apply to rotation.
- Keyboard accessibility: the focus menu also exposes “Rotate −45°” and “Rotate +45°” buttons, plus a
  readout of the current angle, so the handle is not the only way to rotate.
- Junction nodes cannot be rotated. Wires follow their pins automatically.

### 8.6 Focus menus

`NodeFocusMenu` gets two explicit branches before the generic object fallback.

**Component**

```text
Resistor — R1                         [lock] [×]
[ Reference label: R1            ]
[ Rotate −45° ] 45° [ Rotate +45° ]
Text style (existing controls)
Delete object
```

- Label field edits `node.name`; if cleared, the label disappears but the component remains.
- Rotation buttons call `onUpdateNode(node.id, { rotation })`.
- The existing Text style controls operate on `node.textStyle`.
- The existing lock/delete actions remain.

**Junction**

```text
Node                                    [lock] [×]
Style: [● solid] [○ hollow] [ none]
[ Label: … ]
Text style
Remove dot (keep wires)     Delete object
```

- Style buttons write `junctionStyle`.
- “Remove dot” sets `junctionStyle: "none"`, preserving attached wires.
- “Delete object” uses the existing behaviour: the node and its attached wires are deleted. This is
  consistent with every other scene object. Merging two wires automatically is a future convenience,
  not part of the first cut.

### 8.7 Line menu and endpoint menus

- Selecting a wire shows the two endpoint handles (existing `EndpointHandle`), so endpoints can be
  reattached. Reattaching to a pin or junction centre attaches directly; reattaching onto another wire
  reuses the §8.4 junction/split path; reattaching into empty space creates a `none` junction with the
  same §8.3 rule, including the minimum-drag guard. A short drop keeps the original endpoint and changes
  nothing. The scene never gains a free endpoint or an edge-to-edge circuit attachment.
- **Do not open `EdgeEndpointPopover` for circuit wires.** There are no markers or cardinalities.
  A click on an endpoint without dragging should be a no-op or start reattachment; implement a
  circuit guard where `openTerminalMenu` is called.
- The line menu uses `EdgeInspector` with a `variant="circuit"` prop:
  - centre label field (placeholder “wire label”);
  - text style for the label;
  - delete wire;
  - **no** source/target labels, marker controls, stroke pattern, width, routing selector, A* reroute.
- Double-clicking the centre label still opens the line menu and focuses the label (existing behaviour).
- Label dragging and manual offsets keep working through the existing edge-label drag path.

### 8.8 Editing labels

- Double-clicking a component or junction label sets the existing `CanvasTextTarget` `{ kind: "nodeName" }`
  and opens the focus menu with the label field focused/selected.
- Wire labels use the existing centre-label hit layer and line menu.
- No new text target kinds are required for the first cut.

### 8.9 Copy, paste, duplicate and undo

- Same-scene copy/paste uses the existing clipboard: nodes plus wires whose both endpoints are selected.
  Junction nodes must be selected to copy the wires attached to them.
- **Copy/paste and duplicate must preserve component labels exactly.** Do not call
  `nextComponentLabel` on pasted objects and do not re-enumerate them, even when the copied `R1` lands
  next to an existing `R1`. The copies retain the user-visible designators from the source. This applies
  to same-scene paste and to paste into another circuit scene.
- Multiple components with the same reference label are valid in the document. Validation does not treat
  duplicate circuit labels as an error or a warning; if the inspector wants to surface them, it should do
  so as an informational count, never by rewriting the labels.
- Cross-diagram paste: circuit components are not convertible to UML/ER objects in the first cut.
  `convertNodeForDiagram` should return `null` for circuit component/junction targets, and the existing
  toast explains that the object cannot be converted. Image and comment still convert as today.
- Undo/redo already snapshots the whole scene, so wire splits, junction creation and rotation are
  naturally atomic as long as each user action is one `setScene` call.

### 8.10 Delete and keyboard

- Delete on a selected component/junction follows existing scope rules: node plus attached wires.
- Delete on a selected wire deletes only the wire.
- The focus menu’s “Remove dot” is the non-destructive branch-point removal.
- The rotate and junction-style controls are real buttons, so they are keyboard reachable.

---

## 9. Rendering

### 9.1 DOM

New `src/canvas/CircuitSymbols.tsx`:

- `CircuitPrimitiveView` maps `CircuitPrimitive` to SVG `<path>/<circle>/<rect>/<text>`.
- `CircuitSymbolPreview` renders a catalog symbol into a small viewBox for the add menu and panel.
- `CircuitJunctionBody` draws solid/hollow/none dots and the optional label.
- `CircuitComponentBody` draws the primitives, label and optional future value.

`NodeSkeleton` switch adds `case "circuitComponent"` and `case "circuitJunction"`. The generic hit rect
and selection rect continue to use `layout.frame`; for components, replace the selection rectangle with
a polygon through `layout.outline` and suppress resize handles.

Layer order:

1. grid/background;
2. wires (with bridge paths);
3. components and junctions (dots cover wire ends);
4. wire labels;
5. selection overlays, pin handles, rotate handle, ghost junction, menus.

This matches the existing export order (`drawEdges` before `drawNodes` for non-sequence diagrams).

### 9.2 CeTZ

`src/export/cetz.ts`:

- `drawCircuitPrimitive` maps the primitive union to `draw.line`, `draw.circle`, `draw.rect`,
  `draw.bezier` and `draw.content`; use the node’s `style` and `fit.scale`.
- `drawCircuitComponent` draws the primitives and the component label; no editor overlays.
- `drawCircuitJunction` draws the dot (unless `none`) and label.
- Pin anchors: emit `draw.anchor("pin_<id>", …)` for every pin; centre anchor for junctions.
- Skip the generic north/east/south/west anchors for circuit nodes (they are not meaningful for a
  rotated symbol).
- `drawEdge` branches on `layout.bridges`:
  - no bridges → one `draw.line` as today;
  - bridges → alternating line/bezier calls as in §7.7;
  - no markers/mark registrations.
- Wire labels use the existing `drawEdgeLabel`.
- Component and junction labels use the existing text expression helpers so escaping, fonts and colours
  stay consistent.

The serializer must not re-run the standard switch. If `scene.circuit.standard` changes, the layout
pass produces a different primitive list and the exporter follows automatically.

### 9.3 No editor-only geometry in export

The following stay DOM-only and must never appear in CeTZ:

- selection outlines and resize handles;
- rotate handle;
- pin handles;
- ghost junction while drawing;
- junction style “none” hit box;
- lock badge (existing rule).

---

## 10. Persistence, validation and migration

### 10.1 Persistence

- Keep `schemaVersion: "umler.scene/1"`.
- Add `circuit` to `DIAGRAM_KIND_LABELS` so project/scene import accepts it.
- `circuit` settings are optional; `resolveCircuitSettings` supplies defaults for older or partial files.
- New node kinds/port refs/edge family are strict: an older build will reject a circuit scene at
  validation rather than render it incorrectly. That is the desired failure mode.
- Round-trip project/scene export includes the new fields automatically because the document is plain
  JSON; add a persistence assertion for a circuit scene.

If a future change needs to break the schema, bump to `umler.scene/2` and add a migration; this plan
does not require it.

### 10.2 Validation additions

`src/model/validate.ts`:

- `NODE_KINDS` gains `"circuitComponent"` and `"circuitJunction"`.
- `EDGE_FAMILIES` gains `"circuit"`.
- `circuit.standard` is `"iec" | "ansi"`; `crossings` is `"bridge" | "plain"`; `bridgeRadius` is finite
  and `>= 0`.
- Component `component` is a known catalog kind; `rotation` is one of the eight values.
- Pin refs:
  - the node must be a `circuitComponent`;
  - `pinId` must exist in the catalog definition.
- Centre refs:
  - the node must be a `circuitJunction`.
- Circuit wires:
  - both endpoints must be a pin or a junction centre (or a free endpoint during migration; warn);
  - markers must be `none` (warning if not);
  - `routing.mode` should be `straight` and `waypoints` empty (warning otherwise).
- Duplicate component reference labels: **allowed**, including after copy/paste/duplicate. Do not emit an
  error or warning; the editor must not renumber copies. Automatic creation still uses `max+1`.
- Off-grid frames: exempt `circuitJunction` as described in §6.2.
- Overlapping wires: warning if two collinear wires overlap for more than a few points.
- A wire attached to the same node at both ends: existing self-node check already rejects it.

### 10.3 Fixtures

Add a `CIRCUIT_DIVIDER` fixture (voltage source → two resistors → LED loop, plus one wire crossing and
a junction) to `src/fixtures/index.ts`. Include it in `STEP1_FIXTURES` so `npm run check` validates it,
and update the fixture counts in the README/verification output if that output is kept in sync.

If changing `STEP1_FIXTURES` is too disruptive for the existing count assertions, add it as a separate
`CIRCUIT_FIXTURES` export and validate it from `scripts/test-circuit.ts`; the important part is that at
least one circuit scene is exercised by CI.

---

## 11. File-by-file change map

### 11.1 New files

| Path | Responsibility |
|---|---|
| `src/model/circuit.ts` | Component kind union, standard/settings, rotation type, junction style, prefix helpers, `nextComponentLabel`. |
| `src/model/circuit-catalog.ts` | Pure component definitions: size, pins, prefix, keywords, label offset, IEC/ANSI symbol primitives. |
| `src/model/circuit-wires.ts` | Wire/junction factories, `connectCircuitWireToWire`, `connectCircuitWireToPoint`, split/reuse logic. |
| `src/layout/circuit.ts` | Rotation math, absolute pin/outline/primitive/label resolution, `measureCircuitComponent`, `measureCircuitJunction`. |
| `src/layout/wire-bridges.ts` | Segment intersection, over/under rule, bridge geometry, per-edge bridge map. |
| `src/canvas/CircuitSymbols.tsx` | Primitive renderer, component/junction bodies, add-menu/panel previews. |
| `src/canvas/circuit-draw.ts` | `MIN_EXTEND_SCREEN_PX` / `MIN_EXTEND_WORLD`, `canExtendToEmpty()` guard shared by the draw and reattach paths. |
| `src/canvas/CircuitAddObjectMenu.tsx` | Searchable, scrollable circuit palette (or a circuit branch inside `AddObjectMenu.tsx`). |
| `src/app/CircuitPanel.tsx` | IEC/ANSI switch and preview. |
| `src/app/use-circuit-recents.ts` | localStorage-backed recent component list. |
| `scripts/test-circuit.ts` | Circuit model/layout/bridge/export assertions. |

### 11.2 Files to modify or verify

| Path | Change |
|---|---|
| `src/model/scene.ts` | `DiagramKind` + `"circuit"`, label, optional `CircuitSettings`, default scene settings. |
| `src/model/nodes.ts` | New node interfaces and union membership; imports `CircuitComponentKind`, `Rotation45` and `CircuitJunctionStyle` from `circuit.ts`. |
| `src/model/edges.ts` | `PinPortRef`, `CenterPortRef`, port-key cases, `EdgeSemantic` circuit family, `edgeDisplayName`. |
| `src/model/layout.ts` | Circuit layout types, `CircuitPrimitive`, `WireBridge`, `EdgeLayout.bridges`. |
| `src/model/index.ts` | Re-export `circuit.ts`, `circuit-catalog.ts`, `circuit-wires.ts`. |
| `src/model/object-catalog.ts` | Circuit templates, `componentKind` on templates, `createObjectFromTemplate` circuit cases, circuit-aware placement bounds. |
| `src/model/edge-create.ts` | Circuit wire factory; circuit branch before the other diagram families. |
| `src/model/edits.ts` | Circuit settings edit, rotation/junction-style update helpers if generic patch is insufficient. |
| `src/model/validate.ts` | New kinds/family/port refs/settings rules; duplicate circuit labels are allowed. |
| `src/model/persistence.ts` | Accept `circuit` diagram kind and settings; no schema bump. |
| `src/model/convert.ts` | Circuit target/source conversion policy (return `null` for components/junctions). |
| `src/model/clipboard.ts` | No circuit-specific renumbering; the generic clipboard preserves labels and remaps only ids/refs. |
| `src/layout/build-layout.ts` | Circuit measurement branches, pin/centre port resolution, bridge pass, circuit label obstacles. |
| `src/layout/auto-layout.ts` | Early return/no-op for circuit scenes (App also guards). |
| `src/layout/index.ts` | Re-export `circuit.ts` and `wire-bridges.ts`. |
| `src/canvas/AddObjectMenu.tsx` | Delegate to the circuit palette for `diagramKind === "circuit"` (or change `CanvasStage` to render the new component directly). |
| `src/canvas/PortHandles.tsx` | Pin colour/fill and handle labels for `kind: "pin"` / `"center"`. |
| `src/canvas/NodeSkeleton.tsx` | Circuit body case, rotated selection outline, no resize for circuit. |
| `src/canvas/CanvasStage.tsx` | Circuit empty-target draw, ghost junction, endpoint-menu guard, rotate interaction/handle, circuit preview rotation. |
| `src/canvas/Edges.tsx` | Wire bridge path builder, selected-edge path, circuit edge props. |
| `src/canvas/EdgeEndpointPopover.tsx` | Do not offer terminal menus for circuit wires. |
| `src/canvas/NodeFocusMenu.tsx` | Component and junction focus branches (label, rotation, style, remove dot). |
| `src/app/App.tsx` | Circuit add handler/recents, standard change, wire callbacks, rotation preview/commit, auto-layout guard, panel switch. |
| `src/app/EdgeInspector.tsx` | `variant="circuit"` (wire label only, no markers/stroke/routing). |
| `src/app/SceneDialog.tsx` | Circuit type entry, icon, short label, order. |
| `src/app/LayoutPanel.tsx` | No change if App simply hides it for circuit; otherwise accept a disabled note. |
| `src/styles.css` | Circuit panel, searchable table, recents, rotate handle cursor, junction style controls, 8-type grid. |
| `src/export/cetz.ts` | Circuit primitive/junction/component/wire/bridge emitters and pin anchors. |
| `src/fixtures/index.ts` | Circuit fixture and validation list. |
| `package.json` | `test:circuit` script and inclusion in `check`. |
| `README.md` | Only after implementation: feature list, docs table row, verification counts. |

---

## 12. Phased implementation plan

Sizes are relative, not commitments: **S** ≈ half a day, **M** ≈ 1–2 days, **L** ≈ 2–3 days for a
developer already familiar with the codebase.

### M0 — Contract and catalog (S/M)

- Add model types, `DiagramKind`, settings and default resolver.
- Write the component catalog and primitive contract.
- Add a circuit fixture and validation skeleton.
- **Exit:** `npm run typecheck` passes with the new union members; a circuit scene validates; catalog
  symbol previews can be rendered from a unit test.

### M1 — Layout and pins (M/L)

- Implement rotation math, component/junction measurement, pin/centre ports, absolute primitives,
  label frames and bounds.
- Add `buildLayoutSnapshot` branches and `resolveAttachment` cases.
- Add tests for pin positions at 0°/45°/90°, AABB bounds, label placement and center port.
- **Exit:** a circuit fixture produces a complete `LayoutSnapshot`; pins land where expected; no
  existing fixture changes its snapshot output.

### M2 — DOM rendering (M)

- `CircuitSymbols.tsx`, `NodeSkeleton` circuit bodies, selected outline, junction dots.
- Render the fixture with IEC and ANSI standards.
- **Exit:** browser shows components at all rotations, labels upright, correct pins; selection and
  marquee work; resize handles are absent.

### M3 — Palette, panel and numbering (M)

- Circuit add-menu table, search, recents, image/comment rows.
- `CircuitPanel` standard switch; hide layout panel; auto-layout guard.
- `SceneDialog` circuit type/icon.
- Auto-numbering at creation only; copy/paste and duplicate preserve every label exactly.
- **Exit:** add/search/recent flows work by keyboard and mouse; switching standard restyles existing
  components; new components get unique R/C/L/V references while copied components keep their labels.

### M4 — Wires, junctions and bridges (L)

- Circuit wire factory and `createWire`.
- Empty-target extension (with the minimum-drag guard) + ghost junction.
- Wire-to-wire junction/split/rewire.
- Bridge detection and DOM path rendering.
- Line menu circuit variant; endpoint-menu guard.
- **Exit:** all three wire behaviours work; crossing hops are deterministic; undo restores a split;
  validation rejects edge-to-edge circuit wires.

### M5 — Rotation interaction (M)

- Rotate handle, rotate interaction, preview/commit, keyboard rotate buttons.
- Pins/wires/labels follow live; no history entries during preview.
- **Exit:** every 45° step is exact; Escape cancels; one undo reverts one rotation; connected wires stay
  attached at every angle.

### M6 — CeTZ export and persistence (M/L)

- Primitive/junction/component/wire/bridge emitters.
- Pin anchors, no compass anchors for circuit, no marks.
- Persistence round-trip and validation.
- **Exit:** `serializeSceneToCetz` produces balanced Typst for the circuit fixture; the live preview
  compiles; scene/project import round-trips; selection export includes only selected circuit objects.

### M7 — QA, accessibility and polish (M/L)

- Add `scripts/test-circuit.ts` to `npm run check`.
- Browser QA on all requirements, including edge cases (rotated 45°, off-grid junction, multiple hops,
  standard switch, recents, search).
- Performance check with ~200 components/wires.
- **Exit:** full `npm run check` green; Chrome DevTools checklist complete; no regressions in the six
  existing fixture layouts.

Total rough effort: **10–15 focused development days**, plus review and browser QA. The largest risk is
M4 (wire splitting + bridge parity), followed by M5 (rotation preview plumbing).

---

## 13. Test plan

### 13.1 Model/unit tests (`scripts/test-circuit.ts`)

- `nextComponentLabel`:
  - empty scene → `R_1`;
  - `R_1`, `R_3` → `R_4` (max+1, no gap reuse);
  - shared prefixes (`D1` diode, `D2` LED) → `D3`;
  - user label `Load` ignored by the counter.
- Numbering is creation-only:
  - a scene containing two components both named `R_1` still returns `R_2` for the next add;
  - no renumber helper exists and no paste path rewrites labels.
- Component geometry:
  - pin `A` at 0° is left, at 90° is top (screen orientation) etc.;
  - pin normals rotate;
  - AABB grows correctly at 45°.
- Junction factory:
  - centered frame, centre port, all three styles;
  - off-grid point preserved.
- Wire factory:
  - `family: "circuit"`, `mode: "straight"`, markers none, style solid.
- `connectCircuitWireToPoint`:
  - creates a `none` junction at a grid-snapped point;
  - reuses a nearby junction;
  - returns a valid wire with both attachments.
- `connectCircuitWireToWire`:
  - creates a `solid` junction at the exact intersection;
  - original edge keeps its id and now targets the junction;
  - second half reaches the original target;
  - centre label stays on the source half;
  - one revision; no duplicate junction on repeat.
- Validation:
  - valid circuit scene passes;
  - unknown component kind errors;
  - rotation 30° errors;
  - pin id on the wrong component errors;
  - centre ref on a component errors;
  - duplicate reference labels are allowed and produce no diagnostic;
  - edge-to-edge circuit wire warning.
- Extend-distance guard (`canExtendToEmpty`):
  - a candidate below `MIN_EXTEND_SCREEN_PX` / `MIN_EXTEND_WORLD` is rejected;
  - a candidate past both thresholds is accepted;
  - the guard does not apply to explicit pin/junction/wire targets.
- Persistence:
  - scene file round-trip preserves settings, rotation, junction style, labels;
  - project round-trip preserves a circuit scene among UML scenes.
- Clipboard:
  - copy/paste a component + junction + wires keeps topology;
  - copy/paste preserves labels exactly, including duplicates next to an existing label;
  - duplicate does not renumber and does not mutate the source scene.
- Bridge pass:
  - horizontal/vertical crossing → one hop on the horizontal wire;
  - shared endpoint → no hop;
  - junction at the intersection → no hop;
  - two bridges on one wire are ordered along the segment;
  - bridge radius clamps on short segments;
  - owner selection is deterministic.

### 13.2 Layout tests (`scripts/test-layout.ts`)

- Circuit fixture: node count, port count, edge count.
- Pin ports exist with `kind: "pin"`; no perimeter ports for components.
- Junction has exactly one centre port.
- Rotated component's `layout.frame` is the AABB; `outline` has four points; bounds include the label.
- Wires attach to the rotated pin positions (not the unrotated ones).
- No existing fixture snapshot regressions.

### 13.3 CeTZ tests (`scripts/test-cetz.ts`)

- Circuit output contains no marker registrations and no `mark:` on wires.
- Component primitives emit line/circle/rect/bezier/content calls.
- Rotated pin anchors use the resolved coordinates.
- Junction dot appears only for solid/hollow; `none` emits nothing.
- Bridge output alternates `draw.line` and `draw.bezier`.
- Standard change changes resistor primitives (rect vs zigzag) but not pins.
- Selection export includes only selected components/wires.
- Balanced braces/brackets/parens (existing helper).

### 13.4 Browser QA (Chrome DevTools)

- Create a circuit scene from the Scene dialog; cancel/reopen.
- Open Add object: search “ind”, add an inductor; confirm recent list contains it; search a miss and
  confirm the empty state; add Image from below the table.
- Confirm the table scrolls with a long result list and keyboard navigation works.
- Switch IEC → ANSI and confirm every resistor/potentiometer restyles while pins/wires stay attached.
- Drag a wire from a pin to another pin.
- Click/short-drag from a pin and release on empty canvas: confirm no Node and no wire are created.
- Drag a wire well clear of the pin to empty space and confirm a no-dot Node is created; drag from that
  Node onward.
- Drag a wire to the middle of another wire and confirm a filled junction, split wires and unchanged
  topology; undo and confirm the original wire returns.
- Cross two wires without touching and confirm the omega hop; connect them and confirm the hop is
  replaced by a junction.
- Focus a component, drag the rotate handle through several 45° steps, confirm wires follow and labels
  stay upright; Escape cancels; undo reverts one rotation.
- Give a component a custom label; verify numbering still avoids it.
- Copy a component and paste it; confirm the copied label is unchanged even when it duplicates an
  existing reference, and no renumber warning or toast appears.
- Give a wire a centre label; drag it; reopen and edit it.
- Test 45° and off-grid junctions; confirm no validation errors.
- Export the circuit scene and compile the preview; confirm browser/CeTZ parity for rotation, hop,
  junction style and labels.

### 13.5 Commands

```bash
npm run typecheck
npm run validate:scene
npm run test:circuit
npm run test:layout
npm run test:cetz
npm run check
```

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Rotation touches many axis-aligned assumptions (marquee, hit testing, anchors, export) | High | Keep persisted frame unrotated; expose AABB `layout.frame` + rotated `outline`; gate new behaviour to circuit; add regression tests for existing fixtures. |
| Wire split is a multi-entity edit | High | One pure helper returning a new scene; one `setScene` revision; idempotent junction reuse; focused unit tests. |
| Bridge geometry differs between DOM and CeTZ | High | Resolve bridges in layout and share `from/to/c1/c2`; emit SVG `C` and CeTZ `bezier` from the same data; compile-check both. |
| CeTZ 0.5.2 preview lacks `bezier` | Medium | Verify early; fallback is sampled polyline points (still from the same bridge geometry) with no contract change. |
| Fixed symbol size conflicts with the existing corner-resize UX | Medium | Suppress resize handles for circuit nodes; make “no resize” explicit in the UI; add an explicit scale field only if needed later. |
| Junction placed off-grid breaks grid validation | Medium | Exempt junction frames from the off-grid warning; snap only free-end junctions; document why. |
| Duplicate labels after copy/paste | Low | Copy/paste must preserve labels exactly; duplicates are valid, creation still uses `max+1`, and no renumber pass exists. |
| Accidental no-dot Node from a click/short drag | High | Require both a screen-space pointer travel and a world-space distance from the source handle before creating a `none` junction; cancel silently otherwise. Test at multiple zoom levels. |
| Add menu overflows small viewports | Low | Sticky search + scrollable table body; update the hard-coded placement clamp; max-height via CSS. |
| Standard switch changes topology accidentally | High conceptually | Standard is only a symbol selector; pins/topology are catalog constants; test that pins and edges are unchanged when switching. |
| Edge semantic union expansion breaks exhaustive switches | Low | TypeScript compiler finds them; add `circuit` to `edgeDisplayName`, validation and menu gates. |
| Cross-diagram paste of circuit objects | Low | Return `null` from conversion; existing warning toast explains it. |
| Performance of O(S²) bridges | Low | Typical schematics are small; bucket by grid cell if needed; no change to output. |
| Accessibility of a canvas rotate handle | Medium | Add rotate ±45° buttons and a readout in the focus menu, plus keyboard add-menu navigation. |

---

## 15. Decisions and open questions

These are the defaults this plan assumes. They can be changed before M0 without invalidating the
architecture.

1. **Default standard:** IEC/EU. Confirm whether a new circuit scene should start in IEC or ANSI.
2. **Reference prefixes:** R, C, L, RV, V (DC/AC), I, B, D (diode/LED/zener), Q (BJT/MOSFET), VM/AM.
   Confirm the meter and transistor prefixes; the rest are conventional.
3. **Component set:** the 19 entries in §5.1. Confirm whether more diode/MOSFET variants are needed in
   the first cut.
4. **Wire geometry:** straight only, no obstacle avoidance and no 45° wire snap. Confirm whether wires
   should snap to 45° while drawing (this is easy to add later).
5. **Labels:** reference label only; no value line in the first cut. Confirm whether `10 kΩ`-style
   values are required now.
6. **Label rotation:** labels stay upright; only their anchor rotates. Confirm this matches the desired
   schematic look.
7. **Delete junction:** delete object + attached wires, with an explicit “Remove dot (keep wires)”
   action. Confirm whether automatic merge of two wires is required.
8. **Bridge rule:** horizontal wire hops, vertical passes through. Confirm the convention.
9. **Standard scope:** scene-level only, no per-component override. Confirm whether a mixed-standard
   scene is required.
10. **Annotations:** Image is required below the table; Comment is included for parity. Confirm whether
    Comment should be omitted for circuit diagrams.
11. **Export:** circuit scenes are exported to CeTZ exactly like the other diagram types. Confirm that
    the export is in scope for the first release.
12. **Naming in UI:** the dot object is called “Node” in the palette and “Junction” in implementation.
    Confirm the preferred user-facing term.
13. **Copy/paste labels:** preserve labels exactly; never re-enumerate pasted or duplicated components.
    This is fixed by the current brief, not an open question.
14. **Empty-drop threshold:** require both 18 screen px of pointer travel and at least two grid cells of
    world distance from the source handle before creating a `none` junction. Constants are tunable, but
    the guard itself is required.

---

## 16. Post-implementation refinements

The first implementation round was followed by eight refinements. This section is the current
behaviour; where earlier sections differ, this section wins.

1. **Wire thickness matches components.** Circuit wires use the component stroke width and scale with
   zoom like the symbol strokes (no `non-scaling-stroke` for circuit wires). The CeTZ exporter also uses
   the component stroke for circuit edges.
2. **Hovered component handles are hidden while a wire is selected.** Endpoint handles stay available,
   so the line can be dragged away and disconnected without pin handles intercepting the pointer.
3. **Occupied-pin junctions.** When a wire is connected to a component pin that already has a direct
   wire, a small filled junction is placed one grid square outward along the pin normal. Existing direct
   wires are retargeted to it, a short pin-to-junction stub keeps the connection, and the new wire starts
   or ends at the junction. Reusing a pin that already has such a terminal junction reuses it.
4. **Double-click reroute creates corner nodes.** Double-clicking a circuit wire still switches it to an
   orthogonal A* route, but the resolved route is split into straight segments with an invisible
   (`junctionStyle: "none"`) junction at every interior corner. The corner nodes are real scene nodes and
   can be used for later branching.
5. **Typst-style label scripts.** Circuit labels and wire labels support `_` and `^`:
   - `R_1` → R with subscript 1;
   - `R_"12"` → subscript 12;
   - `R_"12"_"34"` → sequential subscript runs;
   - `V^2` → superscript.
   A backslash escapes the next character. Auto-numbering now produces `R_1`, `C_2`, `V_1`, etc. The
   Canvas renders segments as SVG `tspan`s with `baselineShift`; the serializer emits `#sub("…")` /
   `#super("…")`.
6. **Contextual hints.** Circuit wire menus say “Wire” / “Wire options” / “Wire label” and use an
   `e.g. out or V_1` placeholder; circuit component/junction label fields show an `R_1` / `R_"12"`
   placeholder instead of relationship wording.
7. **One-grid-square leads and grid-aligned pins.** Two-terminal leads are 9 units long: resistor/coil
   pins at ±27 with a ±18 body; capacitor pins at ±18 with plates at ±9; diode/LED/zener pins at ±18
   with a ±9 body; vertical sources/meters pins at ±27 with an 18-radius circle; battery outer plates at
   ±18. Frame sizes are multiples of 18 so every pin lands on the 9-unit grid when the frame is
   grid-placed. Transistor and MOSFET pins are all grid multiples; their leads keep the envelope
   footprint.
8. **Junction variants.** `filled` is a new small filled dot and is the default. The former filled dot
   is now `solid`, displayed as **Filled XL**. `hollow` and `none` remain. New junctions created by
   wire-to-wire, occupied-pin and pin-branch edits use the small `filled` style; reroute corner nodes use
   `none`.
9. **Nested scripts render and export correctly.** Sequential scripts increase their depth, so
   `R_"12"_"34"` renders the second run smaller and lower in the canvas. The serializer keeps a
   first-level `#sub`/`#super` content block and emits a sized, baseline-shifted `#text` run for deeper
   levels.
10. **All pins are grid-aligned.** Component frames are multiples of 18 and all pin coordinates are
    multiples of the 9-unit grid, including the potentiometer wiper and all three transistor/MOSFET
    terminals. Frames keep their original centre placement rules.
11. **Two-way junction merge.** A junction with exactly two attached wires shows
    **Remove Junction (merge wires)** in the focus menu. Merging deletes the junction, joins the outer
    endpoints into one wire, keeps a single label, and concatenates two labels with a space. The old
    “Remove dot” action was removed because `None` already covers that use case.
12. **Draggable circuit labels.** Wire labels are draggable through the normal edge-label hit layer, and
    component/junction labels have their own drag hit layer. Component offsets are stored in the
    component's local frame and rotate with it; junction offsets are scene-relative. Hover outlines and
    double-click-to-edit are preserved.
13. **Symbol corrections.** The ANSI/US resistor zigzag is symmetric with three peaks, two troughs and
    equal ramp angles at both ends. The potentiometer keeps its original top-entry vertical wiper arrow;
    the prior diagonal-arrow experiment was reverted.
14. **Label double-click focuses the editor.** Component/junction label presses use the same press-time
    detection as edge labels, because pointer capture retargets the browser `dblclick`. A second press on
    the label opens its focus menu and selects the full name field. Wire labels keep the equivalent
    line-label behaviour.
15. **IEC source symbols.** In IEC/EU mode the DC voltage source is a circle containing two horizontal
    bars, and the current source is two overlapping circles. ANSI/US keeps the labelled/arrow variants.
16. **Delete merges a two-way junction.** When the selected object is a circuit junction with exactly
    two wires, Delete performs the same merge as the focus-menu action, removes the junction, selects the
    surviving wire and shows its endpoint handles. A junction with any other wire count is deleted
    normally.
17. **Straight divider template.** The template is now a rectangular loop: `V+ → R`, `R → D`, `D → N`,
    `N → V−`, all horizontal or vertical, with the junction on the bottom return.
18. **Right-click reroute, double-click junction.** A single right click on a circuit wire computes an
    obstacle-aware orthogonal route with the fewest bends, then splits the wire at every bend into
    separate straight wires joined by junctions. Corner junctions snap to the scene grid while retaining
    horizontal/vertical segments. Double-clicking a wire creates a small filled junction at the nearest
    grid point and splits the wire.
19. **Unconnected-junction warning.** A junction with no attached wire renders as a gray dashed hollow
    circle, regardless of its configured dot style, in the canvas and CeTZ export.
20. **Delete from label fields.** Circuit label inputs carry a scope marker. Delete at the end of a
    non-empty label (or Delete/Backspace when empty) performs the object action: delete the component or
    wire; a mergeable junction merges and selects the merged wire.
21. **Shift-drag branches.** Shift + wheel over a selected/hovered component raises a grid-distance
    counter and shows blue dashed hollow markers at the future Group 1 positions. Group 1/Group 2
    junctions and their wires spawn only after the dragged frame reaches the next grid square; Group 1
    stays fixed, Group 2 moves with the component, and the live wires update. Branch start and finish are
    one undo step, so Undo removes the moved component together with both junction groups. Branch wires
    keep straight routing as requested (they do not switch to orthogonal), and collinear branch chains are
    merged back into direct wires, removing unnecessary Group 1 and Group 2 junctions. Multiple selected
    components are treated as one branch body; internal wires between selected components are left alone.
    Releasing Shift during scroll cancels the distance; releasing it during the drag does not cancel the
    branch.
22. **Ctrl-drag duplication.** Ctrl/Cmd pointer-down starts a duplicate-drag intent. Once the frame enters
    the next grid position, the selection (including fully internal connectors) is duplicated and the
    duplicates are dragged; the original stays behind. A Ctrl/Cmd click without movement still toggles
    additive selection.
23. **Shift-drop insertion.** Shift-dragging an unconnected two-terminal component over a wire highlights
    that wire. On release the component is centered on the nearest grid point along the wire, its
    orientation follows the wire, the wire is split, and the two sides are connected to its pins in
    series without leaving a junction. While a wire-insertion target is active, endpoint/merge previews
    are suppressed and insertion takes precedence over coincidence merging. Added `switch` (`SW`) and `lightbulb` (`LP`) catalog entries in the
    Outputs group. A switch exposes ON/OFF controls and renders a closed blade when ON.
24. **Menu and symbol polish.** The add-component menu has one internal scroll body; wheel events over it
    scroll the list instead of zooming the canvas. The NPN/PNP arrows are aligned with their emitter
    leads, and the IEC MOSFET uses the circled N/P-channel layout with the arrow on the channel rail.
25. **IEC voltage-source references.** In IEC/EU mode, newly created DC and AC voltage sources use the
    `U` reference prefix (`U_1`, `U_2`, …). ANSI/US keeps `V`; current sources keep `I`.
26. **Post-move coincidence merging.** After moving or rotating components/junctions, junctions at the
    same point merge, and component pins that land on a junction or another pin receive a zero-length
    straight wire. All newly created branch, merge and coincidence wires use straight routing; explicit
    right-click reroute remains the deliberate orthogonal path operation.
27. **One wire per component pin.** Scene updates normalize circuit pin connections: any pin with more
    than one direct wire gets a filled junction exactly at the pin point, all direct wires are retargeted
    to it, and a single zero-length pin-to-junction stub remains. This runs after every circuit history
    update, including wire creation, moves, merges and duplication. A `none` junction becomes `filled`
    once it accumulates three connections.
28. **Coincidence preview and Alt-detach.** While dragging, pins/junctions that would coincide with
    another pin/junction are highlighted with amber rings. Alt-dragging a component/group disconnects its
    external endings, leaves invisible junctions at their former positions, and shorts a two-terminal
    component's pair; components with more than two endings get junctions but no short. The detach and
    move are one undo step.
29. **Ctrl+Shift parallel duplicate.** Ctrl/Cmd+Shift-dragging a circuit component duplicates the
    selection and wires each duplicate pin back through a fixed Group 1 and moving Group 2 junction,
    creating a parallel branch. It uses the same branch distance as Shift-drag, including 0. Group 2
    moves with the duplicate; the original and copy both remain connected. Junction hit, hover and
    selection overlays are one-grid-square, square-cornered regions.
30. **Junction focus and cleanup.** A click (without drag) on a junction's centre port handle opens its
    focus menu; dragging still starts a wire. After moves, unlabelled degree-two junctions whose two
    wires are collinear collapse back into a single wire, removing auto-created leftover junctions.
    Coincident component pins share exactly one filled junction and one zero-length stub each; junction
    nodes at the same point are merged and zero-length junction-to-junction loops are removed.
31. **Rotation handle, menu placement and zoom.** The rotate handle follows the pointer while dragging
    at a fixed radius from the component centre, and its dashed leader always points to that centre. It
    settles at the new component angle, then opens the component menu. Component focus menus open
    outside both the component and the rotate handle. The hit area and focus fill use the rotated
    component polygon expanded to include every pinned ending, while the hover outline remains the
    plain rotated body rectangle. No axis-aligned outer rectangle is drawn. Port handles appear only
    while the pointer is inside or near that area. Circuit diagrams open at 200% zoom; manual zoom is
    capped at 800%.
32. **Marquee wire selection.** When a left-drag marquee contains no components, every wire whose
    polyline intersects the marquee is selected together. All selected wires are highlighted and Delete
    removes the whole set.
33. **Click vs double-click text focus.** A single click selects an object and opens its menu without
    focusing the label field. Double-clicking the object or its label requests text focus.
34. **Dynamic pins and diagonal snapping.** Pin leads are no longer baked into the SVG symbol; each
    pin definition stores its body attachment point, and layout renders the lead from that body point
    to the final pin. At 45°, 135°, 225° or 315° the final pin snaps to the scene grid, so the lead
    extends from the rotated body to the grid. Branch, detach and coincidence logic use the same points.
35. **Wire translation.** A circuit wire whose two endpoints are junctions can be dragged sideways.
    The drag is constrained to the axis perpendicular to the wire, snapped to the grid, and moves both
    endpoint junctions together. Other branches at those junctions must be parallel to that movement
    axis; they stretch/reroute with the junctions. `none`-style junctions have no hit area, so dragging
    at a wire bend selects the wire; filled/hollow junctions remain directly selectable.
36. **Unique port-pair connections.** Normalization keeps at most one circuit wire between the same two
    attachment ports. Duplicate parallel wires between those exact ports are removed, preferring the
    labeled/visible copy. Different pins on the same object pair remain valid, so a simple two-wire loop
    between two components needs no junction.
37. **Visual layout refinements.** In circuit diagrams the Layout panel shows only the “Visual layout
    refinements” checkbox (default on); other diagram types do not show it. When enabled, every junction
    moved by orthogonal wire translation with exactly two incident wires switches to `none` style.
    Pin-junction normalization and duplicate-connection removal run before this check, including on the
    first drag. The checkbox disables the cleanup.
38. **Component orientation actions.** Rotation and orientation share one row: rotate −45°/+45°, then a
    thin dashed vertical divider, then mirror vertical, mirror horizontal and change orientation. They
    are commands, not a selected mode. Mirror actions flip the corresponding geometry axis and move pins
    without rewiring, so attached wires cross with the mirrored pins. Change orientation flips the
    control-pin axis (horizontal for two-terminal parts, vertical for transistors around the base),
    rewires every edge to the mirrored counterpart pin, and toggles back when invoked again. The LED
    therefore reverses electrically while its wires stay on their sides, and transistor
    collector/emitter connections swap.
39. **Group-move junction carrying.** When a group of components moves together, any junction whose
    coincident component endpoints all belong to that moving group is carried with it. Ownership uses
    the same quarter-grid tolerance as coincidence merging, and the carried junction’s starting frame is
    snapped to the grid. As a final safety net, circuit normalization merges any junction pair closer
    than half a grid cell into one grid-aligned junction before duplicate-wire cleanup. This keeps an
    auto-merged junction aligned on the first move instead of leaving it behind and generating an
    off-grid duplicate.
40. **Selected junctions inside branch groups.** Shift-drag and Ctrl+Shift-drag treat a selected junction
    as internal only when **all** of its connected nodes are also selected. An internal junction moves or
    duplicates with the group without rewiring. A boundary selected junction is branched as a junction:
    its external wires stay anchored at its original point while a dynamic wire follows the moved or
    duplicated junction, instead of creating the branch at component pins inside the group. Generated
    branch edges are exempt from zero-length loop cleanup so the initial branch connection survives.
    Auto-merged junctions at selected endings are carried by shift-drags too, preventing a stray junction
    at the old merge point. Shift-scroll always adjusts branch distance when components are selected, but
    distance markers appear only for components with external connections.
41. **Visible None junctions and half-grid merging.** None-style junctions keep a transparent hit target,
    so they can be selected, moved and show the focus box like other junctions. Component pin/junction
    coincidence uses a half-grid tolerance consistently, so bringing an ending visually onto a junction
    reliably creates the zero-length merge wire instead of creating a second junction.
42. **Ctrl-drag auto-merge.** Duplicate drags run coincidence merging and pin/duplicate normalization on
    drop, so a copied object released on an ending or junction auto-merges like a normal drag.
43. **Auto-merged junction refinement.** Junctions created by coincidence merging are marked and, when
    Visual layout refinements is enabled, rendered in None style while they have exactly two connections.
    If a third connection is added they become visible again; with refinements disabled they stay visible.

The circuit test suite now covers these cases (111 assertions at the time of writing).

---

## 17. Acceptance checklist

- [ ] `circuit` appears in the Scene dialog with an icon and a working template/empty start.
- [ ] Add object opens a scrollable, searchable component table; recents appear first; Image is below
      the table.
- [ ] Every component in §5.1 can be added and renders at 0°, 45°, 90°, 135°, 180°, 225°, 270° and
      315°; its pins rotate with it.
- [ ] Components get unique, editable reference labels at creation; copy/paste and duplicate preserve
      the labels exactly, including duplicates.
- [ ] A click or short drag from a pin onto empty canvas creates neither a wire nor a Node; a deliberate
      drag past the threshold creates the no-dot Node.
- [ ] IEC/ANSI switch restyles symbols without moving pins or changing wires.
- [ ] Wires are plain solid lines with centre labels; no marker or stroke-pattern UI appears.
- [ ] A wire can be dragged from a pin to another pin, to empty space (auto `none` Node), or to another
      wire (auto `solid` Node + split/rewire).
- [ ] Crossings that are not connections render an omega bridge on the expected wire.
- [ ] A focused component shows an external rotate handle; dragging snaps to 45°; connected wires follow;
      label text stays upright.
- [ ] Junction style can be solid, hollow or none; “Remove dot” keeps wires.
- [ ] Undo/redo treats each wire split, junction creation and rotation as one step.
- [ ] Scene/project export/import round-trips circuit data.
- [ ] CeTZ export contains the same components, rotations, junction styles, labels and hops as the
      canvas, with no editor overlays.
- [ ] `npm run check` passes, including new circuit tests and all existing fixture checks.
































