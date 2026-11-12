# 01 — CeTZ 0.5.3 mapping schema

**Target:** `@preview/cetz:0.5.3` (the version documented by the supplied `cetz.pdf`, compiled with Typst
0.14.2; the local compiler is Typst 0.15.1 and the package declares compiler 0.15.0). The machine-readable
version of this document is [`src/model/cetz-map.ts`](../src/model/cetz-map.ts).

CeTZ’s manual is the reference for every signature below. Key pages: `mark` p10, `line` p11, `content` p14,
`rect` p16, `group` p28, `anchor` p29, and `ortho` p35.

## 1. The coordinate contract

| Concern | Decision |
|---|---|
| Scene units | 1 scene unit = **1 Typst point (pt)**. |
| Canvas | `cetz.canvas(length: 1pt, { ... })`. |
| Model axis | **y-down**, origin at the document’s top-left, because the DOM, SVG and pointer events are y-down. |
| CeTZ axis | y-up. The serializer is the only component allowed to flip it. |
| Export origin | Normalise to `exportBounds`, which already includes `canvas.exportPadding`. |
| Conversion | `x' = x - exportBounds.x`; `y' = exportBounds.y + exportBounds.height - y`. |
| Grid | 9 pt default = 12 CSS px at 96 dpi. Grid is editor-only unless explicitly exported. |

Do **not** use CeTZ’s `y: (0, -1, 0)` canvas basis to avoid the flip. It makes vertical content anchors and
rotations behave counter-intuitively; the explicit point conversion is one function and keeps CeTZ’s normal
semantics.

The same resolved point list feeds:

1. the DOM/SVG skeleton overlay, and
2. the CeTZ serializer.

There is no second geometry algorithm in the export path.

## 2. Scene primitive → CeTZ macro

| Scene concept | CeTZ calls | Contract |
|---|---|---|
| Document | `canvas`, `import cetz.draw: *` | Auto-sized; `length: 1pt`; padding from `exportBounds`. |
| Node container | `group(name: "n_…")` | The group gives the node a stable name and bounds. Child shape and content are inside. |
| Table / class / relation attribute | `rect`, `line`, `content`, `anchor` | Frame is one `rect`; each compartment boundary is one `line`; each row is absolutely positioned `content`; each row port is an `anchor`. |
| Actor | `group`, `circle`, `line`, `content` | Silhouette strokes; label is content below. Do not use a font glyph/emoji. |
| Use case | `circle(center, radius: (rx, ry))`, `content` | True ellipse; text centered. |
| State | `rect(a, b, radius: …)`, `content` | Rounded rectangle in scene units. |
| Object (communication) | `rect`, `content` | Underline the name by drawing a `line` or using Typst underline. |
| Initial / final / choice / fork-join | `circle`, `line` | Filled circle; bullseye; closed diamond; solid bar. |
| Lifeline | `rect`, `line`, `content`, `anchor` | Head box; dashed spine; thin activation rectangles; spine anchors for messages. |
| System boundary / frame | `rect`, `content` | Draw before children. Label tab is a separate rect/content, not a clipped path. |
| Foreign image | `content(pos, image(...))`, `rect` | Asset is materialised in Typst’s VFS; border and caption use the same frame. |
| Connector | `line(..points)` | Explicit polyline. Named endpoints and `line("a", "b")` are not used for routed connectors. |
| Label | `content(pos, ...)` | Explicit center; optional `line` tether to the edge path anchor. |
| Endpoint marker | `line(..., mark: (start: …, end: …))` | Built-in or registered mark; marker semantics stored separately. |
| Grid | `grid(from, to, step: …)` | Preview only by default; never affects export bounds. |
| Projection | `ortho` | **Not orthogonal routing.** 3D projection only; do not use for ER/UML 2D. |

## 3. Table geometry and row ports

Let a table frame be `F = (x, y, w, h)` with a header of height `H`, rows of height `R`, and horizontal inner
padding `P` (used by the text frame; the port x stays on the border). The exact band layout is produced by the
Phase 1 measurement pass, but the formulas are fixed:

```
header band   = (F.x, F.y, F.w, H)
row i band    = (F.x, F.y + H + i*R, F.w, R)
row i centre  = F.y + H + i*R + R/2
west port     = (F.x, row i centre)
east port     = (F.x + F.w, row i centre)
```

CeTZ emission:

```typst
group(name: "n_orders", {
  rect((0, 0), (225, 108), fill: white, stroke: 0.75pt)
  line((0, 80), (225, 80), stroke: 0.5pt)       // model y=28 after the y-flip
  content((112.5, 94), [*orders*], anchor: "center")
  content((7, 62), [id: uuid], anchor: "west")
  anchor("row_0_west", (0, 62))                 // model y=46
  anchor("row_0_east", (225, 62))
})
```

Port anchor names are generated, never copied from a raw UUID:

- `n_<node>` — group name
- `row_<rowIndex>_<west|east>` — row port
- `north`, `east`, `south`, `west`, … — perimeter ports
- `spine_<index>` — lifeline attachment

`toCetzName` in `cetz-map.ts` strips characters that CeTZ treats specially (`.` separates an element name
from an anchor) and appends an FNV-1a suffix when sanitisation changes the ID, preventing collisions.

## 4. Connectors and routing

`line` accepts any number of points and produces a polyline. Orthogonal routing is therefore just a list of
corner points:

```typst
line((225, 46), (270, 46), (270, 126), (396, 126), stroke: 0.75pt)
```

Rules:

- Emit **resolved coordinates**, not `line("customers", "orders")`. CeTZ’s string endpoints re-clip against
  element borders using a ray from the first/last segment; that is a second router and can disagree with the
  DOM skeleton.
- A* produces the corner points. The serializer does not re-route.
- `ortho` is an orthographic **projection** (`ortho(x:, y:, z:, body)`), not an orthogonal connector. Using it
  for ER/UML would rotate the diagram.
- Edge-to-edge attachments use a path anchor:

  ```typst
  line((0, 0), (200, 0), name: "e_places")
  line((100, 80), (name: "e_places", anchor: 50%),
       stroke: (paint: black, thickness: 0.5pt, dash: "dashed"))
  ```

  For 1:1 parity the serializer may instead emit the resolved point. The model stores
  `{ target: "edge", edgeId, t }`, so either strategy is available.
- A **relation-attribute tether** is routed orthogonally by default: leave the attribute box along its side
  normal, add at most one right-angle bend, and meet the relationship line at 90°. A diagonal tether is only a
  manual override. The proof sheet demonstrates the orthogonal case.
- Waypoints are scene points. `locked` waypoints survive A* and auto-layout.
- Stubs must leave a port along its normal; otherwise the first segment grazes the table border.

## 5. Markers

### 5.1 Built-ins and registered marks

CeTZ built-ins cover the primitives we need: `triangle`, `stealth`, `diamond`, `bar`, `circle`, `bracket`,
`straight`, etc. (manual p24–25 and `src/mark-shapes.typ`). We register notation marks once per canvas:

```typst
register-mark("uml-hollow-triangle", style => {
  let (l, w) = (style.length, style.width)
  line((0, 0), (l, -w/2), (l, w/2), close: true,
       fill: white, stroke: style.stroke)
  anchor("tip", (0, 0))
  anchor("base", (l, 0))
})

register-mark("uml-open-arrow", style => {
  let (l, w) = (style.length, style.width)
  line((0, 0), (l,  w/2), stroke: style.stroke)
  line((0, 0), (l, -w/2), stroke: style.stroke)
  anchor("tip", (0, 0))
  anchor("base", (0, 0))   // base == tip: do not shorten the path
})
```

Mark local frame, learned from the working proof sheet:

- `tip` is at `(0, 0)`; local `+x` points **back along the path**.
- `base` controls how much of the path is consumed. A hollow triangle/diamond uses `base = (length, 0)`.
- An open arrow must set `base = tip`, otherwise the line stops behind the arrow and a gap appears.
- Hollow shapes need `fill: white` (or the canvas background), not `fill: none`, or the line shows through.
- The crow’s-foot marks are custom composites:

| Semantic | CeTZ symbol | Construction |
|---|---|---|
| one | `er-one` | one bar at the entity |
| many | `er-many` | three prongs meeting at the entity |
| zero or one | `er-zero-one` | bar at entity + outboard hollow circle |
| one or many | `er-one-many` | crow’s foot at entity + outboard bar |
| zero or many | `er-zero-many` | crow’s foot at entity + outboard hollow circle |

The maximum is nearest the entity; optionality/minimum is outboard. This matches the notation research in
`00-notation-research.md`.

### 5.2 UML relationship presets

| Preset | Start | End | Line |
|---|---|---|---|
| association | — | — | solid |
| directed association | — | open arrow | solid |
| inheritance / generalization | — | hollow triangle | solid |
| realization | — | hollow triangle | dashed |
| aggregation | hollow diamond | — | solid |
| composition | filled diamond | — | solid |
| dependency | — | open arrow | dashed |

The endpoint menu may override either end independently. The line dash is a separate style field, so a
“realization” marker with a solid line is representable but flagged as a notation warning in the editor.

### 5.3 Generic and text-only endings

Not every line needs UML/ER semantics. The endpoint menu also offers:

- **generic open arrow** — CeTZ built-in `straight`, no fill; semantic family is `generic`;
- **generic filled arrow** — CeTZ built-in `triangle` with fill set to the stroke color;
- **plain line** — no mark at all (`{ family: "none", kind: "none" }`).

ER relations can replace either crow's foot with a text label. This is stored as:

```ts
markers: { source: NO_MARKER, target: NO_MARKER },
labels: [
  { zone: "source", text: "0..n", ... },
  { zone: "target", text: "1",    ... },
]
```

The renderer must not synthesise a crow's foot when a label exists. The UI presents this as an explicit
per-end mode: **Crow's foot**, **Text cardinality**, or **Plain line**. `0..n` and `1..n` are endpoint
cardinalities; an m:n relationship is two endpoint labels (or two crow's feet), never a single middle badge.
`1..0` is accepted as free text but is not a preset.

### 5.4 Row prefixes are text, not Typst list markup

A row prefix is data (`+ - # ~` or a custom string), not markup. In the serializer, escape or code-wrap it so
`- id: UUID` cannot become a Typst bullet list and `+ submit()` cannot become an enumerated list. The proof
sheet uses `#("- id: UUID")` / `#("+ submit(): Receipt")` to verify the literal rendering.

## 6. Labels and tethers

Labels are positioned by their resolved frame center, not by `content`’s `north`/`south` anchor. This keeps
the browser and CeTZ layouts identical even after the y-flip.

```typst
let edge-name = "e_places"
content((328, 96), [places], anchor: "center", fill: white, padding: 2)
line((name: edge-name, anchor: 50%), (328, 96),
     stroke: (paint: black, thickness: 0.4pt, dash: "dashed"))
```

- Three zones are stored per edge: `source`, `center`, `target`.
- A dragged label stores an offset in scene units and a resolved anchor `t` on the edge.
- The tether is drawn only when the label box no longer touches the line.
- Label frames are **not** included in edge bounds; they get a separate z-layer and collision pass.
- Text is escaped before being inserted into Typst content (`[`, `]`, `#`, `*`, `_`, `\`, `$`, `<`, `>` are
  the dangerous characters). Full text remains in the document; display truncation is a layout property.

## 7. Images and other “foreign” content

The document stores an asset reference, not a blob. The exporter writes assets into Typst’s virtual file
system and emits:

```typst
rect((486, 306), (630, 396), stroke: 0.75pt)
content((490, 310), image("assets/brand.svg", width: 140pt),
        anchor: "north-west")
content((558, 402), [Figure 1 — imported reference], anchor: "center")
```

- `fit: "contain"` preserves aspect ratio inside the frame; `cover` crops; `fill` stretches.
- The frame participates in obstacle avoidance and exposes perimeter ports.
- The caption is not part of the image; it is a label with its own selection box.
- SVG is preferred for crisp output; raster images are exported at their intrinsic resolution or a
  user-selected scale.

## 8. Typography and 1:1 parity

Text measurement is the only place the two renderers can legitimately diverge. The contract:

1. **Fixed vertical rhythm.** Header and row bands are derived from style, not from text wrapping. Row text is
   single-line; overflow uses ellipsis or a user-selected wrap mode that also changes the derived row height.
2. **Same font.** The editor loads and embeds the same font family/weight used by Typst. A fallback font is a
   parity bug, not an acceptable default.
3. **Same font size.** Scene units are points; `fontSize` is in points in both renderers.
4. **No implicit CeTZ layout.** No `table`, no `grid` for content, no `align` that can resize a node. Every
   row/text position is explicit.
5. **One transform.** Model y-down → CeTZ y-up conversion happens once; no nested `scale`/`translate` that
   could round differently.
6. **Golden checks.** Render the same fixture through the SVG preview and the Typst WASM compiler; compare
   node/port/label coordinates with a tolerance of 0.25 pt. Pixel comparison is a later, font-dependent
   layer.

## 9. What Step 4 emits

The implemented serializer walks `SceneDocument` → `LayoutSnapshot` → a pasteable Typst **snippet**, not a
separate geometry AST and not a standalone document. Selection, page fitting and the y flip are the only
transformations; all drawing calls come from the same resolved points the SVG skeleton uses.

The concrete output is documented in [06 — Step 4 export](06-step4-export.md), including:

- `#figure(... ) <fig-id>` with an optional, editable label (default: scene name);
- `draw.group(name: "n_…")` nodes with `row_<n>_west/east` and compass anchors;
- one `draw.rect` frame plus separator `line`/`content` rows per table;
- explicit polyline `draw.line(...)` connectors with registered UML/ER `mark` symbols;
- literal `#("…")` text inside `text(...)`, so row prefixes and brackets never become Typst markup;
- external `image("<resources>/<file>")` references, never embedded bytes;
- **no** `#import`, `#set page`, `#set text` or other global setter; the host project imports
  `canvas`/`draw` from CeTZ and provides the page, and the snippet only uses local `#figure`/`#align`
  wrappers.

`ortho` remains deliberately unused: orthogonal routing is resolved in TypeScript and emitted as polyline
points.

## 10. Validation evidence

`docs/assets/notation-proof.typ` compiles against the actual local `@preview/cetz:0.5.3` package and exercises:

- a multi-compartment table with row anchors;
- actor, use case, state, lifeline + activation;
- all six UML endpoint presets;
- all five ER crow’s-foot endpoints;
- a row anchor → edge midpoint tether and the three label zones.

The rendered result is `docs/assets/notation-proof.png`. It is a notation proof, not an application
screenshot.
