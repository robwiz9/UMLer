#import "@preview/cetz:0.5.3"
#set page(width: 1180pt, height: 760pt, margin: 0pt)
#set text(font: "Arial", size: 10pt)

#cetz.canvas(length: 1pt, padding: 18, {
  import cetz.draw: *

  // ---- Reusable notation marks -------------------------------------------
  // CeTZ mark local frame: tip at (0,0); +x runs *back* along the path.
  register-mark("uml-hollow-triangle", style => {
    let (l, w) = (style.length, style.width)
    line((0, 0), (l, -w / 2), (l, w / 2), close: true, fill: white, stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (l, 0))
  })
  register-mark("uml-hollow-diamond", style => {
    let (l, w) = (style.length, style.width)
    line((0, 0), (l / 2, w / 2), (l, 0), (l / 2, -w / 2), close: true, fill: white, stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (l, 0))
  })
  register-mark("uml-filled-diamond", style => {
    let (l, w) = (style.length, style.width)
    line((0, 0), (l / 2, w / 2), (l, 0), (l / 2, -w / 2), close: true, fill: black, stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (l, 0))
  })
  register-mark("uml-open-arrow", style => {
    let (l, w) = (style.length, style.width)
    line((0, 0), (l, w / 2), stroke: style.stroke)
    line((0, 0), (l, -w / 2), stroke: style.stroke)
    // Base == tip so the path is not shortened.
    anchor("tip", (0, 0))
    anchor("base", (0, 0))
  })

  register-mark("er-one", style => {
    let w = style.width
    line((0, -w / 2), (0, w / 2), stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (0, 0))
  })
  register-mark("er-many", style => {
    let (l, w) = (style.length, style.width)
    line((l, 0), (0, w / 2), stroke: style.stroke)
    line((l, 0), (0, 0), stroke: style.stroke)
    line((l, 0), (0, -w / 2), stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (l, 0))
  })
  register-mark("er-zero-one", style => {
    let (l, w, r) = (style.length, style.width, style.width / 2)
    let circle-x = l + r
    let base-x = circle-x + r
    line((0, -w / 2), (0, w / 2), stroke: style.stroke)
    circle((circle-x, 0), radius: r, fill: white, stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (base-x, 0))
  })
  register-mark("er-one-many", style => {
    let (l, w) = (style.length, style.width)
    let bar-x = l + l / 3
    line((l, 0), (0, w / 2), stroke: style.stroke)
    line((l, 0), (0, 0), stroke: style.stroke)
    line((l, 0), (0, -w / 2), stroke: style.stroke)
    line((bar-x, -w / 2), (bar-x, w / 2), stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (bar-x, 0))
  })
  register-mark("er-zero-many", style => {
    let (l, w, r) = (style.length, style.width, style.width / 2)
    let circle-x = l + r
    let base-x = circle-x + r
    line((l, 0), (0, w / 2), stroke: style.stroke)
    line((l, 0), (0, 0), stroke: style.stroke)
    line((l, 0), (0, -w / 2), stroke: style.stroke)
    circle((circle-x, 0), radius: r, fill: white, stroke: style.stroke)
    anchor("tip", (0, 0))
    anchor("base", (base-x, 0))
  })

  // ---- Heading ------------------------------------------------------------
  content((28, 736), [*UMLer notation proof sheet* — CeTZ 0.5.3, 1 unit = 1pt], anchor: "west")
  content((28, 716), [Skeleton geometry and export share the same coordinate space; y is converted only at serialization.], anchor: "west")

  // ---- 1. Node skeletons ---------------------------------------------------
  let cls = (x: 36, y: 480, w: 240)
  group(name: "cls-order", {
    rect((cls.x, cls.y), (cls.x + cls.w, cls.y + 180), fill: white, stroke: 0.75pt)
    line((cls.x, cls.y + 144), (cls.x + cls.w, cls.y + 144), stroke: 0.75pt)
    line((cls.x, cls.y + 90), (cls.x + cls.w, cls.y + 90), stroke: 0.75pt)
    content((cls.x + cls.w / 2, cls.y + 162), [*Order*], anchor: "center")
    content((cls.x + cls.w / 2, cls.y + 150), [#text(size: 8pt, style: "italic")[«entity»]], anchor: "center")
    content((cls.x + 10, cls.y + 120), [#("- id: UUID")], anchor: "west")
    content((cls.x + 10, cls.y + 102), [#("- total: Money")], anchor: "west")
    content((cls.x + 10, cls.y + 66), [#("+ submit(): Receipt")], anchor: "west")
    content((cls.x + 10, cls.y + 48), [#("+ cancel(): void")], anchor: "west")
    content((cls.x + 10, cls.y + 30), [#("~ audit(): void")], anchor: "west")
    anchor("row-0-west", (cls.x, cls.y + 120))
    anchor("row-0-east", (cls.x + cls.w, cls.y + 120))
    anchor("row-2-east", (cls.x + cls.w, cls.y + 66))
  })

  group(name: "actor-customer", {
    circle((370, 600), radius: 15, fill: white, stroke: 0.75pt)
    line((370, 585), (370, 550), stroke: 0.75pt)
    line((344, 566), (396, 566), stroke: 0.75pt)
    line((370, 550), (351, 522), stroke: 0.75pt)
    line((370, 550), (389, 522), stroke: 0.75pt)
    content((370, 505), [Customer], anchor: "center")
    anchor("row-0-east", (388, 580))
  })

  circle((520, 585), radius: (67, 30), fill: white, stroke: 0.75pt, name: "uc-place")
  content((520, 585), [Place order])

  rect((650, 555), (790, 611), radius: 10, fill: white, stroke: 0.75pt)
  content((720, 583), [Awaiting payment])

  group(name: "seq-service", {
    rect((850, 640), (990, 668), fill: white, stroke: 0.75pt)
    content((920, 654), [:OrderService], anchor: "center")
    line((920, 640), (920, 500), stroke: (paint: black, thickness: 0.5pt, dash: "dashed"))
    rect((914, 560), (926, 620), fill: white, stroke: 0.75pt)
    anchor("spine-1", (920, 590))
  })
  line((812, 590), "seq-service.spine-1", mark: (end: ">"))
  content((820, 600), [submit()], anchor: "north-west")

  content((28, 452), [*1 · Node skeletons*: class table (row anchors), actor, use case, state, lifeline + activation], anchor: "west")

  // ---- 2. UML relationship markers + generic endings -----------------------
  let uml-y = 390
  content((28, 420), [*2 · UML relationship ends, generic arrow, plain line*], anchor: "west")
  let uml-labels = ("inheritance", "realization", "aggregation", "composition", "directed assoc.", "dependency", "generic arrow", "plain line")
  let uml-samples = (
    (start: none, end: (symbol: "uml-hollow-triangle", length: 0.34cm, width: 0.30cm)),
    (start: none, end: (symbol: "uml-hollow-triangle", length: 0.34cm, width: 0.30cm)),
    (start: (symbol: "uml-hollow-diamond", length: 0.44cm, width: 0.28cm), end: none),
    (start: (symbol: "uml-filled-diamond", length: 0.44cm, width: 0.28cm), end: none),
    (start: none, end: (symbol: "uml-open-arrow", length: 0.30cm, width: 0.26cm)),
    (start: none, end: (symbol: "uml-open-arrow", length: 0.30cm, width: 0.26cm)),
    (start: none, end: (symbol: "straight", length: 0.30cm, width: 0.26cm)),
    (start: none, end: none),
  )
  for (i, sample) in uml-samples.enumerate() {
    let x = 40 + i * 138
    line((x, uml-y), (x + 70, uml-y), stroke: (paint: black, thickness: 0.75pt, dash: if i == 1 or i == 5 { "dashed" } else { "solid" }), mark: sample)
    content((x + 35, uml-y - 14), [#uml-labels.at(i)], anchor: "south", size: 8pt)
  }

  // ---- 3. ER cardinality markers -------------------------------------------
  let er-y = 300
  content((28, 330), [*3 · ER crow's-foot ends (optional; text cardinality is equally valid — see 4)*], anchor: "west")
  let er-labels = ("one", "many", "zero or one", "one or many", "zero or many")
  let er-marks = ("er-one", "er-many", "er-zero-one", "er-one-many", "er-zero-many")
  for (i, symbol) in er-marks.enumerate() {
    let x = 40 + i * 205
    line((x, er-y), (x + 118, er-y), stroke: 0.75pt, mark: (end: (symbol: symbol, length: 0.26cm, width: 0.30cm)))
    content((x + 59, er-y - 14), [#er-labels.at(i)], anchor: "south", size: 8pt)
  }

  // ---- 4. Text cardinality + orthogonal relation-attribute tether ----------
  let rel-y = 150
  content((28, 240), [*4 · Text cardinality endpoints + orthogonal relation-attribute tether*: source label · centre name · target label], anchor: "west")

  // Relation-attribute box above the relationship line, centred on the tether.
  rect((270, 175), (450, 225), fill: white, stroke: 0.75pt)
  line((270, 205), (450, 205), stroke: 0.5pt)
  content((360, 216), [*order_line*], anchor: "center")
  content((280, 194), [#("quantity: int")], anchor: "west")
  content((280, 182), [#("unit_price: Money")], anchor: "west")
  anchor("rel-attr-south", (360, 175))

  line((252, rel-y), (460, rel-y), stroke: 0.75pt, name: "rel")
  line("rel-attr-south", (name: "rel", anchor: 50%), stroke: (paint: black, thickness: 0.5pt, dash: "dashed"))
  content((390, rel-y + 12), [places], anchor: "south", fill: white, padding: 2)
  content((270, rel-y + 12), [0..n], anchor: "south")
  content((442, rel-y + 12), [1], anchor: "south")
  content((252, rel-y - 12), [Customer], anchor: "south-east")
  content((460, rel-y - 12), [Order], anchor: "north-west")

  // Text-only m:n: the two endpoint labels carry the semantics; no crow's feet.
  line((280, 105), (440, 105), stroke: 0.75pt)
  content((280, 117), [0..n], anchor: "south")
  content((440, 117), [0..n], anchor: "south")
  content((360, 86), [Text-only m:n — two endpoint labels, no markers], anchor: "center", size: 8pt)

  content((28, 30), [Proof compiled from the actual CeTZ 0.5.3 package; custom marks and row/spine/edge anchors are exercised.], anchor: "west", size: 8pt)

})
