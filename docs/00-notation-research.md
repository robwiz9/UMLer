# 00 — Notation research: ER and the five UML diagram types

**Status:** research note for Step 1. This is a visual/notation specification, not a claim that the app
will implement the complete UML metamodel.

**Normative anchors**

- UML notation and semantics: OMG *Unified Modeling Language*, version 2.5.1, formal/17-12-05
  ([specification page](https://www.omg.org/spec/UML/2.5.1/), [PDF](https://www.omg.org/spec/UML/2.5.1/PDF)).
- ER model: Peter Chen, *The Entity–Relationship Model—Toward a Unified View of Data*, ACM TODS 1(1),
  1976 ([DOI](https://dl.acm.org/doi/10.1145/320434.320440)).
- CeTZ: the supplied `cetz.pdf` is the **0.5.3** API manual; see also
  [CeTZ docs](https://cetz-package.github.io/), [marks](https://cetz-package.github.io/docs/basics/marks/) and
  [anchors](https://cetz-package.github.io/docs/basics/anchors/).

The app is an editor, so it needs both **notation** (what a shape means) and **formality** (which
combinations are legal). The data model keeps semantics explicit; the renderer never guesses meaning from
pixels.

## 1. Cross-cutting rules

| Concern | Convention used by UMLer |
|---|---|
| Geometry | Node frames and route points are grid-snapped scene points (1 pt). Text and ports are derived from those frames. |
| Line meaning | Solid = structural/association/transition; dashed = realization, dependency, reply, include/extend, relation-attribute tether. Dash never carries meaning alone: the marker and semantic kind are stored too. |
| Direction | Arrowheads point in the direction of the semantic relationship (e.g. dependency → supplier, generalization → parent, message → receiver). Aggregation/composition diamonds sit at the *whole* end. |
| Labels | Three edge zones: **source**, **center**, **target**. Source/target are for multiplicities or role names; center is for the association/relation/message/transition name. |
| Text | Labels are single-line by default with an explicit max width. Ellipsis is a rendering policy; the full text stays in the document. |
| Color | Color is secondary. Keys, stereotypes and marker shapes must remain recognizable in grayscale. |
| Grid | 9 pt default (= 12 CSS px at 96 dpi). Nodes resize in whole cells; ports are centered per row and are not themselves snapped away from the row. |
| Selection | The UI edits the scene graph; CeTZ output is a projection. Nothing is “typed in Typst” as the source of truth. |

## 2. ER diagrams

### 2.1 Chen notation (conceptual)

- **Entity** = rectangle; **relationship** = diamond; **attribute** = ellipse connected by a thin line.
- **Key attributes** are underlined. Weak entities use a double rectangle; identifying relationships use a
  double diamond. Multi-valued and derived attributes have their own conventions.
- **Cardinality/participation** is written next to the connecting line: `1`, `N`, `M`, `(0,N)`, etc.
  Chen's original model separates cardinality ratio from total/partial participation.
- **Relationship attributes** hang from the diamond, not from one participant.
- **N-ary relationships** are a single diamond with one line per participant.

### 2.2 Table / IE / crow's-foot notation (logical and physical)

- **Entity** = table with a header and attribute rows. Primary key is marked (often bold/underlined); the
  app uses a `PK` badge and keeps the row text editable.
- **Relationship** = line between tables. The **maximum** is the symbol nearest the entity: a bar for one,
  a crow's foot for many. The **minimum** is outboard of it: a circle for zero, a bar for one.
  - one: bar
  - many: crow's foot
  - zero or one: circle + bar
  - one or many: bar + crow's foot
  - zero or many: circle + crow's foot
- A many-to-many relationship becomes an **associative/join table**; this is also the natural home for
  relationship attributes in a physical model.
- A **relation-attribute node** is a compact box/table containing a heading and one attribute section, tethered
  to the relationship line (or to a relationship diamond in Chen mode).

### 2.3 UMLer decision

UMLer is **table-first** for ER: an entity is a multi-compartment table, and connectors default to
crow's-foot endpoints. A Chen-style relationship diamond node is available for n-ary relationships and for
teams that prefer conceptual ER. Relation attributes are first-class nodes that can attach to the midpoint
of a relationship line (edge-to-edge attachment). The tether from a relation-attribute box should leave the
box **orthogonally** and meet the relationship line at a right angle; it should not join the line diagonally.

Cardinality has two valid presentations in UMLer:

- **Crow's-foot terminals** at the ends (the default ER mode).
- **Text cardinality labels** at the ends, with no marker: `1`, `0..1`, `0..n`, `1..n`, `1..*`, `*`,
  or arbitrary free text. This is a per-end choice; one end can be a crow's foot while the other is text.
- A **plain line** with neither marker nor endpoint label is also valid when the relation is intentionally
  unspecified.

The two endpoint labels represent the semantic cardinalities of the roles. They are **not** a single
whole-relationship “m:n” badge: a many-to-many relationship is represented by one endpoint label at *each*
end, for example `0..n` and `0..n` (or two crow's feet). Labels are free text and are never silently
overwritten; quick-select chips (`0`, `1`, `0..1`, `0..n`, `1..n`, `1..*`, `*`) are insertion shortcuts only.
The non-standard form `1..0` is accepted as free text but is not offered as a preset.

## 3. UML Use Case diagrams

- **Actor**: stick figure, name below; actors live outside the subject boundary. Actor generalization uses a
  hollow triangle.
- **Use case**: ellipse with the action/goal phrase inside.
- **Subject/system boundary**: optional rectangle around the use cases; the name is usually in a tab or at
  the top-left.
- **Association**: solid line from actor to use case, normally without an arrowhead.
- **Include**: dashed arrow from the base use case to the included use case, labelled `«include»`.
- **Extend**: dashed arrow from the extending use case to the base use case, labelled `«extend»`.
- **Generalization**: solid line with a hollow triangle pointing at the more general use case/actor.

Layout: actors in outside columns, use cases inside the boundary; include/extend chains should read in the
direction of the arrows; avoid crossing actor associations.

## 4. UML Class diagrams

- **Class/interface**: rectangle with name, attributes and operations compartments. The name compartment may
  contain `«interface»`, `«abstract»` or another stereotype; abstract names are italic. Interface names can
  alternatively use the `«interface»` keyword.
- **Visibility**: `+` public, `-` private, `#` protected, `~` package. Static members are underlined.
  A row may also carry a **custom literal prefix**; it overrides the visibility icon and is rendered as text
  (`- id: UUID` must not turn into a Typst bullet list).
- **Attributes**: `name: Type`; operations: `name(params): ReturnType`.
- **Association**: solid line; navigable association uses an open arrow at the target.
- **Aggregation**: hollow diamond at the whole end.
- **Composition**: filled diamond at the whole end.
- **Generalization**: solid line, hollow triangle at the parent.
- **Realization**: dashed line, hollow triangle at the interface.
- **Dependency**: dashed line, open arrow at the supplier.
- **Multiplicity** at each end (`1`, `0..1`, `1..*`, `*`); role names may sit near the ends.

Layout: inheritance/realization hierarchies top-down (parent/interface above), composition near the whole,
and association labels offset from the line. Avoid routing through compartments; ports attach to the table
border, never to the text.

## 5. UML Sequence diagrams

- **Lifeline**: head box (object/class/actor) with a dashed vertical line. Time runs top-to-bottom.
- **Activation**: thin rectangle on the lifeline; nested activations are narrower and offset.
- **Messages**:
  - synchronous call: solid line, filled arrowhead;
  - asynchronous signal: solid line, open arrowhead;
  - reply: dashed line, open arrowhead;
  - create/delete: message to the new lifeline head / `X` at the destruction point.
- **Fragments** (`alt`, `opt`, `loop`, `par`, `critical`, …) use a frame with a pentagon label and guards.
- **Execution specification** may carry entry/exit actions in detailed models; not required for the first
  editor pass.

Layout: x-positions are lanes; y is time. Message labels sit above the arrow and do not move the lifeline.
Our model stores messages as edges with `spine` attachments (`t ∈ [0,1]`), so moving a lifeline preserves the
message’s vertical order.

## 6. UML Communication diagrams

- **Object boxes**: rectangle with `name: Class` or `:Class`; the name is underlined.
- **Links**: solid lines between objects. A message is attached to a link and labelled with a **sequence
  number**: `1`, `1.1`, `1.2`, `2`, … (nested decimal numbering encodes call nesting).
- **Direction**: an arrow on the link indicates the receiver; a link may carry messages in both directions.
- No lifelines or global time axis: sequence numbers carry ordering, so crossing reduction is the primary
  layout concern.

UMLer reuses the generic object node and connector, with `EdgeSemantic.family = "communication"` storing the
sequence number and optional signature.

## 7. UML State Machine diagrams

- **State**: rounded rectangle with the state name; optional internal activities (`entry / …`, `do / …`,
  `exit / …`).
- **Initial pseudostate**: small filled circle. **Final state**: bullseye (outer circle + filled inner circle).
- **Transition**: solid arrow labelled `trigger [guard] / effect`; the guard and effect are optional.
- **Choice**: diamond; **fork/join**: solid bar; **terminate**: `X`; entry/exit points on composite states.
- Composite states contain nested regions and may have entry/exit points.

Layout: layered left-to-right or top-to-bottom; cycles are allowed and should be drawn with explicit
waypoints. Transition labels sit near the middle and must not obscure the arrowhead.

## 8. What the editor must not do

- Do not infer a relationship’s semantics from the glyph alone. A hollow triangle could be realization or
  inheritance depending on line style and context; store the semantic kind and the marker.
- Do not move a row port away from its row to satisfy snapping.
- Do not silently reflow a diagram after every edit; auto-layout is an explicit command and respects locks.
- Do not export editor-only affordances (selection, ports, grid) unless the user explicitly asks for them.
- Do not let a label’s rendered width feed back into node geometry during a drag. Measure against fixed row
  bands; overflow is truncated or wrapped by policy.

## 9. Sources and further reading

- OMG UML 2.5.1 — [specification](https://www.omg.org/spec/UML/2.5.1/), [PDF](https://www.omg.org/spec/UML/2.5.1/PDF).
- P. Chen, *The Entity–Relationship Model—Toward a Unified View of Data*, ACM TODS, 1976
  ([DOI](https://dl.acm.org/doi/10.1145/320434.320440)).
- Entity–relationship model overview and crow's-foot summary:
  [Wikipedia](https://en.wikipedia.org/wiki/Entity%E2%80%93relationship_model) (secondary source; use the
  primary notation sources above for formal work).
- CeTZ manual, version 0.5.3 (`cetz.pdf`) and [CeTZ docs](https://cetz-package.github.io/).
- The notation proof sheet in `docs/assets/notation-proof.png` was compiled from the actual CeTZ package,
  not drawn by hand.
