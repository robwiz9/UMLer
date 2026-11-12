/**
 * Selection resolution for the Typst exporter.
 *
 * Snapping a selection to the page must never resize individual objects, so
 * the exporter keeps absolute scene coordinates and only shifts the origin.
 * This module decides which nodes/edges belong to the export and the one
 * bounding box used for origin normalisation.
 */

import type { EdgeAttachment, SceneEdge } from "../model/edges.ts";
import { expandRect, unionRects, type Rect } from "../model/geometry.ts";
import type { LayoutSnapshot } from "../model/layout.ts";
import type { ImageNode, SceneNode } from "../model/nodes.ts";
import type { SceneDocument } from "../model/scene.ts";
import type { ExportScope } from "./page.ts";

export interface ExportSelection {
  readonly scope: ExportScope;
  readonly nodes: readonly SceneNode[];
  /** z-sorted, matching the canvas draw order. */
  readonly edges: readonly SceneEdge[];
  readonly nodeIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
  /** Content bounds plus the scene's export padding. */
  readonly bounds: Rect;
  /** Natural (unscaled) content size including padding. */
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly imageAssets: readonly { readonly node: ImageNode; readonly assetId?: string }[];
  readonly warnings: readonly string[];
}

const edgeNodeIds = (edge: SceneEdge): string[] => {
  const ids: string[] = [];
  if (edge.source.target === "node") ids.push(edge.source.nodeId);
  if (edge.target.target === "node") ids.push(edge.target.nodeId);
  return ids;
};

const edgeHostIds = (edge: SceneEdge): string[] => {
  const ids: string[] = [];
  if (edge.source.target === "edge") ids.push(edge.source.edgeId);
  if (edge.target.target === "edge") ids.push(edge.target.edgeId);
  return ids;
};

/** An edge is drawable from the selection when every attachment is included. */
const attachmentsIncluded = (
  edge: SceneEdge,
  nodeIds: ReadonlySet<string>,
  includedEdges: ReadonlySet<string>,
  requireOneEnd: boolean,
): boolean => {
  let ends = 0;
  for (const end of [edge.source, edge.target] as const) {
    if (end.target === "node") {
      ends += 1;
      if (!nodeIds.has(end.nodeId)) return false;
    } else if (end.target === "edge") {
      ends += 1;
      if (!includedEdges.has(end.edgeId)) return false;
    }
  }
  return requireOneEnd ? ends > 0 : true;
};

const collectSeed = (
  selectedNodeIds: readonly string[],
  selectedEdgeId: string | null,
  scene: SceneDocument,
): { nodeIds: Set<string>; edgeIds: Set<string> } => {
  const nodeIds = new Set<string>();
  for (const id of selectedNodeIds) {
    const node = scene.nodes[id];
    if (node !== undefined) nodeIds.add(id);
  }
  const edgeIds = new Set<string>();
  let pendingEdge = selectedEdgeId === null ? undefined : scene.edges[selectedEdgeId];
  // Follow edge-to-edge hosts so a selected relation tether keeps its target.
  while (pendingEdge !== undefined && !edgeIds.has(pendingEdge.id)) {
    edgeIds.add(pendingEdge.id);
    for (const nodeId of edgeNodeIds(pendingEdge)) {
      if (scene.nodes[nodeId] !== undefined) nodeIds.add(nodeId);
    }
    const hosts = edgeHostIds(pendingEdge);
    pendingEdge = hosts.length > 0 ? scene.edges[hosts[0] as string] : undefined;
  }
  return { nodeIds, edgeIds };
};

export const resolveExportSelection = (
  scene: SceneDocument,
  layout: LayoutSnapshot,
  scope: ExportScope,
  selectedNodeIds: readonly string[],
  selectedEdgeId: string | null,
): ExportSelection => {
  const warnings: string[] = [];
  const allNodes = Object.values(scene.nodes).sort((a, b) => a.z - b.z);
  const allEdges = Object.values(scene.edges).sort((a, b) => a.z - b.z);
  const visibleNodes = allNodes.filter((node) => node.visible !== false);
  const visibleEdges = allEdges.filter((edge) => edge.visible !== false);

  let chosenNodes = visibleNodes;
  let chosenEdges = visibleEdges;
  const effectiveScope: ExportScope =
    scope === "selection" && selectedNodeIds.length === 0 && selectedEdgeId === null
      ? "diagram"
      : scope;

  if (effectiveScope === "selection") {
    const seed = collectSeed(selectedNodeIds, selectedEdgeId, scene);
    const includedEdges = new Set(seed.edgeIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of visibleEdges) {
        if (includedEdges.has(edge.id)) continue;
        if (
          attachmentsIncluded(
            edge,
            seed.nodeIds,
            includedEdges,
            true,
          )
        ) {
          includedEdges.add(edge.id);
          changed = true;
        }
      }
    }
    chosenNodes = allNodes.filter((node) => seed.nodeIds.has(node.id));
    chosenEdges = allEdges.filter((edge) => includedEdges.has(edge.id));
    if (chosenNodes.length === 0 && chosenEdges.length === 0) {
      warnings.push("Nothing is selected; exporting the whole diagram instead.");
      chosenNodes = visibleNodes;
      chosenEdges = visibleEdges;
    }
  }

  // A connector whose endpoint node is not part of the export would float in
  // empty space. In selection mode we already enforced both ends, but hidden
  // nodes can still remove an endpoint from a whole-diagram export.
  const exportedNodeIds = new Set(chosenNodes.map((node) => node.id));
  const exportedEdgeIds = new Set(chosenEdges.map((edge) => edge.id));
  chosenEdges = chosenEdges.filter((edge) =>
    attachmentsIncluded(edge, exportedNodeIds, exportedEdgeIds, false),
  );

  const nodeLayouts = chosenNodes
    .map((node) => layout.nodes[node.id])
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const edgeLayouts = chosenEdges
    .map((edge) => layout.edges[edge.id])
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  const content = unionRects([
    ...nodeLayouts.map((node) => node.bounds),
    ...edgeLayouts.map((edge) => edge.bounds),
  ]);
  const bounds = expandRect(
    content ?? { x: 0, y: 0, width: 1, height: 1 },
    scene.canvas.exportPadding,
  );

  const hiddenCount = allNodes.length - visibleNodes.length;
  if (effectiveScope === "diagram" && hiddenCount > 0) {
    warnings.push(`${hiddenCount} hidden object${hiddenCount === 1 ? "" : "s"} omitted from the export.`);
  }

  const imageAssets = chosenNodes
    .filter((node): node is ImageNode => node.kind === "image")
    .map((node) => ({ node, assetId: node.assetId }));

  return {
    scope: effectiveScope,
    nodes: chosenNodes,
    edges: chosenEdges,
    nodeIds: new Set(chosenNodes.map((node) => node.id)),
    edgeIds: new Set(chosenEdges.map((edge) => edge.id)),
    bounds,
    naturalWidth: Math.max(1, bounds.width),
    naturalHeight: Math.max(1, bounds.height),
    imageAssets,
    warnings,
  };
};

/** Selection count shown in the panel before the full resolver runs. */
export const selectionObjectCount = (
  selectedNodeIds: readonly string[],
  selectedEdgeId: string | null,
): number => selectedNodeIds.length + (selectedEdgeId === null ? 0 : 1);

/** Attachments that point at a removed edge are dropped during validation. */
export const attachmentNodeIds = (attachment: EdgeAttachment): readonly string[] =>
  attachment.target === "node" ? [attachment.nodeId] : [];
