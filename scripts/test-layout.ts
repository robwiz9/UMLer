import assert from "node:assert/strict";
import { ER_COMMERCE, STEP1_FIXTURES, UML_CLASS_PAYMENTS, UML_COMMUNICATION_CHECKOUT, UML_SEQUENCE_CHECKOUT, UML_USE_CASE_SHOP } from "../src/fixtures/index.ts";
import { buildLayoutSnapshot, withNodeFrames } from "../src/layout/build-layout.ts";
import { autoLayoutFrames } from "../src/layout/auto-layout.ts";
import { FixedTextMeasurer } from "../src/layout/text.ts";
import {
  createEmptyScene,
  DEFAULT_LAYOUT,
  LAYOUT_SPACING_PRESETS,
  type SceneDocument,
} from "../src/model/scene.ts";
import { DEFAULT_THEME, MONO_FONT } from "../src/model/styles.ts";
import { rect } from "../src/model/geometry.ts";
import { asActivationId, asEdgeId, asNodeId } from "../src/model/ids.ts";
import { NO_MARKER } from "../src/model/edges.ts";
import {
  nearestPort,
  resizeFrameFromCorner,
  snapMovingFrame,
  snapResizedFrame,
} from "../src/layout/snap.ts";
import { validateScene } from "../src/model/validate.ts";
import { createEdgeForDiagram } from "../src/model/edge-create.ts";
import { createObjectFromTemplate } from "../src/model/object-catalog.ts";
import {
  addActivation,
  commitAutoLayout,
  insertConnectedObject,
  insertEdge,
  moveSequenceEdge,
  setEdgeAttachment,
  setEdgeLabelTextStyle,
  setEndpointLabel,
  setSceneTheme,
  updateRow,
  updateActivation,
} from "../src/model/edits.ts";
import type { Point, Rect } from "../src/model/geometry.ts";

const measurer = new FixedTextMeasurer();
const layout = buildLayoutSnapshot(ER_COMMERCE, measurer);

for (const fixture of STEP1_FIXTURES) {
  const diagnostics = validateScene(fixture.scene);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  assert.equal(errors.length, 0, `${fixture.name} has validation errors: ${JSON.stringify(errors)}`);
  const fixtureLayout = buildLayoutSnapshot(fixture.scene, measurer);
  assert.equal(Object.keys(fixtureLayout.nodes).length, Object.keys(fixture.scene.nodes).length);
  assert.equal(Object.keys(fixtureLayout.edges).length, Object.keys(fixture.scene.edges).length);
  assert.ok(fixtureLayout.contentBounds.width > 0);
  assert.ok(fixtureLayout.contentBounds.height > 0);
  for (const edge of Object.values(fixtureLayout.edges)) {
    for (const label of edge.labels) {
      for (const node of Object.values(fixtureLayout.nodes)) {
        if (node.kind === "frame" || node.kind === "lifeline") continue;
        const overlaps =
          label.frame.x < node.frame.x + node.frame.width &&
          label.frame.x + label.frame.width > node.frame.x &&
          label.frame.y < node.frame.y + node.frame.height &&
          label.frame.y + label.frame.height > node.frame.y;
        assert.ok(
          !overlaps,
          `${fixture.name}: label "${label.text.text}" overlaps node "${node.nodeId}"`,
        );
      }
    }
  }
  const labels = Object.values(fixtureLayout.edges).flatMap((edge) => edge.labels);
  for (const edge of Object.values(fixtureLayout.edges)) {
    for (const label of edge.labels) {
      for (let index = 1; index < edge.points.length; index += 1) {
        const a = edge.points[index - 1] as Point;
        const b = edge.points[index] as Point;
        const thick = 1.5;
        const segment = a.y === b.y
          ? {
              x: Math.min(a.x, b.x) - thick,
              y: a.y - thick,
              width: Math.abs(b.x - a.x) + thick * 2,
              height: thick * 2,
            }
          : a.x === b.x
            ? {
                x: a.x - thick,
                y: Math.min(a.y, b.y) - thick,
                width: thick * 2,
                height: Math.abs(b.y - a.y) + thick * 2,
              }
            : null;
        if (segment === null) continue;
        const overlaps =
          label.frame.x < segment.x + segment.width &&
          label.frame.x + label.frame.width > segment.x &&
          label.frame.y < segment.y + segment.height &&
          label.frame.y + label.frame.height > segment.y;
        assert.ok(
          !overlaps,
          `${fixture.name}: label "${label.text.text}" overlaps its edge line`,
        );
      }
    }
  }
  for (let first = 0; first < labels.length; first += 1) {
    for (let second = first + 1; second < labels.length; second += 1) {
      const a = labels[first] as (typeof labels)[number];
      const b = labels[second] as (typeof labels)[number];
      const overlaps =
        a.frame.x < b.frame.x + b.frame.width &&
        a.frame.x + a.frame.width > b.frame.x &&
        a.frame.y < b.frame.y + b.frame.height &&
        a.frame.y + a.frame.height > b.frame.y;
      assert.ok(
        !overlaps,
        `${fixture.name}: labels "${a.text.text}" and "${b.text.text}" overlap`,
      );
    }
  }
}

const customers = layout.nodes.customers;
assert.ok(customers !== undefined);
assert.equal(customers.kind, "table");
if (customers.kind !== "table") throw new Error("unreachable");
assert.equal(customers.sections.length, 1);
assert.equal(customers.sections[0]?.rows.length, 3);

const firstRow = customers.sections[0]?.rows[0];
assert.ok(firstRow !== undefined);
const leftPort = layout.ports[firstRow.leftPortId];
const rightPort = layout.ports[firstRow.rightPortId];
assert.ok(leftPort !== undefined && rightPort !== undefined);
assert.equal(leftPort.point.x, customers.frame.x);
assert.equal(rightPort.point.x, customers.frame.x + customers.frame.width);
assert.ok(Math.abs(leftPort.point.y - (firstRow.frame.y + firstRow.frame.height / 2)) < 1e-6);
assert.equal(leftPort.ref.kind, "row");

const customersPorts = Object.values(layout.ports).filter((port) => port.nodeId === "customers");
const perimeter = customersPorts.filter((port) => port.ref.kind === "perimeter");
assert.equal(perimeter.length, 4);
for (const port of perimeter) {
  const onVertical = Math.abs(port.point.x - customers.frame.x) < 1e-6 ||
    Math.abs(port.point.x - (customers.frame.x + customers.frame.width)) < 1e-6;
  const onHorizontal = Math.abs(port.point.y - customers.frame.y) < 1e-6 ||
    Math.abs(port.point.y - (customers.frame.y + customers.frame.height)) < 1e-6;
  assert.ok(onVertical || onHorizontal, "perimeter port must be on the frame border");
}
const eastPerimeter = perimeter.find((port) => port.ref.kind === "perimeter" && port.ref.side === "east");
assert.ok(eastPerimeter !== undefined);
assert.ok(
  Math.abs(eastPerimeter.point.y - (customers.header.frame.y + customers.header.frame.height / 2)) < 1e-6,
  "table side handles must sit at the header centre",
);

const places = layout.edges.edge_places;
const orderLine = layout.edges.edge_order_line;
assert.ok(places !== undefined && orderLine !== undefined);
assert.equal(places.routedBy, "astar");
assert.equal(orderLine.routedBy, "astar");
assert.equal(places.points[0]?.x, customers.frame.x + customers.frame.width);
assert.ok((places.points[0]?.y ?? 0) > customers.frame.y);
assert.ok((places.points[0]?.y ?? 0) < customers.frame.y + customers.frame.height);
assert.equal(places.bendCount, 0);
assert.equal(orderLine.bendCount, 0);
assert.ok(places.points.length >= 2);

const pointAtPolyline = (points: readonly Point[], t: number): Point => {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(segment);
    total += segment;
  }
  let remaining = total * t;
  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index] ?? 0;
    if (remaining <= segment) {
      const a = points[index] as Point;
      const b = points[index + 1] as Point;
      const ratio = segment === 0 ? 0 : remaining / segment;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= segment;
  }
  return points[points.length - 1] as Point;
};

const expectedTether = pointAtPolyline(places.points, 0.5);
const tetherEnd = orderLine.points[orderLine.points.length - 1] as Point;
assert.ok(Math.abs(tetherEnd.x - expectedTether.x) < 1e-6);
assert.ok(Math.abs(tetherEnd.y - expectedTether.y) < 1e-6);

const orderLineNode = layout.nodes.order_line;
assert.ok(orderLineNode !== undefined);
const orderLineSource = orderLine.points[0] as Point;
assert.ok(
  orderLineSource.x > orderLineNode.frame.x + 1 &&
    orderLineSource.x < orderLineNode.frame.x + orderLineNode.frame.width - 1,
  "dynamic perimeter anchor must stay away from table corners",
);
assert.equal(orderLineSource.y, orderLineNode.frame.y);
const insideOrderLine = orderLine.points.some(
  (p) =>
    p.x > orderLineNode.frame.x + 1e-6 &&
    p.x < orderLineNode.frame.x + orderLineNode.frame.width - 1e-6 &&
    p.y > orderLineNode.frame.y + 1e-6 &&
    p.y < orderLineNode.frame.y + orderLineNode.frame.height - 1e-6,
);
assert.ok(!insideOrderLine, "relation-attribute route must not run under its table");
const orderLineLabel = orderLine.labels.find((entry) => entry.text.text === "line items");
assert.ok(orderLineLabel !== undefined);
const overlapsTable =
  orderLineLabel.frame.x < orderLineNode.frame.x + orderLineNode.frame.width &&
  orderLineLabel.frame.x + orderLineLabel.frame.width > orderLineNode.frame.x &&
  orderLineLabel.frame.y < orderLineNode.frame.y + orderLineNode.frame.height &&
  orderLineLabel.frame.y + orderLineLabel.frame.height > orderLineNode.frame.y;
assert.ok(!overlapsTable, "relation-attribute label must clear its table");

// A chain of edge-to-edge attachments needs one resolution pass per link.
// The pass limit must not shrink with the pending list, or the last edge is
// silently dropped from the snapshot.
const chainedEdge = createEdgeForDiagram(
  ER_COMMERCE,
  { nodeId: asNodeId("customers"), port: { kind: "perimeter", side: "south" } },
  { edgeId: asEdgeId("edge_order_line"), t: 0.5 },
);
assert.ok(chainedEdge !== null);
const chainedLayout = buildLayoutSnapshot(insertEdge(ER_COMMERCE, chainedEdge), measurer);
assert.equal(
  Object.keys(chainedLayout.edges).length,
  Object.keys(ER_COMMERCE.edges).length + 1,
  "chained edge-to-edge connector must appear in the layout snapshot",
);

const sequenceLayout = buildLayoutSnapshot(UML_SEQUENCE_CHECKOUT, measurer);
assert.ok(sequenceLayout.fitBounds.height < sequenceLayout.contentBounds.height);
const lastMessage = sequenceLayout.edges.msg_receipt;
assert.ok(lastMessage !== undefined);
const lastMessageY = Math.max(...lastMessage.points.map((p) => p.y));
assert.ok(
  Math.abs(sequenceLayout.fitBounds.y + sequenceLayout.fitBounds.height - lastMessageY) < 1e-6,
  "sequence fit bounds should end at the last message, not the lifeline tail",
);

// Activation bars added from the lifeline-axis menu are frame-relative and
// must be clamped inside the lifeline.
const activatedScene = addActivation(UML_SEQUENCE_CHECKOUT, asNodeId("seq_customer"), 1000, 90);
const activatedLayout = buildLayoutSnapshot(activatedScene, measurer);
const activatedLane = activatedLayout.nodes.seq_customer;
assert.ok(activatedLane !== undefined && activatedLane.kind === "lifeline");
if (activatedLane === undefined || activatedLane.kind !== "lifeline") throw new Error("unreachable");
assert.equal(activatedLane.activations.length, 1);
assert.equal(activatedLane.activations[0]?.frame.height, 90);

// Activation handles are generated from the bar height and evenly spaced.
const activationPorts = Object.values(sequenceLayout.ports)
  .filter(
    (port) =>
      port.nodeId === "seq_order_service" &&
      port.ref.kind === "spine" &&
      port.label.startsWith("activation"),
  )
  .sort((a, b) => a.point.y - b.point.y);
assert.equal(activationPorts.length, 5);
const activationGap = (activationPorts[1]?.point.y ?? 0) - (activationPorts[0]?.point.y ?? 0);
assert.ok(activationGap > 0);
for (let index = 1; index < activationPorts.length; index += 1) {
  const previous = activationPorts[index - 1] as (typeof activationPorts)[number];
  const current = activationPorts[index] as (typeof activationPorts)[number];
  assert.ok(
    Math.abs(current.point.y - previous.point.y - activationGap) < 1e-6,
    "activation handles must be evenly spaced",
  );
}

const movedActivationScene = updateActivation(
  UML_SEQUENCE_CHECKOUT,
  asNodeId("seq_order_service"),
  asActivationId("act_order_service"),
  { top: 150, height: 120 },
);
const movedActivationLayout = buildLayoutSnapshot(movedActivationScene, measurer);
const movedLane = movedActivationLayout.nodes.seq_order_service;
assert.ok(movedLane !== undefined && movedLane.kind === "lifeline");
if (movedLane === undefined || movedLane.kind !== "lifeline") throw new Error("unreachable");
const movedBar = movedLane.activations[0];
assert.ok(movedBar !== undefined);
assert.equal(movedBar.frame.y, movedLane.frame.y + 150);
assert.equal(movedBar.frame.height, 120);

// Legacy orthogonal flags on sequence messages must be ignored by layout.
const legacySequence: SceneDocument = {
  ...UML_SEQUENCE_CHECKOUT,
  edges: {
    ...UML_SEQUENCE_CHECKOUT.edges,
    msg_submit: {
      ...(UML_SEQUENCE_CHECKOUT.edges.msg_submit as NonNullable<typeof UML_SEQUENCE_CHECKOUT.edges[string]>),
      routing: {
        ...(UML_SEQUENCE_CHECKOUT.edges.msg_submit as NonNullable<typeof UML_SEQUENCE_CHECKOUT.edges[string]>).routing,
        mode: "orthogonal",
        avoidObstacles: true,
      },
    },
  },
};
const legacySequenceLayout = buildLayoutSnapshot(legacySequence, measurer);
const legacyMessage = legacySequenceLayout.edges.msg_submit;
assert.ok(legacyMessage !== undefined);
assert.equal(legacyMessage.routedBy, "straight");
assert.equal(legacyMessage.points.length, 2);

const baseMessage = sequenceLayout.edges.msg_submit;
assert.ok(baseMessage !== undefined);
const movedMessageScene = moveSequenceEdge(
  UML_SEQUENCE_CHECKOUT,
  asEdgeId("msg_submit"),
  54,
);
const movedMessageLayout = buildLayoutSnapshot(movedMessageScene, measurer);
const movedMessage = movedMessageLayout.edges.msg_submit;
assert.ok(movedMessage !== undefined);
for (const point of movedMessage.points) {
  const original = baseMessage.points.find((candidate) => Math.abs(candidate.x - point.x) < 1e-6);
  assert.ok(original !== undefined);
  assert.ok(Math.abs(point.y - (original.y + 54)) < 1e-6, "sequence message must move vertically");
}

const reattachedScene = setEdgeAttachment(
  UML_SEQUENCE_CHECKOUT,
  asEdgeId("msg_submit"),
  "target",
  { target: "node", nodeId: asNodeId("seq_gateway"), port: { kind: "spine", t: 0.18 } },
);
const reattachedLayout = buildLayoutSnapshot(reattachedScene, measurer);
const reattachedMessage = reattachedLayout.edges.msg_submit;
assert.ok(reattachedMessage !== undefined);
const gateway = reattachedLayout.nodes.seq_gateway;
assert.ok(gateway !== undefined);
const targetPoint = reattachedMessage.points[reattachedMessage.points.length - 1];
assert.ok(targetPoint !== undefined);
assert.ok(Math.abs(targetPoint.x - (gateway.frame.x + gateway.frame.width / 2)) < 1e-6);

const snapped = snapMovingFrame(
  { x: 10, y: 10, width: 54, height: 18 },
  { gridSize: 9, gridEnabled: true, alignmentEnabled: false, threshold: 6, others: [] },
);
assert.equal(snapped.frame.x, 9);
assert.equal(snapped.frame.y, 9);

const resized = snapResizedFrame({ x: 9, y: 9, width: 20, height: 20 }, 9, true);
assert.equal(resized.width, 18);
assert.equal(resized.height, 18);

const nwResize = resizeFrameFromCorner(
  { x: 90, y: 90, width: 180, height: 90 },
  "nw",
  { x: -45, y: -27 },
  9,
  true,
);
assert.deepEqual(nwResize, { x: 45, y: 63, width: 225, height: 117 });
const seResize = resizeFrameFromCorner(
  { x: 90, y: 90, width: 180, height: 90 },
  "se",
  { x: 45, y: 27 },
  9,
  true,
);
assert.deepEqual(seResize, { x: 90, y: 90, width: 225, height: 117 });
const neResize = resizeFrameFromCorner(
  { x: 90, y: 90, width: 180, height: 90 },
  "ne",
  { x: 45, y: -27 },
  9,
  true,
);
assert.deepEqual(neResize, { x: 90, y: 63, width: 225, height: 117 });

const lockedAspect = resizeFrameFromCorner(
  { x: 100, y: 100, width: 200, height: 100 },
  "se",
  { x: 100, y: 3 },
  9,
  true,
  2,
);
assert.equal(lockedAspect.x, 100);
assert.equal(lockedAspect.y, 100);
assert.ok(Math.abs(lockedAspect.width / lockedAspect.height - 2) < 0.001);
const lockedAspectFromHeight = resizeFrameFromCorner(
  { x: 100, y: 100, width: 200, height: 100 },
  "nw",
  { x: -3, y: -100 },
  9,
  true,
  2,
);
assert.equal(lockedAspectFromHeight.x + lockedAspectFromHeight.width, 300);
assert.equal(lockedAspectFromHeight.y + lockedAspectFromHeight.height, 200);
assert.ok(
  Math.abs(lockedAspectFromHeight.width / lockedAspectFromHeight.height - 2) < 0.001,
);

const captionLocked = resizeFrameFromCorner(
  { x: 0, y: 0, width: 144, height: 113.65 },
  "se",
  { x: 81, y: 10 },
  9,
  true,
  1.5,
  17.65,
);
assert.ok(Math.abs(captionLocked.width - 225) < 0.001);
assert.ok(Math.abs(captionLocked.height - 167.65) < 0.001);
assert.ok(
  Math.abs(
    captionLocked.width / (captionLocked.height - 17.65) - 1.5,
  ) < 0.001,
);

const near = nearestPort(layout.ports, leftPort.point, 1);
assert.equal(near?.id, leftPort.id);

const orders = layout.nodes.orders;
assert.ok(orders !== undefined);
const aligned = snapMovingFrame(
  {
    x: orders.frame.x - customers.frame.width + 2,
    y: 300,
    width: customers.frame.width,
    height: customers.frame.height,
  },
  {
    gridSize: 9,
    gridEnabled: false,
    alignmentEnabled: true,
    threshold: 6,
    others: [orders],
  },
);
assert.equal(aligned.frame.x, orders.frame.x - customers.frame.width);
assert.ok(aligned.guides.some((guide) => guide.axis === "x"));

const preview = withNodeFrames(ER_COMMERCE, {
  customers: { x: 90, y: 90, width: 225, height: 90 },
});
const previewLayout = buildLayoutSnapshot(preview, measurer);
assert.equal(previewLayout.nodes.customers?.frame.x, 90);
assert.notEqual(previewLayout.nodes.customers?.frame.x, customers.frame.x);

const classLayout = buildLayoutSnapshot(UML_CLASS_PAYMENTS, measurer);
const paymentMethod = classLayout.nodes.payment_method;
assert.ok(paymentMethod !== undefined);
assert.equal(paymentMethod.kind, "table");
if (paymentMethod.kind !== "table") throw new Error("unreachable");
assert.ok(paymentMethod.header.stereotype !== undefined);
assert.ok(paymentMethod.header.stereotypeFrame !== undefined);
const headerContentTop = paymentMethod.header.textFrame.y;
const headerContentBottom =
  paymentMethod.header.stereotypeFrame.y + paymentMethod.header.stereotypeFrame.height;
const headerCenter = paymentMethod.header.frame.y + paymentMethod.header.frame.height / 2;
assert.ok(
  Math.abs((headerContentTop + headerContentBottom) / 2 - headerCenter) < 1e-6,
  "title + stereotype stack must be vertically centred in the header",
);
assert.ok(
  paymentMethod.header.stereotypeFrame.y >=
    paymentMethod.header.textFrame.y + paymentMethod.header.textFrame.height,
  "stereotype must sit below the title",
);

const ellipseScene = setEdgeAttachment(
  UML_USE_CASE_SHOP,
  asEdgeId("use_case_assoc"),
  "target",
  { target: "node", nodeId: asNodeId("uc_checkout"), port: { kind: "angle", angle: 315 } },
);
const ellipseLayout = buildLayoutSnapshot(ellipseScene, measurer);
const ellipseEdge = ellipseLayout.edges.use_case_assoc;
const checkout = ellipseLayout.nodes.uc_checkout;
assert.ok(ellipseEdge !== undefined && checkout !== undefined);
const ellipseTip = ellipseEdge.points[ellipseEdge.points.length - 1];
assert.ok(ellipseTip !== undefined);
const ellipseRx = checkout.frame.width / 2;
const ellipseRy = checkout.frame.height / 2;
const expectedEllipseTip = {
  x: checkout.frame.x + ellipseRx + ellipseRx * Math.cos((315 * Math.PI) / 180),
  y: checkout.frame.y + ellipseRy + ellipseRy * Math.sin((315 * Math.PI) / 180),
};
assert.ok(Math.abs(ellipseTip.x - expectedEllipseTip.x) < 1e-6);
assert.ok(Math.abs(ellipseTip.y - expectedEllipseTip.y) < 1e-6);
for (let index = 1; index < ellipseEdge.points.length; index += 1) {
  const a = ellipseEdge.points[index - 1] as Point;
  const b = ellipseEdge.points[index] as Point;
  assert.ok(
    Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
    "use-case ellipse routes must stay orthogonal",
  );
}

const useCaseLayout = buildLayoutSnapshot(UML_USE_CASE_SHOP, measurer);
const useCaseAuto = autoLayoutFrames(UML_USE_CASE_SHOP, useCaseLayout);
assert.equal(useCaseAuto.skipped, undefined);
assert.ok(useCaseAuto.frames.shop_boundary !== undefined);
for (const childId of ["uc_checkout", "uc_pay", "uc_receipt"]) {
  const nextParent = useCaseAuto.frames.shop_boundary;
  const nextChild = useCaseAuto.frames[childId];
  const oldParent = useCaseLayout.nodes.shop_boundary?.frame;
  const oldChild = useCaseLayout.nodes[childId]?.frame;
  assert.ok(nextParent !== undefined && nextChild !== undefined);
  assert.ok(oldParent !== undefined && oldChild !== undefined);
  assert.ok(
    Math.abs((nextChild.x - nextParent.x) - (oldChild.x - oldParent.x)) < 1e-6 &&
      Math.abs((nextChild.y - nextParent.y) - (oldChild.y - oldParent.y)) < 1e-6,
    "enclosed use cases must preserve their offset inside the boundary",
  );
}

const assocPatch = useCaseAuto.edgeAttachments.use_case_assoc;
assert.ok(assocPatch?.target !== undefined);
if (assocPatch?.target !== undefined && assocPatch.target.target === "node") {
  const port = assocPatch.target.port;
  assert.equal(port.kind, "angle");
  if (port.kind === "angle") {
    const checkoutNext = useCaseAuto.frames.uc_checkout;
    const actorNext = useCaseAuto.frames.shop_customer;
    assert.ok(checkoutNext !== undefined && actorNext !== undefined);
    const cx = checkoutNext.x + checkoutNext.width / 2;
    const cy = checkoutNext.y + checkoutNext.height / 2;
    const ax = actorNext.x + actorNext.width / 2;
    const ay = actorNext.y + actorNext.height / 2;
    const expected =
      ((Math.atan2(
        (ay - cy) / (checkoutNext.height / 2),
        (ax - cx) / (checkoutNext.width / 2),
      ) *
        180) /
        Math.PI +
        360) %
      360;
    assert.ok(Math.abs(port.angle - expected) < 1e-6);
  }
}

// Auto ellipse anchors keep following the partner even after a manual move.
const autoScene = commitAutoLayout(
  UML_USE_CASE_SHOP,
  useCaseAuto.frames,
  useCaseAuto.edgeAttachments,
);
const autoCheckout = autoScene.nodes.uc_checkout;
const autoActor = autoScene.nodes.shop_customer;
assert.ok(autoCheckout !== undefined && autoActor !== undefined);
const actorBelowScene = withNodeFrames(autoScene, {
  shop_customer: {
    ...autoActor.frame,
    y: autoCheckout.frame.y + autoCheckout.frame.height + 90,
  },
});
const actorBelowLayout = buildLayoutSnapshot(actorBelowScene, measurer);
const actorBelowEdge = actorBelowLayout.edges.use_case_assoc;
const actorBelowCheckout = actorBelowLayout.nodes.uc_checkout;
assert.ok(actorBelowEdge !== undefined && actorBelowCheckout !== undefined);
const actorBelowTip = actorBelowEdge.points[actorBelowEdge.points.length - 1];
assert.ok(actorBelowTip !== undefined);
assert.ok(
  actorBelowTip.y > actorBelowCheckout.frame.y + actorBelowCheckout.frame.height / 2,
  "auto ellipse anchor must follow the partner to the lower ellipse side",
);

const auto = autoLayoutFrames(UML_CLASS_PAYMENTS, classLayout);
assert.equal(auto.layers, 2);
assert.ok(auto.moved > 0);
assert.ok(auto.crossingsAfter <= auto.crossingsBefore);
assert.ok(Object.keys(auto.frames).length > 0);
const lockedClassScene = {
  ...UML_CLASS_PAYMENTS,
  nodes: {
    ...UML_CLASS_PAYMENTS.nodes,
    payment_method: {
      ...(UML_CLASS_PAYMENTS.nodes.payment_method as NonNullable<typeof UML_CLASS_PAYMENTS.nodes[string]>),
      locked: true,
    },
  },
};
const lockedClassLayout = buildLayoutSnapshot(lockedClassScene, measurer);
const lockedAuto = autoLayoutFrames(lockedClassScene, lockedClassLayout);
assert.equal(lockedAuto.frames.payment_method, undefined, "locked node must not be moved");
assert.ok(Object.keys(lockedAuto.frames).length > 0);
assert.equal(autoLayoutFrames(UML_SEQUENCE_CHECKOUT, sequenceLayout).moved, 0);

const crossingBase = createEmptyScene("uml-class", "Crossing test");
const objectNode = (id: string, x: number, y: number): SceneDocument["nodes"][string] => ({
  id: asNodeId(id),
  kind: "object",
  name: id.toUpperCase(),
  frame: rect(x, y, 81, 36),
  z: 2,
  locked: false,
  visible: true,
  underlineName: true,
  style: DEFAULT_THEME.shape,
});
const crossingEdge = (id: string, source: string, target: string) => ({
  id: asEdgeId(id),
  source: { target: "node" as const, nodeId: asNodeId(source), port: { kind: "perimeter" as const, side: "south" as const } },
  target: { target: "node" as const, nodeId: asNodeId(target), port: { kind: "perimeter" as const, side: "north" as const } },
  routing: { mode: "orthogonal" as const, avoidObstacles: true, obstaclePadding: 9, stubLength: 9, waypoints: [] },
  markers: { source: NO_MARKER, target: NO_MARKER },
  labels: [],
  semantic: { family: "generic" as const },
  style: DEFAULT_THEME.edge,
  locked: false,
  visible: true,
  z: 10,
});
const crossingScene: SceneDocument = {
  ...crossingBase,
  nodes: {
    a: objectNode("a", 0, 0),
    b: objectNode("b", 126, 0),
    c: objectNode("c", 0, 108),
    d: objectNode("d", 126, 108),
  },
  edges: {
    ad: crossingEdge("ad", "a", "d"),
    bc: crossingEdge("bc", "b", "c"),
  },
};
const crossingLayout = buildLayoutSnapshot(crossingScene, measurer);
const crossingAuto = autoLayoutFrames(crossingScene, crossingLayout);
assert.ok(crossingAuto.crossingsBefore >= 1, "the synthetic graph must start with a crossing");
assert.equal(crossingAuto.crossingsAfter, 0, "barycenter ordering must remove the crossing");

const lrCommunication = {
  ...UML_COMMUNICATION_CHECKOUT,
  layout: { ...UML_COMMUNICATION_CHECKOUT.layout, direction: "LR" as const },
};
const lrCommunicationLayout = buildLayoutSnapshot(lrCommunication, measurer);
const lrAuto = autoLayoutFrames(lrCommunication, lrCommunicationLayout);
assert.equal(lrAuto.skipped, undefined);
const lrCommitted = withNodeFrames(lrCommunication, lrAuto.frames);
const lrLayout = buildLayoutSnapshot(lrCommitted, measurer);
const reserve = lrLayout.edges.comm_reserve;
const confirm = lrLayout.edges.comm_confirm;
assert.ok(reserve !== undefined && confirm !== undefined);
assert.equal(reserve.bendCount, 0);
assert.equal(confirm.bendCount, 0);
assert.notEqual(
  reserve.points[0]?.y,
  confirm.points[0]?.y,
  "parallel reverse edges must not share the same corridor",
);
assert.equal(lrLayout.diagnostics.routeCollisions, 0);

const customersNode = ER_COMMERCE.nodes.customers;
assert.ok(customersNode?.kind === "table");
const firstCustomerRow = customersNode.sections[0]?.rows[0];
assert.ok(firstCustomerRow !== undefined);
const styledScene = updateRow(ER_COMMERCE, asNodeId("customers"), firstCustomerRow.id, {
  textStyle: {
    bold: true,
    italic: true,
    monospace: true,
    fontSize: 14,
    color: "#cc0000",
  },
});
const tintedTheme = {
  ...DEFAULT_THEME,
  table: {
    ...DEFAULT_THEME.table,
    fill: { color: null },
    headerFill: { color: "#ffd166" },
    text: { ...DEFAULT_THEME.table.text, fontSize: 12, color: "#003366" },
  },
};
const themedScene = setSceneTheme(styledScene, tintedTheme);
assert.equal(themedScene.theme.table.headerFill.color, "#ffd166");
assert.equal(themedScene.nodes.customers?.style.fill.color, null);
const styledLayout = buildLayoutSnapshot(themedScene, measurer);
const styledCustomers = styledLayout.nodes.customers;
assert.ok(styledCustomers?.kind === "table");
const styledRow = styledCustomers.sections[0]?.rows[0];
assert.ok(styledRow !== undefined);
assert.equal(styledRow.text.style.fontSize, 14, "row override must beat the theme size");
assert.equal(styledRow.text.style.fontFamily, MONO_FONT);
assert.equal(styledRow.text.style.weight, 700);
assert.equal(styledRow.text.style.italic, true);
assert.equal(styledRow.text.style.color, "#cc0000");

const themedObject = createObjectFromTemplate(
  "er",
  "entity-table",
  themedScene,
  { x: 900, y: 450 },
);
assert.ok(themedObject !== null);
assert.equal(themedObject.node.style.fill.color, null);
assert.equal(themedObject.node.style.text.fontSize, 12);

const compactUseCase = createObjectFromTemplate(
  "uml-use-case",
  "use-case",
  UML_USE_CASE_SHOP,
  { x: 900, y: 450 },
);
assert.ok(compactUseCase !== null);
assert.equal(compactUseCase.node.frame.width, 138);
assert.equal(compactUseCase.node.frame.height, 45);

assert.equal(DEFAULT_LAYOUT.spacing, "normal");
assert.ok(LAYOUT_SPACING_PRESETS.tight.nodeGap < LAYOUT_SPACING_PRESETS.normal.nodeGap);
assert.ok(LAYOUT_SPACING_PRESETS.normal.nodeGap < LAYOUT_SPACING_PRESETS.wide.nodeGap);

const relationAttr = createObjectFromTemplate(
  "er",
  "relation-attribute",
  ER_COMMERCE,
  { x: 360, y: 450 },
);
assert.ok(relationAttr !== null && relationAttr.node.kind === "relationAttribute");
const namedRelationAttr = { ...relationAttr.node, name: "places" };
const relationScene = {
  ...ER_COMMERCE,
  nodes: { ...ER_COMMERCE.nodes, [namedRelationAttr.id]: namedRelationAttr },
};
const tether = createEdgeForDiagram(
  relationScene,
  { nodeId: namedRelationAttr.id, port: { kind: "perimeter", side: "north" } },
  { edgeId: asEdgeId("edge_places"), t: 0.5 },
);
assert.ok(tether !== null);
const converted = insertConnectedObject(
  ER_COMMERCE,
  namedRelationAttr,
  tether,
  { edgeId: asEdgeId("edge_places"), zone: "center" },
  relationAttr.asset,
);
assert.equal(Object.keys(converted.nodes).length, Object.keys(ER_COMMERCE.nodes).length + 1);
assert.equal(Object.keys(converted.edges).length, Object.keys(ER_COMMERCE.edges).length + 1);
assert.equal(
  converted.edges.edge_places?.labels.some((label) => label.zone === "center"),
  false,
);
assert.equal(converted.nodes[namedRelationAttr.id]?.name, "places");
const convertedLayout = buildLayoutSnapshot(converted, measurer);
const convertedAuto = autoLayoutFrames(converted, convertedLayout);
const placedConverted = convertedAuto.frames[namedRelationAttr.id];
const placedExistingAttribute = convertedAuto.frames.order_line;
const placedCustomers = convertedAuto.frames.customers;
const placedOrders = convertedAuto.frames.orders;
assert.ok(
  placedConverted !== undefined &&
  placedExistingAttribute !== undefined &&
  placedCustomers !== undefined &&
  placedOrders !== undefined,
);
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width - 0.001 &&
  a.x + a.width > b.x + 0.001 &&
  a.y < b.y + b.height - 0.001 &&
  a.y + a.height > b.y + 0.001;
assert.equal(overlaps(placedConverted, placedCustomers), false);
assert.equal(overlaps(placedConverted, placedOrders), false);
assert.equal(overlaps(placedExistingAttribute, placedCustomers), false);
assert.equal(overlaps(placedExistingAttribute, placedOrders), false);
const parentCenterX =
  (placedCustomers.x + placedCustomers.width / 2 +
    placedOrders.x + placedOrders.width / 2) / 2;
const convertedCenterX = placedConverted.x + placedConverted.width / 2;
const existingCenterX = placedExistingAttribute.x + placedExistingAttribute.width / 2;
assert.notEqual(
  Math.sign(convertedCenterX - parentCenterX),
  Math.sign(existingCenterX - parentCenterX),
  "relation-attribute tables should occupy opposite sides of their relationship",
);
const placedTetherTarget = convertedAuto.edgeAttachments[tether.id]?.target;
const existingTetherTarget = convertedAuto.edgeAttachments.edge_order_line?.target;
if (
  placedTetherTarget?.target !== "edge" ||
  existingTetherTarget?.target !== "edge"
) {
  throw new Error("relation-attribute tethers should remain attached to the relationship edge");
}
assert.notEqual(
  placedTetherTarget.t,
  existingTetherTarget.t,
  "multiple relation-attribute tethers should anchor at distinct points on the relationship",
);
const parentEdgePatch = convertedAuto.edgeAttachments.edge_places;
if (
  parentEdgePatch?.source?.target !== "node" ||
  parentEdgePatch.source.port.kind !== "perimeter" ||
  parentEdgePatch.target?.target !== "node" ||
  parentEdgePatch.target.port.kind !== "perimeter"
) {
  throw new Error("TB layout should re-anchor rectangular relationship endpoints");
}
assert.equal(parentEdgePatch.source.port.side, "south");
assert.equal(parentEdgePatch.target.port.side, "north");
for (const tetherId of [tether.id, "edge_order_line"]) {
  const tetherPatch = convertedAuto.edgeAttachments[tetherId];
  if (
    tetherPatch?.source?.target !== "node" ||
    tetherPatch.source.port.kind !== "perimeter"
  ) {
    throw new Error("relation-attribute tether should expose a facing perimeter side");
  }
  assert.ok(["east", "west"].includes(tetherPatch.source.port.side));
}

const labelEdgeId = asEdgeId("edge_places");
const labelStyle = { bold: true, monospace: true, fontSize: 12, color: "#aa0000" };
const edgeStyledScene = setEdgeLabelTextStyle(ER_COMMERCE, labelEdgeId, "center", labelStyle);
const edgeStyledLayout = buildLayoutSnapshot(edgeStyledScene, measurer);
const styledLabel = edgeStyledLayout.edges.edge_places?.labels.find((label) => label.zone === "center");
assert.ok(styledLabel !== undefined);
assert.equal(styledLabel.text.style.fontSize, 12);
assert.equal(styledLabel.text.style.color, "#aa0000");
const relabeled = setEndpointLabel(edgeStyledScene, labelEdgeId, "center", "renamed");
assert.deepEqual(
  relabeled.edges.edge_places?.labels.find((label) => label.zone === "center")?.textStyle,
  labelStyle,
  "renaming a label must keep its typography overrides",
);

console.log("layout: OK");
console.log(`  fixtures: ${STEP1_FIXTURES.length}`);
console.log(`  ER nodes/ports/edges: ${Object.keys(layout.nodes).length}/${Object.keys(layout.ports).length}/${Object.keys(layout.edges).length}`);
console.log(`  ER content bounds: ${layout.contentBounds.width} × ${layout.contentBounds.height}`);
