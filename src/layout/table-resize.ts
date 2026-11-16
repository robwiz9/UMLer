import type { LayoutSnapshot } from "../model/layout.ts";
import type { SceneDocument } from "../model/scene.ts";
import type { SceneNode } from "../model/nodes.ts";
import { patchNode } from "../model/edits.ts";
import { asNodeId } from "../model/ids.ts";

/**
 * The live row height is the fraction of the table body each row currently
 * receives. Adding/removing a row changes the frame by exactly this amount so
 * the remaining rows keep their absolute height.
 */
export const tableRowHeightFor = (
  scene: SceneDocument,
  layout: LayoutSnapshot,
  nodeId: string,
): number => {
  const nodeLayout = layout.nodes[nodeId];
  if (nodeLayout?.kind === "table" || nodeLayout?.kind === "relationAttribute") {
    for (const section of nodeLayout.sections) {
      const row = section.rows[0];
      if (row !== undefined && row.frame.height > 0) return row.frame.height;
    }
  }
  const node = scene.nodes[nodeId];
  if (node?.kind === "table" || node?.kind === "relationAttribute") {
    return Math.max(8, node.style.rowHeight);
  }
  return 20;
};

/** Grow/shrink a table frame by a content delta without snapping the delta. */
export const resizeTableFrameBy = (
  scene: SceneDocument,
  nodeId: string,
  delta: number,
): SceneDocument => {
  const node = scene.nodes[nodeId];
  if (
    node === undefined ||
    (node.kind !== "table" && node.kind !== "relationAttribute") ||
    Math.abs(delta) < 0.001
  ) {
    return scene;
  }
  return patchNode(scene, asNodeId(nodeId), {
    frame: {
      ...node.frame,
      height: Math.max(1, node.frame.height + delta),
    },
  } as Partial<SceneNode>);
};
