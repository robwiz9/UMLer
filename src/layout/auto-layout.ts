/**
 * Step 3 layered auto-layout.
 *
 * A compact Sugiyama-style implementation:
 *   1. collect semantic edges between moveable node kinds;
 *   2. break cycles with a DFS back-edge pass;
 *   3. rank by longest path;
 *   4. reduce crossings with median/barycenter sweeps;
 *   5. assign coordinates rank by rank;
 *   6. keep locked frames fixed and treat them as placement obstacles.
 *
 * This deliberately favours deterministic, readable results for the fixture
 * scale over advanced network-simplex coordinates. It never mutates the
 * scene: the caller commits the returned frame map as one revision.
 */

import type { LayoutSnapshot } from "../model/layout.ts";
import type { SceneNode } from "../model/nodes.ts";
import type { SceneDocument } from "../model/scene.ts";
import type { EdgeAttachment } from "../model/edges.ts";
import type { Rect } from "../model/geometry.ts";
import { rectBottom, rectRight, snap } from "../model/geometry.ts";
import { isSystemBoundary, useCaseContainers } from "../model/containment.ts";

export interface AutoLayoutResult {
  readonly frames: Readonly<Record<string, Rect>>;
  /** Favorable ellipse anchors recomputed after the new positions are known. */
  readonly edgeAttachments: Readonly<
    Record<string, { readonly source?: EdgeAttachment; readonly target?: EdgeAttachment }>
  >;
  readonly layers: number;
  readonly moved: number;
  readonly crossingsBefore: number;
  readonly crossingsAfter: number;
  readonly skipped?: string;
}

const EMPTY: AutoLayoutResult = {
  frames: {},
  edgeAttachments: {},
  layers: 0,
  moved: 0,
  crossingsBefore: 0,
  crossingsAfter: 0,
};

const layoutable = (node: SceneNode): boolean =>
  node.kind !== "lifeline" &&
  node.kind !== "comment" &&
  (node.kind !== "frame" || isSystemBoundary(node));

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < rectRight(b) - 0.001 &&
  rectRight(a) > b.x + 0.001 &&
  a.y < rectBottom(b) - 0.001 &&
  rectBottom(a) > b.y + 0.001;

const approximateCrossings = (
  layerOf: ReadonlyMap<string, number>,
  orderOf: ReadonlyMap<string, number>,
  edges: readonly { readonly source: string; readonly target: string }[],
): number => {
  const between = edges.filter((edge) => {
    const a = layerOf.get(edge.source);
    const b = layerOf.get(edge.target);
    return a !== undefined && b !== undefined && Math.abs(a - b) === 1;
  });
  let crossings = 0;
  for (let i = 0; i < between.length; i += 1) {
    const a = between[i] as { source: string; target: string };
    for (let j = i + 1; j < between.length; j += 1) {
      const b = between[j] as { source: string; target: string };
      const aLayer = layerOf.get(a.source) as number;
      const bLayer = layerOf.get(b.source) as number;
      if (aLayer !== bLayer) continue;
      const a1 = orderOf.get(a.source) as number;
      const a2 = orderOf.get(a.target) as number;
      const b1 = orderOf.get(b.source) as number;
      const b2 = orderOf.get(b.target) as number;
      if ((a1 - b1) * (a2 - b2) < 0) crossings += 1;
    }
  }
  return crossings;
};

export const autoLayoutFrames = (
  scene: SceneDocument,
  layout: LayoutSnapshot,
): AutoLayoutResult => {
  if (scene.meta.diagramKind === "uml-sequence") {
    return { ...EMPTY, skipped: "Sequence diagrams keep their lane/time layout." };
  }

  const containers = useCaseContainers(scene);
  const childIds = new Set(containers.keys());
  const unhandledFrames = Object.values(scene.nodes).filter(
    (node) => node.kind === "frame" && !isSystemBoundary(node),
  );
  if (unhandledFrames.length > 0) {
    return {
      ...EMPTY,
      skipped: "Framed diagrams keep their container layout; auto-layout is available for graph-only diagrams.",
    };
  }

  const nodes = Object.values(scene.nodes)
    .filter(layoutable)
    .filter((node) => !childIds.has(node.id));
  const byId = new Map(nodes.map((node) => [node.id as string, node]));
  if (nodes.length === 0) return { ...EMPTY, skipped: "No layoutable nodes." };

  const resolveEndpoint = (nodeId: string): string => containers.get(nodeId) ?? nodeId;
  const edges = Object.values(scene.edges).flatMap((edge) => {
    if (edge.source.target !== "node" || edge.target.target !== "node") return [];
    const source = resolveEndpoint(edge.source.nodeId as string);
    const target = resolveEndpoint(edge.target.nodeId as string);
    if (source === target) return [];
    if (!byId.has(source) || !byId.has(target)) return [];
    return [{ source, target }];
  });

  // DFS cycle breaking: drop back edges from the ranking graph. They still
  // draw normally; only their rank constraint is omitted.
  const outgoing = new Map<string, string[]>();
  for (const id of byId.keys()) outgoing.set(id, []);
  for (const edge of edges) outgoing.get(edge.source)?.push(edge.target);
  const state = new Map<string, 0 | 1 | 2>();
  const dag: { source: string; target: string }[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const target of outgoing.get(id) ?? []) {
      const targetState = state.get(target) ?? 0;
      if (targetState === 1) continue;
      dag.push({ source: id, target });
      if (targetState === 0) visit(target);
    }
    state.set(id, 2);
  };
  for (const id of byId.keys()) {
    if ((state.get(id) ?? 0) === 0) visit(id);
  }

  const indegree = new Map<string, number>();
  for (const id of byId.keys()) indegree.set(id, 0);
  for (const edge of dag) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  const rank = new Map<string, number>();
  const queue = [...byId.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  for (const id of queue) rank.set(id, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index] as string;
    for (const edge of dag.filter((entry) => entry.source === id)) {
      rank.set(edge.target, Math.max(rank.get(edge.target) ?? 0, (rank.get(id) ?? 0) + 1));
      const next = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, next);
      if (next === 0) queue.push(edge.target);
    }
  }
  for (const id of byId.keys()) if (!rank.has(id)) rank.set(id, 0);
  const maxRank = Math.max(0, ...rank.values());

  const direction = scene.layout.direction;
  const layerIds = new Map<number, string[]>();
  for (let index = 0; index <= maxRank; index += 1) layerIds.set(index, []);
  for (const id of byId.keys()) {
    const layer = rank.get(id) ?? 0;
    layerIds.get(layer)?.push(id);
  }
  for (const [layer, ids] of layerIds) {
    ids.sort((a, b) => {
      const aFrame = layout.nodes[a]?.frame ?? byId.get(a)?.frame;
      const bFrame = layout.nodes[b]?.frame ?? byId.get(b)?.frame;
      const primary = direction === "TB" ? (aFrame?.x ?? 0) - (bFrame?.x ?? 0) : (aFrame?.y ?? 0) - (bFrame?.y ?? 0);
      return primary !== 0 ? primary : a.localeCompare(b);
    });
    layerIds.set(layer, ids);
  }

  const neighbors = (id: string): string[] => {
    const result: string[] = [];
    for (const edge of edges) {
      if (edge.source === id) result.push(edge.target);
      if (edge.target === id) result.push(edge.source);
    }
    return result;
  };
  const position = (): Map<string, number> => {
    const result = new Map<string, number>();
    for (const ids of layerIds.values()) {
      ids.forEach((id, index) => result.set(id, index));
    }
    return result;
  };
  const crossingsBefore = approximateCrossings(
    rank,
    position(),
    edges,
  );

  if (scene.layout.reduceCrossings) {
    for (let iteration = 0; iteration < scene.layout.maxIterations; iteration += 1) {
      let changed = false;
      for (let layer = 1; layer <= maxRank; layer += 1) {
        const ids = layerIds.get(layer);
        if (ids === undefined) continue;
        const fixed = position();
        ids.sort((a, b) => {
          const average = (id: string): number => {
            const adjacent = neighbors(id)
              .map((neighbor) => (rank.get(neighbor) ?? 0) === layer - 1 ? fixed.get(neighbor) : undefined)
              .filter((value): value is number => value !== undefined);
            return adjacent.length === 0
              ? (fixed.get(id) ?? 0)
              : adjacent.reduce((sum, value) => sum + value, 0) / adjacent.length;
          };
          const order = average(a) - average(b);
          return order !== 0 ? order : (fixed.get(a) ?? 0) - (fixed.get(b) ?? 0);
        });
        changed = true;
      }
      for (let layer = maxRank - 1; layer >= 0; layer -= 1) {
        const ids = layerIds.get(layer);
        if (ids === undefined) continue;
        const fixed = position();
        ids.sort((a, b) => {
          const average = (id: string): number => {
            const adjacent = neighbors(id)
              .map((neighbor) => (rank.get(neighbor) ?? 0) === layer + 1 ? fixed.get(neighbor) : undefined)
              .filter((value): value is number => value !== undefined);
            return adjacent.length === 0
              ? (fixed.get(id) ?? 0)
              : adjacent.reduce((sum, value) => sum + value, 0) / adjacent.length;
          };
          const order = average(a) - average(b);
          return order !== 0 ? order : (fixed.get(a) ?? 0) - (fixed.get(b) ?? 0);
        });
        changed = true;
      }
      if (!changed) break;
    }
  }

  const orderOf = position();
  const crossingsAfter = approximateCrossings(rank, orderOf, edges);

  const gap = Math.max(9, scene.layout.nodeGap);
  const rankGap = Math.max(9, scene.layout.rankGap);
  const grid = Math.max(1, scene.canvas.grid.size);
  const allFrames = nodes.map((node) => layout.nodes[node.id]?.frame ?? node.frame);
  const originX = Math.min(...allFrames.map((frame) => frame.x));
  const originY = Math.min(...allFrames.map((frame) => frame.y));

  const lockedRects: Rect[] = nodes
    .filter((node) => node.locked)
    .map((node) => layout.nodes[node.id]?.frame ?? node.frame);
  const occupied: Rect[] = [...lockedRects];
  const frames: Record<string, Rect> = {};
  let moved = 0;

  const placeClear = (candidate: Rect): Rect => {
    let next = candidate;
    for (let attempts = 0; attempts < 60; attempts += 1) {
      if (!occupied.some((rect) => intersects(next, rect))) break;
      if (direction === "TB") next = { ...next, x: next.x + next.width + gap };
      else next = { ...next, y: next.y + next.height + gap };
    }
    occupied.push(next);
    return next;
  };

  if (direction === "TB") {
    let cursorY = originY;
    for (let layer = 0; layer <= maxRank; layer += 1) {
      const ids = layerIds.get(layer) ?? [];
      const layerHeight = Math.max(0, ...ids.map((id) => (layout.nodes[id]?.frame ?? byId.get(id)?.frame)?.height ?? 0));
      let cursorX = originX;
      for (const id of ids) {
        const node = byId.get(id);
        const current = layout.nodes[id]?.frame ?? node?.frame;
        if (node === undefined || current === undefined) continue;
        const candidate = {
          ...current,
          x: snap(cursorX, grid),
          y: snap(cursorY + (layerHeight - current.height) / 2, grid),
        };
        cursorX += current.width + gap;
        if (node.locked) continue;
        const placed = placeClear(candidate);
        frames[id] = placed;
        moved += 1;
      }
      cursorY += layerHeight + rankGap;
    }
  } else {
    let cursorX = originX;
    for (let layer = 0; layer <= maxRank; layer += 1) {
      const ids = layerIds.get(layer) ?? [];
      const layerWidth = Math.max(0, ...ids.map((id) => (layout.nodes[id]?.frame ?? byId.get(id)?.frame)?.width ?? 0));
      let cursorY = originY;
      for (const id of ids) {
        const node = byId.get(id);
        const current = layout.nodes[id]?.frame ?? node?.frame;
        if (node === undefined || current === undefined) continue;
        const candidate = {
          ...current,
          x: snap(cursorX + (layerWidth - current.width) / 2, grid),
          y: snap(cursorY, grid),
        };
        cursorY += current.height + gap;
        if (node.locked) continue;
        const placed = placeClear(candidate);
        frames[id] = placed;
        moved += 1;
      }
      cursorX += layerWidth + rankGap;
    }
  }

  // Each system boundary moves as one layout unit. Translate its fully
  // enclosed use cases by the same delta as the new boundary frame, so their
  // internal arrangement is preserved.
  const childrenByBoundary = new Map<string, string[]>();
  for (const [childId, parentId] of containers) {
    const list = childrenByBoundary.get(parentId) ?? [];
    list.push(childId);
    childrenByBoundary.set(parentId, list);
  }
  for (const [parentId, childList] of childrenByBoundary) {
    const nextParent = frames[parentId];
    const previousParent = layout.nodes[parentId]?.frame ?? byId.get(parentId)?.frame;
    if (nextParent === undefined || previousParent === undefined) continue;
    const dx = nextParent.x - previousParent.x;
    const dy = nextParent.y - previousParent.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
    for (const childId of childList) {
      const previousChild = layout.nodes[childId]?.frame ?? scene.nodes[childId]?.frame;
      if (previousChild === undefined) continue;
      frames[childId] = {
        ...previousChild,
        x: previousChild.x + dx,
        y: previousChild.y + dy,
      };
      moved += 1;
    }
  }

  const frameFor = (nodeId: string): Rect | undefined =>
    frames[nodeId] ?? layout.nodes[nodeId]?.frame ?? scene.nodes[nodeId]?.frame;
  const centerOf = (frame: Rect) => ({
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  });
  const ellipseAngle = (usecaseFrame: Rect, otherCenter: { x: number; y: number }): number => {
    const center = centerOf(usecaseFrame);
    const rx = Math.max(1, usecaseFrame.width / 2);
    const ry = Math.max(1, usecaseFrame.height / 2);
    const theta = Math.atan2((otherCenter.y - center.y) / ry, (otherCenter.x - center.x) / rx);
    return ((theta * 180) / Math.PI + 360) % 360;
  };

  const edgeAttachments: Record<
    string,
    { source?: EdgeAttachment; target?: EdgeAttachment }
  > = {};
  for (const edge of Object.values(scene.edges)) {
    if (edge.source.target !== "node" || edge.target.target !== "node") continue;
    if (edge.source.nodeId === edge.target.nodeId) continue;
    const sourceNode = scene.nodes[edge.source.nodeId];
    const targetNode = scene.nodes[edge.target.nodeId];
    const sourceFrame = frameFor(edge.source.nodeId);
    const targetFrame = frameFor(edge.target.nodeId);
    if (sourceFrame === undefined || targetFrame === undefined) continue;
    const patch: { source?: EdgeAttachment; target?: EdgeAttachment } = {};
    if (sourceNode?.kind === "useCase") {
      patch.source = {
        target: "node",
        nodeId: edge.source.nodeId,
        port: {
          kind: "angle",
          angle: ellipseAngle(sourceFrame, centerOf(targetFrame)),
          auto: true,
        },
      };
    }
    if (targetNode?.kind === "useCase") {
      patch.target = {
        target: "node",
        nodeId: edge.target.nodeId,
        port: {
          kind: "angle",
          angle: ellipseAngle(targetFrame, centerOf(sourceFrame)),
          auto: true,
        },
      };
    }
    if (patch.source !== undefined || patch.target !== undefined) {
      edgeAttachments[edge.id] = patch;
    }
  }

  return {
    frames,
    edgeAttachments,
    layers: maxRank + 1,
    moved,
    crossingsBefore,
    crossingsAfter,
    skipped: moved === 0 ? "Every node is locked; auto-layout is a no-op." : undefined,
  };
};
