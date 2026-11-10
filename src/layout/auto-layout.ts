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
import { rect, rectBottom, rectRight, snap } from "../model/geometry.ts";
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
  const nodeNodeIds = new Set<string>();
  for (const edge of Object.values(scene.edges)) {
    if (edge.source.target !== "node" || edge.target.target !== "node") continue;
    nodeNodeIds.add(edge.source.nodeId as string);
    nodeNodeIds.add(edge.target.nodeId as string);
  }

  /**
   * Relation-attribute tethers point at the relationship edge, not at another
   * node, so the layered graph used to ignore them and left the tables in rank
   * zero where their dashed tethers could cross the real graph. Track those
   * tables separately and place them around the relationship after the main
   * graph has coordinates.
   */
  const tetherByNode = new Map<
    string,
    { readonly parentEdgeId: string; readonly tetherEdgeId: string }
  >();
  for (const edge of Object.values(scene.edges)) {
    if (edge.source.target === "node" && edge.target.target === "edge") {
      const node = scene.nodes[edge.source.nodeId];
      if (node?.kind === "relationAttribute" && !nodeNodeIds.has(edge.source.nodeId)) {
        tetherByNode.set(edge.source.nodeId, {
          parentEdgeId: edge.target.edgeId,
          tetherEdgeId: edge.id,
        });
      }
    }
    if (edge.target.target === "node" && edge.source.target === "edge") {
      const node = scene.nodes[edge.target.nodeId];
      if (node?.kind === "relationAttribute" && !nodeNodeIds.has(edge.target.nodeId)) {
        tetherByNode.set(edge.target.nodeId, {
          parentEdgeId: edge.source.edgeId,
          tetherEdgeId: edge.id,
        });
      }
    }
  }
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
    .filter((node) => !childIds.has(node.id))
    .filter((node) => !tetherByNode.has(node.id));
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

  const lockedRects: Rect[] = Object.values(scene.nodes)
    .filter((node) => node.locked && layoutable(node) && !childIds.has(node.id))
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

  /**
   * Relation-attribute tables must stay on their requested side of the parent
   * relationship. Move them along the relationship axis first, then farther
   * away from the line; never jump across it the way the generic placement
   * cascade can.
   */
  const placeTetheredClear = (
    candidate: Rect,
    horizontal: boolean,
    side: "above" | "below" | "left" | "right",
    nodeId: string,
  ): Rect => {
    const node = scene.nodes[nodeId];
    if (node === undefined) return placeClear(candidate);
    const alongStep = (horizontal ? node.frame.width : node.frame.height) + gap;
    const awayStep = (horizontal ? node.frame.height : node.frame.width) + gap;
    const awaySign = side === "below" || side === "right" ? 1 : -1;
    const alongOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    for (let awayIndex = 0; awayIndex < 5; awayIndex += 1) {
      for (const alongIndex of alongOffsets) {
        const along = alongIndex * alongStep;
        const away = awaySign * awayIndex * awayStep;
        const next = horizontal
          ? {
              ...candidate,
              x: snap(candidate.x + along, grid),
              y: snap(candidate.y + away, grid),
            }
          : {
              ...candidate,
              x: snap(candidate.x + away, grid),
              y: snap(candidate.y + along, grid),
            };
        if (!occupied.some((rect) => intersects(next, rect))) {
          occupied.push(next);
          return next;
        }
      }
    }
    return placeClear(candidate);
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

  // Relation-attribute tables orbit their parent relationship instead of being
  // ranked as disconnected nodes. The first table keeps its current side; any
  // additional tables alternate above/below (or left/right for vertical lines)
  // so their tethers do not pile up on one side of the edge.
  const tetheredByParent = new Map<string, string[]>();
  for (const [nodeId, tether] of tetherByNode) {
    if (scene.nodes[nodeId]?.locked) continue;
    const list = tetheredByParent.get(tether.parentEdgeId) ?? [];
    list.push(nodeId);
    tetheredByParent.set(tether.parentEdgeId, list);
  }
  const tetherTValues = new Map<string, number>();
  for (const [parentEdgeId, nodeIds] of tetheredByParent) {
    const parent = scene.edges[parentEdgeId];
    if (
      parent === undefined ||
      parent.source.target !== "node" ||
      parent.target.target !== "node"
    ) {
      continue;
    }
    const sourceFrame = frameFor(parent.source.nodeId);
    const targetFrame = frameFor(parent.target.nodeId);
    if (sourceFrame === undefined || targetFrame === undefined) continue;
    const sourceCenter = centerOf(sourceFrame);
    const targetCenter = centerOf(targetFrame);
    const parentCenter = {
      x: (sourceCenter.x + targetCenter.x) / 2,
      y: (sourceCenter.y + targetCenter.y) / 2,
    };
    const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >=
      Math.abs(targetCenter.y - sourceCenter.y);
    const ordered = [...nodeIds].sort((a, b) => {
      const aFrame = layout.nodes[a]?.frame ?? scene.nodes[a]?.frame;
      const bFrame = layout.nodes[b]?.frame ?? scene.nodes[b]?.frame;
      if (aFrame === undefined || bFrame === undefined) return a.localeCompare(b);
      const aCenter = centerOf(aFrame);
      const bCenter = centerOf(bFrame);
      return horizontal
        ? aCenter.x - bCenter.x || a.localeCompare(b)
        : aCenter.y - bCenter.y || a.localeCompare(b);
    });
    const first = ordered[0];
    const firstFrame = first === undefined
      ? undefined
      : layout.nodes[first]?.frame ?? scene.nodes[first]?.frame;
    if (firstFrame === undefined) continue;
    const firstCenter = centerOf(firstFrame);
    const firstSide = horizontal
      ? firstCenter.y >= parentCenter.y ? "below" : "above"
      : firstCenter.x >= parentCenter.x ? "right" : "left";

    ordered.forEach((nodeId, index) => {
      const node = scene.nodes[nodeId];
      if (node === undefined || node.locked) return;
      const tether = tetherByNode.get(nodeId);
      if (tether !== undefined) {
        tetherTValues.set(tether.tetherEdgeId, (index + 1) / (ordered.length + 1));
      }
      const sameAxis = index % 2 === 0;
      const side = sameAxis
        ? firstSide
        : horizontal
          ? firstSide === "below" ? "above" : "below"
          : firstSide === "right" ? "left" : "right";
      const slot = Math.floor(index / 2);
      const step = horizontal
        ? node.frame.width + gap
        : node.frame.height + gap;
      const slotOffset = slot === 0
        ? 0
        : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2) * step;
      const away = (horizontal ? node.frame.height / 2 : node.frame.width / 2) + rankGap;
      const center = horizontal
        ? {
            x: parentCenter.x + slotOffset,
            y: parentCenter.y + (side === "below" ? away : -away),
          }
        : {
            x: parentCenter.x + (side === "right" ? away : -away),
            y: parentCenter.y + slotOffset,
          };
      const candidate = rect(
        snap(center.x - node.frame.width / 2, grid),
        snap(center.y - node.frame.height / 2, grid),
        node.frame.width,
        node.frame.height,
      );
      frames[nodeId] = placeTetheredClear(candidate, horizontal, side, nodeId);
      moved += 1;
    });
  }

  const ellipseAngle = (usecaseFrame: Rect, otherCenter: { x: number; y: number }): number => {
    const center = centerOf(usecaseFrame);
    const rx = Math.max(1, usecaseFrame.width / 2);
    const ry = Math.max(1, usecaseFrame.height / 2);
    const theta = Math.atan2((otherCenter.y - center.y) / ry, (otherCenter.x - center.x) / rx);
    return ((theta * 180) / Math.PI + 360) % 360;
  };
  const facingSide = (
    from: Rect,
    to: Rect,
  ): "north" | "east" | "south" | "west" => {
    const fromCenter = centerOf(from);
    const toCenter = centerOf(to);
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;
    return Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0 ? "east" : "west"
      : dy >= 0 ? "south" : "north";
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
    } else if (edge.source.port.kind === "perimeter") {
      patch.source = {
        target: "node",
        nodeId: edge.source.nodeId,
        port: { kind: "perimeter", side: facingSide(sourceFrame, targetFrame) },
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
    } else if (edge.target.port.kind === "perimeter") {
      patch.target = {
        target: "node",
        nodeId: edge.target.nodeId,
        port: { kind: "perimeter", side: facingSide(targetFrame, sourceFrame) },
      };
    }
    if (patch.source !== undefined || patch.target !== undefined) {
      edgeAttachments[edge.id] = patch;
    }
  }

  for (const [nodeId, tether] of tetherByNode) {
    const tetherEdge = scene.edges[tether.tetherEdgeId];
    const node = scene.nodes[nodeId];
    const parent = scene.edges[tether.parentEdgeId];
    const nodeFrame = frameFor(nodeId);
    if (
      tetherEdge === undefined ||
      node === undefined ||
      nodeFrame === undefined ||
      parent === undefined ||
      parent.source.target !== "node" ||
      parent.target.target !== "node"
    ) {
      continue;
    }
    const sourceFrame = frameFor(parent.source.nodeId);
    const targetFrame = frameFor(parent.target.nodeId);
    if (sourceFrame === undefined || targetFrame === undefined) continue;
    const nodeCenter = centerOf(nodeFrame);
    const parentCenter = {
      x: (centerOf(sourceFrame).x + centerOf(targetFrame).x) / 2,
      y: (centerOf(sourceFrame).y + centerOf(targetFrame).y) / 2,
    };
    const dx = nodeCenter.x - parentCenter.x;
    const dy = nodeCenter.y - parentCenter.y;
    const side: "north" | "east" | "south" | "west" =
      Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0 ? "east" : "west"
        : dy >= 0 ? "south" : "north";
    const t = tetherTValues.get(tether.tetherEdgeId) ??
      (tetherEdge.target.target === "edge" ? tetherEdge.target.t : 0.5);
    edgeAttachments[tether.tetherEdgeId] = {
      source: {
        target: "node",
        nodeId: node.id,
        port: { kind: "perimeter", side },
      },
      ...(tetherEdge.target.target === "edge"
        ? {
            target: {
              target: "edge" as const,
              edgeId: tetherEdge.target.edgeId,
              t,
            },
          }
        : {}),
    };
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
