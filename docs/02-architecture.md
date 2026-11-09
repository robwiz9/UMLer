# 02 — Architecture: skeleton-first editor with CeTZ as the render core

**Status:** architecture note. Step 2 implements the Phase 1 canvas, Step 3 implements A* routing, layered
auto-layout, endpoint menus and table editing (see [05 — Step 3](05-step3-editor.md)). Phase 2 Typst compilation
and final preview remain Step 4.

## 1. Why two phases

An editor needs immediate feedback; Typst compilation is too slow and too stable-by-design to run on every
pointer move. A two-phase pipeline gives both:

```text
pointer / command
      │
      ▼
Phase 1 — interactive skeleton
  scene graph → measured text → row bands → ports
  → grid snapping → obstacles → edge preview → hit testing
      │  (rAF, transient override)
      ▼
commit (revision++), debounce 120–250 ms
      │
      ▼
Phase 2 — CeTZ compilation
  scene + layout snapshot → Typst/CeTZ source
  → WASM compiler (worker) → SVG/PDF
  → swap preview only if revision is current
```

### Phase 1: skeleton and geometry pass

Runs synchronously in the UI thread for drag/selection and in a worker for heavy auto-layout.

1. **Measure.** Use a deterministic measurer (Canvas 2D or an offscreen DOM element) with the exact embedded
   font. Rows are single-line by default; measure text once per `(text, style, maxWidth)` revision.
2. **Build bands.** Header band, section bands, row bands, badge frames, actor/ellipse/state frames, lifeline
   head/spine/activations.
3. **Resolve ports.** Row west/east ports, perimeter compass ports, arbitrary-angle ports, lifeline `spine`
   ports, activation top/bottom ports.
4. **Resolve attachments.** Node reference → port point/normal; edge reference → path point at `t`; free
   point → as-is.
5. **Route preview.** Straight/orthogonal/polyline route, A* only when requested, or the auto-layout route.
6. **Produce `LayoutSnapshot`.** Persist nothing; include `sceneRevision` so late async results can be
   discarded.
7. **Draw skeleton.** DOM/SVG is ideal: crisp lines, CSS hit areas, cheap text editing, accessible focus
   rings. Canvas 2D is only for very large grids/minimaps.

The skeleton is deliberately **not** a low-resolution Typst render. It is a wireframe representation of the
same geometry, so ports and snapping remain responsive.

### Phase 2: CeTZ compilation

1. Serialize the committed `SceneDocument` + `LayoutSnapshot` into human-readable Typst.
2. Compile with Typst WASM in a dedicated worker (or call a local `typst` process in desktop/CLI mode).
3. Receive SVG (preview) / PDF (export) + diagnostics.
4. Verify `result.revision === currentRevision`; otherwise discard.
5. Swap the preview atomically. Keep the skeleton if compilation fails and surface the Typst diagnostic
   mapped back to the scene object.

CeTZ is the **rendering and export core**, not the interactive renderer. This avoids trying to make a Typst
compile keep up with a 120 Hz drag.

## 2. Single source of truth

| Data | Persisted? | Owner |
|---|---|---|
| Semantic scene (`SceneDocument`) | yes | document store / undo stack |
| Manual frames, waypoints, label offsets, locks | yes | document store |
| Measured text, row bands, ports, routed points | no | `LayoutSnapshot` |
| Typst source | no (derived) | serializer (Step 4) |
| Compiled SVG/PDF | no (cache) | compiler worker |
| Camera/zoom/selection | session (optional autosave) | `EditorSession` |

The Phase 1 pass and Phase 2 serializer must consume the **same** `LayoutSnapshot`. If the serializer needs a
value (e.g. a label frame), it reads it rather than recomputing it.

## 3. Canvas and snapping

- Infinite scene: no fixed document width/height; content bounds drive the scrollbars/minimap.
- Camera: CSS transform `translate(...) scale(...)` for the skeleton; SVG `viewBox` for the preview. Pan and
  zoom never mutate scene coordinates.
- Grid: 9 pt default; major lines every 4 cells. Snapping is applied to node `x/y/width/height`, waypoints and
  (optionally) labels. Row ports keep their row’s y coordinate; they snap only on the x border.
- Resize: snap each edge independently; enforce a minimum size of one grid cell.
- Hit testing: DOM elements or an R-tree of inflated node/port/label frames. Ports have a larger invisible
  target than their rendered dot.
- Locked objects: `locked` on nodes/waypoints/labels. A locked node keeps its **current frame** during
  auto-layout and acts as a fixed constraint; unlocked nodes lay out around it. This is how a user can keep
  two entities next to each other. Manual drag remains available; the new position becomes the constraint.
  Waypoint/label locks follow the same principle within their passes. If every movable object is locked,
  auto-layout is a no-op. The UI shows a lock badge and excludes the object only from automatic movement,
  not from selection or deliberate manual movement.

## 4. Crossing-reduction auto-layout

Default engine: layered Sugiyama-style layout for class/ER/state/use-case/communication graphs.

1. **Constraint collection.** Build the obstacle graph; locked nodes are fixed at their current frames and
   participate as obstacles, not as free variables.
2. **Cycle breaking.** DFS/Greedy-FAS on directed semantic edges; reversed edges are remembered for drawing.
3. **Layering.** Longest-path or network-simplex ranking. Parent/generalization edges prefer rank+1. When all
   nodes in a component are locked, skip that component.
4. **Ordering.** Barycenter/median sweep with adjacent exchanges to reduce crossings. This is the
   crossing-reduction phase; it is iterative and bounded by `maxIterations`.
5. **Coordinate assignment.** Brandes–Köpf-style alignment or priority method; unlocked nodes snap to grid
   while locked frames remain exactly where the user placed them. Relative offsets between locked neighbours
   are preserved because neither is moved.
6. **Port assignment.** Choose row/edge side based on relative position; avoid identical port points.
7. **Edge routing.** Orthogonal A* with bend and crossing penalties; see below.
8. **Label pass.** Place labels in the least-colliding free slot; respect pinned labels.
9. **Commit only if improved.** Compare weighted crossings + bends + overlap; keep the previous layout if
   not better. Locked objects are invariant.

Sequence/communication diagrams need different heuristics:

- **Sequence:** x = lanes, y = time. Never let auto-layout reorder messages; assign lane spacing only.
- **Communication:** graph layout is primary; sequence numbers are labels, not y-coordinates.

## 5. Orthogonal A* router

Inputs: source point + normal, target point + normal, inflated node obstacles, existing edge segments
(soft obstacles), bend penalty, crossing penalty, stub length.

- Build a sparse visibility graph on a routing grid (or a Hanan grid of obstacle edges/port coordinates),
  not a full-cell grid for large scenes.
- State = `(point, direction)` so bend cost is explicit. This is A* over an **orthogonal state graph**.
- Reject paths that cut through a node’s inflated bounds; allow source/target node interiors to be escaped by
  the stub.
- Prefer routes that reuse an existing corridor (small bonus) to produce tidy diagrams.
- Cache by `(sourcePort, targetPort, obstacleSignature, waypointSignature)`. Invalidate on any node/edge
  change.
- Double-clicking an edge sets `routing.mode = "orthogonal"` and `avoidObstacles = true` and reruns the
  router. A manual waypoint switches the edge to manual mode.
- If A* fails, fall back to the current polyline and show a non-blocking diagnostic; never delete the edge.

## 6. Endpoint menus

- Selecting an edge shows two endpoint handles. Clicking a handle opens a popover anchored to the handle,
  not to the cursor.
- The popover lists UML presets, ER crow’s-foot ends, and explicit **text cardinality / plain line** modes,
  with live SVG glyph previews. It also offers **generic open/filled arrows** that carry no UML/ER meaning.
- Choosing a preset updates `markers` and (for realization/dependency) the stroke pattern. Overriding the
  line style afterward keeps the marker.
- Choosing **Text cardinality** clears the marker and focuses the source/target label editor. Choosing **Plain
  line** clears both. Mixed endpoints (crow’s foot on one end, text on the other) are valid.
- The same component is reused by the inspector; no duplicated marker tables.

## 7. Labels

- Three zones per edge, each with `anchor` (`edgePoint(t)` or endpoint) and an offset.
- Dragging a label stores `offset` and `locked`/`pinned`; the tether is recomputed from the current route.
- Quick-select chips (`0`, `1`, `0..1`, `0..n`, `1..n`, `1..*`, `*`) insert text but do not lock the input.
  Endpoint labels are independent; an m:n relation is two endpoint labels, not a middle badge.
- Labels render above edges, below selection handles. Background fill + padding prevents line-through-text.
- Collision pass: resolve label-label and label-node overlaps deterministically, then snap only if
  `snapLabels` is on.

## 8. Foreign objects and assets

- Image node stores `assetId`, fit, caption, alt text and frame.
- Assets live in IndexedDB/OPFS keyed by checksum; the scene JSON stores metadata + relative export path.
- The browser preview loads a blob URL; the Typst worker receives a virtual file with the same path.
- Images are obstacles for A* and auto-layout. Captions are labels and do not affect the image frame.
- SVG sanitisation is required before embedding untrusted SVG; raster decoding happens off the main thread.

## 9. Performance budgets

| Interaction | Budget |
|---|---|
| Pointer move → skeleton update | ≤ 16 ms (single node/edge drag) |
| 500-node layout pass | ≤ 250 ms in worker |
| A* single edge, 500 obstacles | ≤ 20 ms |
| CeTZ compile, 100 nodes | ≤ 1.5 s, debounced |
| Preview swap | no visible flash; keep old SVG until new is ready |

Use `requestAnimationFrame` coalescing, `ResizeObserver` for the container, and an offscreen measurement cache.
Do not run auto-layout on every drag frame; show the skeleton and commit on pointer-up.

## 10. Security and determinism

- Typst compilation is untrusted input. Run WASM in a worker with no DOM access; in native mode use a
  temporary directory and resource limits.
- Escape Typst markup when inserting user text; never concatenate raw strings into a content block.
- Pin `@preview/cetz:0.5.3` and `@preview/oxifmt:1.0.0` in the package manifest/lockfile. A package update is
  a deliberate migration, not an implicit `latest`.
- Normalise floats before serialization (`roundTo(3)`) so re-exports are byte-stable.
- Keep a schema version and migration path; unknown fields are preserved where safe, but not trusted.

## 11. Toolchain (Step 1)

- Node 24.16, npm 11.13, TypeScript 5.9.3.
- Typst 0.15.1 locally; CeTZ 0.5.3 downloaded into the workspace-local package path `.typst/packages`.
- The CLI’s own downloader fails in this environment with `SEC_E_NO_CREDENTIALS`; the packages were fetched by
  Node and installed locally. The app must use the WASM compiler with its own package bundle, not rely on the
  Typst CLI downloader.
- No application framework is chosen yet. Step 1 is framework-agnostic TypeScript; the UI shell will be
  selected in Step 2.
