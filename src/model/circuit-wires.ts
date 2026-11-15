/**
 * Circuit wire and junction edits.
 *
 * These helpers return a complete new scene. The caller commits it in one
 * `setScene` call so a junction split is a single undo step.
 */

import type { SceneDocument } from "./scene.ts";
import type { CircuitJunctionNode, SceneNode } from "./nodes.ts";
import type { EdgeAttachment, NodePortRef, SceneEdge } from "./edges.ts";
import { NO_MARKER, portKey } from "./edges.ts";
import type { Point, Rect } from "./geometry.ts";
import { add, length, point, rect, rectCenter, scale, snap, sub } from "./geometry.ts";
import { circuitComponent } from "./circuit-catalog.ts";
import {
  asNodeId,
  newId,
  type EdgeId,
  type LabelId,
  type NodeId,
} from "./ids.ts";

export interface CircuitSourceRef {
  readonly nodeId: NodeId;
  readonly port: NodePortRef;
}

export interface CircuitWireResult {
  readonly scene: SceneDocument;
  readonly junctionId: NodeId;
  readonly newEdgeId: EdgeId;
}

export interface CircuitJunctionInsertion {
  readonly scene: SceneDocument;
  readonly junction: CircuitJunctionNode;
  readonly newEdgeId: EdgeId;
}

const internalJunctionSelection = (
  scene: SceneDocument,
  nodeIds: readonly NodeId[],
): Set<string> => {
  const selected = new Set(nodeIds.map(String));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...selected]) {
      const node = scene.nodes[id];
      if (node?.kind !== "circuitJunction") continue;
      const boundary = Object.values(scene.edges).some((edge) => {
        if (edge.semantic.family !== "circuit") return false;
        const source =
          edge.source.target === "node" &&
          edge.source.nodeId === node.id &&
          edge.source.port.kind === "center";
        const target =
          edge.target.target === "node" &&
          edge.target.nodeId === node.id &&
          edge.target.port.kind === "center";
        if (!source && !target) return false;
        const other = source ? edge.target : edge.source;
        return other.target !== "node" || !selected.has(String(other.nodeId));
      });
      if (boundary) {
        selected.delete(id);
        changed = true;
      }
    }
  }
  return selected;
};

export interface ShiftBranchDrag {
  readonly nodeIds: readonly NodeId[];
  /** Boundary junctions that should branch instead of their enclosed pins. */
  readonly junctionIds?: readonly NodeId[];
  /** All selected nodes, including junctions that are internal to the group. */
  readonly selectedNodeIds?: readonly NodeId[];
  readonly originalFrames: Readonly<Record<string, Rect>>;
  /** Outward offset from the original pin, in scene units. */
  readonly distance: number;
}

export interface ShiftBranchGroup {
  readonly pinNodeId: NodeId;
  readonly pinId: string;
  readonly group1Id: NodeId;
  readonly group2Id?: NodeId;
  readonly stubEdgeId: EdgeId;
  readonly dynamicEdgeId?: EdgeId;
  readonly externalEdgeIds: readonly EdgeId[];
}

export interface ShiftBranchResult {
  readonly scene: SceneDocument;
  readonly group2Ids: readonly NodeId[];
  readonly groups: readonly ShiftBranchGroup[];
}

const rotateLocal = (value: Point, degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: value.x * cosine - value.y * sine,
    y: value.x * sine + value.y * cosine,
  };
};

const mirrorLocal = (
  value: Point,
  mirror: "none" | "horizontal" | "vertical" | undefined,
): Point =>
  mirror === "horizontal"
    ? point(-value.x, value.y)
    : mirror === "vertical"
      ? point(value.x, -value.y)
      : value;

const mirrorLocalXY = (
  value: Point,
  mirrorX: boolean,
  mirrorY: boolean,
): Point =>
  mirrorX || mirrorY
    ? point(mirrorX ? -value.x : value.x, mirrorY ? -value.y : value.y)
    : value;

const componentPinPoint = (
  center: Point,
  local: Point,
  rotation: number,
  gridSize: number,
  mirrorX = false,
  mirrorY = false,
): Point => {
  const raw = add(center, rotateLocal(mirrorLocalXY(local, mirrorX, mirrorY), rotation));
  return rotation % 90 === 0
    ? raw
    : { x: snap(raw.x, gridSize), y: snap(raw.y, gridSize) };
};

const commit = (
  scene: SceneDocument,
  patch: {
    readonly nodes?: Readonly<Record<string, SceneNode>>;
    readonly edges?: Readonly<Record<string, SceneEdge>>;
  },
): SceneDocument => ({
  ...scene,
  ...patch,
  revision: scene.revision + 1,
  meta: { ...scene.meta, updatedAt: new Date().toISOString() },
});

const nodeAttachment = (nodeId: NodeId, port: NodePortRef): EdgeAttachment => ({
  target: "node",
  nodeId,
  port,
});

export const createCircuitJunction = (
  scene: SceneDocument,
  at: Point,
  junctionStyle: CircuitJunctionNode["junctionStyle"] = "filled",
  name = "",
): CircuitJunctionNode => ({
  id: asNodeId(newId("junction")),
  kind: "circuitJunction",
  name,
  frame: rect(at.x - 9, at.y - 9, 18, 18),
  z: 3,
  locked: false,
  visible: true,
  junctionStyle,
  style: scene.theme.shape,
});

export const nearestCircuitJunction = (
  scene: SceneDocument,
  at: Point,
  tolerance: number,
): CircuitJunctionNode | undefined => {
  let best: CircuitJunctionNode | undefined;
  let bestDistance = tolerance;
  for (const node of Object.values(scene.nodes)) {
    if (node.kind !== "circuitJunction" || node.generatedBranch === true) continue;
    const distance = length(sub(rectCenter(node.frame), at));
    if (distance <= bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
};

export const createCircuitWire = (
  scene: SceneDocument,
  source: CircuitSourceRef,
  target: CircuitSourceRef,
): SceneEdge => ({
  id: newId<EdgeId>("edge"),
  source: nodeAttachment(source.nodeId, source.port),
  target: nodeAttachment(target.nodeId, target.port),
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
  style: scene.theme.edge,
  locked: false,
  visible: true,
  z: 10,
});

const isPinAttachment = (
  attachment: EdgeAttachment,
  nodeId: NodeId,
  pinId: string,
): boolean =>
  attachment.target === "node" &&
  attachment.nodeId === nodeId &&
  attachment.port.kind === "pin" &&
  attachment.port.pinId === pinId;

const connectsPinToJunction = (
  edge: SceneEdge,
  nodeId: NodeId,
  pinId: string,
  junctionId: NodeId,
): boolean => {
  const isPin = (attachment: EdgeAttachment): boolean =>
    isPinAttachment(attachment, nodeId, pinId);
  const isJunction = (attachment: EdgeAttachment): boolean =>
    attachment.target === "node" &&
    attachment.nodeId === junctionId &&
    attachment.port.kind === "center";
  return (isPin(edge.source) && isJunction(edge.target)) ||
    (isPin(edge.target) && isJunction(edge.source));
};

export interface OccupiedPinPreparation {
  readonly scene: SceneDocument;
  readonly attachment: CircuitSourceRef;
}

/**
 * When a pin already has a wire, a second wire gets a small filled junction
 * one grid square outside the pin. Existing direct wires are rewired to that
 * junction and a short pin-to-junction stub keeps the electrical connection.
 */
export const prepareOccupiedPinJunction = (
  scene: SceneDocument,
  attachment: CircuitSourceRef,
  point: Point,
  _normal: Point,
): OccupiedPinPreparation => {
  if (attachment.port.kind !== "pin") return { scene, attachment };
  const pinId = attachment.port.pinId;
  const direct = Object.values(scene.edges).filter(
    (edge) =>
      edge.semantic.family === "circuit" &&
      (isPinAttachment(edge.source, attachment.nodeId, pinId) ||
        isPinAttachment(edge.target, attachment.nodeId, pinId)),
  );
  if (direct.length === 0) return { scene, attachment };

  const grid = Math.max(1, scene.canvas.grid.size);
  const existing = nearestCircuitJunction(scene, point, Math.max(0.5, grid / 10));
  const baseJunction = existing ?? createCircuitJunction(scene, point, "filled");
  const junction: CircuitJunctionNode = {
    ...baseJunction,
    junctionStyle: "filled",
  };
  const nodes: Record<string, SceneNode> = {
    ...scene.nodes,
    [junction.id]: junction,
  };
  const edges: Record<string, SceneEdge> = { ...scene.edges };

  for (const edge of direct) {
    if (connectsPinToJunction(edge, attachment.nodeId, pinId, junction.id)) continue;
    let next = edge;
    if (isPinAttachment(next.source, attachment.nodeId, pinId)) {
      next = { ...next, source: nodeAttachment(junction.id, { kind: "center" }) };
    }
    if (isPinAttachment(next.target, attachment.nodeId, pinId)) {
      next = { ...next, target: nodeAttachment(junction.id, { kind: "center" }) };
    }
    edges[next.id] = next;
  }

  const hasStub = Object.values(edges).some((edge) =>
    connectsPinToJunction(edge, attachment.nodeId, pinId, junction.id),
  );
  if (!hasStub) {
    const stub = createCircuitWire(
      { ...scene, nodes },
      attachment,
      { nodeId: junction.id, port: { kind: "center" } },
    );
    edges[stub.id] = stub;
  }

  return {
    scene: { ...scene, nodes, edges },
    attachment: { nodeId: junction.id, port: { kind: "center" } },
  };
};

const addJunction = (
  scene: SceneDocument,
  at: Point,
  junctionStyle: CircuitJunctionNode["junctionStyle"],
  tolerance: number,
): { readonly scene: SceneDocument; readonly junction: CircuitJunctionNode } => {
  const existing = nearestCircuitJunction(scene, at, tolerance);
  if (existing !== undefined) return { scene, junction: existing };
  const junction = createCircuitJunction(scene, at, junctionStyle);
  return {
    scene: { ...scene, nodes: { ...scene.nodes, [junction.id]: junction } },
    junction,
  };
};

const upgradeJunction = (
  scene: SceneDocument,
  junction: CircuitJunctionNode,
  style: CircuitJunctionNode["junctionStyle"],
): { readonly scene: SceneDocument; readonly junction: CircuitJunctionNode } => {
  if (junction.junctionStyle === style) return { scene, junction };
  const upgraded: CircuitJunctionNode = { ...junction, junctionStyle: style };
  return {
    scene: { ...scene, nodes: { ...scene.nodes, [upgraded.id]: upgraded } },
    junction: upgraded,
  };
};

export const connectCircuitWireToPoint = (
  scene: SceneDocument,
  source: CircuitSourceRef,
  at: Point,
  junctionStyle: CircuitJunctionNode["junctionStyle"] = "none",
): CircuitWireResult | null => {
  if (scene.nodes[source.nodeId] === undefined) return null;
  const tolerance = Math.max(1, scene.canvas.grid.size / 2);
  const withJunction = addJunction(scene, at, junctionStyle, tolerance);
  let prepared = withJunction.scene;
  let junction = withJunction.junction;
  const existingConnections = Object.values(prepared.edges).filter(
    (edge) =>
      edge.semantic.family === "circuit" &&
      ((edge.source.target === "node" &&
        edge.source.nodeId === junction.id &&
        edge.source.port.kind === "center") ||
        (edge.target.target === "node" &&
          edge.target.nodeId === junction.id &&
          edge.target.port.kind === "center")),
  ).length;
  if (junction.junctionStyle === "none" && existingConnections >= 2) {
    const upgraded = upgradeJunction(prepared, junction, "filled");
    prepared = upgraded.scene;
    junction = upgraded.junction;
  }
  const wire = createCircuitWire(prepared, source, {
    nodeId: junction.id,
    port: { kind: "center" },
  });
  const next = commit(prepared, {
    edges: { ...prepared.edges, [wire.id]: wire },
  });
  return { scene: next, junctionId: junction.id, newEdgeId: wire.id };
};

const setEnd = (
  edge: SceneEdge,
  end: "source" | "target",
  attachment: EdgeAttachment,
): SceneEdge => (end === "source" ? { ...edge, source: attachment } : { ...edge, target: attachment });

/**
 * Split an existing wire at a junction. The original edge keeps its id, source
 * and labels and is retargeted to the junction; a second edge continues from
 * the junction to the original target.
 */
const splitWireAtJunction = (
  scene: SceneDocument,
  edgeId: EdgeId,
  junctionId: NodeId,
): { readonly scene: SceneDocument; readonly newEdgeId: EdgeId } | null => {
  const edge = scene.edges[edgeId];
  if (edge === undefined) return null;
  const alreadyAtJunction =
    (edge.source.target === "node" && edge.source.nodeId === junctionId) ||
    (edge.target.target === "node" && edge.target.nodeId === junctionId);
  if (alreadyAtJunction) {
    return { scene, newEdgeId: edgeId };
  }
  const junctionAttachment = nodeAttachment(junctionId, { kind: "center" });
  const continuation = createCircuitWire(
    scene,
    { nodeId: junctionId, port: { kind: "center" } },
    edge.target.target === "node"
      ? { nodeId: edge.target.nodeId, port: edge.target.port }
      : { nodeId: junctionId, port: { kind: "center" } },
  );
  // Preserve the source-side edge metadata and labels. Only the endpoint moves.
  const original: SceneEdge = {
    ...setEnd(edge, "target", junctionAttachment),
    labels: edge.labels.map((label) =>
      label.zone === "center" && label.anchor.kind === "edgePoint"
        ? { ...label, anchor: { kind: "edgePoint", t: 0.5 } }
        : label,
    ),
  };
  const continuationEdge: SceneEdge = {
    ...continuation,
    routing: edge.routing,
    markers: edge.markers,
    semantic: edge.semantic,
    style: edge.style,
    z: edge.z,
    locked: edge.locked,
    visible: edge.visible,
    labels: [],
  };
  return {
    scene: {
      ...scene,
      edges: {
        ...scene.edges,
        [original.id]: original,
        [continuationEdge.id]: continuationEdge,
      },
    },
    newEdgeId: continuationEdge.id,
  };
};

/** Insert a small filled junction at the nearest grid point and split the wire. */
export const addCircuitJunctionToWire = (
  scene: SceneDocument,
  edgeId: EdgeId,
  at: Point,
): CircuitJunctionInsertion | null => {
  const edge = scene.edges[edgeId];
  if (edge === undefined || edge.semantic.family !== "circuit") return null;
  const grid = Math.max(1, scene.canvas.grid.size);
  const snapped = { x: snap(at.x, grid), y: snap(at.y, grid) };
  const junction = createCircuitJunction(scene, snapped, "filled");
  const withJunction: SceneDocument = {
    ...scene,
    nodes: { ...scene.nodes, [junction.id]: junction },
  };
  const split = splitWireAtJunction(withJunction, edgeId, junction.id);
  if (split === null) return null;
  return {
    scene: commit(split.scene, {}),
    junction,
    newEdgeId: split.newEdgeId,
  };
};

export const connectCircuitWireToWire = (
  scene: SceneDocument,
  source: CircuitSourceRef,
  targetEdgeId: EdgeId,
  at: Point,
): CircuitWireResult | null => {
  if (scene.edges[targetEdgeId] === undefined) return null;
  if (scene.nodes[source.nodeId] === undefined) return null;
  const tolerance = Math.max(1, scene.canvas.grid.size / 2);
  const withJunction = addJunction(scene, at, "filled", tolerance);
  const upgraded = upgradeJunction(withJunction.scene, withJunction.junction, "filled");
  const split = splitWireAtJunction(upgraded.scene, targetEdgeId, upgraded.junction.id);
  if (split === null) return null;
  const wire = createCircuitWire(split.scene, source, {
    nodeId: upgraded.junction.id,
    port: { kind: "center" },
  });
  const next = commit(split.scene, {
    edges: { ...split.scene.edges, [wire.id]: wire },
  });
  return { scene: next, junctionId: upgraded.junction.id, newEdgeId: wire.id };
};

export const reattachCircuitEdgeToPoint = (
  scene: SceneDocument,
  edgeId: EdgeId,
  end: "source" | "target",
  at: Point,
): CircuitWireResult | null => {
  const edge = scene.edges[edgeId];
  if (edge === undefined) return null;
  const tolerance = Math.max(1, scene.canvas.grid.size / 2);
  const withJunction = addJunction(scene, at, "none", tolerance);
  const junction = withJunction.junction;
  const updated = setEnd(
    edge,
    end,
    nodeAttachment(junction.id, { kind: "center" }),
  );
  const next = commit(withJunction.scene, {
    edges: { ...withJunction.scene.edges, [edgeId]: updated },
  });
  return { scene: next, junctionId: junction.id, newEdgeId: edgeId };
};

export const reattachCircuitEdgeToWire = (
  scene: SceneDocument,
  edgeId: EdgeId,
  end: "source" | "target",
  targetEdgeId: EdgeId,
  at: Point,
): CircuitWireResult | null => {
  if (edgeId === targetEdgeId) return null;
  const moved = scene.edges[edgeId];
  if (moved === undefined || scene.edges[targetEdgeId] === undefined) return null;
  const tolerance = Math.max(1, scene.canvas.grid.size / 2);
  const withJunction = addJunction(scene, at, "filled", tolerance);
  const upgraded = upgradeJunction(withJunction.scene, withJunction.junction, "filled");
  const split = splitWireAtJunction(upgraded.scene, targetEdgeId, upgraded.junction.id);
  if (split === null) return null;
  const updated = setEnd(
    moved,
    end,
    nodeAttachment(upgraded.junction.id, { kind: "center" }),
  );
  const next = commit(split.scene, {
    edges: { ...split.scene.edges, [edgeId]: updated },
  });
  return { scene: next, junctionId: upgraded.junction.id, newEdgeId: edgeId };
};

const straightCircuitRouting = (): SceneEdge["routing"] => ({
  mode: "straight",
  avoidObstacles: false,
  obstaclePadding: 0,
  stubLength: 0,
  waypoints: [],
});

const attachmentRef = (attachment: EdgeAttachment): CircuitSourceRef | null =>
  attachment.target === "node"
    ? { nodeId: attachment.nodeId, port: attachment.port }
    : null;

/**
 * Turn an orthogonal route into a chain of straight wires with an invisible
 * junction at every interior corner. Used by the circuit double-click reroute.
 */
export const splitCircuitWireAtCorners = (
  scene: SceneDocument,
  edgeId: EdgeId,
  corners: readonly Point[],
): SceneDocument => {
  const edge = scene.edges[edgeId];
  if (edge === undefined || corners.length === 0) return scene;
  const tolerance = Math.max(1, scene.canvas.grid.size / 2);
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const junctionIds: NodeId[] = [];
  const seen = new Set<string>();
  for (const corner of corners) {
    const key = `${Math.round(corner.x * 1000)}:${Math.round(corner.y * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = nearestCircuitJunction({ ...scene, nodes }, corner, tolerance);
    if (existing !== undefined) {
      junctionIds.push(existing.id);
      continue;
    }
    const junction = createCircuitJunction(scene, corner, "none");
    nodes[junction.id] = junction;
    junctionIds.push(junction.id);
  }
  if (junctionIds.length === 0) return scene;

  const points: EdgeAttachment[] = [
    edge.source,
    ...junctionIds.map((nodeId) => nodeAttachment(nodeId, { kind: "center" })),
    edge.target,
  ];
  const firstSource = attachmentRef(points[0] as EdgeAttachment);
  if (firstSource === null) return scene;

  const edges: Record<string, SceneEdge> = { ...scene.edges };
  for (let index = 0; index < points.length - 1; index += 1) {
    const source = attachmentRef(points[index] as EdgeAttachment);
    const target = attachmentRef(points[index + 1] as EdgeAttachment);
    if (source === null || target === null) return scene;
    if (index === 0) {
      edges[edge.id] = {
        ...edge,
        target: points[1] as EdgeAttachment,
        routing: straightCircuitRouting(),
        labels: edge.labels.map((label) =>
          label.zone === "center" && label.anchor.kind === "edgePoint"
            ? { ...label, anchor: { kind: "edgePoint", t: 0.5 } }
            : label,
        ),
      };
      continue;
    }
    const segment = createCircuitWire(scene, source, target);
    edges[segment.id] = {
      ...segment,
      id: segment.id,
      markers: edge.markers,
      semantic: edge.semantic,
      style: edge.style,
      z: edge.z,
      locked: edge.locked,
      visible: edge.visible,
      routing: straightCircuitRouting(),
      labels: [],
    };
  }
  return commit(scene, { nodes, edges });
};

const otherEnd = (edge: SceneEdge, junctionId: NodeId): EdgeAttachment | null => {
  if (edge.source.target === "node" && edge.source.nodeId === junctionId) {
    return edge.target;
  }
  if (edge.target.target === "node" && edge.target.nodeId === junctionId) {
    return edge.source;
  }
  return null;
};

/**
 * Remove a two-way junction and merge its two wires into one. A single label is
 * kept; two labels are concatenated with a space, as requested by the editor.
 */
export interface CircuitJunctionMerge {
  readonly scene: SceneDocument;
  readonly edgeId: EdgeId;
}

export const mergeCircuitJunctionResult = (
  scene: SceneDocument,
  junctionId: NodeId,
): CircuitJunctionMerge | null => {
  const junction = scene.nodes[junctionId];
  if (junction === undefined || junction.kind !== "circuitJunction") return null;
  const attached = Object.values(scene.edges).filter(
    (edge) =>
      edge.semantic.family === "circuit" &&
      ((edge.source.target === "node" &&
        edge.source.nodeId === junctionId &&
        edge.source.port.kind === "center") ||
        (edge.target.target === "node" &&
          edge.target.nodeId === junctionId &&
          edge.target.port.kind === "center")),
  );
  if (attached.length !== 2) return null;
  const first = attached[0];
  const second = attached[1];
  if (first === undefined || second === undefined) return null;
  const firstOther = otherEnd(first, junctionId);
  const secondOther = otherEnd(second, junctionId);
  if (firstOther === null || secondOther === null) return null;
  const source = attachmentRef(firstOther);
  const target = attachmentRef(secondOther);
  if (source === null || target === null) return null;

  const labels = [first, second].flatMap((edge) =>
    edge.labels.filter((label) => label.zone === "center"),
  );
  const labelText = labels
    .map((label) => label.text.trim())
    .filter((text) => text.length > 0)
    .join(" ");
  const firstLabel = labels[0];
  const mergedLabels: SceneEdge["labels"] = labelText.length === 0
    ? []
    : [{
        id: firstLabel?.id ?? newId<LabelId>("label"),
        zone: "center",
        text: labelText,
        anchor: { kind: "edgePoint", t: 0.5 },
        offset: firstLabel?.offset ?? { x: 0, y: -12 },
        locked: false,
        visible: true,
        textStyle: firstLabel?.textStyle,
      }];

  const template = createCircuitWire(scene, source, target);
  const merged: SceneEdge = {
    ...template,
    id: first.id,
    markers: first.markers,
    semantic: first.semantic,
    style: first.style,
    z: first.z,
    labels: mergedLabels,
  };
  const edges = { ...scene.edges, [merged.id]: merged };
  delete edges[second.id];
  const nodes = { ...scene.nodes };
  delete nodes[junction.id];
  return { scene: commit(scene, { nodes, edges }), edgeId: merged.id };
};

export const mergeCircuitJunction = (
  scene: SceneDocument,
  junctionId: NodeId,
): SceneDocument =>
  mergeCircuitJunctionResult(scene, junctionId)?.scene ?? scene;

const circuitAttachmentPoint = (
  scene: SceneDocument,
  attachment: EdgeAttachment,
): Point | null => {
  if (attachment.target !== "node") return null;
  const node = scene.nodes[attachment.nodeId];
  if (node === undefined) return null;
  if (attachment.port.kind === "center") return rectCenter(node.frame);
  if (attachment.port.kind !== "pin" || node.kind !== "circuitComponent") return null;
  const port = attachment.port;
  const definition = circuitComponent(node.component);
  const pin = definition?.pins.find((candidate) => candidate.id === port.pinId);
  if (pin === undefined) return null;
  return componentPinPoint(
    rectCenter(node.frame),
    point(pin.x, pin.y),
    node.rotation,
    scene.canvas.grid.size,
    node.mirrorX === true,
    node.mirrorY === true,
  );
};

const areCollinear = (a: Point, b: Point, c: Point): boolean =>
  Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-6;

export type WireOrientation = "horizontal" | "vertical";

/**
 * Drop an unconnected two-terminal component onto a wire. The component is
 * centered on the nearest grid point, the target wire is split there, and the
 * two sides are attached to the component's two pins.
 */
export const insertCircuitComponentOnWire = (
  scene: SceneDocument,
  nodeId: NodeId,
  edgeId: EdgeId,
  at: Point,
  orientation: WireOrientation,
): SceneDocument | null => {
  const node = scene.nodes[nodeId];
  if (node === undefined || node.kind !== "circuitComponent") return null;
  const definition = circuitComponent(node.component);
  if (definition === undefined || definition.pins.length !== 2) return null;
  const edge = scene.edges[edgeId];
  if (edge === undefined || edge.semantic.family !== "circuit") return null;
  if (
    Object.values(scene.edges).some(
      (candidate) =>
        candidate.semantic.family === "circuit" &&
        definition.pins.some(
          (pin) =>
            isPinAttachment(candidate.source, node.id, pin.id) ||
            isPinAttachment(candidate.target, node.id, pin.id),
        ),
    )
  ) {
    return null;
  }

  const grid = Math.max(1, scene.canvas.grid.size);
  const snapped = { x: snap(at.x, grid), y: snap(at.y, grid) };
  const rotation = orientation === "horizontal" ? 0 : 90;
  const updatedNode = {
    ...node,
    rotation,
    frame: {
      ...node.frame,
      x: snapped.x - node.frame.width / 2,
      y: snapped.y - node.frame.height / 2,
    },
  } as SceneNode;
  const withNode: SceneDocument = {
    ...scene,
    nodes: { ...scene.nodes, [node.id]: updatedNode },
  };
  const firstPin = definition.pins[0];
  const secondPin = definition.pins[1];
  if (firstPin === undefined || secondPin === undefined) return null;
  const firstPoint = componentPinPoint(
    snapped,
    point(firstPin.x, firstPin.y),
    rotation,
    scene.canvas.grid.size,
    node.mirrorX === true,
    node.mirrorY === true,
  );
  const sourcePoint = circuitAttachmentPoint(scene, edge.source);
  const sourceFirst = sourcePoint === null
    ? true
    : orientation === "horizontal"
      ? (sourcePoint.x <= snapped.x) === (firstPoint.x <= snapped.x)
      : (sourcePoint.y <= snapped.y) === (firstPoint.y <= snapped.y);
  const sourcePin = sourceFirst ? firstPin : secondPin;
  const targetPin = sourceFirst ? secondPin : firstPin;

  const junction = createCircuitJunction(withNode, snapped, "none");
  const withJunction: SceneDocument = {
    ...withNode,
    nodes: { ...withNode.nodes, [junction.id]: junction },
  };
  const split = splitWireAtJunction(withJunction, edgeId, junction.id);
  if (split === null) return null;
  const original = split.scene.edges[edgeId];
  const continuation = split.scene.edges[split.newEdgeId];
  if (original === undefined || continuation === undefined) return null;
  const nodes = { ...split.scene.nodes };
  delete nodes[junction.id];
  const edges = {
    ...split.scene.edges,
    [original.id]: setEnd(
      original,
      "target",
      nodeAttachment(node.id, { kind: "pin", pinId: sourcePin.id }),
    ),
    [continuation.id]: setEnd(
      continuation,
      "source",
      nodeAttachment(node.id, { kind: "pin", pinId: targetPin.id }),
    ),
  };
  return commit(split.scene, { nodes, edges });
};

/**
 * Shift-drag branch creation. Group 1 junctions stay at the original pin
 * position plus the scroll distance; Group 2 junctions mirror that offset from
 * the moved pin and connect back to Group 1. With distance 0 only Group 1 is
 * needed and the moved pin connects directly to it.
 */
export const createShiftDragBranchesResult = (
  scene: SceneDocument,
  drag: ShiftBranchDrag,
  mergeStraight = false,
): ShiftBranchResult => {
  const allSelected = new Set(
    (drag.selectedNodeIds ?? drag.nodeIds).map((id) => String(id)),
  );
  const internalJunctions = internalJunctionSelection(
    scene,
    drag.selectedNodeIds ?? drag.nodeIds,
  );
  const selected = allSelected;
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  const groups: ShiftBranchGroup[] = [];
  const group2Ids: NodeId[] = [];
  const distance = Math.max(0, drag.distance);

  for (const nodeId of drag.nodeIds) {
    const node = scene.nodes[nodeId];
    if (node === undefined || node.kind !== "circuitComponent") continue;
    const definition = circuitComponent(node.component);
    if (definition === undefined) continue;
    const originalFrame = drag.originalFrames[nodeId] ?? node.frame;
    const originalCenter = rectCenter(originalFrame);
    const finalCenter = rectCenter(node.frame);

    for (const pin of definition.pins) {
      const pinRef: CircuitSourceRef = {
        nodeId: node.id,
        port: { kind: "pin", pinId: pin.id },
      };
      const external = Object.values(scene.edges).flatMap((edge) => {
        const atPin = isPinAttachment(edge.source, node.id, pin.id) ||
          isPinAttachment(edge.target, node.id, pin.id);
        if (!atPin) return [];
        const other = isPinAttachment(edge.source, node.id, pin.id)
          ? edge.target
          : edge.source;
        if (other.target === "node" && selected.has(other.nodeId)) return [];
        return [{
          edge,
          otherPoint: circuitAttachmentPoint(scene, other),
        }];
      });
      if (external.length === 0) continue;

      const local = point(pin.x, pin.y);
      const localNormal = point(pin.nx, pin.ny);
      const originalPoint = componentPinPoint(
        originalCenter,
        local,
        node.rotation,
        scene.canvas.grid.size,
        node.mirrorX === true,
        node.mirrorY === true,
      );
      const finalPoint = componentPinPoint(
        finalCenter,
        local,
        node.rotation,
        scene.canvas.grid.size,
        node.mirrorX === true,
        node.mirrorY === true,
      );
      const normal = rotateLocal(
        mirrorLocalXY(localNormal, node.mirrorX === true, node.mirrorY === true),
        node.rotation,
      );
      const group1Point = add(originalPoint, scale(normal, distance));
      const group1 = {
        ...createCircuitJunction(scene, group1Point, "filled"),
        generatedBranch: true,
      };
      nodes[group1.id] = group1;
      const group1Ref: CircuitSourceRef = {
        nodeId: group1.id,
        port: { kind: "center" },
      };
      const group1Attachment = nodeAttachment(group1.id, { kind: "center" });

      for (const { edge } of external) {
        const end = isPinAttachment(edge.source, node.id, pin.id)
          ? "source"
          : "target";
        edges[edge.id] = setEnd(edge, end, group1Attachment);
      }

      let group2: CircuitJunctionNode | undefined;
      let stubEdge: SceneEdge | undefined;
      let dynamicEdge: SceneEdge | undefined;
      if (distance > 0) {
        const group2Point = add(finalPoint, scale(normal, distance));
        group2 = {
          ...createCircuitJunction(scene, group2Point, "none"),
          generatedBranch: true,
        };
        nodes[group2.id] = group2;
        const group2Ref: CircuitSourceRef = {
          nodeId: group2.id,
          port: { kind: "center" },
        };
        stubEdge = createCircuitWire(scene, pinRef, group2Ref);
        edges[stubEdge.id] = stubEdge;
        dynamicEdge = createCircuitWire(scene, group2Ref, group1Ref);
        edges[dynamicEdge.id] = dynamicEdge;
      } else {
        stubEdge = createCircuitWire(scene, pinRef, group1Ref);
        edges[stubEdge.id] = stubEdge;
      }
      if (group2 !== undefined) group2Ids.push(group2.id);
      groups.push({
        pinNodeId: node.id,
        pinId: pin.id,
        group1Id: group1.id,
        group2Id: group2?.id,
        stubEdgeId: stubEdge.id,
        dynamicEdgeId: dynamicEdge?.id,
        externalEdgeIds: external.map((entry) => entry.edge.id),
      });
    }
  }

  for (const junctionId of drag.junctionIds ?? []) {
    if (internalJunctions.has(String(junctionId))) continue;
    const junction = scene.nodes[junctionId];
    if (junction?.kind !== "circuitJunction") continue;
    const external = Object.values(scene.edges).filter((edge) => {
      if (edge.semantic.family !== "circuit") return false;
      const atJunction =
        edge.source.target === "node" &&
        edge.source.nodeId === junction.id &&
        edge.source.port.kind === "center"
          ? true
          : edge.target.target === "node" &&
            edge.target.nodeId === junction.id &&
            edge.target.port.kind === "center";
      if (!atJunction) return false;
      const other =
        edge.source.target === "node" && edge.source.nodeId === junction.id
          ? edge.target
          : edge.source;
      return other.target !== "node" || !selected.has(String(other.nodeId));
    });
    if (external.length === 0) continue;
    const originalFrame = drag.originalFrames[junction.id] ?? junction.frame;
    const group1 = {
      ...createCircuitJunction(
        scene,
        add(rectCenter(originalFrame), point(distance, 0)),
        "filled",
      ),
      generatedBranch: true,
    };
    nodes[group1.id] = group1;
    const group1Attachment = nodeAttachment(group1.id, { kind: "center" });
    for (const edge of external) {
      const end = edge.source.target === "node" &&
        edge.source.nodeId === junction.id &&
        edge.source.port.kind === "center"
        ? "source"
        : "target";
      edges[edge.id] = setEnd(edge, end, group1Attachment);
    }
    const dynamic = createCircuitWire(
      scene,
      { nodeId: junction.id, port: { kind: "center" } },
      { nodeId: group1.id, port: { kind: "center" } },
    );
    edges[dynamic.id] = dynamic;
    groups.push({
      pinNodeId: junction.id,
      pinId: "",
      group1Id: group1.id,
      stubEdgeId: dynamic.id,
      dynamicEdgeId: dynamic.id,
      externalEdgeIds: external.map((edge) => edge.id),
    });
  }

  const committed = commit(scene, { nodes, edges });
  return {
    scene: mergeStraight ? cleanupShiftBranches(committed, groups) : committed,
    group2Ids,
    groups,
  };
};

export interface DuplicateParallelBranchResult {
  readonly scene: SceneDocument;
  readonly group2Ids: readonly NodeId[];
}

/**
 * Ctrl+Shift drag: keep the originals in place, duplicate the selection, and
 * wire each duplicate pin back to its original pin through a fixed Group 1 and
 * a moving Group 2 junction (a parallel branch).
 */
export const createDuplicateParallelBranches = (
  scene: SceneDocument,
  pairs: readonly { readonly sourceId: NodeId; readonly duplicateId: NodeId }[],
  distance: number,
  selectedNodeIds?: readonly NodeId[],
  junctionPairs?: readonly {
    readonly sourceId: NodeId;
    readonly duplicateId: NodeId;
  }[],
): DuplicateParallelBranchResult => {
  const selected = new Set(
    (selectedNodeIds ?? pairs.map((pair) => pair.sourceId)).map((id) => String(id)),
  );
  const internalJunctions = internalJunctionSelection(
    scene,
    selectedNodeIds ?? pairs.map((pair) => pair.sourceId),
  );
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  const group2Ids: NodeId[] = [];
  const offset = Math.max(0, distance);
  for (const pair of pairs) {
    const source = scene.nodes[pair.sourceId];
    const duplicate = scene.nodes[pair.duplicateId];
    if (source?.kind !== "circuitComponent" || duplicate?.kind !== "circuitComponent") {
      continue;
    }
    const definition = circuitComponent(source.component);
    if (definition === undefined) continue;
    const sourceCenter = rectCenter(source.frame);
    const duplicateCenter = rectCenter(duplicate.frame);
    for (const pin of definition.pins) {
      const external = Object.values(scene.edges).filter((edge) => {
        const atPin = isPinAttachment(edge.source, source.id, pin.id) ||
          isPinAttachment(edge.target, source.id, pin.id);
        if (!atPin) return false;
        const other = isPinAttachment(edge.source, source.id, pin.id)
          ? edge.target
          : edge.source;
        return other.target !== "node" || !selected.has(other.nodeId);
      });
      if (external.length === 0) continue;
      const local = point(pin.x, pin.y);
      const normal = rotateLocal(
        mirrorLocalXY(
          point(pin.nx, pin.ny),
          source.mirrorX === true,
          source.mirrorY === true,
        ),
        source.rotation,
      );
      const sourcePinPoint = componentPinPoint(
        sourceCenter,
        local,
        source.rotation,
        scene.canvas.grid.size,
        source.mirrorX === true,
        source.mirrorY === true,
      );
      const duplicatePinPoint = componentPinPoint(
        duplicateCenter,
        local,
        duplicate.rotation,
        scene.canvas.grid.size,
        duplicate.mirrorX === true,
        duplicate.mirrorY === true,
      );
      const group1 = {
        ...createCircuitJunction(
          scene,
          add(sourcePinPoint, scale(normal, offset)),
          "filled",
        ),
        generatedBranch: true,
      };
      nodes[group1.id] = group1;
      const group1Ref: CircuitSourceRef = {
        nodeId: group1.id,
        port: { kind: "center" },
      };
      const group1Attachment = nodeAttachment(group1.id, { kind: "center" });
      for (const edge of external) {
        const end = isPinAttachment(edge.source, source.id, pin.id)
          ? "source"
          : "target";
        edges[edge.id] = setEnd(edge, end, group1Attachment);
      }
      const sourceStub = createCircuitWire(
        scene,
        { nodeId: source.id, port: { kind: "pin", pinId: pin.id } },
        group1Ref,
      );
      edges[sourceStub.id] = sourceStub;

      const group2 = {
        ...createCircuitJunction(
          scene,
          add(duplicatePinPoint, scale(normal, offset)),
          "none",
        ),
        generatedBranch: true,
      };
      nodes[group2.id] = group2;
      group2Ids.push(group2.id);
      const group2Ref: CircuitSourceRef = {
        nodeId: group2.id,
        port: { kind: "center" },
      };
      const duplicateStub = createCircuitWire(
        scene,
        { nodeId: duplicate.id, port: { kind: "pin", pinId: pin.id } },
        group2Ref,
      );
      edges[duplicateStub.id] = duplicateStub;
      const dynamic = createCircuitWire(scene, group2Ref, group1Ref);
      edges[dynamic.id] = dynamic;
    }
  }
  for (const pair of junctionPairs ?? []) {
    if (internalJunctions.has(String(pair.sourceId))) continue;
    const source = scene.nodes[pair.sourceId];
    const duplicate = scene.nodes[pair.duplicateId];
    if (source?.kind !== "circuitJunction" || duplicate?.kind !== "circuitJunction") {
      continue;
    }
    const external = Object.values(scene.edges).filter((edge) => {
      if (edge.semantic.family !== "circuit") return false;
      const atJunction =
        edge.source.target === "node" &&
        edge.source.nodeId === source.id &&
        edge.source.port.kind === "center"
          ? true
          : edge.target.target === "node" &&
            edge.target.nodeId === source.id &&
            edge.target.port.kind === "center";
      if (!atJunction) return false;
      const other =
        edge.source.target === "node" && edge.source.nodeId === source.id
          ? edge.target
          : edge.source;
      return other.target !== "node" || !selected.has(String(other.nodeId));
    });
    if (external.length === 0) continue;
    const dynamic = createCircuitWire(
      scene,
      { nodeId: duplicate.id, port: { kind: "center" } },
      { nodeId: source.id, port: { kind: "center" } },
    );
    edges[dynamic.id] = dynamic;
  }
  return { scene: { ...scene, nodes, edges }, group2Ids };
};

/**
 * Remove Group 1/Group 2 when the final branch is collinear; called when the
 * drag ends so live branch junctions can still spawn during the gesture.
 */
export const cleanupShiftBranches = (
  scene: SceneDocument,
  groups: readonly ShiftBranchGroup[],
): SceneDocument => {
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  for (const group of groups) {
    const group1 = nodes[group.group1Id];
    const pinNode = nodes[group.pinNodeId];
    if (
      group1?.kind !== "circuitJunction" ||
      pinNode?.kind !== "circuitComponent"
    ) {
      continue;
    }
    const definition = circuitComponent(pinNode.component);
    const pin = definition?.pins.find((candidate) => candidate.id === group.pinId);
    if (pin === undefined) continue;
    const pinPoint = componentPinPoint(
      rectCenter(pinNode.frame),
      point(pin.x, pin.y),
      pinNode.rotation,
      scene.canvas.grid.size,
      pinNode.mirrorX === true,
      pinNode.mirrorY === true,
    );
    let group2 = group.group2Id === undefined ? undefined : nodes[group.group2Id];
    let stubEdge = edges[group.stubEdgeId];
    let dynamicEdge = group.dynamicEdgeId === undefined
      ? undefined
      : edges[group.dynamicEdgeId];
    const group1Point = rectCenter(group1.frame);
    if (
      group2?.kind === "circuitJunction" &&
      stubEdge !== undefined &&
      dynamicEdge !== undefined &&
      areCollinear(pinPoint, rectCenter(group2.frame), group1Point)
    ) {
      delete edges[dynamicEdge.id];
      delete nodes[group2.id];
      stubEdge = setEnd(
        stubEdge,
        "target",
        nodeAttachment(group1.id, { kind: "center" }),
      );
      edges[stubEdge.id] = stubEdge;
      dynamicEdge = undefined;
      group2 = undefined;
    }
    const external = group.externalEdgeIds.flatMap((edgeId) => {
      const edge = edges[edgeId];
      if (edge === undefined) return [];
      const atGroup = edge.source.target === "node" &&
        edge.source.nodeId === group1.id
        ? edge.target
        : edge.target.target === "node" && edge.target.nodeId === group1.id
          ? edge.source
          : undefined;
      if (atGroup === undefined) return [];
      return [{ edge, otherPoint: circuitAttachmentPoint(scene, atGroup) }];
    });
    const onlyExternal = external.length === 1 ? external[0] : undefined;
    if (
      onlyExternal !== undefined &&
      onlyExternal.otherPoint !== null &&
      onlyExternal.edge.routing.mode === "straight" &&
      stubEdge !== undefined &&
      stubEdge.target.target === "node" &&
      stubEdge.target.nodeId === group1.id &&
      areCollinear(pinPoint, group1Point, onlyExternal.otherPoint)
    ) {
      delete edges[stubEdge.id];
      delete nodes[group1.id];
      const end = onlyExternal.edge.source.target === "node" &&
        onlyExternal.edge.source.nodeId === group1.id
        ? "source"
        : "target";
      edges[onlyExternal.edge.id] = setEnd(
        onlyExternal.edge,
        end,
        nodeAttachment(pinNode.id, { kind: "pin", pinId: group.pinId }),
      );
    }
  }
  return commit(scene, { nodes, edges });
};

export const createShiftDragBranches = (
  scene: SceneDocument,
  drag: ShiftBranchDrag,
): SceneDocument =>
  createShiftDragBranchesResult(scene, drag, true).scene;

/**
 * Remove auto-created degree-2 junctions left behind when a branch is no
 * longer a branch: two collinear wires through an unlabelled junction are
 * merged back into one wire.
 */
const collapseRedundantCollinearJunctions = (
  scene: SceneDocument,
): SceneDocument => {
  let current = scene;
  let changed = true;
  while (changed) {
    changed = false;
    const nodes: Record<string, SceneNode> = { ...current.nodes };
    const edges: Record<string, SceneEdge> = { ...current.edges };
    for (const node of Object.values(current.nodes)) {
      if (
        node.kind !== "circuitJunction" ||
        node.generatedBranch === true ||
        node.name.length > 0
      ) {
        continue;
      }
      const incident = Object.values(edges).filter(
        (edge) =>
          edge.semantic.family === "circuit" &&
          ((edge.source.target === "node" &&
            edge.source.nodeId === node.id &&
            edge.source.port.kind === "center") ||
            (edge.target.target === "node" &&
              edge.target.nodeId === node.id &&
              edge.target.port.kind === "center")),
      );
      if (incident.length !== 2) continue;
      const first = incident[0];
      const second = incident[1];
      if (first === undefined || second === undefined) continue;
      if (first.labels.length > 0 || second.labels.length > 0) continue;
      const center = rectCenter(node.frame);
      const otherPoint = (edge: SceneEdge): Point | null => {
        const other =
          edge.source.target === "node" &&
          edge.source.nodeId === node.id &&
          edge.source.port.kind === "center"
            ? edge.target
            : edge.source;
        return circuitAttachmentPoint(current, other);
      };
      const firstPoint = otherPoint(first);
      const secondPoint = otherPoint(second);
      if (firstPoint === null || secondPoint === null) continue;
      const firstVector = sub(firstPoint, center);
      const secondVector = sub(secondPoint, center);
      const firstLength = length(firstVector);
      const secondLength = length(secondVector);
      if (firstLength < 1e-6 || secondLength < 1e-6) continue;
      const cross = Math.abs(
        firstVector.x * secondVector.y - firstVector.y * secondVector.x,
      ) / (firstLength * secondLength);
      const dot =
        firstVector.x * secondVector.x + firstVector.y * secondVector.y;
      if (cross > 0.02 || dot >= 0) continue;

      const drop = second;
      const kept = first;
      const otherAttachment =
        drop.source.target === "node" &&
        drop.source.nodeId === node.id &&
        drop.source.port.kind === "center"
          ? drop.target
          : drop.source;
      let next = kept;
      if (
        next.source.target === "node" &&
        next.source.nodeId === node.id &&
        next.source.port.kind === "center"
      ) {
        next = setEnd(next, "source", otherAttachment);
      } else {
        next = setEnd(next, "target", otherAttachment);
      }
      edges[next.id] = next;
      delete edges[drop.id];
      delete nodes[node.id];
      current = { ...current, nodes, edges };
      changed = true;
      break;
    }
  }
  return current;
};

/**
 * After a move, merge junctions that landed on the same point and connect
 * component pins that landed on a junction or another pin with zero-length
 * straight wires.
 */
export const mergeCoincidentCircuitConnections = (
  scene: SceneDocument,
): SceneDocument => {
  const grid = Math.max(1, scene.canvas.grid.size);
  const tolerance = Math.max(0.5, grid * 0.5 - 1e-6);
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const edges: Record<string, SceneEdge> = { ...scene.edges };

  const junctionIds = () => Object.keys(nodes).filter(
    (id) =>
      nodes[id]?.kind === "circuitJunction" &&
      (nodes[id] as CircuitJunctionNode).generatedBranch !== true,
  );
  const ids = junctionIds();
  for (let index = 0; index < ids.length; index += 1) {
    const keeperId = asNodeId(ids[index] ?? "");
    const keeper = nodes[keeperId];
    if (keeper?.kind !== "circuitJunction") continue;
    const keeperCenter = rectCenter(keeper.frame);
    for (let otherIndex = index + 1; otherIndex < ids.length; otherIndex += 1) {
      const otherId = asNodeId(ids[otherIndex] ?? "");
      const other = nodes[otherId];
      if (other?.kind !== "circuitJunction") continue;
      if (length(sub(rectCenter(other.frame), keeperCenter)) > tolerance) continue;
      for (const edge of Object.values(edges)) {
        let next = edge;
        if (
          next.source.target === "node" &&
          next.source.nodeId === other.id &&
          next.source.port.kind === "center"
        ) {
          next = setEnd(
            next,
            "source",
            nodeAttachment(keeper.id, { kind: "center" }),
          );
        }
        if (
          next.target.target === "node" &&
          next.target.nodeId === other.id &&
          next.target.port.kind === "center"
        ) {
          next = setEnd(
            next,
            "target",
            nodeAttachment(keeper.id, { kind: "center" }),
          );
        }
        edges[next.id] = next;
      }
      if (keeper.name.length === 0 && other.name.length > 0) {
        nodes[keeper.id] = { ...keeper, name: other.name };
      }
      delete nodes[other.id];
    }
  }

  const pinPoints: {
    readonly nodeId: NodeId;
    readonly pinId: string;
    readonly point: Point;
  }[] = [];
  for (const node of Object.values(nodes)) {
    if (node.kind !== "circuitComponent") continue;
    const definition = circuitComponent(node.component);
    if (definition === undefined) continue;
    const center = rectCenter(node.frame);
    for (const pin of definition.pins) {
      pinPoints.push({
        nodeId: node.id,
        pinId: pin.id,
        point: componentPinPoint(
          center,
          point(pin.x, pin.y),
          node.rotation,
          scene.canvas.grid.size,
          node.mirrorX === true,
          node.mirrorY === true,
        ),
      });
    }
  }
  const junctions = Object.values(nodes).filter(
    (node): node is CircuitJunctionNode =>
      node.kind === "circuitJunction" && node.generatedBranch !== true,
  );
  const addZeroWire = (
    source: CircuitSourceRef,
    target: CircuitSourceRef,
  ): void => {
    const matches = (
      attachment: EdgeAttachment,
      reference: CircuitSourceRef,
    ): boolean =>
      reference.port.kind === "pin"
        ? isPinAttachment(
            attachment,
            reference.nodeId,
            reference.port.pinId,
          )
        : attachment.target === "node" &&
          attachment.nodeId === reference.nodeId &&
          attachment.port.kind === "center";
    const exists = Object.values(edges).some(
      (edge) =>
        (matches(edge.source, source) && matches(edge.target, target)) ||
        (matches(edge.target, source) && matches(edge.source, target)),
    );
    if (exists) return;
    const wire = createCircuitWire(scene, source, target);
    edges[wire.id] = wire;
  };

  for (const pin of pinPoints) {
    const source: CircuitSourceRef = {
      nodeId: pin.nodeId,
      port: { kind: "pin", pinId: pin.pinId },
    };
    for (const junction of junctions) {
      if (length(sub(rectCenter(junction.frame), pin.point)) <= tolerance) {
        addZeroWire(source, { nodeId: junction.id, port: { kind: "center" } });
      }
    }
  }
  for (let index = 0; index < pinPoints.length; index += 1) {
    const first = pinPoints[index];
    if (first === undefined) continue;
    for (let otherIndex = index + 1; otherIndex < pinPoints.length; otherIndex += 1) {
      const second = pinPoints[otherIndex];
      if (second === undefined) continue;
      if (
        first.nodeId === second.nodeId &&
        first.pinId === second.pinId
      ) {
        continue;
      }
      if (length(sub(second.point, first.point)) <= tolerance) {
        addZeroWire(
          { nodeId: first.nodeId, port: { kind: "pin", pinId: first.pinId } },
          { nodeId: second.nodeId, port: { kind: "pin", pinId: second.pinId } },
        );
      }
    }
  }
  return collapseRedundantCollinearJunctions({ ...scene, nodes, edges });
};

/**
 * Alt-drag detach: leave invisible junctions at the original external pin
 * positions, retarget existing wires to them, and short the two junctions of a
 * two-terminal component. Components with more than two endings get junctions
 * but no short.
 */
export const detachCircuitComponentEndings = (
  scene: SceneDocument,
  nodeIds: readonly NodeId[],
): SceneDocument => {
  const selected = new Set(nodeIds);
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  let changed = false;
  for (const nodeId of nodeIds) {
    const node = scene.nodes[nodeId];
    if (node === undefined || node.kind !== "circuitComponent") continue;
    const definition = circuitComponent(node.component);
    if (definition === undefined) continue;
    const center = rectCenter(node.frame);
    const junctions: CircuitJunctionNode[] = [];
    for (const pin of definition.pins) {
      const external = Object.values(scene.edges).filter((edge) => {
        const atPin = isPinAttachment(edge.source, node.id, pin.id) ||
          isPinAttachment(edge.target, node.id, pin.id);
        if (!atPin) return false;
        const other = isPinAttachment(edge.source, node.id, pin.id)
          ? edge.target
          : edge.source;
        return other.target !== "node" || !selected.has(other.nodeId);
      });
      if (external.length === 0) continue;
      changed = true;
      const pinPoint = componentPinPoint(
        center,
        point(pin.x, pin.y),
        node.rotation,
        scene.canvas.grid.size,
        node.mirrorX === true,
        node.mirrorY === true,
      );
      const existing = nearestCircuitJunction(scene, pinPoint, Math.max(1, scene.canvas.grid.size / 2));
      const junction = existing ?? createCircuitJunction(scene, pinPoint, "none");
      if (existing === undefined) nodes[junction.id] = junction;
      junctions.push(junction);
      const attachment = nodeAttachment(junction.id, { kind: "center" });
      for (const edge of external) {
        const end = isPinAttachment(edge.source, node.id, pin.id)
          ? "source"
          : "target";
        edges[edge.id] = setEnd(edge, end, attachment);
      }
    }
    if (definition.pins.length === 2 && junctions.length === 2) {
      const first = junctions[0];
      const second = junctions[1];
      if (first !== undefined && second !== undefined) {
        const short = createCircuitWire(
          scene,
          { nodeId: first.id, port: { kind: "center" } },
          { nodeId: second.id, port: { kind: "center" } },
        );
        edges[short.id] = short;
      }
    }
  }
  return changed ? { ...scene, nodes, edges } : scene;
};

/** At most one circuit wire may connect the same pair of nodes. */
export const normalizeCircuitDuplicateConnections = (
  scene: SceneDocument,
): SceneDocument => {
  const groups = new Map<string, SceneEdge[]>();
  for (const edge of Object.values(scene.edges)) {
    if (
      edge.semantic.family !== "circuit" ||
      edge.source.target !== "node" ||
      edge.target.target !== "node"
    ) {
      continue;
    }
    const sourceKey = portKey(edge.source.nodeId, edge.source.port);
    const targetKey = portKey(edge.target.nodeId, edge.target.port);
    const pair = [sourceKey, targetKey].sort().join("|");
    const group = groups.get(pair);
    if (group === undefined) groups.set(pair, [edge]);
    else group.push(edge);
  }
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  let changed = false;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const keeper = [...group].sort(
      (a, b) => b.labels.length - a.labels.length || Number(b.visible) - Number(a.visible),
    )[0];
    if (keeper === undefined) continue;
    for (const edge of group) {
      if (edge.id === keeper.id) continue;
      delete edges[edge.id];
      changed = true;
    }
  }
  return changed ? { ...scene, edges } : scene;
};

/** Swap pin attachments with their geometric mirror counterparts. */
export const rewireCircuitComponentPins = (
  scene: SceneDocument,
  nodeId: NodeId,
  axis: "horizontal" | "vertical",
): SceneDocument => {
  const node = scene.nodes[nodeId];
  if (node?.kind !== "circuitComponent") return scene;
  const definition = circuitComponent(node.component);
  if (definition === undefined) return scene;
  const mapping = new Map<string, string>();
  for (const pin of definition.pins) {
    const mirrored = mirrorLocal(point(pin.x, pin.y), axis);
    const counterpart = definition.pins.find(
      (candidate) =>
        Math.abs(candidate.x - mirrored.x) < 1e-6 &&
        Math.abs(candidate.y - mirrored.y) < 1e-6,
    );
    if (counterpart !== undefined && counterpart.id !== pin.id) {
      mapping.set(pin.id, counterpart.id);
    }
  }
  if (mapping.size === 0) return scene;
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  let changed = false;
  for (const edge of Object.values(scene.edges)) {
    let next = edge;
    if (
      next.source.target === "node" &&
      next.source.nodeId === nodeId &&
      next.source.port.kind === "pin"
    ) {
      const pinId = mapping.get(next.source.port.pinId);
      if (pinId !== undefined) {
        next = { ...next, source: { ...next.source, port: { kind: "pin", pinId } } };
      }
    }
    if (
      next.target.target === "node" &&
      next.target.nodeId === nodeId &&
      next.target.port.kind === "pin"
    ) {
      const pinId = mapping.get(next.target.port.pinId);
      if (pinId !== undefined) {
        next = { ...next, target: { ...next.target, port: { kind: "pin", pinId } } };
      }
    }
    if (next !== edge) {
      edges[next.id] = next;
      changed = true;
    }
  }
  return changed ? { ...scene, edges } : scene;
};

/** Merge junctions that are only a few pixels apart and snap them to the grid. */
export const mergeNearbyCircuitJunctions = (
  scene: SceneDocument,
): SceneDocument => {
  const grid = Math.max(1, scene.canvas.grid.size);
  const tolerance = grid * 0.5 - 1e-6;
  const junctionIds = Object.keys(scene.nodes).filter(
    (id) => {
      const node = scene.nodes[id];
      return node?.kind === "circuitJunction" && node.generatedBranch !== true;
    },
  );
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  const edges: Record<string, SceneEdge> = { ...scene.edges };
  const merged = new Set<string>();
  let changed = false;
  for (let index = 0; index < junctionIds.length; index += 1) {
    const keeperId = asNodeId(junctionIds[index] ?? "");
    const keeper = nodes[keeperId];
    if (keeper?.kind !== "circuitJunction" || merged.has(keeperId)) continue;
    const keeperCenter = rectCenter(keeper.frame);
    const cluster = junctionIds
      .map((id) => asNodeId(id))
      .filter((id) => id !== keeperId)
      .filter((id) => {
        const candidate = nodes[id];
        return candidate?.kind === "circuitJunction" &&
          !merged.has(id) &&
          length(sub(rectCenter(candidate.frame), keeperCenter)) <= tolerance;
      });
    if (cluster.length === 0) continue;
    const centers = [keeperCenter, ...cluster.map((id) => {
      const candidate = nodes[id];
      return candidate?.kind === "circuitJunction"
        ? rectCenter(candidate.frame)
        : keeperCenter;
    })];
    const target = {
      x: snap(
        centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
        grid,
      ),
      y: snap(
        centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
        grid,
      ),
    };
    nodes[keeperId] = {
      ...keeper,
      frame: {
        ...keeper.frame,
        x: target.x - keeper.frame.width / 2,
        y: target.y - keeper.frame.height / 2,
      },
    };
    for (const otherId of cluster) {
      const other = nodes[otherId];
      if (other?.kind !== "circuitJunction") continue;
      for (const edge of Object.values(edges)) {
        let next = edge;
        if (
          next.source.target === "node" &&
          next.source.nodeId === otherId &&
          next.source.port.kind === "center"
        ) {
          next = setEnd(next, "source", nodeAttachment(keeperId, { kind: "center" }));
        }
        if (
          next.target.target === "node" &&
          next.target.nodeId === otherId &&
          next.target.port.kind === "center"
        ) {
          next = setEnd(next, "target", nodeAttachment(keeperId, { kind: "center" }));
        }
        edges[next.id] = next;
      }
      merged.add(otherId);
      delete nodes[otherId];
    }
    changed = true;
  }
  return changed ? { ...scene, nodes, edges } : scene;
};

/** Hide translated junctions that still have only two incident wires. */
export const hideDegreeTwoJunctions = (
  scene: SceneDocument,
  nodeIds: readonly NodeId[],
): SceneDocument => {
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  let changed = false;
  for (const nodeId of nodeIds) {
    const node = scene.nodes[nodeId];
    if (node?.kind !== "circuitJunction" || node.junctionStyle === "none") continue;
    const connections = Object.values(scene.edges).filter(
      (edge) =>
        edge.semantic.family === "circuit" &&
        ((edge.source.target === "node" &&
          edge.source.nodeId === node.id &&
          edge.source.port.kind === "center") ||
          (edge.target.target === "node" &&
            edge.target.nodeId === node.id &&
            edge.target.port.kind === "center")),
    ).length;
    if (connections === 2) {
      nodes[node.id] = { ...node, junctionStyle: "none" };
      changed = true;
    }
  }
  return changed ? { ...scene, nodes } : scene;
};

/** A None-style junction becomes visible once it is a real three-way branch. */
export const normalizeCircuitJunctionStyles = (
  scene: SceneDocument,
): SceneDocument => {
  const nodes: Record<string, SceneNode> = { ...scene.nodes };
  let changed = false;
  for (const node of Object.values(scene.nodes)) {
    if (
      node.kind !== "circuitJunction" ||
      node.junctionStyle !== "none" ||
      node.generatedBranch === true
    ) {
      continue;
    }
    const connections = Object.values(scene.edges).filter(
      (edge) =>
        edge.semantic.family === "circuit" &&
        ((edge.source.target === "node" &&
          edge.source.nodeId === node.id &&
          edge.source.port.kind === "center") ||
          (edge.target.target === "node" &&
            edge.target.nodeId === node.id &&
            edge.target.port.kind === "center")),
    ).length;
    if (connections >= 3) {
      nodes[node.id] = { ...node, junctionStyle: "filled" };
      changed = true;
    }
  }
  return changed ? { ...scene, nodes } : scene;
};

/** Enforce one direct wire per component pin, sharing one junction per point. */
export const normalizeCircuitPinConnections = (
  scene: SceneDocument,
): SceneDocument => {
  let current = scene;
  const tolerance = Math.max(0.5, scene.canvas.grid.size * 0.5 - 1e-6);

  // First merge junction nodes that occupy the same point; multiple pins
  // landing together must share one junction, not one junction per pin.
  const junctionIds = Object.keys(current.nodes).filter(
    (id) => {
      const node = current.nodes[id];
      return node?.kind === "circuitJunction" && node.generatedBranch !== true;
    },
  );
  for (let index = 0; index < junctionIds.length; index += 1) {
    const keeperId = asNodeId(junctionIds[index] ?? "");
    const keeper = current.nodes[keeperId];
    if (keeper?.kind !== "circuitJunction") continue;
    const keeperCenter = rectCenter(keeper.frame);
    for (let otherIndex = index + 1; otherIndex < junctionIds.length; otherIndex += 1) {
      const otherId = asNodeId(junctionIds[otherIndex] ?? "");
      const other = current.nodes[otherId];
      if (other?.kind !== "circuitJunction") continue;
      if (length(sub(rectCenter(other.frame), keeperCenter)) > tolerance) continue;
      const nodes = { ...current.nodes };
      const edges = { ...current.edges };
      for (const edge of Object.values(current.edges)) {
        let next = edge;
        if (
          next.source.target === "node" &&
          next.source.nodeId === other.id &&
          next.source.port.kind === "center"
        ) {
          next = setEnd(next, "source", nodeAttachment(keeper.id, { kind: "center" }));
        }
        if (
          next.target.target === "node" &&
          next.target.nodeId === other.id &&
          next.target.port.kind === "center"
        ) {
          next = setEnd(next, "target", nodeAttachment(keeper.id, { kind: "center" }));
        }
        edges[next.id] = next;
      }
      delete nodes[other.id];
      current = { ...current, nodes, edges };
    }
  }

  type PinEntry = {
    readonly nodeId: NodeId;
    readonly pinId: string;
    readonly point: Point;
  };
  const pins: PinEntry[] = [];
  for (const node of Object.values(current.nodes)) {
    if (node.kind !== "circuitComponent") continue;
    const definition = circuitComponent(node.component);
    if (definition === undefined) continue;
    const center = rectCenter(node.frame);
    for (const pin of definition.pins) {
      pins.push({
        nodeId: node.id,
        pinId: pin.id,
        point: componentPinPoint(
          center,
          point(pin.x, pin.y),
          node.rotation,
          current.canvas.grid.size,
          node.mirrorX === true,
          node.mirrorY === true,
        ),
      });
    }
  }
  const groups: PinEntry[][] = [];
  for (const pin of pins) {
    const group = groups.find(
      (candidate) =>
        length(sub(candidate[0]?.point ?? pin.point, pin.point)) <= tolerance,
    );
    if (group === undefined) groups.push([pin]);
    else group.push(pin);
  }

  const directEdges = (pin: PinEntry): SceneEdge[] =>
    Object.values(current.edges).filter(
      (edge) =>
        edge.semantic.family === "circuit" &&
        (isPinAttachment(edge.source, pin.nodeId, pin.pinId) ||
          isPinAttachment(edge.target, pin.nodeId, pin.pinId)),
    );

  for (const group of groups) {
    const first = group[0];
    if (first === undefined) continue;
    const needsJunction =
      group.length > 1 || group.some((pin) => directEdges(pin).length > 1);
    if (!needsJunction) continue;
    const existing = nearestCircuitJunction(current, first.point, tolerance);
    const baseJunction = existing ?? createCircuitJunction(current, first.point, "filled");
    const junction: CircuitJunctionNode = { ...baseJunction, junctionStyle: "filled" };
    const nodes: Record<string, SceneNode> = {
      ...current.nodes,
      [junction.id]: junction,
    };
    const edges: Record<string, SceneEdge> = { ...current.edges };
    const groupPins = new Set(group.map((pin) => `${pin.nodeId}:${pin.pinId}`));
    const attached = Object.values(current.edges).filter((edge) =>
      edge.semantic.family === "circuit" &&
      group.some(
        (pin) =>
          isPinAttachment(edge.source, pin.nodeId, pin.pinId) ||
          isPinAttachment(edge.target, pin.nodeId, pin.pinId),
      ),
    );
    for (const edge of attached) {
      let next = edge;
      for (const pin of group) {
        if (isPinAttachment(next.source, pin.nodeId, pin.pinId)) {
          next = setEnd(next, "source", nodeAttachment(junction.id, { kind: "center" }));
        }
        if (isPinAttachment(next.target, pin.nodeId, pin.pinId)) {
          next = setEnd(next, "target", nodeAttachment(junction.id, { kind: "center" }));
        }
      }
      edges[next.id] = next;
    }
    for (const pin of group) {
      if (!groupPins.has(`${pin.nodeId}:${pin.pinId}`)) continue;
      const hasStub = Object.values(edges).some((edge) =>
        connectsPinToJunction(edge, pin.nodeId, pin.pinId, junction.id),
      );
      if (!hasStub) {
        const stub = createCircuitWire(
          { ...current, nodes },
          { nodeId: pin.nodeId, port: { kind: "pin", pinId: pin.pinId } },
          { nodeId: junction.id, port: { kind: "center" } },
        );
        edges[stub.id] = stub;
      }
    }
    current = { ...current, nodes, edges };
  }

  // A pin may only retain one direct wire even if several parallel/zero edges
  // were previously attached to it.
  const dedupedEdges: Record<string, SceneEdge> = { ...current.edges };
  for (const pin of pins) {
    const direct = Object.values(current.edges).filter(
      (edge) =>
        edge.semantic.family === "circuit" &&
        (isPinAttachment(edge.source, pin.nodeId, pin.pinId) ||
          isPinAttachment(edge.target, pin.nodeId, pin.pinId)),
    );
    for (const extra of direct.slice(1)) delete dedupedEdges[extra.id];
  }
  current = { ...current, edges: dedupedEdges };

  // Drop zero-length loops created by rewiring several coincident pins to the
  // same middleman.
  const cleanedEdges: Record<string, SceneEdge> = { ...current.edges };
  for (const edge of Object.values(current.edges)) {
    if (edge.semantic.family !== "circuit") continue;
    if (
      edge.source.target === "node" &&
      edge.target.target === "node" &&
      edge.source.port.kind === "center" &&
      edge.target.port.kind === "center"
    ) {
      const sourceNode = current.nodes[edge.source.nodeId];
      const targetNode = current.nodes[edge.target.nodeId];
      if (
        edge.source.nodeId === edge.target.nodeId ||
        (sourceNode?.kind === "circuitJunction" &&
          targetNode?.kind === "circuitJunction" &&
          sourceNode.generatedBranch !== true &&
          targetNode.generatedBranch !== true &&
          length(sub(rectCenter(sourceNode.frame), rectCenter(targetNode.frame))) <= tolerance)
      ) {
        delete cleanedEdges[edge.id];
      }
    }
  }
  return { ...current, edges: cleanedEdges };
};

/** Snap routed bends to the scene grid while keeping every segment orthogonal. */export const gridAlignedOrthogonalRoute = (
  points: readonly Point[],
  grid: number,
): readonly Point[] => {
  if (points.length < 2) return points;
  const step = Math.max(1, grid);
  const snapped = points.map((entry, index) =>
    index === 0 || index === points.length - 1
      ? entry
      : { x: snap(entry.x, step), y: snap(entry.y, step) });
  const result: Point[] = [];
  for (const next of snapped) {
    const previous = result[result.length - 1];
    if (previous === undefined) {
      result.push(next);
      continue;
    }
    if (next.x !== previous.x && next.y !== previous.y) {
      const corner = { x: next.x, y: previous.y };
      if (corner.x !== previous.x || corner.y !== previous.y) result.push(corner);
    }
    if (next.x !== previous.x || next.y !== previous.y) result.push(next);
  }
  const simplified: Point[] = [];
  for (const entry of result) {
    const last = simplified[simplified.length - 1];
    if (last !== undefined && last.x === entry.x && last.y === entry.y) continue;
    if (simplified.length >= 2) {
      const before = simplified[simplified.length - 2];
      if (
        before !== undefined &&
        (last!.x - before.x) * (entry.y - last!.y) ===
          (last!.y - before.y) * (entry.x - last!.x)
      ) {
        simplified.pop();
      }
    }
    simplified.push(entry);
  }
  return simplified;
};

/** Exposed for tests and future wire merging. */
export const circuitJunctionCenter = (node: CircuitJunctionNode): Point => rectCenter(node.frame);
