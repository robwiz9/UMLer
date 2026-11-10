/**
 * Snap helpers for the skeleton canvas.
 *
 * Grid snapping is the baseline. Alignment guides are a higher-priority,
 * visual snap: when a dragged frame's left/centre/right (or top/middle/bottom)
 * is within a screen-pixel threshold of another node, it aligns to that line.
 * The returned guides are rendered as thin dashed lines.
 */

import type { NodeLayout, PortGeometry } from "../model/layout.ts";
import type { Point, Rect } from "../model/geometry.ts";
import { rectRight, snap } from "../model/geometry.ts";

export interface SnapGuide {
  readonly axis: "x" | "y";
  readonly position: number;
  readonly from: number;
  readonly to: number;
}

export interface FrameSnapOptions {
  readonly gridSize: number;
  readonly gridEnabled: boolean;
  readonly alignmentEnabled: boolean;
  /** World-space alignment threshold (usually 6 screen px / zoom). */
  readonly threshold: number;
  readonly others: readonly NodeLayout[];
}

export interface FrameSnapResult {
  readonly frame: Rect;
  readonly guides: readonly SnapGuide[];
}

const verticalCandidates = (frame: Rect): readonly number[] => [
  frame.x,
  frame.x + frame.width / 2,
  rectRight(frame),
];

const horizontalCandidates = (frame: Rect): readonly number[] => [
  frame.y,
  frame.y + frame.height / 2,
  frame.y + frame.height,
];

/**
 * Snaps a moved frame. Grid snap happens first, then alignment can override it
 * on either axis. `others` should exclude the moving node.
 */
export const snapMovingFrame = (
  frame: Rect,
  options: FrameSnapOptions,
): FrameSnapResult => {
  let next: Rect = options.gridEnabled
    ? {
        ...frame,
        x: snap(frame.x, options.gridSize),
        y: snap(frame.y, options.gridSize),
      }
    : frame;

  if (!options.alignmentEnabled) return { frame: next, guides: [] };

  const guides: SnapGuide[] = [];
  const movingX = verticalCandidates(next);
  const movingY = horizontalCandidates(next);

  let bestX: { delta: number; line: number; source: Rect } | null = null;
  let bestY: { delta: number; line: number; source: Rect } | null = null;

  for (const other of options.others) {
    if (other.kind === "frame") continue;
    for (const candidate of verticalCandidates(other.frame)) {
      for (const current of movingX) {
        const delta = candidate - current;
        if (Math.abs(delta) <= options.threshold && (bestX === null || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, line: candidate, source: other.frame };
        }
      }
    }
    for (const candidate of horizontalCandidates(other.frame)) {
      for (const current of movingY) {
        const delta = candidate - current;
        if (Math.abs(delta) <= options.threshold && (bestY === null || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, line: candidate, source: other.frame };
        }
      }
    }
  }

  if (bestX !== null) {
    next = { ...next, x: next.x + bestX.delta };
    guides.push({
      axis: "x",
      position: bestX.line,
      from: Math.min(next.y, bestX.source.y),
      to: Math.max(next.y + next.height, bestX.source.y + bestX.source.height),
    });
  }
  if (bestY !== null) {
    next = { ...next, y: next.y + bestY.delta };
    guides.push({
      axis: "y",
      position: bestY.line,
      from: Math.min(next.x, bestY.source.x),
      to: Math.max(next.x + next.width, bestY.source.x + bestY.source.width),
    });
  }

  return { frame: next, guides };
};

/** Resize snap: width/height follow the grid, with a one-cell minimum. */
export const snapResizedFrame = (
  frame: Rect,
  gridSize: number,
  gridEnabled: boolean,
): Rect => {
  const min = gridSize > 0 ? gridSize : 1;
  const width = Math.max(min, gridEnabled ? snap(frame.width, gridSize) : frame.width);
  const height = Math.max(min, gridEnabled ? snap(frame.height, gridSize) : frame.height);
  return { ...frame, width, height };
};

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

/**
 * Resizes from any corner while keeping the opposite corner fixed. The moving
 * edges snap to the grid, so a west/north resize also moves the frame origin.
 */
export const resizeFrameFromCorner = (
  start: Rect,
  corner: ResizeCorner,
  delta: Point,
  gridSize: number,
  gridEnabled: boolean,
  aspectRatio?: number,
  extraHeight = 0,
): Rect => {
  const min = gridSize > 0 ? gridSize : 1;
  const east = corner === "ne" || corner === "se";
  const south = corner === "se" || corner === "sw";
  const rawWidth = Math.max(min, start.width + (east ? delta.x : -delta.x));
  const rawHeight = Math.max(min, start.height + (south ? delta.y : -delta.y));

  let width = Math.max(min, gridEnabled ? snap(rawWidth, gridSize) : rawWidth);
  let height = Math.max(min, gridEnabled ? snap(rawHeight, gridSize) : rawHeight);

  if (aspectRatio !== undefined && aspectRatio > 0) {
    const widthDriven =
      Math.abs(rawWidth / Math.max(1, start.width) - 1) >=
      Math.abs(rawHeight / Math.max(1, start.height) - 1);
    if (widthDriven) {
      height = Math.max(min, width / aspectRatio) + extraHeight;
    } else {
      const imageHeight = Math.max(min, height - extraHeight);
      width = Math.max(min, imageHeight * aspectRatio);
      height = imageHeight + extraHeight;
    }
  }

  return {
    x: east ? start.x : start.x + start.width - width,
    y: south ? start.y : start.y + start.height - height,
    width,
    height,
  };
};

/** Ports that should be shown as snap handles for a selected/hovered node. */
export const snapHandlesForNode = (
  ports: Readonly<Record<string, PortGeometry>>,
  nodeId: string,
): readonly PortGeometry[] =>
  Object.values(ports).filter((port) => port.nodeId === nodeId);

/** Nearest port to a world-space point, within a world-space radius. */
export const nearestPort = (
  ports: Readonly<Record<string, PortGeometry>>,
  world: Point,
  radius: number,
): PortGeometry | null => {
  let best: PortGeometry | null = null;
  let bestDistance = radius;
  for (const port of Object.values(ports)) {
    const distance = Math.hypot(port.point.x - world.x, port.point.y - world.y);
    if (distance <= bestDistance) {
      best = port;
      bestDistance = distance;
    }
  }
  return best;
};

export const screenToWorld = (
  screen: Point,
  camera: { readonly x: number; readonly y: number },
  zoom: number,
): Point => ({
  x: (screen.x - camera.x) / zoom,
  y: (screen.y - camera.y) / zoom,
});

export const worldToScreen = (
  world: Point,
  camera: { readonly x: number; readonly y: number },
  zoom: number,
): Point => ({
  x: world.x * zoom + camera.x,
  y: world.y * zoom + camera.y,
});
