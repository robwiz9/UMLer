/**
 * Geometric containment for UML system boundaries.
 *
 * Containment is derived, not persisted: a use case belongs to the smallest
 * system-boundary frame that fully encloses it. Dragging the boundary therefore
 * automatically carries its contained use cases, and auto-layout can treat the
 * boundary as one movable unit.
 */

import type { SceneDocument } from "./scene.ts";
import type { FrameNode, SceneNode } from "./nodes.ts";
import { rectBottom, rectRight } from "./geometry.ts";

const EPSILON = 0.001;

export const isSystemBoundary = (node: SceneNode | undefined): node is FrameNode =>
  node !== undefined && node.kind === "frame" && node.frameKind === "system-boundary";

export const fullyEncloses = (parent: FrameNode, child: SceneNode): boolean =>
  child.frame.x >= parent.frame.x - EPSILON &&
  child.frame.y >= parent.frame.y - EPSILON &&
  rectRight(child.frame) <= rectRight(parent.frame) + EPSILON &&
  rectBottom(child.frame) <= rectBottom(parent.frame) + EPSILON;

/**
 * Maps each fully enclosed use case to its smallest containing boundary.
 * Nested boundaries are handled by choosing the smallest enclosing frame.
 */
export const useCaseContainers = (scene: SceneDocument): ReadonlyMap<string, string> => {
  const boundaries = Object.values(scene.nodes)
    .filter(isSystemBoundary)
    .sort(
      (a, b) =>
        a.frame.width * a.frame.height - b.frame.width * b.frame.height ||
        a.id.localeCompare(b.id),
    );
  const result = new Map<string, string>();
  for (const node of Object.values(scene.nodes)) {
    if (node.kind !== "useCase") continue;
    const parent = boundaries.find((boundary) => fullyEncloses(boundary, node));
    if (parent !== undefined) result.set(node.id, parent.id);
  }
  return result;
};

export const childrenOfBoundary = (
  scene: SceneDocument,
  boundaryId: string,
): readonly SceneNode[] => {
  const containers = useCaseContainers(scene);
  return Object.values(scene.nodes).filter(
    (node) => containers.get(node.id) === boundaryId,
  );
};
