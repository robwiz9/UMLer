/**
 * Scene-local object clipboard.
 *
 * A copy contains the selected nodes and only the connectors whose endpoints
 * are both part of that copy. Pasting allocates fresh node/edge/label/waypoint
 * IDs and remaps attachments, so the original and every paste are independent.
 */

import type { EdgeAttachment, SceneEdge } from "./edges.ts";
import type { Point } from "./geometry.ts";
import {
  asEdgeId,
  asLabelId,
  asNodeId,
  asWaypointId,
  newId,
  type EdgeId,
  type NodeId,
} from "./ids.ts";
import type { ImageAsset, SceneNode } from "./nodes.ts";
import type { SceneDocument } from "./scene.ts";
import { insertSubgraph } from "./edits.ts";

export interface SceneClipboard {
  readonly sceneId: SceneDocument["id"];
  readonly diagramKind: SceneDocument["meta"]["diagramKind"];
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly assets: Readonly<Record<string, ImageAsset>>;
}

export interface PasteResult {
  readonly scene: SceneDocument;
  readonly nodeIds: readonly NodeId[];
  readonly edgeIds: readonly EdgeId[];
}

const attachmentReady = (
  attachment: EdgeAttachment,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
): boolean => {
  if (attachment.target === "node") return nodeIds.has(attachment.nodeId);
  if (attachment.target === "edge") return edgeIds.has(attachment.edgeId);
  return false;
};

/** Copies selected nodes plus every connector fully contained in the selection. */
export const copySceneNodes = (
  scene: SceneDocument,
  nodeIds: readonly string[],
): SceneClipboard | null => {
  const uniqueIds = [...new Set(nodeIds)];
  const nodes = uniqueIds.flatMap((id) => {
    const node = scene.nodes[id];
    return node === undefined ? [] : [node];
  });
  if (nodes.length === 0) return null;

  const selectedNodeIds = new Set(nodes.map((node) => String(node.id)));
  const copiedEdgeIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of Object.values(scene.edges)) {
      if (copiedEdgeIds.has(edge.id)) continue;
      if (
        attachmentReady(edge.source, selectedNodeIds, copiedEdgeIds) &&
        attachmentReady(edge.target, selectedNodeIds, copiedEdgeIds)
      ) {
        copiedEdgeIds.add(edge.id);
        changed = true;
      }
    }
  }

  return {
    sceneId: scene.id,
    diagramKind: scene.meta.diagramKind,
    nodes,
    edges: Object.values(scene.edges).filter((edge) => copiedEdgeIds.has(edge.id)),
    assets: Object.fromEntries(
      Object.entries(scene.assets).filter(([assetId]) =>
        nodes.some((node) => node.kind === "image" && node.assetId === assetId)),
    ),
  };
};

const remapAttachment = (
  attachment: EdgeAttachment,
  nodeIds: ReadonlyMap<string, NodeId>,
  edgeIds: ReadonlyMap<string, EdgeId>,
  offset: Point,
): EdgeAttachment | null => {
  if (attachment.target === "node") {
    const nodeId = nodeIds.get(attachment.nodeId);
    return nodeId === undefined ? null : { ...attachment, nodeId };
  }
  if (attachment.target === "edge") {
    const edgeId = edgeIds.get(attachment.edgeId);
    return edgeId === undefined ? null : { ...attachment, edgeId };
  }
  return {
    ...attachment,
    point: {
      x: attachment.point.x + offset.x,
      y: attachment.point.y + offset.y,
    },
  };
};

/** Inserts a clipboard payload with new IDs and an offset from the source. */
export const pasteSceneClipboard = (
  scene: SceneDocument,
  clipboard: SceneClipboard,
  offset: Point,
): PasteResult | null => {
  if (clipboard.nodes.length === 0) return null;

  const nodeIds = new Map<string, NodeId>();
  for (const node of clipboard.nodes) {
    nodeIds.set(node.id, asNodeId(newId("node")));
  }
  const edgeIds = new Map<string, EdgeId>();
  for (const edge of clipboard.edges) {
    edgeIds.set(edge.id, asEdgeId(newId("edge")));
  }

  const nodes: SceneNode[] = clipboard.nodes.map((node) => ({
    ...node,
    id: nodeIds.get(node.id) ?? asNodeId(newId("node")),
    frame: {
      ...node.frame,
      x: node.frame.x + offset.x,
      y: node.frame.y + offset.y,
    },
  }));

  const edges: SceneEdge[] = [];
  for (const edge of clipboard.edges) {
    const source = remapAttachment(edge.source, nodeIds, edgeIds, offset);
    const target = remapAttachment(edge.target, nodeIds, edgeIds, offset);
    if (source === null || target === null) continue;
    const id = edgeIds.get(edge.id);
    if (id === undefined) continue;
    edges.push({
      ...edge,
      id,
      source,
      target,
      routing: {
        ...edge.routing,
        waypoints: edge.routing.waypoints.map((waypoint) => ({
          ...waypoint,
          id: asWaypointId(newId("waypoint")),
          point: {
            x: waypoint.point.x + offset.x,
            y: waypoint.point.y + offset.y,
          },
        })),
      },
      labels: edge.labels.map((label) => ({
        ...label,
        id: asLabelId(newId("label")),
      })),
    });
  }

  return {
    scene: insertSubgraph(scene, nodes, edges, clipboard.assets),
    nodeIds: nodes.map((node) => node.id),
    edgeIds: edges.map((edge) => edge.id),
  };
};
