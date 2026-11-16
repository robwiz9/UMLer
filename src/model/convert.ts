/**
 * Cross-diagram object conversion.
 *
 * Conversions are intentionally lossy: structure that has no meaning in the
 * target notation is dropped, while names, section titles and row names/types
 * are kept where possible. Converting again from the pasted object works, so
 * class → object → class or ER → class → lifeline chains are supported.
 */

import type { DiagramKind, SceneDocument } from "./scene.ts";
import type {
  LifelineNode,
  ObjectNode,
  SceneNode,
  TableNode,
  TableRow,
  TableSection,
} from "./nodes.ts";
import type { SceneClipboard } from "./clipboard.ts";
import type { NodePortRef, SceneEdge } from "./edges.ts";
import type { CompassSide, Point } from "./geometry.ts";
import { rectCenter, unionRects } from "./geometry.ts";
import { asLabelId, asNodeId, asRowId, asSectionId, newId, type NodeId } from "./ids.ts";
import { createEdgeForDiagram } from "./edge-create.ts";
import { placeObjectFrame } from "./object-catalog.ts";

const cleanName = (name: string): string => name.replace(/^:\s*/, "").trim();
const instanceName = (name: string): string => `:${cleanName(name) || "Object"}`;

const commonNode = (node: SceneNode, target: SceneDocument): SceneNode | null => {
  if (node.kind !== "image" && node.kind !== "comment") return null;
  const center = {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
  const frame = placeObjectFrame(target, center, node.frame.width, node.frame.height);
  return {
    ...node,
    id: asNodeId(newId(node.kind)),
    frame,
    style: target.theme.shape,
  };
};

const rowForClass = (row: TableRow): TableRow => ({
  ...row,
  id: asRowId(newId("row")),
  constraints: undefined,
});

const rowForEr = (row: TableRow): TableRow => ({
  ...row,
  id: asRowId(newId("row")),
  kind: "attribute",
  type: row.returnType ?? row.type,
  returnType: undefined,
  visibility: undefined,
  prefix: undefined,
  parameters: undefined,
});

const tableSections = (node: SceneNode): readonly TableSection[] => {
  if (node.kind === "table") return node.sections;
  if (node.kind === "relationAttribute") {
    return [{
      id: asSectionId(newId("section")),
      role: "attributes",
      rows: node.rows,
    }];
  }
  return [];
};

const tableNode = (
  node: SceneNode,
  targetDiagram: "er" | "uml-class",
  targetScene: SceneDocument,
): TableNode | null => {
  if (node.kind !== "table" && node.kind !== "relationAttribute" &&
      node.kind !== "object" && node.kind !== "lifeline") {
    return null;
  }
  const center = {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
  const sourceIsTable = node.kind === "table" || node.kind === "relationAttribute";
  const width = sourceIsTable ? Math.max(198, node.frame.width) : 225;
  const height = sourceIsTable
    ? Math.max(45, node.frame.height)
    : targetDiagram === "uml-class" ? 108 : 90;
  const frame = placeObjectFrame(targetScene, center, width, height);
  const targetClass = targetDiagram === "uml-class";
  const sections = tableSections(node).map((section) => ({
    ...section,
    id: asSectionId(newId("section")),
    rows: section.rows.map(targetClass ? rowForClass : rowForEr),
  }));
  const nameSource = node.kind === "object"
    ? node.name
    : node.kind === "lifeline"
      ? node.head.label ?? node.name
      : node.name;
  const name = cleanName(nameSource) || (targetClass ? "NewClass" : "new_entity");
  return {
    id: asNodeId(newId(targetClass ? "class" : "entity")),
    kind: "table",
    tableKind: targetClass
      ? "class"
      : node.kind === "table" && node.tableKind === "associative"
        ? "associative"
        : "entity",
    name,
    frame,
    z: 2,
    locked: node.locked,
    visible: node.visible,
    header: {},
    sections,
    style: targetScene.theme.table,
    textStyle: node.textStyle,
    metadata: node.metadata,
  };
};

const objectNode = (node: SceneNode, target: SceneDocument): ObjectNode | null => {
  if (node.kind !== "table" && node.kind !== "relationAttribute" &&
      node.kind !== "object" && node.kind !== "lifeline") {
    return null;
  }
  const label = node.kind === "object"
    ? node.name
    : node.kind === "lifeline"
      ? node.head.label ?? node.name
      : node.name;
  const center = {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
  const frame = placeObjectFrame(target, center, 180, 45);
  return {
    id: asNodeId(newId("object")),
    kind: "object",
    name: instanceName(label),
    frame,
    z: 2,
    locked: node.locked,
    visible: node.visible,
    underlineName: true,
    stereotype: node.kind === "object" ? node.stereotype : undefined,
    classifier: node.kind === "object" ? node.classifier : undefined,
    style: target.theme.shape,
    textStyle: node.textStyle,
    metadata: node.metadata,
  };
};

const lifelineNode = (node: SceneNode, target: SceneDocument): LifelineNode | null => {
  if (node.kind !== "table" && node.kind !== "relationAttribute" &&
      node.kind !== "object" && node.kind !== "lifeline") {
    return null;
  }
  const label = node.kind === "object"
    ? node.name
    : node.kind === "lifeline"
      ? node.head.label ?? node.name
      : node.name;
  const name = cleanName(label) || "Object";
  const lanes = Object.values(target.nodes).filter((candidate) => candidate.kind === "lifeline");
  const center = lanes.length === 0
    ? {
        x: node.frame.x + node.frame.width / 2,
        y: node.frame.y + node.frame.height / 2,
      }
    : {
        x: Math.max(...lanes.map((lane) => lane.frame.x + lane.frame.width)) + 27 + 54,
        y: Math.min(...lanes.map((lane) => lane.frame.y)) + 315,
      };
  const frame = placeObjectFrame(target, center, 108, 630);
  return {
    id: asNodeId(newId("lifeline")),
    kind: "lifeline",
    name,
    frame,
    z: 2,
    locked: node.locked,
    visible: node.visible,
    head: {
      headKind: "object",
      label: instanceName(label),
      stereotype: node.kind === "object" ? node.stereotype : undefined,
    },
    headHeight: 36,
    activationBars: [],
    style: target.theme.shape,
    textStyle: node.textStyle,
    metadata: node.metadata,
  };
};

export const convertNodeForDiagram = (
  node: SceneNode,
  targetDiagram: DiagramKind,
  target: SceneDocument,
): SceneNode | null => {
  const common = commonNode(node, target);
  if (common !== null) return common;

  switch (targetDiagram) {
    case "er":
      return tableNode(node, "er", target);
    case "uml-class":
      return tableNode(node, "uml-class", target);
    case "uml-object":
    case "uml-communication":
      return objectNode(node, target);
    case "uml-sequence":
      return lifelineNode(node, target);
    case "uml-use-case":
    case "uml-state-machine":
      return null;
    case "circuit":
      return null;
  }
};

export interface ConvertedClipboard {
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly sourceToTarget: ReadonlyMap<string, NodeId>;
  readonly skippedNodes: number;
  readonly skippedEdges: number;
}

const centerOf = (node: SceneNode): Point => ({
  x: node.frame.x + node.frame.width / 2,
  y: node.frame.y + node.frame.height / 2,
});

const sideToward = (from: SceneNode, to: SceneNode): CompassSide => {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
};

const sideForAngle = (angle: number): CompassSide => {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized < 45 || normalized >= 315) return "east";
  if (normalized < 135) return "south";
  if (normalized < 225) return "west";
  return "north";
};

/**
 * Converts a source port to a port the converted node can resolve. Row ports
 * become perimeter ports; a lifeline receives a spine port so sequence messages
 * still land on the lifeline body rather than its head.
 */
const portForConversion = (
  port: NodePortRef,
  source: SceneNode,
  target: SceneNode,
  other: SceneNode,
): NodePortRef => {
  if (target.kind === "lifeline") {
    return port.kind === "spine" ? port : { kind: "spine", t: 0.5 };
  }
  if (port.kind === "spine") {
    return { kind: "perimeter", side: sideToward(source, other) };
  }
  if (port.kind === "row") {
    return { kind: "perimeter", side: port.side };
  }
  if (port.kind === "perimeter") return port;
  if (port.kind === "pin" || port.kind === "center") {
    return { kind: "perimeter", side: sideToward(source, other) };
  }
  return { kind: "perimeter", side: sideForAngle(port.angle) };
};

/**
 * Converts every source object that has an equivalent in the target notation,
 * then rebuilds each connector whose two converted endpoints survive. The
 * result is a self-contained subgraph for `insertSubgraph`; unconvertible
 * objects and their dangling connectors are counted and skipped.
 */
export const convertClipboardForDiagram = (
  clipboard: SceneClipboard,
  target: SceneDocument,
  center?: Point,
): ConvertedClipboard => {
  const converted: SceneNode[] = [];
  const sourceToTarget = new Map<string, NodeId>();

  for (const source of clipboard.nodes) {
    const node = convertNodeForDiagram(source, target.meta.diagramKind, target);
    if (node === null) continue;
    converted.push(node);
    sourceToTarget.set(source.id, node.id);
  }

  let nodes = converted;
  if (center !== undefined && nodes.length > 0) {
    const bounds = unionRects(nodes.map((node) => node.frame));
    if (bounds !== null) {
      const current = rectCenter(bounds);
      const delta = { x: center.x - current.x, y: center.y - current.y };
      nodes = nodes.map((node) => ({
        ...node,
        frame: {
          ...node.frame,
          x: node.frame.x + delta.x,
          y: node.frame.y + delta.y,
        },
      }));
    }
  }

  const nodeById = new Map<string, SceneNode>();
  for (const node of nodes) nodeById.set(node.id, node);
  const working: SceneDocument = {
    ...target,
    nodes: {
      ...target.nodes,
      ...Object.fromEntries(nodes.map((node) => [node.id, node])),
    },
  };

  const edges: SceneEdge[] = [];
  const createdBySource = new Map<string, SceneEdge>();
  let skippedEdges = 0;
  const withSourceProperties = (created: SceneEdge, sourceEdge: SceneEdge): SceneEdge => ({
    ...created,
    labels: sourceEdge.labels.map((label) => ({
      ...label,
      id: asLabelId(newId("label")),
    })),
    locked: sourceEdge.locked,
    visible: sourceEdge.visible,
    z: sourceEdge.z,
  });
  const deferredTethers = new Set<string>();

  // First pass: node-to-node connectors. Tethers whose target is another edge
  // wait until their parent edge has an ID in the target document.
  for (const sourceEdge of clipboard.edges) {
    if (sourceEdge.source.target === "node" && sourceEdge.target.target === "edge") {
      deferredTethers.add(sourceEdge.id);
      continue;
    }
    if (sourceEdge.source.target !== "node" || sourceEdge.target.target !== "node") {
      skippedEdges += 1;
      continue;
    }
    const convertedSourceId = sourceToTarget.get(sourceEdge.source.nodeId);
    const convertedTargetId = sourceToTarget.get(sourceEdge.target.nodeId);
    if (convertedSourceId === undefined || convertedTargetId === undefined) {
      skippedEdges += 1;
      continue;
    }
    const convertedSource = nodeById.get(convertedSourceId);
    const convertedTarget = nodeById.get(convertedTargetId);
    if (convertedSource === undefined || convertedTarget === undefined) {
      skippedEdges += 1;
      continue;
    }
    const sourcePort = portForConversion(
      sourceEdge.source.port,
      convertedSource,
      convertedSource,
      convertedTarget,
    );
    const targetPort = portForConversion(
      sourceEdge.target.port,
      convertedTarget,
      convertedTarget,
      convertedSource,
    );
    const created = createEdgeForDiagram(
      working,
      { nodeId: convertedSourceId, port: sourcePort },
      { nodeId: convertedTargetId, port: targetPort },
    );
    if (created === null) {
      skippedEdges += 1;
      continue;
    }
    const edge = withSourceProperties(created, sourceEdge);
    edges.push(edge);
    createdBySource.set(sourceEdge.id, edge);
  }

  if (deferredTethers.size > 0) {
    const edgeWorking: SceneDocument = {
      ...working,
      edges: {
        ...target.edges,
        ...Object.fromEntries(edges.map((edge) => [edge.id, edge])),
      },
    };
    for (const sourceEdge of clipboard.edges) {
      if (!deferredTethers.has(sourceEdge.id)) continue;
      if (sourceEdge.source.target !== "node" || sourceEdge.target.target !== "edge") {
        skippedEdges += 1;
        continue;
      }
      const convertedSourceId = sourceToTarget.get(sourceEdge.source.nodeId);
      const convertedSource = convertedSourceId === undefined
        ? undefined
        : nodeById.get(convertedSourceId);
      const parent = createdBySource.get(sourceEdge.target.edgeId);
      if (convertedSourceId === undefined || convertedSource === undefined || parent === undefined) {
        skippedEdges += 1;
        continue;
      }
      const sourcePort = portForConversion(
        sourceEdge.source.port,
        convertedSource,
        convertedSource,
        convertedSource,
      );
      const created = createEdgeForDiagram(
        edgeWorking,
        { nodeId: convertedSourceId, port: sourcePort },
        { edgeId: parent.id, t: sourceEdge.target.t },
      );
      if (created === null) {
        skippedEdges += 1;
        continue;
      }
      const edge = withSourceProperties(created, sourceEdge);
      edges.push(edge);
      createdBySource.set(sourceEdge.id, edge);
    }
  }

  return {
    nodes,
    edges,
    sourceToTarget,
    skippedNodes: clipboard.nodes.length - nodes.length,
    skippedEdges,
  };
};
