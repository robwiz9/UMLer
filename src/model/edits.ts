/**
 * Pure document edits used by the Step 3 UI.
 *
 * Every helper returns a new SceneDocument with an incremented revision. The
 * canvas/layout pass never mutates the persisted scene directly.
 */

import type { SceneDocument } from "./scene.ts";
import { withNodeFrames } from "../layout/build-layout.ts";
import type { Rect } from "./geometry.ts";
import type {
  ActivationBar,
  ImageAsset,
  RelationAttributeNode,
  SceneNode,
  TableLikeNode,
  TableNode,
  TableRow,
  TableSection,
} from "./nodes.ts";
import type {
  EdgeAttachment,
  EdgeLabel,
  EdgeLabelZone,
  EdgeMarkerSet,
  EdgeRoutingMode,
  SceneEdge,
} from "./edges.ts";
import { asActivationId, asLabelId, asRowId, asSectionId, newId, type ActivationId, type EdgeId, type LabelId, type NodeId, type RowId, type SectionId } from "./ids.ts";
import type { EdgeEnd, EndpointMarker } from "./markers.ts";
import type { StrokePattern } from "./styles.ts";

const stamp = (scene: SceneDocument, patch: Partial<SceneDocument>): SceneDocument => ({
  ...scene,
  ...patch,
  revision: scene.revision + 1,
  meta: { ...scene.meta, updatedAt: new Date().toISOString() },
});

/**
 * Inserts a palette-created object (and its placeholder asset, for images) in
 * one revision. Placement is resolved by the catalogue before this call.
 */
export const insertObject = (
  scene: SceneDocument,
  node: SceneNode,
  asset?: ImageAsset,
): SceneDocument =>
  stamp(scene, {
    nodes: { ...scene.nodes, [node.id]: node },
    ...(asset === undefined ? {} : { assets: { ...scene.assets, [asset.id]: asset } }),
  });

export const insertEdge = (scene: SceneDocument, edge: SceneEdge): SceneDocument =>
  stamp(scene, { edges: { ...scene.edges, [edge.id]: edge } });

/**
 * Removes a node and every connector whose endpoint references it. Connectors
 * are the only external references to a node in the scene graph.
 */
export const deleteNode = (scene: SceneDocument, nodeId: NodeId): SceneDocument => {
  if (scene.nodes[nodeId] === undefined) return scene;
  const removedEdges = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of Object.values(scene.edges)) {
      if (removedEdges.has(edge.id)) continue;
      const sourceNodeGone = edge.source.target === "node" && edge.source.nodeId === nodeId;
      const targetNodeGone = edge.target.target === "node" && edge.target.nodeId === nodeId;
      const sourceEdgeGone =
        edge.source.target === "edge" && removedEdges.has(edge.source.edgeId);
      const targetEdgeGone =
        edge.target.target === "edge" && removedEdges.has(edge.target.edgeId);
      if (sourceNodeGone || targetNodeGone || sourceEdgeGone || targetEdgeGone) {
        removedEdges.add(edge.id);
        changed = true;
      }
    }
  }
  const nodes = Object.fromEntries(
    Object.entries(scene.nodes).filter(([id]) => id !== nodeId),
  );
  const edges = Object.fromEntries(
    Object.entries(scene.edges).filter(([id]) => !removedEdges.has(id)),
  );
  return stamp(scene, { nodes, edges });
};

/** Appends an execution specification to a lifeline at a frame-relative top. */
export const addActivation = (
  scene: SceneDocument,
  nodeId: NodeId,
  top: number,
  height: number,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "lifeline") return node;
    const frameHeight = node.frame.height;
    const safeHeight = Math.max(1, Math.min(height, frameHeight));
    const safeTop = Math.max(0, Math.min(top, Math.max(0, frameHeight - safeHeight)));
    const bar: ActivationBar = {
      id: asActivationId(newId("activation")),
      top: safeTop,
      height: safeHeight,
      level: 0,
    };
    return { ...node, activationBars: [...node.activationBars, bar] };
  });

export const updateActivation = (
  scene: SceneDocument,
  nodeId: NodeId,
  activationId: ActivationId,
  patch: { readonly top: number; readonly height: number },
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "lifeline") return node;
    const maxHeight = node.frame.height;
    const height = Math.max(1, Math.min(patch.height, maxHeight));
    const top = Math.max(0, Math.min(patch.top, maxHeight - height));
    return {
      ...node,
      activationBars: node.activationBars.map((bar) =>
        bar.id === activationId ? { ...bar, top, height } : bar,
      ),
    };
  });

export const deleteActivation = (
  scene: SceneDocument,
  nodeId: NodeId,
  activationId: ActivationId,
): SceneDocument =>
  updateNode(scene, nodeId, (node) =>
    node.kind === "lifeline"
      ? {
          ...node,
          activationBars: node.activationBars.filter((bar) => bar.id !== activationId),
        }
      : node);

export const deleteEdge = (scene: SceneDocument, edgeId: EdgeId): SceneDocument => {
  if (scene.edges[edgeId] === undefined) return scene;
  const removedEdges = new Set<string>([edgeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of Object.values(scene.edges)) {
      if (removedEdges.has(edge.id)) continue;
      const sourceGone = edge.source.target === "edge" && removedEdges.has(edge.source.edgeId);
      const targetGone = edge.target.target === "edge" && removedEdges.has(edge.target.edgeId);
      if (sourceGone || targetGone) {
        removedEdges.add(edge.id);
        changed = true;
      }
    }
  }
  return stamp(scene, {
    edges: Object.fromEntries(
      Object.entries(scene.edges).filter(([id]) => !removedEdges.has(id)),
    ),
  });
};

export const updateNode = (
  scene: SceneDocument,
  nodeId: NodeId,
  updater: (node: SceneNode) => SceneNode,
): SceneDocument => {
  const node = scene.nodes[nodeId];
  if (node === undefined) return scene;
  return stamp(scene, { nodes: { ...scene.nodes, [nodeId]: updater(node) } });
};

export const patchNode = (
  scene: SceneDocument,
  nodeId: NodeId,
  patch: Partial<SceneNode>,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => ({ ...node, ...patch } as SceneNode));

export const updateEdge = (
  scene: SceneDocument,
  edgeId: EdgeId,
  updater: (edge: SceneEdge) => SceneEdge,
): SceneDocument => {
  const edge = scene.edges[edgeId];
  if (edge === undefined) return scene;
  return stamp(scene, { edges: { ...scene.edges, [edgeId]: updater(edge) } });
};

export const commitFrames = (
  scene: SceneDocument,
  frames: Readonly<Record<string, Rect>>,
  layoutPatch?: Partial<SceneDocument["layout"]>,
): SceneDocument => {
  const next = withNodeFrames(scene, frames);
  return stamp(next, layoutPatch === undefined ? {} : { layout: { ...next.layout, ...layoutPatch } });
};

/** Commits auto-layout frames and re-anchored ellipse endpoints in one revision. */
export const commitAutoLayout = (
  scene: SceneDocument,
  frames: Readonly<Record<string, Rect>>,
  edgeAttachments: Readonly<
    Record<string, { readonly source?: EdgeAttachment; readonly target?: EdgeAttachment }>
  >,
  layoutPatch?: Partial<SceneDocument["layout"]>,
): SceneDocument => {
  const framed = withNodeFrames(scene, frames);
  const edges: Record<string, SceneEdge> = { ...framed.edges };
  for (const [edgeId, patch] of Object.entries(edgeAttachments)) {
    const edge = edges[edgeId];
    if (edge === undefined) continue;
    edges[edgeId] = { ...edge, ...patch };
  }
  const next: SceneDocument = { ...framed, edges };
  return stamp(next, layoutPatch === undefined ? {} : { layout: { ...next.layout, ...layoutPatch } });
};

const tableSections = (node: TableLikeNode): readonly TableSection[] =>
  node.kind === "table"
    ? node.sections
    : [
        {
          id: asSectionId(`${node.id}_attributes`),
          role: "attributes",
          rows: node.rows,
        },
      ];

const withSections = (
  node: TableNode | RelationAttributeNode,
  sections: readonly TableSection[],
): TableNode | RelationAttributeNode => {
  if (node.kind === "table") return { ...node, sections };
  return { ...node, rows: sections.flatMap((section) => section.rows) };
};

export const updateRow = (
  scene: SceneDocument,
  nodeId: NodeId,
  rowId: RowId,
  patch: Partial<TableRow>,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "table" && node.kind !== "relationAttribute") return node;
    const sections = tableSections(node).map((section) => ({
      ...section,
      rows: section.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
    return withSections(node, sections);
  });

export const addRow = (
  scene: SceneDocument,
  nodeId: NodeId,
  sectionId?: SectionId,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "table" && node.kind !== "relationAttribute") return node;
    const sections = tableSections(node);
    const targetIndex = Math.max(
      0,
      sectionId === undefined
        ? sections.length - 1
        : sections.findIndex((section) => section.id === sectionId),
    );
    const target = sections[targetIndex];
    if (target === undefined) {
      const section: TableSection = {
        id: asSectionId(newId("section")),
        role: "attributes",
        rows: [],
      };
      return withSections(node, [...sections, section]);
    }
    const row: TableRow = {
      id: asRowId(newId("row")),
      kind: target.role === "methods" ? "method" : "attribute",
      name: target.role === "methods" ? "newOperation" : "newAttribute",
      type: target.role === "methods" ? undefined : "string",
      visibility: node.kind === "table" && node.tableKind === "class" ? "+" : undefined,
      constraints: [],
    };
    const next = sections.map((section, index) =>
      index === targetIndex ? { ...section, rows: [...section.rows, row] } : section,
    );
    return withSections(node, next);
  });

export const deleteRow = (
  scene: SceneDocument,
  nodeId: NodeId,
  rowId: RowId,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "table" && node.kind !== "relationAttribute") return node;
    const sections = tableSections(node).map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.id !== rowId),
    }));
    return withSections(node, sections);
  });

export const addSection = (scene: SceneDocument, nodeId: NodeId): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "table") return node;
    const section: TableSection = {
      id: asSectionId(newId("section")),
      role: "custom",
      title: "new section",
      rows: [
        {
          id: asRowId(newId("row")),
          kind: "attribute",
          name: "newAttribute",
          type: "string",
        },
      ],
    };
    return { ...node, sections: [...node.sections, section] };
  });

export const updateSection = (
  scene: SceneDocument,
  nodeId: NodeId,
  sectionId: SectionId,
  patch: Partial<TableSection>,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "table") return node;
    return {
      ...node,
      sections: node.sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
      ),
    };
  });

export const deleteSection = (
  scene: SceneDocument,
  nodeId: NodeId,
  sectionId: SectionId,
): SceneDocument =>
  updateNode(scene, nodeId, (node) => {
    if (node.kind !== "table") return node;
    return {
      ...node,
      sections: node.sections.filter((section) => section.id !== sectionId),
    };
  });

const labelAnchor = (zone: EdgeLabelZone): EdgeLabel["anchor"] =>
  zone === "source"
    ? { kind: "endpoint", end: "source" }
    : zone === "target"
      ? { kind: "endpoint", end: "target" }
      : { kind: "edgePoint", t: 0.5 };

export const setEndpointLabel = (
  scene: SceneDocument,
  edgeId: EdgeId,
  zone: EdgeLabelZone,
  text: string,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => {
    const existing = edge.labels.find((label) => label.zone === zone);
    if (text.trim().length === 0) {
      return { ...edge, labels: edge.labels.filter((label) => label.zone !== zone) };
    }
    const label: EdgeLabel = {
      id: existing?.id ?? asLabelId(newId("label")),
      zone,
      text,
      anchor: existing?.anchor ?? labelAnchor(zone),
      offset: existing?.offset ?? { x: 0, y: -12 },
      locked: existing?.locked ?? false,
      visible: existing?.visible ?? true,
      maxWidth: existing?.maxWidth,
    };
    return {
      ...edge,
      labels:
        existing === undefined
          ? [...edge.labels, label]
          : edge.labels.map((entry) => (entry.zone === zone ? label : entry)),
    };
  });

/** Manual label placement; the offset is relative to the resolved edge anchor. */
export const setEdgeLabelOffset = (
  scene: SceneDocument,
  edgeId: EdgeId,
  labelId: LabelId,
  offset: { readonly x: number; readonly y: number },
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => ({
    ...edge,
    labels: edge.labels.map((label) =>
      label.id === labelId ? { ...label, offset, locked: true } : label,
    ),
  }));

export const setMarker = (
  scene: SceneDocument,
  edgeId: EdgeId,
  end: EdgeEnd,
  marker: EndpointMarker,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => {
    const markers: EdgeMarkerSet = {
      ...edge.markers,
      [end]: marker,
    };
    return { ...edge, markers };
  });

/** Replaces one endpoint of an existing connector (terminal drag). */
export const setEdgeAttachment = (
  scene: SceneDocument,
  edgeId: EdgeId,
  end: "source" | "target",
  attachment: EdgeAttachment,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => ({
    ...edge,
    [end]: attachment,
  }));

/**
 * Moves both ends of a sequence message by the same world-space delta. Only
 * spine attachments are eligible; each t is recomputed against its lifeline
 * span and clamped, so the message can travel from head to tail.
 */
export const moveSequenceEdge = (
  scene: SceneDocument,
  edgeId: EdgeId,
  deltaY: number,
): SceneDocument => {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const moved = (attachment: SceneEdge["source"]): SceneEdge["source"] => {
    if (attachment.target !== "node" || attachment.port.kind !== "spine") return attachment;
    const lane = scene.nodes[attachment.nodeId];
    if (lane === undefined || lane.kind !== "lifeline") return attachment;
    const span = Math.max(1, lane.frame.height - lane.headHeight);
    return {
      ...attachment,
      port: { kind: "spine", t: clamp(attachment.port.t + deltaY / span) },
    };
  };
  return updateEdge(scene, edgeId, (edge) =>
    edge.semantic.family === "sequence"
      ? { ...edge, source: moved(edge.source), target: moved(edge.target) }
      : edge,
  );
};

export const setMarkers = (
  scene: SceneDocument,
  edgeId: EdgeId,
  markers: EdgeMarkerSet,
  pattern?: StrokePattern,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => ({
    ...edge,
    markers,
    style:
      pattern === undefined
        ? edge.style
        : { ...edge.style, stroke: { ...edge.style.stroke, pattern } },
  }));

export const setStrokePattern = (
  scene: SceneDocument,
  edgeId: EdgeId,
  pattern: StrokePattern,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => ({
    ...edge,
    style: { ...edge.style, stroke: { ...edge.style.stroke, pattern } },
  }));

export const setStrokeWidth = (
  scene: SceneDocument,
  edgeId: EdgeId,
  width: number,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => ({
    ...edge,
    style: { ...edge.style, stroke: { ...edge.style.stroke, width: Math.max(0.25, width) } },
  }));

export const setRoutingMode = (
  scene: SceneDocument,
  edgeId: EdgeId,
  mode: EdgeRoutingMode,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) =>
    edge.semantic.family === "sequence"
      ? {
          ...edge,
          routing: { ...edge.routing, mode: "straight", avoidObstacles: false },
        }
      : {
          ...edge,
          routing: { ...edge.routing, mode },
        });

export const rerouteEdge = (scene: SceneDocument, edgeId: EdgeId): SceneDocument =>
  updateEdge(scene, edgeId, (edge) =>
    edge.semantic.family === "sequence"
      ? {
          ...edge,
          routing: { ...edge.routing, mode: "straight", avoidObstacles: false },
        }
      : {
          ...edge,
          routing: { ...edge.routing, mode: "orthogonal", avoidObstacles: true },
        });

export const setEdgeLocked = (
  scene: SceneDocument,
  edgeId: EdgeId,
  locked: boolean,
): SceneDocument => updateEdge(scene, edgeId, (edge) => ({ ...edge, locked }));

export const patchLayout = (
  scene: SceneDocument,
  patch: Partial<SceneDocument["layout"]>,
): SceneDocument => stamp(scene, { layout: { ...scene.layout, ...patch } });
