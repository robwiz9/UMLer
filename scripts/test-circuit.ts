/**
 * Circuit extension checks.
 *
 * These run without a browser: model factories and the Phase 1 layout pass are
 * pure, and the CeTZ serializer is structural.
 */

import { CIRCUIT_DIVIDER } from "../src/fixtures/index.ts";
import { buildLayoutSnapshot, withNodeRotations } from "../src/layout/build-layout.ts";
import { FixedTextMeasurer } from "../src/layout/text.ts";
import { computeWireBridges } from "../src/layout/wire-bridges.ts";
import { serializeSceneToCetz } from "../src/export/cetz.ts";
import { DEFAULT_EXPORT_SETTINGS } from "../src/export/page.ts";
import { createEmptyScene } from "../src/model/scene.ts";
import type { SceneDocument } from "../src/model/scene.ts";
import type { SceneNode, CircuitComponentNode } from "../src/model/nodes.ts";
import type { SceneEdge } from "../src/model/edges.ts";
import { NO_MARKER } from "../src/model/edges.ts";
import {
  addCircuitJunctionToWire,
  connectCircuitWireToPoint,
  connectCircuitWireToWire,
  createCircuitJunction,
  createDuplicateParallelBranches,
  createShiftDragBranches,
  createShiftDragBranchesResult,
  detachCircuitComponentEndings,
  gridAlignedOrthogonalRoute,
  hideDegreeTwoJunctions,
  mergeNearbyCircuitJunctions,
  insertCircuitComponentOnWire,
  mergeCircuitJunction,
  mergeCircuitJunctionResult,
  mergeCoincidentCircuitConnections,
  normalizeCircuitPinConnections,
  normalizeCircuitDuplicateConnections,
  normalizeCircuitJunctionStyles,
  refineAutoMergedJunctionStyles,
  prepareOccupiedPinJunction,
  rewireCircuitComponentPins,
  splitCircuitWireAtCorners,
} from "../src/model/circuit-wires.ts";
import { circuitPrefixFor, nextComponentLabel, setCircuitStandard } from "../src/model/circuit.ts";
import { CIRCUIT_COMPONENTS, circuitComponent } from "../src/model/circuit-catalog.ts";
import { canExtendToEmpty } from "../src/canvas/circuit-draw.ts";
import { copySceneNodes, pasteSceneClipboard } from "../src/model/clipboard.ts";
import { validateScene } from "../src/model/validate.ts";
import { rerouteEdge } from "../src/model/edits.ts";
import { measureRichText, parseRichText } from "../src/model/rich-text.ts";
import { asEdgeId, asLabelId, asNodeId } from "../src/model/ids.ts";
import { rect, rectCenter } from "../src/model/geometry.ts";

const measurer = new FixedTextMeasurer();

const component = (
  id: string,
  name: string,
  kind: CircuitComponentNode["component"],
  frame = rect(0, 0, 54, 36),
  rotation: CircuitComponentNode["rotation"] = 0,
): CircuitComponentNode => ({
  id: asNodeId(id),
  kind: "circuitComponent",
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  component: kind,
  rotation,
  style: {
    fill: { color: "#ffffff" },
    stroke: { color: "#111111", width: 0.75, pattern: "solid" },
    text: { fontFamily: "Latin Modern Roman", fontSize: 10.5, color: "#111111", weight: 400 },
    cornerRadius: 0,
    padding: 6,
  },
});

const wire = (
  id: string,
  source: string,
  sourcePin: string,
  target: string,
  targetPin: string,
  family: "circuit" | "generic" = "circuit",
): SceneEdge => ({
  id: asEdgeId(id),
  source: { target: "node", nodeId: asNodeId(source), port: { kind: "pin", pinId: sourcePin } },
  target: { target: "node", nodeId: asNodeId(target), port: { kind: "pin", pinId: targetPin } },
  routing: { mode: "straight", avoidObstacles: false, obstaclePadding: 0, stubLength: 0, waypoints: [] },
  markers: { source: NO_MARKER, target: NO_MARKER },
  labels: [],
  semantic: family === "circuit" ? { family: "circuit" } : { family: "generic" },
  style: {
    stroke: { color: "#111111", width: 0.75, pattern: "solid" },
    labelText: { fontFamily: "Latin Modern Roman", fontSize: 9.5, color: "#111111", weight: 400 },
    labelFill: { color: "#ffffff" },
    labelPadding: 2,
    labelInset: 18,
    arrowScale: 1,
  },
  locked: false,
  visible: true,
  z: 10,
});

const withNodes = (nodes: readonly SceneNode[], edges: readonly SceneEdge[] = []): SceneDocument => {
  const base = createEmptyScene("circuit", "Circuit test");
  return {
    ...base,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    edges: Object.fromEntries(edges.map((edge) => [edge.id, edge])),
  };
};

let passed = 0;
const check = (condition: boolean, message: string): void => {
  if (condition) {
    passed += 1;
  } else {
    throw new Error(message);
  }
};

// --- catalogue and numbering -------------------------------------------------
check(CIRCUIT_COMPONENTS.length === 19, "catalogue should expose 19 components");
check(circuitComponent("transistor-pnp") !== undefined, "PNP transistor is catalogued");
check(circuitComponent("mosfet-p") !== undefined, "P-MOSFET is catalogued");
check(circuitComponent("switch") !== undefined, "switch is catalogued");
check(circuitComponent("lightbulb") !== undefined, "lightbulb is catalogued");
const misalignedComponents = CIRCUIT_COMPONENTS.filter((definition) =>
  definition.width % 18 !== 0 ||
  definition.height % 18 !== 0 ||
  definition.pins.some((pin) => pin.x % 9 !== 0 || pin.y % 9 !== 0),
);
check(
  misalignedComponents.length === 0,
  "all component frames should be multiples of 18 and all pins multiples of 9",
);

const base = withNodes([component("r1", "R1", "resistor")]);
check(nextComponentLabel(base, "R") === "R_2", "next resistor label should be R_2");
check(
  nextComponentLabel(withNodes([component("r1", "R_1", "resistor"), component("r2", "R_1", "resistor")]), "R") === "R_2",
  "duplicate labels still advance from max+1",
);
check(nextComponentLabel(base, "C") === "C_1", "unused prefix starts at C_1");
check(circuitPrefixFor("voltage-source", "iec") === "U", "IEC voltage sources should use the U prefix");
check(circuitPrefixFor("ac-source", "iec") === "U", "IEC AC sources should use the U prefix");
check(circuitPrefixFor("voltage-source", "ansi") === "V", "ANSI voltage sources keep the V prefix");
check(circuitPrefixFor("current-source", "iec") === "I", "IEC current sources keep the I prefix");

// --- rich sub/superscript labels --------------------------------------------
const parsedLabel = parseRichText('R_"12"_"34"');
check(parsedLabel.length === 3, "rich label parser should split sequential scripts");
check(parsedLabel[0]?.text === "R" && parsedLabel[0]?.script === "normal", "rich label keeps the base text");
check(parsedLabel[1]?.text === "12" && parsedLabel[1]?.script === "sub", "quoted subscript is parsed");
check(parsedLabel[2]?.text === "34" && parsedLabel[2]?.script === "sub", "second subscript is parsed");
check(parsedLabel[2]?.depth === 2, "second sequential subscript is nested");
const richMeasurement = measureRichText("V^2", base.nodes.r1?.style.text ?? {
  fontFamily: "Latin Modern Roman",
  fontSize: 10.5,
  color: "#111111",
  weight: 400,
}, measurer);
check(richMeasurement.segments?.some((segment) => segment.script === "super") === true, "superscript is measured");

// --- rotation / pins ---------------------------------------------------------
const rotated = withNodes([component("r1", "R1", "resistor"),].map((node) => node));
const layout0 = buildLayoutSnapshot(rotated, measurer);
const pins0 = layout0.nodes.r1?.kind === "circuitComponent" ? layout0.nodes.r1.pins : [];
check(pins0.length === 2, "resistor should expose two pins");
check(Math.abs((pins0[0]?.point.x ?? 0) - 0) < 0.001, "pin A should start at the left edge, x=0");
const layout90 = buildLayoutSnapshot(withNodeRotations(rotated, { r1: 90 }), measurer);
const pins90 = layout90.nodes.r1?.kind === "circuitComponent" ? layout90.nodes.r1.pins : [];
check(Math.abs((pins90[0]?.point.y ?? 0) + 9) < 0.001, "pin A should move to the top after 90°");
check(
  layout90.nodes.r1?.kind === "circuitComponent" &&
    Math.abs(layout90.nodes.r1.frame.width - 36) < 0.001 &&
    Math.abs(layout90.nodes.r1.frame.height - 54) < 0.001,
  "90° rotated component AABB should swap dimensions",
);

const layout45 = buildLayoutSnapshot(withNodeRotations(rotated, { r1: 45 }), measurer);
const pins45 = layout45.nodes.r1?.kind === "circuitComponent" ? layout45.nodes.r1.pins : [];
check(
  pins45.length === 2 &&
    pins45.every((pin) =>
      Math.abs(pin.point.x / 9 - Math.round(pin.point.x / 9)) < 1e-6 &&
      Math.abs(pin.point.y / 9 - Math.round(pin.point.y / 9)) < 1e-6),
  "45° rotated component pins should snap to the grid",
);
const mirroredLayout = buildLayoutSnapshot(
  withNodes([{ ...component("r1", "R1", "resistor"), mirrorX: true }]),
  measurer,
);
const mirroredPins =
  mirroredLayout.nodes.r1?.kind === "circuitComponent"
    ? mirroredLayout.nodes.r1.pins
    : [];
check(
  (mirroredPins[0]?.point.x ?? 0) > (mirroredPins[1]?.point.x ?? 0),
  "mirroring should move the resistor pins to the mirrored sides",
);
const mirroredLedScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    { ...component("led1", "D1", "led", rect(90, 0, 36, 36)), mirrorX: true },
  ],
  [wire("mirror_wire", "v1", "+", "led1", "A")],
);
const mirroredLedLayout = buildLayoutSnapshot(mirroredLedScene, measurer);
const mirroredLedPins =
  mirroredLedLayout.nodes.led1?.kind === "circuitComponent"
    ? mirroredLedLayout.nodes.led1.pins
    : [];
const mirroredLedWire = mirroredLedLayout.edges.mirror_wire;
check(
  (mirroredLedPins[0]?.point.x ?? 0) > (mirroredLedPins[1]?.point.x ?? 0),
  "horizontal LED mirroring should reverse anode and cathode positions",
);
check(
  Math.abs(
    (mirroredLedWire?.points.at(-1)?.x ?? 0) -
      (mirroredLedPins[0]?.point.x ?? 0),
  ) < 0.001,
  "visual mirroring should let wires follow the mirrored LED pin",
);
const orientedLedSource = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    {
      ...component("led1", "D1", "led", rect(90, 0, 36, 36)),
      mirrorX: true,
      swapPinsX: true,
    },
  ],
  [wire("orient_wire", "v1", "+", "led1", "A")],
);
const orientedLedScene = rewireCircuitComponentPins(
  orientedLedSource,
  asNodeId("led1"),
  "horizontal",
);
const orientedLedLayout = buildLayoutSnapshot(orientedLedScene, measurer);
const orientedLedPins =
  orientedLedLayout.nodes.led1?.kind === "circuitComponent"
    ? orientedLedLayout.nodes.led1.pins
    : [];
const orientedLedWire = orientedLedLayout.edges.orient_wire;
check(
  (orientedLedPins[0]?.point.x ?? 0) > (orientedLedPins[1]?.point.x ?? 0),
  "horizontal LED orientation should reverse anode and cathode positions",
);
check(
  (orientedLedWire?.points.at(-1)?.x ?? 0) < (orientedLedPins[0]?.point.x ?? 0),
  "orientation should rewire the LED so the wire stays at the original side",
);
const orientedTransistorLayout = buildLayoutSnapshot(
  withNodes([
    { ...component("q1", "Q1", "transistor-npn", rect(0, 0, 54, 54)), mirrorY: true },
  ]),
  measurer,
);
const orientedTransistorPins =
  orientedTransistorLayout.nodes.q1?.kind === "circuitComponent"
    ? orientedTransistorLayout.nodes.q1.pins
    : [];
const orientedCollector = orientedTransistorPins.find((pin) => pin.pinId === "C");
const orientedEmitter = orientedTransistorPins.find((pin) => pin.pinId === "E");
check(
  (orientedCollector?.point.y ?? 0) > (orientedEmitter?.point.y ?? 0),
  "vertical transistor orientation should switch collector and emitter positions",
);
const transistorRewireBase = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    {
      ...component("q1", "Q1", "transistor-npn", rect(90, 0, 54, 54)),
      mirrorY: true,
      swapPinsY: true,
    },
  ],
  [wire("collector_wire", "v1", "+", "q1", "C")],
);
const transistorRewired = rewireCircuitComponentPins(
  transistorRewireBase,
  asNodeId("q1"),
  "vertical",
);
const collectorRewired = transistorRewired.edges.collector_wire;
check(
  collectorRewired?.target.target === "node" &&
    collectorRewired.target.port.kind === "pin" &&
    collectorRewired.target.port.pinId === "E",
  "vertical transistor orientation should rewire collector to emitter",
);

// --- label offsets -----------------------------------------------------------
const offsetLayout = buildLayoutSnapshot(
  withNodes([{
    ...component("r1", "R1", "resistor"),
    labelOffset: { x: 18, y: 18 },
  }]),
  measurer,
);
const offsetFrame = offsetLayout.nodes.r1?.kind === "circuitComponent"
  ? offsetLayout.nodes.r1.labelFrame
  : undefined;
check(
  offsetFrame !== undefined &&
    Math.abs(offsetFrame.x + offsetFrame.width / 2 - 45) < 0.001 &&
    Math.abs(offsetFrame.y + offsetFrame.height / 2 - 36) < 0.001,
  "component labelOffset should move the rendered label frame",
);
const junctionOffset = createCircuitJunction(base, { x: 90, y: 45 }, "filled");
const junctionOffsetLayout = buildLayoutSnapshot(
  withNodes([{ ...junctionOffset, name: "N", labelOffset: { x: 18, y: 9 } }]),
  measurer,
);
const junctionFrame = junctionOffsetLayout.nodes[junctionOffset.id];
check(
  junctionFrame?.kind === "circuitJunction" &&
    junctionFrame.labelFrame !== undefined &&
    Math.abs(junctionFrame.labelFrame.x + junctionFrame.labelFrame.width / 2 - 108) < 0.001 &&
    Math.abs(junctionFrame.labelFrame.y + junctionFrame.labelFrame.height / 2 - 54) < 0.001,
  "junction labelOffset should move the rendered label frame",
);

// --- standard switch ---------------------------------------------------------
const ansi = setCircuitStandard(rotated, "ansi");
const layoutAnsi = buildLayoutSnapshot(ansi, measurer);
const resistorLayout = layoutAnsi.nodes.r1;
check(
  resistorLayout?.kind === "circuitComponent" &&
    resistorLayout.primitives.some((primitive) => primitive.kind === "polyline" && !primitive.closed),
  "ANSI resistor should contain an open zigzag polyline",
);
const layoutIec = buildLayoutSnapshot(rotated, measurer);
const iecLayout = layoutIec.nodes.r1;
check(
  iecLayout?.kind === "circuitComponent" &&
    iecLayout.primitives.some((primitive) => primitive.kind === "polyline" && primitive.closed === true),
  "IEC resistor should contain a closed rectangular body",
);

// --- validation --------------------------------------------------------------
const duplicateLabels = withNodes([
  component("r1", "R1", "resistor"),
  component("r2", "R1", "resistor"),
]);
const diagnostics = validateScene(duplicateLabels);
check(
  diagnostics.filter((diagnostic) => diagnostic.code.includes("duplicate")).length === 0,
  "duplicate reference labels are allowed",
);

// --- wire extension / junction / split --------------------------------------
const sourceScene = withNodes([
  component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
  component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  createCircuitJunction(sourceSceneBase(), { x: 220, y: 40 }, "none"),
]);

function sourceSceneBase(): SceneDocument {
  return createEmptyScene("circuit", "source");
}

const sourceNode = Object.values(sourceScene.nodes).find((node) => node.kind === "circuitJunction");
check(sourceNode !== undefined, "test junction should exist");

const extend = connectCircuitWireToPoint(
  sourceScene,
  { nodeId: asNodeId("v1"), port: { kind: "pin", pinId: "+" } },
  { x: 180, y: 36 },
  "none",
);
check(extend !== null, "wire extension should create a scene");
const extendJunction = extend === null ? undefined : extend.scene.nodes[extend.junctionId];
check(
  extendJunction?.kind === "circuitJunction" && extendJunction.junctionStyle === "none",
  "empty extension should create a no-dot junction",
);
let junctionStyleScene = withNodes([
  component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
  component("v2", "V2", "voltage-source", rect(0, 90, 36, 54)),
  component("v3", "V3", "voltage-source", rect(0, 180, 36, 54)),
]);
for (const [nodeId, pinId] of [
  ["v1", "+"],
  ["v2", "+"],
  ["v3", "+"],
] as const) {
  const connected = connectCircuitWireToPoint(
    junctionStyleScene,
    { nodeId: asNodeId(nodeId), port: { kind: "pin", pinId } },
    { x: 180, y: 36 },
    "none",
  );
  if (connected !== null) junctionStyleScene = connected.scene;
}
check(
  Object.values(junctionStyleScene.nodes).some(
    (node) => node.kind === "circuitJunction" && node.junctionStyle === "filled",
  ),
  "a None junction with two existing wires should become filled on the next connection",
);

const existingWire: SceneEdge = {
  ...wire("w1", "v1", "+", "r1", "A"),
  labels: [
    {
      id: asLabelId("wire_label"),
      zone: "center",
      text: "out",
      anchor: { kind: "edgePoint", t: 0.5 },
      offset: { x: 0, y: -12 },
      locked: false,
      visible: true,
    },
  ],
};
const splitScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [existingWire],
);
const split = connectCircuitWireToWire(
  splitScene,
  { nodeId: asNodeId("v1"), port: { kind: "pin", pinId: "−" } },
  asEdgeId("w1"),
  { x: 45, y: 36 },
);
check(split !== null, "wire-to-wire connection should succeed");
if (split !== null) {
  const original = split.scene.edges.w1;
  const newJunction = split.scene.nodes[split.junctionId];
  check(
    original?.target.target === "node" && original.target.nodeId === split.junctionId,
    "original wire should target the new junction",
  );
  check(
    original?.labels.length === 1 && original.labels[0]?.text === "out",
    "split wire should keep its centre label on the source half",
  );
  check(
    newJunction?.kind === "circuitJunction" && newJunction.junctionStyle === "filled",
    "wire-to-wire should create a solid junction",
  );
  check(
    Object.values(split.scene.edges).some(
      (edge) =>
        edge.target.target === "node" &&
        edge.target.nodeId === asNodeId("r1") &&
        edge.source.target === "node" &&
        edge.source.nodeId === split.junctionId,
    ),
    "split wire should continue to the original target",
  );
}

// --- junction upgrade on wire-to-wire ---------------------------------------
const noneJunction = createCircuitJunction(splitScene, { x: 45, y: 6.75 }, "none");
const upgradeScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    noneJunction,
  ],
  [existingWire],
);
const upgraded = connectCircuitWireToWire(
  upgradeScene,
  { nodeId: asNodeId("v1"), port: { kind: "pin", pinId: "−" } },
  asEdgeId("w1"),
  { x: 45, y: 6.75 },
);
check(upgraded !== null, "wire-to-wire with an existing no-dot node should succeed");
const upgradedNode = upgraded === null ? undefined : upgraded.scene.nodes[upgraded.junctionId];
check(
  upgradedNode?.kind === "circuitJunction" && upgradedNode.junctionStyle === "filled",
  "an existing no-dot node should be upgraded to a filled junction",
);

// --- occupied pin creates a nearby junction --------------------------------
const occupiedPinScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [wire("occupied_wire", "v1", "+", "r1", "A")],
);
const occupied = prepareOccupiedPinJunction(
  occupiedPinScene,
  { nodeId: asNodeId("v1"), port: { kind: "pin", pinId: "+" } },
  { x: 18, y: 0 },
  { x: 0, y: -1 },
);
check(
  occupied.attachment.nodeId !== asNodeId("v1") && occupied.attachment.port.kind === "center",
  "a second wire on an occupied pin should attach to a nearby junction",
);
const occupiedJunction = occupied.scene.nodes[occupied.attachment.nodeId];
check(
  occupiedJunction?.kind === "circuitJunction" &&
    occupiedJunction.junctionStyle === "filled" &&
    Math.abs(rectCenter(occupiedJunction.frame).x - 18) < 0.001 &&
    Math.abs(rectCenter(occupiedJunction.frame).y - 0) < 0.001,
  "an occupied pin should get a filled junction at the pin point",
);
const occupiedWire = occupied.scene.edges.occupied_wire;
check(
  occupiedWire?.source.target === "node" &&
    occupiedWire.source.nodeId === occupied.attachment.nodeId,
  "the existing wire should be rewired to the nearby junction",
);
check(
  Object.values(occupied.scene.edges).some(
    (edge) =>
      edge.source.target === "node" &&
      edge.source.nodeId === asNodeId("v1") &&
      edge.source.port.kind === "pin" &&
      edge.source.port.pinId === "+" &&
      edge.target.target === "node" &&
      edge.target.nodeId === occupied.attachment.nodeId,
  ),
  "a short stub should keep the pin connected to the junction",
);
const doublePinScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    component("r2", "R2", "resistor", rect(90, 90, 54, 36)),
  ],
  [
    wire("double_w1", "v1", "+", "r1", "A"),
    wire("double_w2", "v1", "+", "r2", "A"),
  ],
);
const normalizedPins = normalizeCircuitPinConnections(doublePinScene);
const v1Direct = Object.values(normalizedPins.edges).filter(
  (edge) =>
    (edge.source.target === "node" &&
      edge.source.nodeId === asNodeId("v1") &&
      edge.source.port.kind === "pin" &&
      edge.source.port.pinId === "+") ||
    (edge.target.target === "node" &&
      edge.target.nodeId === asNodeId("v1") &&
      edge.target.port.kind === "pin" &&
      edge.target.port.pinId === "+"),
);
check(
  v1Direct.length === 1 &&
    Object.values(normalizedPins.nodes).some(
      (node) => node.kind === "circuitJunction" && node.junctionStyle === "filled",
    ),
  "a pin with multiple wires should keep one stub through a filled junction",
);
const threeCoincident = normalizeCircuitPinConnections(withNodes([
  component("r1", "R1", "resistor", rect(0, -18, 54, 36), 0),
  component("r2", "R2", "resistor", rect(-27, 9, 54, 36), 90),
  component("r3", "R3", "resistor", rect(-54, -18, 54, 36), 180),
]));
check(
  Object.values(threeCoincident.nodes).filter(
    (node) => node.kind === "circuitJunction",
  ).length === 1 && Object.keys(threeCoincident.edges).length === 3,
  "three coincident pins should share one junction and three zero-length stubs",
);
const duplicateConnections = normalizeCircuitDuplicateConnections(withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [
    wire("duplicate_w1", "v1", "+", "r1", "A"),
    wire("duplicate_w2", "v1", "+", "r1", "A"),
  ],
));
check(
  Object.keys(duplicateConnections.edges).length === 1,
  "duplicate wires between the same two nodes should collapse to one",
);
const loopConnections = normalizeCircuitDuplicateConnections(withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [
    wire("loop_w1", "v1", "+", "r1", "A"),
    wire("loop_w2", "v1", "−", "r1", "B"),
  ],
));
check(
  Object.keys(loopConnections.edges).length === 2,
  "a two-point loop between different pins should not be deduplicated",
);
const nearMergeBase = withNodes([
  component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
]);
const nearMergeJunction = createCircuitJunction(
  nearMergeBase,
  { x: 92, y: 18 },
  "none",
);
const nearMergeScene = withNodes(
  [
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    nearMergeJunction,
  ],
);
const nearMerged = mergeCoincidentCircuitConnections(nearMergeScene);
check(
  Object.values(nearMerged.edges).some(
    (edge) =>
      edge.source.target === "node" &&
      edge.source.nodeId === asNodeId("r1") &&
      edge.source.port.kind === "pin" &&
      edge.source.port.pinId === "A" &&
      edge.target.target === "node" &&
      edge.target.nodeId === nearMergeJunction.id &&
      edge.target.port.kind === "center",
  ),
  "a component ending near a junction should auto-merge within half a grid cell",
);
const autoMergeScene = withNodes([
  component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  component("r2", "R2", "resistor", rect(90, 0, 54, 36)),
]);
const autoMergeNormalized = normalizeCircuitPinConnections(autoMergeScene);
const autoMergeJunction = Object.values(autoMergeNormalized.nodes).find(
  (node) => node.kind === "circuitJunction",
);
check(
  autoMergeJunction?.kind === "circuitJunction" &&
    autoMergeJunction.autoMerged === true,
  "coincident pins should create an auto-merged junction",
);
const autoMergeRefined = refineAutoMergedJunctionStyles(autoMergeNormalized);
const refinedAutoMergeJunction =
  autoMergeJunction?.kind === "circuitJunction"
    ? autoMergeRefined.nodes[autoMergeJunction.id]
    : undefined;
check(
  refinedAutoMergeJunction?.kind === "circuitJunction" &&
    refinedAutoMergeJunction.junctionStyle === "none",
  "a degree-two auto-merged junction should become None under visual refinements",
);

// --- orthogonal corner junctions -------------------------------------------
const cornerScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 90, 54, 27)),
  ],
  [wire("corner_wire", "v1", "+", "r1", "A")],
);
const rerouted = rerouteEdge(cornerScene, asEdgeId("corner_wire"));
check(
  rerouted.edges.corner_wire?.routing.avoidWireOverlap === true,
  "orthogonal reroute should avoid overlapping other wires",
);
const reroutedLayout = buildLayoutSnapshot(rerouted, measurer);
const reroutedPoints = reroutedLayout.edges.corner_wire?.points ?? [];
const reroutedCorners = reroutedPoints.slice(1, -1);
check(reroutedCorners.length > 0, "orthogonal reroute should produce at least one corner");
const cornerSplit = splitCircuitWireAtCorners(
  rerouted,
  asEdgeId("corner_wire"),
  reroutedCorners,
);
const hiddenJunctions = Object.values(cornerSplit.nodes).filter(
  (node) => node.kind === "circuitJunction" && node.junctionStyle === "none",
);
check(
  hiddenJunctions.length === reroutedCorners.length,
  "each corner should get an invisible junction",
);
check(
  hiddenJunctions.every((node) => {
    const center = rectCenter(node.frame);
    return (
      Math.abs(center.x / 9 - Math.round(center.x / 9)) < 1e-6 &&
      Math.abs(center.y / 9 - Math.round(center.y / 9)) < 1e-6
    );
  }),
  "orthogonal corner junctions should snap to the scene grid",
);
check(
  Object.keys(cornerSplit.edges).length === reroutedCorners.length + 1,
  "the rerouted wire should be split into a chain of straight segments",
);

// --- merge a two-way junction ----------------------------------------------
const mergeBase = withNodes([
  component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
  component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
]);
const mergeJunction = createCircuitJunction(mergeBase, { x: 45, y: 0 }, "filled");
const mergeLabel = (id: string, text: string) => ({
  id: asLabelId(id),
  zone: "center" as const,
  text,
  anchor: { kind: "edgePoint" as const, t: 0.5 },
  offset: { x: 0, y: -12 },
  locked: false,
  visible: true,
});
const mergeW1: SceneEdge = {
  ...wire("merge_w1", "v1", "+", "r1", "A"),
  target: { target: "node", nodeId: mergeJunction.id, port: { kind: "center" } },
  labels: [mergeLabel("merge_l1", "A")],
};
const mergeW2: SceneEdge = {
  ...wire("merge_w2", "v1", "+", "r1", "A"),
  source: { target: "node", nodeId: mergeJunction.id, port: { kind: "center" } },
  target: { target: "node", nodeId: asNodeId("r1"), port: { kind: "pin", pinId: "A" } },
  labels: [mergeLabel("merge_l2", "B")],
};
const mergeScene = withNodes(
  [mergeBase.nodes.v1 as SceneNode, mergeBase.nodes.r1 as SceneNode, mergeJunction],
  [mergeW1, mergeW2],
);
const merged = mergeCircuitJunction(mergeScene, mergeJunction.id);
check(merged.nodes[mergeJunction.id] === undefined, "merge should remove the junction node");
check(Object.keys(merged.edges).length === 1, "merge should leave one wire");
const mergedWire = Object.values(merged.edges)[0];
check(
  mergedWire?.labels[0]?.text === "A B",
  "merge should concatenate both wire labels with a space",
);
const mergeResult = mergeCircuitJunctionResult(mergeScene, mergeJunction.id);
check(
  mergeResult?.edgeId === mergeW1.id,
  "merge result should identify the surviving wire for selection",
);

// --- junction insertion / warning / shift branches -------------------------
const insertionScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [wire("insertion_wire", "v1", "+", "r1", "A")],
);
const inserted = addCircuitJunctionToWire(
  insertionScene,
  asEdgeId("insertion_wire"),
  { x: 63, y: 35 },
);
check(
  inserted !== null &&
    Math.abs(rectCenter(inserted.junction.frame).x - 63) < 0.001 &&
    Math.abs(rectCenter(inserted.junction.frame).y - 36) < 0.001,
  "double-click junction insertion should snap to the nearest grid point",
);
check(
  inserted !== null && Object.keys(inserted.scene.edges).length === 2,
  "inserting a junction should split the wire",
);
const insertScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("lp1", "LP1", "lightbulb", rect(0, 90, 54, 36)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [wire("insert_wire", "v1", "+", "r1", "A")],
);
const insertedComponent = insertCircuitComponentOnWire(
  insertScene,
  asNodeId("lp1"),
  asEdgeId("insert_wire"),
  { x: 63, y: 36 },
  "horizontal",
);
const insertedBulb = insertedComponent?.nodes.lp1;
check(
  insertedComponent !== null &&
    insertedBulb?.kind === "circuitComponent" &&
    insertedBulb.rotation === 0 &&
    Math.abs(rectCenter(insertedBulb.frame).x - 63) < 0.001 &&
    Math.abs(rectCenter(insertedBulb.frame).y - 36) < 0.001,
  "shift-dropped component should center on the target wire",
);
check(
  insertedComponent !== null &&
    Object.values(insertedComponent.edges).length === 2 &&
    Object.values(insertedComponent.nodes).every(
      (node) => node.kind !== "circuitJunction",
    ),
  "wire insertion should split the wire without leaving a junction",
);
check(
  insertedComponent !== null &&
    Object.values(insertedComponent.edges).filter(
      (edge) =>
        (edge.source.target === "node" && edge.source.nodeId === asNodeId("lp1")) ||
        (edge.target.target === "node" && edge.target.nodeId === asNodeId("lp1")),
    ).length === 2,
  "both split wire ends should rewire to the inserted component",
);
const switchOpenScene = withNodes([component("sw1", "SW1", "switch")]);
const switchClosedScene = withNodes([{
  ...component("sw1", "SW1", "switch"),
  switchClosed: true,
}]);
const switchOpen = buildLayoutSnapshot(switchOpenScene, measurer);
const switchClosed = buildLayoutSnapshot(switchClosedScene, measurer);
check(
  JSON.stringify(switchOpen.nodes.sw1) !== JSON.stringify(switchClosed.nodes.sw1),
  "switch ON/OFF should change the rendered symbol",
);
const coincidentBase = withNodes([
  component("r1", "R1", "resistor", rect(0, 0, 54, 36)),
]);
const coincidentPin = { x: 0, y: 18 };
const coincidentJ1 = createCircuitJunction(coincidentBase, coincidentPin, "filled");
const coincidentJ2 = createCircuitJunction(coincidentBase, coincidentPin, "filled");
const coincidentMerged = mergeCoincidentCircuitConnections(
  withNodes([component("r1", "R1", "resistor", rect(0, 0, 54, 36)), coincidentJ1, coincidentJ2]),
);
check(
  Object.values(coincidentMerged.nodes).filter(
    (node) => node.kind === "circuitJunction",
  ).length === 1,
  "coincident junctions should merge after a move",
);
check(
  Object.keys(coincidentMerged.edges).length === 1,
  "a component pin landed on a junction should gain a zero-length wire",
);
const redundantBase = withNodes(
  [
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    component("r2", "R2", "resistor", rect(270, 0, 54, 36)),
  ],
);
const redundantJunction = createCircuitJunction(redundantBase, { x: 180, y: 18 }, "filled");
const redundantScene = withNodes(
  [
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    component("r2", "R2", "resistor", rect(270, 0, 54, 36)),
    redundantJunction,
  ],
  [
    {
      ...wire("redundant_w1", "r1", "A", "r2", "A"),
      target: {
        target: "node",
        nodeId: redundantJunction.id,
        port: { kind: "center" },
      },
    },
    {
      ...wire("redundant_w2", "r1", "A", "r2", "A"),
      source: {
        target: "node",
        nodeId: redundantJunction.id,
        port: { kind: "center" },
      },
    },
  ],
);
const redundantMerged = mergeCoincidentCircuitConnections(redundantScene);
check(
  Object.values(redundantMerged.nodes).every(
    (node) => node.kind !== "circuitJunction",
  ) && Object.keys(redundantMerged.edges).length === 1,
  "a degree-two collinear junction should collapse back into one wire",
);
const hiddenDegreeTwo = hideDegreeTwoJunctions(
  redundantScene,
  [redundantJunction.id],
);
const hiddenNode = hiddenDegreeTwo.nodes[redundantJunction.id];
check(
  hiddenNode?.kind === "circuitJunction" && hiddenNode.junctionStyle === "none",
  "visual refinement should hide a translated junction with only two wires",
);
const nearbyBase = createEmptyScene("circuit", "nearby");
const nearbyJ1 = createCircuitJunction(nearbyBase, { x: 100.5, y: 100.5 }, "filled");
const nearbyJ2 = createCircuitJunction(nearbyBase, { x: 101.5, y: 101.5 }, "filled");
const nearbyMerged = mergeNearbyCircuitJunctions(
  withNodes([nearbyJ1, nearbyJ2]),
);
const nearbyJunction = Object.values(nearbyMerged.nodes).find(
  (node) => node.kind === "circuitJunction",
);
check(
  Object.values(nearbyMerged.nodes).filter(
    (node) => node.kind === "circuitJunction",
  ).length === 1 &&
    nearbyJunction !== undefined &&
    Math.abs(rectCenter(nearbyJunction.frame).x / 9 - Math.round(rectCenter(nearbyJunction.frame).x / 9)) < 1e-6 &&
    Math.abs(rectCenter(nearbyJunction.frame).y / 9 - Math.round(rectCenter(nearbyJunction.frame).y / 9)) < 1e-6,
  "nearby off-grid junctions should merge into one grid-aligned junction",
);
const isolatedJunction = createCircuitJunction(base, { x: 180, y: 90 }, "filled");
const isolatedLayout = buildLayoutSnapshot(
  withNodes([{ ...isolatedJunction, name: "N" }]),
  measurer,
);
const isolatedJunctionLayout = isolatedLayout.nodes[isolatedJunction.id];
check(
  isolatedJunctionLayout?.kind === "circuitJunction" &&
    isolatedJunctionLayout.connected === false,
  "an unconnected junction should be marked for the warning style",
);

const originalR1Frame = rect(90, 0, 54, 36);
const movedR1 = { ...component("r1", "R1", "resistor", rect(90, 36, 54, 36)) };
const branchScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    movedR1,
  ],
  [wire("branch_wire", "v1", "+", "r1", "A")],
);
const branchZero = createShiftDragBranches(branchScene, {
  nodeIds: [asNodeId("r1")],
  originalFrames: { r1: originalR1Frame },
  distance: 0,
});
const branchZeroJunction = Object.values(branchZero.nodes).find(
  (node) => node.kind === "circuitJunction",
);
check(
  branchZeroJunction?.kind === "circuitJunction" &&
    Math.abs(rectCenter(branchZeroJunction.frame).x - 90) < 0.001 &&
    Math.abs(rectCenter(branchZeroJunction.frame).y - 18) < 0.001,
  "shift drag without scroll should pin Group 1 at the former pin",
);
check(
  Object.keys(branchZero.edges).length === 2,
  "shift drag without scroll should add the moved-pin stub",
);
const branchOffset = createShiftDragBranches(branchScene, {
  nodeIds: [asNodeId("r1")],
  originalFrames: { r1: originalR1Frame },
  distance: 9,
});
const branchJunctions = Object.values(branchOffset.nodes).filter(
  (node) => node.kind === "circuitJunction",
);
check(
  branchJunctions.length === 2 &&
    branchJunctions.some((node) => node.kind === "circuitJunction" && node.junctionStyle === "filled") &&
    branchJunctions.some((node) => node.kind === "circuitJunction" && node.junctionStyle === "none"),
  "shift scroll should create fixed Group 1 and None Group 2 junctions",
);
check(
  Object.keys(branchOffset.edges).length === 3,
  "shift scroll should add a stub and a Group 2-to-Group 1 wire",
);
check(
  Object.values(branchOffset.edges).some(
    (edge) =>
      edge.routing.mode === "straight" &&
      (edge.source.target === "node" || edge.target.target === "node"),
  ),
  "shift branch wires should use straight routing",
);
const parallelBase = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    component("r1d", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [wire("parallel_w1", "v1", "+", "r1", "A")],
);
const parallel = createDuplicateParallelBranches(
  parallelBase,
  [{ sourceId: asNodeId("r1"), duplicateId: asNodeId("r1d") }],
  9,
);
const parallelJunctions = Object.values(parallel.scene.nodes).filter(
  (node) => node.kind === "circuitJunction",
);
check(
  parallelJunctions.some(
    (node) => node.kind === "circuitJunction" && node.junctionStyle === "filled",
  ) &&
    parallelJunctions.some(
      (node) => node.kind === "circuitJunction" && node.junctionStyle === "none",
    ) &&
    Object.keys(parallel.scene.edges).length === 4,
  "ctrl+shift duplicate should add parallel Group 1/Group 2 branches",
);
const internalBranchJunction = createCircuitJunction(
  withNodes([
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ]),
  { x: 90, y: 18 },
  "filled",
);
const internalBranchScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
    internalBranchJunction,
  ],
  [
    {
      ...wire("internal_w1", "r1", "A", "v1", "+"),
      target: {
        target: "node",
        nodeId: internalBranchJunction.id,
        port: { kind: "center" },
      },
    },
    {
      ...wire("internal_w2", "v1", "+", "r1", "A"),
      target: {
        target: "node",
        nodeId: internalBranchJunction.id,
        port: { kind: "center" },
      },
    },
  ],
);
const internalBranch = createShiftDragBranchesResult(
  internalBranchScene,
  {
    nodeIds: [asNodeId("r1")],
    junctionIds: [internalBranchJunction.id],
    selectedNodeIds: [
      asNodeId("r1"),
      asNodeId("v1"),
      internalBranchJunction.id,
    ],
    originalFrames: { r1: rect(90, 0, 54, 36) },
    distance: 9,
  },
  false,
);
check(
  internalBranch.groups.length === 0,
  "shift-branch should not rewire a pin connected to an internal selected junction",
);
const boundaryBranch = createShiftDragBranchesResult(
  internalBranchScene,
  {
    nodeIds: [asNodeId("r1")],
    junctionIds: [internalBranchJunction.id],
    selectedNodeIds: [asNodeId("r1"), internalBranchJunction.id],
    originalFrames: { r1: rect(90, 0, 54, 36) },
    distance: 9,
  },
  false,
);
check(
  boundaryBranch.groups.length > 0,
  "a selected junction connected outside the group should be treated normally",
);
const boundaryAnchor = boundaryBranch.groups[0]?.group1Id;
check(
  boundaryAnchor !== undefined &&
    Object.values(boundaryBranch.scene.edges).some(
      (edge) =>
        (edge.source.target === "node" &&
          edge.source.nodeId === internalBranchJunction.id &&
          edge.source.port.kind === "center" &&
          edge.target.target === "node" &&
          edge.target.nodeId === boundaryAnchor &&
          edge.target.port.kind === "center") ||
        (edge.target.target === "node" &&
          edge.target.nodeId === internalBranchJunction.id &&
          edge.target.port.kind === "center" &&
          edge.source.target === "node" &&
          edge.source.nodeId === boundaryAnchor &&
          edge.source.port.kind === "center"),
    ),
  "a boundary junction branch should connect the junction to its new anchor",
);
const normalizedBoundaryBranch = normalizeCircuitJunctionStyles(
  mergeNearbyCircuitJunctions(
    normalizeCircuitDuplicateConnections(
      normalizeCircuitPinConnections(boundaryBranch.scene),
    ),
  ),
);
check(
  boundaryAnchor !== undefined &&
    Object.values(normalizedBoundaryBranch.edges).some(
      (edge) =>
        (edge.source.target === "node" &&
          edge.source.nodeId === internalBranchJunction.id &&
          edge.target.target === "node" &&
          edge.target.nodeId === boundaryAnchor) ||
        (edge.target.target === "node" &&
          edge.target.nodeId === internalBranchJunction.id &&
          edge.source.target === "node" &&
          edge.source.nodeId === boundaryAnchor),
    ),
  "normalization should keep the boundary junction branch connection",
);
const detachScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("r1", "R1", "resistor", rect(90, 0, 54, 36)),
  ],
  [
    wire("detach_w1", "v1", "+", "r1", "A"),
    wire("detach_w2", "v1", "−", "r1", "B"),
  ],
);
const detached = detachCircuitComponentEndings(detachScene, [asNodeId("r1")]);
const detachJunctions = Object.values(detached.nodes).filter(
  (node) => node.kind === "circuitJunction",
);
const detachedPinEdges = Object.values(detached.edges).filter(
  (edge) =>
    (edge.source.target === "node" &&
      edge.source.nodeId === asNodeId("r1") &&
      edge.source.port.kind === "pin") ||
    (edge.target.target === "node" &&
      edge.target.nodeId === asNodeId("r1") &&
      edge.target.port.kind === "pin"),
);
check(
  detachJunctions.length === 2 &&
    detachJunctions.every(
      (node) => node.kind === "circuitJunction" && node.junctionStyle === "none",
    ),
  "alt-detach should leave invisible junctions at both endings",
);
check(
  detachedPinEdges.length === 0 && Object.keys(detached.edges).length === 3,
  "alt-detach should disconnect the component and add a two-ending short",
);
const detachThreeScene = withNodes(
  [
    component("v1", "V1", "voltage-source", rect(0, 0, 36, 54)),
    component("v2", "V2", "voltage-source", rect(0, 90, 36, 54)),
    component("v3", "V3", "voltage-source", rect(0, 180, 36, 54)),
    component("q1", "Q1", "transistor-npn", rect(180, 90, 54, 54)),
  ],
  [
    wire("detach3_w1", "v1", "+", "q1", "B"),
    wire("detach3_w2", "v2", "+", "q1", "C"),
    wire("detach3_w3", "v3", "+", "q1", "E"),
  ],
);
const detachedThree = detachCircuitComponentEndings(detachThreeScene, [asNodeId("q1")]);
check(
  Object.values(detachedThree.nodes).filter(
    (node) => node.kind === "circuitJunction",
  ).length === 3 && Object.keys(detachedThree.edges).length === 3,
  "alt-detach with three endings should create junctions without a short",
);
const straightExternal = createCircuitJunction(
  withNodes([component("r1", "R1", "resistor", rect(90, 0, 54, 36))]),
  { x: 18, y: 18 },
  "filled",
);
const straightScene = withNodes(
  [
    component("r1", "R1", "resistor", rect(54, 0, 54, 36)),
    straightExternal,
  ],
  [{
    ...wire("straight_wire", "r1", "A", "r1", "A"),
    source: { target: "node", nodeId: straightExternal.id, port: { kind: "center" } },
    target: { target: "node", nodeId: asNodeId("r1"), port: { kind: "pin", pinId: "A" } },
  }],
);
const straightMerged = createShiftDragBranches(straightScene, {
  nodeIds: [asNodeId("r1")],
  originalFrames: { r1: rect(90, 0, 54, 36) },
  distance: 0,
});
check(
  Object.keys(straightMerged.edges).length === 1 &&
    Object.values(straightMerged.nodes).filter(
      (node) => node.kind === "circuitJunction" && node.id !== straightExternal.id,
    ).length === 0,
  "collinear shift branches should merge away unnecessary Group 1 junctions",
);
const straightOffset = createShiftDragBranches(straightScene, {
  nodeIds: [asNodeId("r1")],
  originalFrames: { r1: rect(90, 0, 54, 36) },
  distance: 9,
});
check(
  Object.keys(straightOffset.edges).length === 1 &&
    Object.values(straightOffset.nodes).filter(
      (node) => node.kind === "circuitJunction" && node.id !== straightExternal.id,
    ).length === 0,
  "collinear shift branches should also remove Group 2",
);

// --- bridges -----------------------------------------------------------------
const bridgeScene = withNodes(
  [
    createCircuitJunction(sourceSceneBase(), { x: 0, y: 50 }, "none"),
    createCircuitJunction(sourceSceneBase(), { x: 200, y: 50 }, "none"),
    createCircuitJunction(sourceSceneBase(), { x: 100, y: 0 }, "none"),
    createCircuitJunction(sourceSceneBase(), { x: 100, y: 100 }, "none"),
  ],
);
const junctionNodes = Object.values(bridgeScene.nodes);
const bridgeEdges: SceneEdge[] = [
  {
    ...wire("h", "unused", "A", "unused", "A"),
    source: { target: "node", nodeId: junctionNodes[0]?.id ?? asNodeId("x"), port: { kind: "center" } },
    target: { target: "node", nodeId: junctionNodes[1]?.id ?? asNodeId("y"), port: { kind: "center" } },
  },
  {
    ...wire("v", "unused", "A", "unused", "A"),
    source: { target: "node", nodeId: junctionNodes[2]?.id ?? asNodeId("x"), port: { kind: "center" } },
    target: { target: "node", nodeId: junctionNodes[3]?.id ?? asNodeId("y"), port: { kind: "center" } },
  },
];
const bridgeLayout = buildLayoutSnapshot({ ...bridgeScene, edges: Object.fromEntries(bridgeEdges.map((edge) => [edge.id, edge])) }, measurer);
const bridgeMap = computeWireBridges(
  Object.values(bridgeLayout.edges).map((edge) => ({
    edgeId: edge.edgeId,
    points: edge.points,
    z: 10,
  })),
  junctionNodes.flatMap((node) =>
    node.kind === "circuitJunction"
      ? [{ x: node.frame.x + 9, y: node.frame.y + 9 }]
      : [],
  ),
  { standard: "iec", crossings: "bridge", bridgeRadius: 6 },
);
check(
  bridgeMap.size === 1,
  "exactly one owner edge should receive the crossing bridge",
);

const bridgeExport = serializeSceneToCetz({
  scene: {
    ...bridgeScene,
    edges: Object.fromEntries(bridgeEdges.map((edge) => [edge.id, edge])),
  },
  layout: bridgeLayout,
  settings: { ...DEFAULT_EXPORT_SETTINGS, diagramId: "fig-bridge" },
  selectedNodeIds: [],
  selectedEdgeId: null,
});
check(bridgeExport.code.includes("draw.bezier"), "bridge hops should export as CeTZ beziers");

// --- clipboard preserves labels ---------------------------------------------
const clipboardScene = withNodes([component("r1", "R1", "resistor")]);
const clipboard = copySceneNodes(clipboardScene, ["r1"]);
check(clipboard !== null, "clipboard copy should succeed");
if (clipboard !== null) {
  const pasted = pasteSceneClipboard(clipboardScene, clipboard, { x: 18, y: 18 });
  check(pasted !== null, "clipboard paste should succeed");
  if (pasted !== null) {
    const names = Object.values(pasted.scene.nodes).map((node) => node.name);
    check(names.filter((name) => name === "R1").length === 2, "copy/paste must preserve duplicate labels");
  }
}

// --- minimum drag guard ------------------------------------------------------
check(
  !canExtendToEmpty({ pointerTravelPx: 4, source: { x: 0, y: 0 }, candidate: { x: 40, y: 0 }, gridSize: 9 }),
  "short drag must not create a node",
);
check(
  canExtendToEmpty({ pointerTravelPx: 20, source: { x: 0, y: 0 }, candidate: { x: 40, y: 0 }, gridSize: 9 }),
  "deliberate drag should create a node",
);

// --- CeTZ export -------------------------------------------------------------
const layout = buildLayoutSnapshot(CIRCUIT_DIVIDER, measurer);
const straightFixture = Object.values(layout.edges).every((edge) =>
  edge.points.every((point, index) => {
    if (index === 0) return true;
    const previous = edge.points[index - 1];
    return previous !== undefined &&
      (Math.abs(previous.x - point.x) < 0.001 || Math.abs(previous.y - point.y) < 0.001);
  }),
);
check(straightFixture, "the divider template wires should be horizontal/vertical");
const gridFixture = Object.values(layout.edges).every((edge) =>
  edge.points.slice(1, -1).every(
    (point) => point.x % 9 === 0 && point.y % 9 === 0,
  ),
);
check(gridFixture, "all divider template wire corners should sit on the grid");
const alignedRoute = gridAlignedOrthogonalRoute(
  [{ x: 0, y: 0 }, { x: 14, y: 5 }, { x: 28, y: 23 }, { x: 36, y: 27 }],
  9,
);
check(
  alignedRoute.every((entry, index) => {
    if (index === 0) return true;
    const previous = alignedRoute[index - 1];
    return previous !== undefined &&
      (previous.x === entry.x || previous.y === entry.y);
  }),
  "grid-aligned rerouting should keep every segment orthogonal",
);
check(
  alignedRoute.slice(1, -1).every(
    (entry) => entry.x % 9 === 0 && entry.y % 9 === 0,
  ),
  "grid-aligned rerouting should place every bend on the grid",
);
const exported = serializeSceneToCetz({
  scene: CIRCUIT_DIVIDER,
  layout,
  settings: { ...DEFAULT_EXPORT_SETTINGS, diagramId: "fig-circuit" },
  selectedNodeIds: [],
  selectedEdgeId: null,
});
check(exported.code.includes("draw.circle"), "circuit export should draw component circles/dots");
check(!exported.code.includes("draw.register-mark"), "circuit export must not register markers");
check(!exported.code.includes("mark:"), "circuit wires must not carry markers");
check(exported.code.includes('draw.anchor("pin_A"'), "circuit export should expose pin anchors");
check(exported.code.includes('#sub('), "circuit reference labels should export as Typst subscripts");
const nestedLabelScene = withNodes([component("r1", 'R_"12"_"34"', "resistor")]);
const nestedLabelExport = serializeSceneToCetz({
  scene: nestedLabelScene,
  layout: buildLayoutSnapshot(nestedLabelScene, measurer),
  settings: { ...DEFAULT_EXPORT_SETTINGS, diagramId: "fig-nested" },
  selectedNodeIds: [],
  selectedEdgeId: null,
});
check(
  nestedLabelExport.code.includes('#sub(') &&
    nestedLabelExport.code.includes('#text(size:') &&
    nestedLabelExport.code.includes('#("34")'),
  "nested subscripts should serialize with a smaller, lower Typst text run",
);

console.log(`Circuit checks passed (${passed} assertions).`);



