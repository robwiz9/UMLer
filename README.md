# UMLer

A UX-focused editor for **ER** and **UML** diagrams — Use Case, Class, Sequence, Communication and State Machine
— with a skeleton-first interactive canvas and a **Typst + CeTZ** rendering/export core.

> **Current checkpoint: Step 3 complete — editing, routing and auto-layout.**
> The repository contains the notation research and scene schema (Step 1), the SVG grid canvas and
> measurement/snap pipeline (Step 2), and the Step 3 editor layer: sparse orthogonal A* routing with
> point-and-double-click reroute, layered crossing-reduction layout with lock constraints, table content
> editing, edge/endpoint marker popovers, label quick-select and label collision avoidance.

![UMLer Step 3 editor](docs/assets/step3-editor.png)

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5173/
npm run check    # typecheck + scene validation + layout tests
npm run build
```

The Vite config uses `--configLoader native`. Vite's bundled config loader spawns a helper process that the
current Windows sandbox blocks with `spawn EPERM`; the native loader is a supported Vite option and the app
builds and runs normally.

## Read this first

| Document | What it covers |
|---|---|
| [00 — Notation research](docs/00-notation-research.md) | Visual conventions and formalities for ER + the five UML diagram types |
| [01 — CeTZ mapping](docs/01-cetz-mapping.md) | How every primitive maps to CeTZ 0.5.3 `anchors`, `rect`, `line`, `ortho`, `mark`, `content` |
| [02 — Architecture](docs/02-architecture.md) | Two-phase skeleton → CeTZ pipeline, auto-layout, A* routing, parity contract |
| [03 — Step 1 scene graph](docs/03-step1-scene-graph.md) | TypeScript schema, invariants, fixtures, review decisions |
| [04 — Step 2 canvas](docs/04-step2-canvas.md) | Camera/grid/measurement/snap pipeline and Step 2 verification |
| [05 — Step 3 editor](docs/05-step3-editor.md) | A* router, layered auto-layout, endpoint menus, table editor, label rules, verification |

## Repository layout

```text
src/model/        framework-agnostic scene graph + derived layout types + validation + edits + file formats
src/layout/       text measurer, Phase 1 layout pass, A* router, auto-layout, snap/index helpers
src/canvas/       SVG grid, node/edge skeleton renderers, endpoint popover, camera and port handles
src/app/          React shell, layout panel, history, table and edge editors
src/fixtures/     six example scenes (ER, class, sequence, use case, state, communication)
scripts/          fixture validator, layout tests, Typst bootstrap
docs/             research, mapping, architecture, Step 1/2/3 specifications
docs/assets/      CeTZ notation proof + app screenshots
examples/         generated JSON example for the ER fixture
cetz.pdf          supplied CeTZ 0.5.3 manual
```

## What works now

- Infinite pan/zoom SVG canvas with fit (max 150% for small diagrams); pan on right- or middle-drag.
- Configurable 9 pt grid (3–72 pt), major lines every 4 cells.
- Grid snapping and node-to-node alignment guides.
- Node drag, corner resize and live commit/revision handling.
- **Diagram-aware object palette** via the canvas **+ Add object** button or a single right-click on empty
  canvas space. The menu only offers valid objects for the active diagram:
  - ER: entity table, associative table, relationship attribute;
  - UML class: class;
  - UML use case: actor, use case, system boundary;
  - UML sequence: lifeline, interaction frame;
  - UML communication: communication object;
  - UML state machine: state, initial/final pseudostate, choice;
  - every diagram: **Comment** and **Image**.
  Connectors are absent from the palette: drag from a selected object's border/row/spine handle to another
  object (or onto an existing line, for a dashed edge-to-edge relation-attribute attachment) to create a
  family-appropriate connector. New objects are grid-aligned, placed clear of existing objects, selected and
  focused; new lifelines become a lane to the right of the existing lanes.
- Comments are multi-line notes with a folded corner and a focused textarea; images use a placeholder asset
  frame with an editable caption. Both are available in every diagram type.
- Measurement pass for tables, classes, actors, use cases, states, objects, lifelines, frames, images, comments
  and ER diamonds; class title + stereotype headers stay vertically centred.
- Row-level and perimeter ports for tables, plus spine/activation ports for sequence diagrams.
- Sparse orthogonal **A\*** routing with bend penalty, obstacle inflation, equal-length/fewer-bend
  preference, dynamic non-row perimeter anchors and double-click reroute.
- **Layered crossing-reduction auto-layout** (TB/LR) with locked frames preserved exactly; dynamic perimeter
  anchors keep separate-side and reverse edges on distinct corridors.
- **Undo / redo** with 100 whole-document snapshots, toolbar buttons (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or
  `Ctrl+Y`), and 350 ms typing coalescing. History resets when switching scenes and shortcuts defer to native
  editing inside text fields.
- **File / Scene menus** in the top bar. File exports/imports a single scene (`.scene.json`) or the whole
  project (`umler-project.json`, all scenes plus the active scene); imports are validated, scene imports get a
  fresh id and unique title, and a project import asks for confirmation before replacing the in-session scenes.
  Scene can create a scene with
  square diagram-type icons, an auto-generated `Untitled <type> diagram` name until edited, and a Template
  (built-in example, default) or Empty start mode; it can also rename, duplicate with a numbered suffix, or
  delete with a warning. The top-bar scene switcher is the only scene list.
- **Layout panel toggle**: hide the left panel to let the canvas fill the workspace.
- **Floating object focus menus**: click a table header, section, row or other object and its editing controls
  appear beside the object; the side inspector is removed.
  - header: table name, stereotype for classes, Add row, Add section;
  - section: header text, Add row, Add section, Delete section; the divider above the rows is a dedicated hit
    strip so an untitled section remains selectable;
  - row: attribute/operation name, data type/return type, PK/FK/NN/UQ, Add row, Delete row;
  - other objects: their displayed text (name, lifeline label, image caption, or multi-line comment body);
  - header/object menus also delete the object and its attached connectors.
- **Lifelines only hit-test on the head and thin time axis**, so arrows, frames and notes crossing the lane stay
  selectable. The focus overlay follows the same head + axis geometry.
- **Clicking the dashed lifeline axis** opens a lifeline menu with the head label, **+ Add activation bar here**
  (the tall execution box on that lane at the clicked y), and **Delete lifeline**. Activation bars expose
  automatically generated, evenly spaced connection handles (about one every 54 pt, 3–7 handles per bar),
  can be dragged vertically, and have top/bottom resize handles. Connection handles stay visible while the bar
  is selected, the resize handles sit just outside its ends, and the selected blue axis is hidden under the bar.
  Hovering the body shows a move cursor; hovering the top/bottom border bands shows a vertical-resize cursor
  and starts a resize.
- **Scope-aware Delete/Backspace**: focused section → section, focused row → row, selected activation bar →
  activation, selected connector → connector, selected object → object plus attached connectors. Inputs/selects/
  content-editable elements keep native Delete behaviour.
- **Canvas text editing**: double-clicking any displayed text opens the matching floating menu, focuses its
  input and selects the existing value. Canvas text stays visible on pointer-down/drag, and node pointer
  capture is deferred until actual movement so native double-clicks reach the text element.
- **Split edge menus**: a compact per-end terminal menu (custom text field, `none` first, suggested cardinality
  chips, SVG terminal glyphs) and a separate line menu (center label, visual full/dashed/dotted previews with
  width on the same row, routing).
- **Connector endpoint reattachment**: drag either square endpoint handle onto another object or line to change
  only that source/target, with a live preview and the same port/snap resolution as drawing; a click without
  dragging still opens that end’s terminal menu.
- **Sequence messages are always straight**; the routing selector is hidden for sequence edges and legacy
  orthogonal flags are ignored by layout. When drawing from a port to a lifeline spine, the target snaps to an
  exact horizontal axis when within 5° of horizontal; hold **Alt** to bypass the snap.
- **Sequence messages can be dragged vertically**: both spine anchors move by the same grid-snapped delta and
  the line stays horizontal, with a live preview and click-to-open-menu preserved.
- Terminal click targets include the glyph and cardinality label; terminal/line hit layers sit below nodes, so
  clicking inside an entity selects the entity while only the outside portion of a terminal hit target opens
  the menu. Menus are placed outside the line and endpoint label, and centre-label clicks open the line menu
  beside the label.
- Double-clicking a cardinality label or the centre label opens the relevant menu and focuses/selects its text
  field.
- Endpoint cardinality labels are positioned outside the entity border, so delete/re-add keeps them near the
  terminal; no ordinary label leader is drawn.
- Terminal-glyph-aware connector shortening and label clearance: open-angle arrows keep the line at the
  vertex, while closed/filled/hollow terminals stop at the glyph base; labels stay off glyphs and the line.
- ER `one`/`oneOrMany` bars are padded from the entity border, and `zeroOrOne` places its bar behind the
  circle.
- **Label editing and collision avoidance** against solid node frames, terminal glyphs and other labels, with
  re-tethering. Centre and endpoint labels can be dragged; a dragged label stores a manual anchor-relative
  offset and bypasses automatic collision nudging until reset.
- **Use-case system boundaries are containers**: use cases fully enclosed by a boundary move with it and are
  laid out as one unit, with external edges remapped to the boundary for ranking. Partial overlaps do not count.
  Auto-layout also re-anchors each use-case edge to a favourable ellipse angle toward the partner’s new centre,
  so arrows do not remain stuck on the old side after a re-layout.
- **Elliptical use-case endpoints snap to the ellipse curve**, not the rectangular frame; the dynamic
  rectangle-anchor slide is skipped for ellipses. New/reattached ends choose the curve point facing the fixed
  partner end, so the line never cuts through the ellipse to an unfavourable far side. Auto-layout marks its
  ellipse anchors automatic and reevaluates them on every pass, so they keep following manually moved partners;
  manually placed anchors stay fixed. Orthogonal routing uses an axis-aligned approach stub at ellipse ends,
  avoiding the small diagonal V/spike where the route met the curve.
- Sequence sync/reply arrowheads, sequence-aware fit bounds and correct label layering above nodes.
- Inspector with frame, row, port, route and fit diagnostics.

## Verification

`npm run check` output:

```text
PASS ER commerce — 3 nodes, 2 edges, 0 errors, 0 warnings
PASS UML class payments — 4 nodes, 3 edges, 0 errors, 0 warnings
PASS UML sequence checkout — 3 nodes, 4 edges, 0 errors, 0 warnings
PASS UML use case shop — 6 nodes, 3 edges, 0 errors, 0 warnings
PASS UML state order — 5 nodes, 4 edges, 0 errors, 0 warnings
PASS UML communication checkout — 3 nodes, 3 edges, 0 errors, 0 warnings

layout: OK
  fixtures: 6
  ER nodes/ports/edges: 3/42/2
  ER content bounds: 585 × 207

Persistence checks passed (29 assertions).
```

Browser verification (Chrome DevTools): clicked table headers, sections, rows and other object text and
confirmed the correct floating control menu appeared beside the object; used native double-clicks on headers,
section titles, row names, data types, stereotypes, constraint
badges, frame text, image captions and lifeline labels and confirmed the matching field was focused and fully
selected; added a row from the floating table menu and verified the revision/table update; opened the compact
terminal menu by clicking both a terminal glyph and a cardinality label; verified custom-text deletion and
re-add returns the label beside the endpoint; confirmed the menu’s `none`-first ordering, per-end contents and
outside-the-line placement; clicked the centre label and confirmed the separate line menu opens beside it with
center label, line width/type and routing; applied ER and generic terminals; confirmed open-angle arrows meet
the line at the vertex and no dashed label leaders are drawn; double-clicked an edge to rerun A*; ran TB and LR
auto-layout; verified the LR communication reverse edges use separate corridors; asserted a locked node kept
its frame; checked the sequence skip note and framed-diagram guard; and verified zero route collisions/label
overlaps. Step 3 object-palette checks: opened **+ Add object** on ER, use-case, state and sequence diagrams and
confirmed each menu shows only relevant objects plus Comment/Image; opened the same menu by right-clicking
empty canvas space; confirmed a right-drag still pans without opening the menu; added a comment, image, use
case, state and sequence lifeline and confirmed selection/placement/focus; entered a two-line comment; and
dragged a connector from a new lifeline spine port to an existing lifeline; attached a new relationship
attribute to an existing ER relationship line; selected a sequence arrow through a lifeline lane; added an
activation bar from the lifeline axis menu, moved and resized it, and verified its handles are evenly spaced;
deleted only that activation with Delete; verified its connection handles stay visible over the selected bar,
that the selected blue axis is hidden beneath it, and the move/resize hover cursors; verified right/middle-drag
panning exits cleanly; verified sequence routing stays straight; verified the 5° horizontal snap and Alt bypass
while drawing; dragged a sequence message vertically; reattached a connector endpoint to another lifeline and
confirmed a click without dragging still opens the terminal menu; dragged centre labels to manual offsets;
reattached a line to a use-case ellipse at a diagonal and confirmed it chose the side facing the actor even when
dropped on the far side; moved a system boundary and confirmed its enclosed use
cases followed while auto-layout placed the boundary as one unit and re-anchored its edge to the ellipse side
facing the actor; moved the actor below the use case and confirmed the automatic anchor followed to the lower
ellipse side without another layout run and the route stayed fully orthogonal with no ellipse spike; cleared a
lifeline head label and confirmed it stayed empty; added/undo/redo an object with both toolbar and keyboard
shortcuts; created scenes via square type icons with auto names and Template/Empty starts; duplicated/renamed/
deleted scenes through the Scene menu and dialog warnings; exported and re-imported a scene with a unique title;
exported a six-scene project and re-imported a three-scene project, confirming the replacement dialog, active
scene restore and undo-history reset; imported broken JSON and confirmed the error toast; hid and restored the
layout panel with the canvas widening; and verified Delete removes a section, then its table, a row and a
connector without over-deleting.
Earlier Step 2 checks covered drag/resize, right-drag panning, stereotype centring, uniform table borders and
sequence fit bounds.

## Toolchain notes

- **Node.js 24.16**, npm 11.13.
- **React 19.3**, **Vite 8.3**, **TypeScript 5.9.3**.
- **Typst 0.15.1** installed system-wide.
- **CeTZ 0.5.3** and **oxifmt 1.0.0** pinned into the workspace-local `.typst/packages` path.

The Typst CLI's package downloader fails in this environment with
`native_tls connect failed: SEC_E_NO_CREDENTIALS`. The packages were fetched with Node and installed locally;
`npm run bootstrap:typst` reproduces that setup. The application's future Step 4 compiler should bundle a
versioned WASM compiler/packages rather than depending on the CLI downloader.

## Not implemented yet (Step 4 and later)

- Typst/CeTZ serializer, WASM compilation and final SVG/PDF preview swap.
- Autosave, recent-file history and embedding real image bytes in project files.
- Container-aware auto-layout for framed diagrams; sequence lane editing.
- Label dragging/pinning and multiline label wrapping.
- CeTZ-renderer glyph previews in terminal menus (the editor menu already uses SVG previews).

## Next

**Step 4 — CeTZ Render + Export:** serialize the committed scene/layout snapshot to Typst + CeTZ, compile in a
WASM worker, swap the final SVG preview behind a stale-revision guard, and add PDF/SVG export.
