/**
 * Pure document edits used by the Step 3 UI.
 *
 * Every helper returns a new SceneDocument with an incremented revision. The
 * canvas/layout pass never mutates the persisted scene directly.
 */

import type { SceneDocument } from "./scene.ts";
import { withNodeFrames } from "../layout/build-layout.ts";
import { imageFrameHeightForWidth } from "./image-geometry.ts";
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
import type { StrokePattern, TextStyleOverride, Theme } from "./styles.ts";

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
 * Inserts an object and its tether in one revision, optionally removing an
 * existing label from the edge it was derived from.
 */
export const insertConnectedObject = (
  scene: SceneDocument,
  node: SceneNode,
  edge: SceneEdge,
  removeLabel?: { readonly edgeId: EdgeId; readonly zone: EdgeLabelZone },
  asset?: ImageAsset,
): SceneDocument => {
  const edges = { ...scene.edges, [edge.id]: edge };
  if (removeLabel !== undefined) {
    const parent = edges[removeLabel.edgeId];
    if (parent !== undefined) {
      edges[removeLabel.edgeId] = {
        ...parent,
        labels: parent.labels.filter((label) => label.zone !== removeLabel.zone),
      };
    }
  }
  return stamp(scene, {
    nodes: { ...scene.nodes, [node.id]: node },
    edges,
    ...(asset === undefined ? {} : { assets: { ...scene.assets, [asset.id]: asset } }),
  });
};

/**
 * Applies theme defaults to the scene and every existing object. Per-object
 * text overrides live outside `node.style`, so they keep winning over the new
 * defaults after this pass.
 */
export const setSceneTheme = (scene: SceneDocument, theme: Theme): SceneDocument =>
  stamp(scene, {
    theme,
    nodes: Object.fromEntries(
      Object.entries(scene.nodes).map(([id, node]) => [
        id,
        node.kind === "table" || node.kind === "relationAttribute"
          ? { ...node, style: theme.table }
          : { ...node, style: theme.shape },
      ]),
    ),
  });

/**
 * Removes several nodes and every connector whose endpoint references one of
 * them. Connectors are the only external references to a node in the scene
 * graph; edges tethered to a removed connector are removed as well.
 */
export const deleteNodes = (
  scene: SceneDocument,
  nodeIds: readonly NodeId[],
): SceneDocument => {
  const removedNodes = new Set<string>(nodeIds);
  if (removedNodes.size === 0) return scene;
  if (![...removedNodes].some((id) => scene.nodes[id] !== undefined)) return scene;

  const removedEdges = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of Object.values(scene.edges)) {
      if (removedEdges.has(edge.id)) continue;
      const sourceNodeGone = edge.source.target === "node" && removedNodes.has(edge.source.nodeId);
      const targetNodeGone = edge.target.target === "node" && removedNodes.has(edge.target.nodeId);
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
    Object.entries(scene.nodes).filter(([id]) => !removedNodes.has(id)),
  );
  const edges = Object.fromEntries(
    Object.entries(scene.edges).filter(([id]) => !removedEdges.has(id)),
  );
  const usedAssetIds = new Set<string>(
    Object.values(nodes).flatMap((node) =>
      node.kind === "image" && node.assetId !== undefined
        ? [String(node.assetId)]
        : [],
    ),
  );
  const assets = Object.fromEntries(
    Object.entries(scene.assets).filter(([id]) => usedAssetIds.has(id)),
  );
  return stamp(scene, { nodes, edges, assets });
};

export const deleteNode = (scene: SceneDocument, nodeId: NodeId): SceneDocument =>
  deleteNodes(scene, [nodeId]);

/** Inserts a copied subgraph in one revision. */
export const insertSubgraph = (
  scene: SceneDocument,
  nodes: readonly SceneNode[],
  edges: readonly SceneEdge[],
  assets: Readonly<Record<string, ImageAsset>> = {},
): SceneDocument => {
  if (nodes.length === 0) return scene;
  return stamp(scene, {
    nodes: {
      ...scene.nodes,
      ...Object.fromEntries(nodes.map((node) => [node.id, node])),
    },
    edges: {
      ...scene.edges,
      ...Object.fromEntries(edges.map((edge) => [edge.id, edge])),
    },
    assets: { ...scene.assets, ...assets },
  });
};

/** Attach project image bytes to an image node, or revert it to an empty frame. */
export const setNodeImage = (
  scene: SceneDocument,
  nodeId: NodeId,
  asset: ImageAsset | undefined,
): SceneDocument => {
  const node = scene.nodes[nodeId];
  if (node === undefined || node.kind !== "image") return scene;

  if (asset === undefined) {
    const nodes = {
      ...scene.nodes,
      [nodeId]: { ...node, assetId: undefined },
    };
    const usedAssetIds = new Set<string>(
      Object.values(nodes).flatMap((candidate) =>
        candidate.kind === "image" && candidate.assetId !== undefined
          ? [String(candidate.assetId)]
          : [],
      ),
    );
    const assets = Object.fromEntries(
      Object.entries(scene.assets).filter(([id]) => usedAssetIds.has(id)),
    );
    return stamp(scene, { nodes, assets });
  }

  const aspect = asset.intrinsicWidth / Math.max(1, asset.intrinsicHeight);
  const nodes = {
    ...scene.nodes,
    [nodeId]: {
      ...node,
      assetId: asset.id,
      frame: {
        ...node.frame,
        height: imageFrameHeightForWidth(node, node.frame.width, aspect),
      },
    },
  };
  return stamp(scene, {
    nodes,
    assets: { ...scene.assets, [asset.id]: asset },
  });
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

export interface AddRowOptions {
  /** Pre-allocated so the caller can focus the new row's name field. */
  readonly rowId?: RowId;
  /** Insert directly below this row instead of appending to the section. */
  readonly afterRowId?: RowId;
}

export const addRow = (
  scene: SceneDocument,
  nodeId: NodeId,
  sectionId?: SectionId,
  options: AddRowOptions = {},
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
      id: options.rowId ?? asRowId(newId("row")),
      kind: target.role === "methods" ? "method" : "attribute",
      // Blank rows let the row editor drive a fast keyboard entry flow.
      name: "",
      visibility: node.kind === "table" && node.tableKind === "class" ? "+" : undefined,
      constraints: [],
    };
    const afterIndex = options.afterRowId === undefined
      ? -1
      : target.rows.findIndex((entry) => entry.id === options.afterRowId);
    const rows = [...target.rows];
    rows.splice(afterIndex < 0 ? rows.length : afterIndex + 1, 0, row);
    const next = sections.map((section, index) =>
      index === targetIndex ? { ...section, rows } : section,
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
      textStyle: existing?.textStyle,
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

export const setEdgeLabelTextStyle = (
  scene: SceneDocument,
  edgeId: EdgeId,
  zone: EdgeLabelZone,
  textStyle: TextStyleOverride | undefined,
): SceneDocument =>
  updateEdge(scene, edgeId, (edge) => ({
    ...edge,
    labels: edge.labels.map((label) =>
      label.zone === zone ? { ...label, textStyle } : label,
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
