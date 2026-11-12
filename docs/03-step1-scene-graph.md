# 03 — Step 1: scene graph and CeTZ mapping schema

**Deliverable status:** Step 1 schema accepted into Step 2. The canvas core is documented in
[04 — Step 2](04-step2-canvas.md) and the Step 3 editor layer in
[05 — Step 3](05-step3-editor.md); this document remains the schema/invariant record. The A* router and
layered auto-layout are implemented; the Typst/CeTZ serializer and live preview are implemented in Step 4
(see [06 — Step 4](06-step4-export.md)).

## 1. What is in the repository

```text
src/model/
  ids.ts          branded IDs + ID factory
  geometry.ts     Point/Rect, snapping, compass geometry, y-down conventions
  styles.ts       stroke/fill/text/theme tokens
  markers.ts      UML + ER endpoint vocabulary and relationship presets
  nodes.ts        discriminated union of every node family
  edges.ts        attachments (node/row/spine/edge/free), routing, labels, semantics
  layout.ts       derived Phase 1 geometry (ports, bands, labels, routed paths)
  scene.ts        document root, canvas/layout settings, editor session
  validate.ts     structural import/export validation
  cetz-map.ts     machine-readable CeTZ 0.5.3 mapping + naming/unit contract
  index.ts        public model exports
src/fixtures/
  index.ts        six validated example scenes + foreign-image asset
scripts/
  validate-fixtures.ts
docs/
  00-notation-research.md
  01-cetz-mapping.md
  02-architecture.md
  03-step1-scene-graph.md
  assets/notation-proof.{typ,png,svg}
```

## 2. Persisted document vs derived layout

This is the most important boundary in the model.

### Persisted (`SceneDocument`)

- semantic nodes, rows, sections and edge semantics;
- grid-snapped `frame` for every node;
- manual routing waypoints and label offsets;
- marker choices and line styles;
- locks;
- canvas/layout/theme settings;
- asset metadata (never blobs).

### Derived (`LayoutSnapshot`)

- measured text + row/section/header bands;
- resolved ports with point, normal and tangent;
- routed edge points and bend/crossing counts;
- label frames and tether endpoints;
- content/export bounds;
- diagnostics.

`LayoutSnapshot` is not serialized. A stale snapshot is rejected by `sceneRevision`.

## 3. Core types

### 3.1 Node union

| `kind` | Purpose | Key fields |
|---|---|---|
| `table` | ER entity, UML class, associative table | `tableKind`, `header`, `sections[].rows[]`, `style` |
| `relationAttribute` | ER relationship attribute | `rows[]` (compact single-section table) |
| `relationship` | Chen-style ER diamond (n-ary) | `identifying`, `weak` |
| `actor` | UML actor | `labelPlacement`, `style` |
| `useCase` | UML use-case ellipse | `style` |
| `object` | Communication/sequence object box | `classifier`, `stereotype`, `underlineName` |
| `state` | State-machine state | `stateKind`, `internalActivities` |
| `pseudostate` | initial/final/choice/fork/join/… | `pseudostateKind` |
| `lifeline` | Sequence lane | `head`, `headHeight`, `activationBars[]`, `destroyAt` |
| `frame` | System boundary / interaction frame / package | `frameKind`, `operator`, `guard`, `tabHeight` |
| `image` | Foreign object | `assetId`, `caption`, `fit`, `alt`, `showBorder` |

Every node has: `id`, `name`, `frame`, `z`, `locked`, `visible`, optional `metadata`.

`TableRow` supports both modes:

- ER: `name`, `type`, `constraints` (`PK`, `FK`, `NN`, `UQ`), optional prefix.
- UML: `visibility` (`+ - # ~`), `name`, `type`, `parameters[]`, `returnType`, `static`, `abstract`.
- Any row may carry a **custom literal `prefix`**; it overrides `visibility` and is rendered as text, never as
  Typst list markup. This prevents `- id` becoming a bullet and `+ submit()` becoming an enumerated list.

### 3.2 Ports and attachments

A port is a **reference**, not a stored coordinate:

```ts
type NodePortRef =
  | { kind: "row"; rowId: RowId; side: "west" | "east" }
  | { kind: "perimeter"; side: CompassSide }
  | { kind: "angle"; angle: number }
  | { kind: "spine"; t: number };          // lifeline: 0 top, 1 bottom
```

An edge endpoint is:

```ts
type EdgeAttachment =
  | { target: "node"; nodeId: NodeId; port: NodePortRef }
  | { target: "edge"; edgeId: EdgeId; t: number }   // edge-to-edge
  | { target: "free"; point: Point };
```

Why references:

- resizing/reordering rows cannot invalidate the attachment;
- exported anchors stay stable (`row_2_east`);
- the layout pass can choose a different perimeter side without mutating the semantic edge;
- edge-to-edge tether targets (`t = 0.5`) survive automatic rerouting.

### 3.3 Edges

`SceneEdge` stores:

- source/target attachments;
- `routing`: `straight | orthogonal | polyline | bezier`, obstacle padding, stub length, waypoints;
- `markers`: independent source/target `EndpointMarker`; families are `uml`, `er`, `generic`, or `none`;
- `labels`: up to one source, center and target label, each with anchor `t` + offset + lock;
- `semantic`: UML / ER / sequence / communication / state / generic;
- `style`, `locked`, `visible`, `z`.

Sequence messages store `messageKind` in `semantic.family = "sequence"`; their arrowhead is derived from that
kind (filled sync, open async, dashed open reply), while class/ER relationships use the marker menu.

**ER endpoint presentation** is a per-end UI mode, not a second stored geometry model:

- `crowFoot` — set an ER marker, optionally with a text label;
- `label` — clear the marker and use the source/target cardinality label (`0..n`, `1`, …);
- `plain` — clear both marker and label.

A mixed edge is valid (crow's foot on one end, text on the other). An m:n relationship is two endpoint labels
or two crow's feet, never one middle `m:n` badge. **Generic** arrows (`arrow`, `filledArrow`) and a **plain
line** (`family: "none"`) are available without UML/ER semantics.

### 3.4 Layout snapshot

`NodeLayout` has four variants:

- `TableNodeLayout` — header band + section bands + row bands, with row port IDs;
- `LifelineNodeLayout` — head, spine, activation frames, destruction point;
- `ShapeNodeLayout` — actor/use case/object/state/pseudostate/frame/relationship;
- `ImageNodeLayout` — image frame + caption frame.

`EdgeLayout` stores the resolved polyline, label frames, tether points, bend count and crossing count.

## 4. Example: ER commerce fixture

`src/fixtures/index.ts` contains `ER_COMMERCE`; its serialized document is
[`examples/er-commerce.scene.json`](../examples/er-commerce.scene.json).

```ts
edge(
  "edge_places",
  nodeAttachment("customers", { kind: "perimeter", side: "east" }),
  nodeAttachment("orders", { kind: "perimeter", side: "west" }),
  { family: "er", name: "places" },
  {
    markers: { source: er("one"), target: er("zeroOrMany") },
    labels: [
      label("label_places_source", "source", "1", 0.12),
      label("label_places_center", "center", "places", 0.5),
      label("label_places_target", "target", "0..*", 0.88),
    ],
  },
)
```

The relation-attribute tether uses an edge-to-edge anchor:

```ts
edge(
  "edge_order_line",
  nodeAttachment("order_line", { kind: "perimeter", side: "east" }),
  edgeToEdge("edge_places", 0.5),
  { family: "er", name: "has" },
  { strokePattern: "dashed" },
)
```

The fixture uses text cardinality labels (`1`, `0..*`) on `edge_places` and also retains crow's-foot markers;
label-only and mixed endpoints are supported by clearing the marker on either side.

The six fixtures cover:

| Fixture | Exercises |
|---|---|
| ER commerce | entity tables, PK/FK/NN/UQ, row + perimeter ports, crow’s foot, text cardinality, edge-to-edge tether |
| UML class payments | compartments, visibility, parameters, realization, composition, directed association |
| UML sequence checkout | lifelines, head kinds, activation bars, spine ports, sync/reply semantics |
| UML use case shop | actor, system boundary, include/extend, imported image asset + caption |
| UML state order | initial/final pseudostates, rounded states, guarded transitions |
| UML communication checkout | object boxes, links, nested sequence numbers |

## 5. Validation

`npm run validate:scene` checks:

- schema version, revision, grid/padding/layout ranges;
- record-key ↔ `id` consistency;
- finite, positive frames and grid alignment (warnings only for off-grid);
- duplicate row IDs within a table/relation attribute;
- activation bars inside the lifeline, destruction inside the frame;
- image asset references;
- edge attachments: existing nodes/edges, valid row/spine/angle/t, no self-attachment, no edge cycles;
- label zones unique per edge, finite offsets, `t ∈ [0,1]`;
- marker scale and family/semantic mismatches (warning).

Current result:

```text
PASS ER commerce — 3 nodes, 2 edges, 0 errors, 0 warnings
PASS UML class payments — 4 nodes, 3 edges, 0 errors, 0 warnings
PASS UML sequence checkout — 3 nodes, 4 edges, 0 errors, 0 warnings
PASS UML use case shop — 6 nodes, 3 edges, 0 errors, 0 warnings
PASS UML state order — 5 nodes, 4 edges, 0 errors, 0 warnings
PASS UML communication checkout — 3 nodes, 3 edges, 0 errors, 0 warnings
```

`npm run typecheck` passes with `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` and `noEmit`.

## 6. CeTZ mapping decisions already fixed

- `@preview/cetz:0.5.3`, `canvas(length: 1pt)`; 1 scene unit = 1 pt.
- Model y-down → CeTZ y-up conversion happens exactly once in the serializer.
- Explicit polyline points; never rely on CeTZ’s string-endpoint clipping for routed lines.
- `ortho` is projection, not orthogonal routing; not used for 2D ER/UML.
- Custom marks: `uml-hollow-triangle`, `uml-hollow-diamond`, `uml-filled-diamond`, `uml-open-arrow`,
  `er-one`, `er-many`, `er-zero-one`, `er-one-many`, `er-zero-many`.
- Mark semantics and line dash are separate fields; presets update both. Generic open/filled arrows and a
  plain (`none`) ending are also representable.
- ER text cardinality uses `markers: none` plus source/target labels; it does **not** synthesise a crow's
  foot. The endpoint menu presents crow's foot / label / plain as three explicit modes.
- Labels are absolute `content` positions with optional `line` tethers. Relation-attribute tethers default to
  orthogonal; the proof sheet joins the box to the line at 90°.
- Images are `content(image(...))` with an asset path materialised in Typst’s VFS.
- Names are sanitized through `toCetzName`; `.` is reserved for anchor access.

The full mapping table and working snippets are in `01-cetz-mapping.md`.

## 7. Deliberately deferred to later steps

- ~~DOM/SVG canvas, camera, pointer interactions (Step 2).~~ Implemented in Step 2.
- ~~Text measurement implementation and font loading (Step 2).~~ Implemented in Step 2.
- ~~Port hit-testing and snap-handle rendering (Step 2).~~ Implemented in Step 2.
- ~~Entity-table editing UI, endpoint popovers, A* router, Sugiyama layout (Step 3).~~ Implemented in Step 3;
  framed/container-aware layout remains deferred.
- ~~Typst/CeTZ serializer and live WASM preview (Step 4).~~ Implemented in Step 4; PDF/SVG file export and
  multi-scene document assembly remain deferred.
- Multi-user/undo persistence, clipboard, import/export UI (not in the requested four steps).

## 8. Feedback incorporated

- **Units:** kept 1 scene unit = 1 pt. CeTZ is exact and font sizes stay in points; CSS px is 4/3.
- **ER cardinality:** per-end choice of **crow's foot**, **text cardinality**, or **plain line**. Text labels
  are independent endpoint labels; `0..n` / `0..n` represents m:n at the two ends, never a middle badge.
  `1..0` was a typo and is not a preset.
- **Generic endings:** added `generic.arrow`, `generic.filledArrow`, and `none` (plain line).
- **Relation attributes:** the default tether leaves the box orthogonally and meets the relationship line at
  90°; the proof sheet now shows this.
- **Row prefixes:** custom literal prefixes are supported; prefixes are code-wrapped/escaped in Typst so they
  never become bullets or numbered lists.
- **Node locks:** a locked node keeps its current frame during auto-layout and acts as a fixed constraint.
  It is not “excluded and re-placed”; two locked entities stay in their user-chosen relative arrangement.
- **Proof sheet:** updated for literal prefixes, text cardinality, generic/plain endings, and the orthogonal
  relation-attribute tether.

### Remaining review questions

1. Is the `frame` rectangle the right port boundary for actors, or should actor ports follow the silhouette
   (head/shoulders) instead? The current model uses the frame and lets the renderer inset ports.
2. Should auto-layout be allowed to move a node with a user-pinned label, or only pin the node? Current plan:
   node lock wins; label-only pin affects the label pass, not the node.
