import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SceneDocument } from "../model/scene.ts";
import type { EdgeLabelLayout, EdgeLayout, LayoutSnapshot, NodeLayout, PortGeometry } from "../model/layout.ts";
import type { CanvasTextFocusRequest, CanvasTextTarget } from "../model/text-targets.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { ImageAsset, SceneNode, TableRow, TableSection, Visibility } from "../model/nodes.ts";
import { asNodeId, type ActivationId, type NodeId, type RowId, type SectionId } from "../model/ids.ts";
import { NodeFocusMenu } from "./NodeFocusMenu.tsx";
import { DraggablePanel } from "./DraggablePanel.tsx";
import type { Point, Rect } from "../model/geometry.ts";
import { add, expandRect, point, rectCenter, rectContainsPoint, rectFromPoints, rectsIntersect, scale, snap, sub } from "../model/geometry.ts";
import { rotatePoint } from "../layout/circuit.ts";
import { normalizeRotation, resolveCircuitSettings } from "../model/circuit.ts";
import { canExtendToEmpty, MIN_EXTEND_SCREEN_PX, minExtendWorld } from "./circuit-draw.ts";
import type { ObjectTemplateId } from "../model/object-catalog.ts";
import type { EdgeAttachmentRef, PortAttachmentRef } from "../model/edge-create.ts";
import { childrenOfBoundary } from "../model/containment.ts";
import { AddObjectMenu } from "./AddObjectMenu.tsx";
import type { Camera } from "./camera.ts";
import { fitBounds, zoomAtScreenPoint, type ViewportSize } from "./camera.ts";
import { Grid } from "./Grid.tsx";
import { NodeSkeleton } from "./NodeSkeleton.tsx";
import { EdgeLabelView, EdgeLayer, edgeLayerItem, edgeLinePoints, edgePathData } from "./Edges.tsx";
import { EdgeEndpointPopover } from "./EdgeEndpointPopover.tsx";
import { EdgeInspector } from "../app/EdgeInspector.tsx";
import { isSupportedImageFile } from "../app/image-assets.ts";
import { PortHandles } from "./PortHandles.tsx";
import type { EdgeEnd } from "../model/markers.ts";
import type { EdgeLabelZone, EdgeRoutingMode, SceneEdge } from "../model/edges.ts";
import type { ShiftBranchDrag, ShiftBranchGroup, WireOrientation } from "../model/circuit-wires.ts";
import { createShiftDragBranchesResult, createDuplicateParallelBranches, detachCircuitComponentEndings } from "../model/circuit-wires.ts";
import { circuitComponent } from "../model/circuit-catalog.ts";
import { copySceneNodes, pasteSceneClipboard } from "../model/clipboard.ts";
import type { EndpointMarker } from "../model/markers.ts";
import type { StrokePattern, TextStyleOverride } from "../model/styles.ts";
import {
  nearestPort,
  resizeFrameFromCorner,
  screenToWorld,
  snapHandlesForNode,
  snapMovingFrame,
  type ResizeCorner,
  type SnapGuide,
} from "../layout/snap.ts";

const LABEL_DOUBLE_PRESS_MS = 400;
/** Uniform terminal hover radius in scene units for every marker family. */
const TERMINAL_HOVER_RADIUS = 9;
/** Keep the terminal target usable at low zoom without shrinking the ring. */
const TERMINAL_HOVER_MIN_SCREEN_RADIUS = 8;

const sameNodeFocus = (a: NodeFocus | null, b: NodeFocus | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a.kind !== b.kind || a.nodeId !== b.nodeId) return false;
  if (a.kind === "row" && b.kind === "row") return a.rowId === b.rowId;
  if (a.kind === "section" && b.kind === "section") return a.sectionId === b.sectionId;
  if (a.kind === "lifelineSpine" && b.kind === "lifelineSpine") return a.y === b.y;
  return true;
};

/** Move an endpoint marker's hit/ring centre out of the attached object. */
const outwardPoint = (origin: Point, toward: Point, distance: number): Point => {
  const dx = toward.x - origin.x;
  const dy = toward.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) return origin;
  return {
    x: origin.x + (dx / length) * distance,
    y: origin.y + (dy / length) * distance,
  };
};

interface CanvasStageProps {
  readonly scene: SceneDocument;
  readonly layout: LayoutSnapshot;
  readonly camera: Camera;
  readonly zoom: number;
  readonly gridVisible: boolean;
  readonly gridSize: number;
  readonly majorEvery: number;
  readonly snapEnabled: boolean;
  readonly showCompactAddButton: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly imageAssets: Readonly<Record<string, ImageAsset>>;
  readonly onDropImageFiles: (files: readonly File[], world: Point) => void;
  readonly onAssignImageToNode: (nodeId: string, file: File) => Promise<void>;
  readonly onUseImageAsset: (nodeId: string, assetId: string) => void;
  readonly onRemoveImageFromNode: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly selectedEdgeId: string | null;
  readonly selectedEdgeIds: readonly string[];
  readonly selectedActivation: {
    readonly nodeId: string;
    readonly activationId: ActivationId;
  } | null;
  readonly fitNonce: number;
  readonly onSelectNode: (nodeId: string | null) => void;
  readonly onSelectNodes: (nodeIds: readonly string[], primary?: string | null) => void;
  readonly onToggleNodeSelection: (nodeId: string) => void;
  readonly onSelectEdge: (edgeId: string | null) => void;
  readonly onSelectEdges: (edgeIds: readonly string[]) => void;
  readonly onSelectActivation: (
    activation: { readonly nodeId: string; readonly activationId: ActivationId } | null,
  ) => void;
  readonly onSetMarker: (edgeId: string, end: EdgeEnd, marker: EndpointMarker) => void;
  readonly onSetEdgeLabel: (edgeId: string, zone: EdgeLabelZone, text: string) => void;
  readonly onSetEdgeLabelStyle: (
    edgeId: string,
    zone: EdgeLabelZone,
    style: TextStyleOverride | undefined,
  ) => void;
  readonly onConvertToRelationAttribute: (
    edgeId: string,
    world: Point,
    anchor: Point,
  ) => void;
  readonly onSetStrokePattern: (edgeId: string, pattern: StrokePattern) => void;
  readonly onSetStrokeWidth: (edgeId: string, width: number) => void;
  readonly onSetRoutingMode: (edgeId: string, mode: EdgeRoutingMode) => void;
  readonly onRerouteEdge: (edgeId: string) => void;
  readonly onAddJunctionAtWire: (edgeId: string, point: Point) => void;
  readonly onBeginShiftDrag: (scene: SceneDocument) => void;
  readonly onCommitShiftDrag: (
    frames: Readonly<Record<string, Rect>>,
    groups: readonly ShiftBranchGroup[],
  ) => void;
  readonly onBeginDuplicateDrag: (
    scene: SceneDocument,
    nodeIds: readonly string[],
  ) => void;
  readonly onCommitDuplicateDrag: (frames: Readonly<Record<string, Rect>>) => void;
  readonly onBeginDetachDrag: (scene: SceneDocument) => void;
  readonly onCommitDetachDrag: (frames: Readonly<Record<string, Rect>>) => void;
  readonly onInsertComponentOnWire: (
    nodeId: string,
    edgeId: string,
    point: Point,
    orientation: WireOrientation,
  ) => void;
  readonly onReattachEdge: (
    edgeId: string,
    end: EdgeEnd,
    target: PortAttachmentRef | EdgeAttachmentRef,
  ) => void;
  readonly onMoveSequenceEdge: (edgeId: string, deltaY: number) => void;
  readonly onSlideStraightEdge: (edgeId: string, position: number) => void;
  readonly onMoveEdgeLabel: (
    edgeId: string,
    labelId: string,
    offset: Point,
  ) => void;
  readonly onTextDoubleClick: (nodeId: string, target: CanvasTextTarget) => void;
  readonly nodeFocus: NodeFocus | null;
  readonly focusRequest: CanvasTextFocusRequest | null;
  readonly onNodePartClick: (focus: NodeFocus, additive?: boolean) => void;
  readonly onClearNodeFocus: () => void;
  readonly onUpdateNode: (nodeId: string, patch: Partial<SceneNode>) => void;
  readonly onUpdateRow: (nodeId: string, rowId: RowId, patch: Partial<TableRow>) => void;
  readonly onAddRow: (nodeId: string, sectionId?: SectionId, afterRowId?: RowId) => void;
  readonly onDeleteRow: (nodeId: string, rowId: RowId) => void;
  readonly onMoveRow: (nodeId: string, rowId: RowId, direction: "up" | "down") => void;
  readonly onFocusRow: (nodeId: string, rowId: RowId) => void;
  readonly onAddSection: (nodeId: string) => void;
  readonly onUpdateSection: (nodeId: string, sectionId: SectionId, patch: Partial<TableSection>) => void;
  readonly onSetSectionVisibility: (
    nodeId: string,
    sectionId: SectionId,
    visibility: Visibility | undefined,
  ) => void;
  readonly onDeleteSection: (nodeId: string, sectionId: SectionId) => void;
  readonly onAddObject: (templateId: ObjectTemplateId, world: Point) => SceneNode | null;
  readonly onAddActivation: (nodeId: string, worldY: number) => void;
  readonly onUpdateActivation: (
    nodeId: string,
    activationId: ActivationId,
    top: number,
    height: number,
  ) => void;
  readonly onCreateEdge: (
    source: PortAttachmentRef,
    target: PortAttachmentRef | EdgeAttachmentRef,
  ) => void;
  readonly onExtendWireToPoint: (source: PortAttachmentRef, point: Point) => void;
  readonly onReattachEdgeToPoint: (edgeId: string, end: EdgeEnd, point: Point) => void;
  readonly onPreviewRotation: (nodeId: string, rotation: number | null) => void;
  readonly onCommitRotation: (nodeId: string, rotation: number) => void;
  readonly onDeleteNode: (nodeId: string) => void;
  readonly onMergeJunction: (nodeId: string) => void;
  readonly onMoveNodeLabel: (nodeId: string, offset: Point) => void;
  readonly onViewChange: (camera: Camera, zoom: number) => void;
  readonly onPreviewFrames: (frames: Readonly<Record<string, Rect>>) => void;
  readonly onCommitFrames: (frames: Readonly<Record<string, Rect>>) => void;
  readonly onCommitWireTranslation: (
    frames: Readonly<Record<string, Rect>>,
    edgeId: string,
  ) => void;
  readonly onViewport: (viewport: ViewportSize) => void;
}

export interface CanvasStageHandle {
  readonly openAddObjectMenu: () => void;
  /** Last pointer position over the canvas, in scene coordinates. */
  readonly getPointerWorld: () => Point | null;
}

type Interaction =
  | {
      readonly kind: "pan";
      readonly pointerId: number;
      readonly startScreen: Point;
      readonly startCamera: Camera;
    }
  | {
      readonly kind: "marquee";
      readonly pointerId: number;
      readonly startWorld: Point;
      currentWorld: Point;
      readonly additive: boolean;
      readonly baseIds: readonly string[];
      moved: boolean;
    }
  | {
      readonly kind: "drag";
      readonly pointerId: number;
      readonly nodeId: string;
      readonly startWorld: Point;
      readonly startFrame: Rect;
      childIds: string[];
      childStartFrames: Readonly<Record<string, Rect>>;
      captured: boolean;
      lastFrame: Rect;
      lastChildFrames: Record<string, Rect>;
    }
  | {
      readonly kind: "resize";
      readonly pointerId: number;
      readonly nodeId: string;
      readonly corner: ResizeCorner;
      readonly startWorld: Point;
      readonly startFrame: Rect;
      captured: boolean;
      lastFrame: Rect;
    }
  | {
      readonly kind: "draw";
      readonly pointerId: number;
      readonly source: PortGeometry;
      readonly startScreen: Point;
      lastWorld: Point;
      pointerTravel: number;
    }
  | {
      readonly kind: "edge-translate";
      readonly pointerId: number;
      readonly edgeId: string;
      readonly axis: "x" | "y";
      readonly startWorld: Point;
      readonly startScreen: Point;
      readonly startFrames: Readonly<Record<string, Rect>>;
      lastFrames: Record<string, Rect>;
      moved: boolean;
    }
  | {
      readonly kind: "rotate";
      readonly pointerId: number;
      readonly nodeId: string;
      readonly center: Point;
      readonly radius: number;
      readonly startPointerAngle: number;
      readonly startRotation: number;
      lastRotation: number;
    }
  | {
      readonly kind: "activation-move" | "activation-resize";
      readonly pointerId: number;
      readonly nodeId: string;
      readonly activationId: ActivationId;
      readonly edge: "top" | "bottom";
      readonly startWorld: Point;
      readonly startTop: number;
      readonly startHeight: number;
      readonly frameHeight: number;
      lastTop: number;
      lastHeight: number;
    }
  | {
      readonly kind: "reattach";
      readonly pointerId: number;
      readonly edgeId: string;
      readonly end: EdgeEnd;
      readonly startWorld: Point;
      readonly startScreen: Point;
      lastWorld: Point;
      pointerTravel: number;
      moved: boolean;
    }
  | {
      readonly kind: "edge-move";
      readonly pointerId: number;
      readonly edgeId: string;
      readonly startWorld: Point;
      moved: boolean;
      lastDelta: number;
    }
  | {
      readonly kind: "edge-slide";
      readonly pointerId: number;
      readonly edgeId: string;
      readonly axis: "x" | "y";
      readonly startWorld: Point;
      readonly startPosition: number;
      readonly min: number;
      readonly max: number;
      lastPosition: number;
      moved: boolean;
    }
  | {
      readonly kind: "edge-press";
      readonly pointerId: number;
      readonly edgeId: string;
      readonly end: EdgeEnd | null;
      readonly startWorld: Point;
      readonly startScreen: Point;
      lastWorld: Point;
      pointerTravel: number;
      moved: boolean;
    }
  | {
      readonly kind: "label-drag";
      readonly pointerId: number;
      readonly edgeId: string;
      readonly labelId: string;
      readonly menu: "line" | "terminal";
      readonly end?: EdgeEnd;
      readonly startWorld: Point;
      readonly startOffset: Point;
      moved: boolean;
      lastDelta: Point;
    }
  | {
      readonly kind: "node-label-drag";
      readonly pointerId: number;
      readonly nodeId: string;
      readonly startWorld: Point;
      readonly startOffset: Point;
      readonly rotation: number;
      moved: boolean;
      lastDelta: Point;
    };

interface DrawTarget {
  readonly point: Point;
  readonly attachment: PortAttachmentRef | EdgeAttachmentRef;
}

interface DraftEdge {
  readonly from: Point;
  readonly to: Point;
  readonly snapped: boolean;
}

const pointFromEvent = (event: { readonly clientX: number; readonly clientY: number }, svg: SVGSVGElement): Point => {
  const rect = svg.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Lifelines are selected by their head; the tall time axis is not a target. */
const selectionFrameFor = (node: NodeLayout): Rect =>
  node.kind === "lifeline" ? node.headFrame : node.frame;

interface StraightSlideInfo {
  readonly axis: "x" | "y";
  readonly min: number;
  readonly max: number;
}

/**
 * A straight connector between two table-like objects on facing parallel
 * borders can be slid along that shared border. Corners, row ports and mixed
 * orientations are deliberately excluded.
 */
const straightSlideInfo = (
  edge: SceneEdge,
  scene: SceneDocument,
  points: readonly Point[],
  gridSize: number,
): StraightSlideInfo | null => {
  if (points.length !== 2) return null;
  if (edge.source.target !== "node" || edge.target.target !== "node") return null;
  if (edge.source.port.kind !== "perimeter" || edge.target.port.kind !== "perimeter") {
    return null;
  }
  const sourceNode = scene.nodes[edge.source.nodeId];
  const targetNode = scene.nodes[edge.target.nodeId];
  if (
    sourceNode === undefined ||
    targetNode === undefined ||
    (sourceNode.kind !== "table" && sourceNode.kind !== "relationAttribute") ||
    (targetNode.kind !== "table" && targetNode.kind !== "relationAttribute")
  ) {
    return null;
  }
  const sourceSide = edge.source.port.side;
  const targetSide = edge.target.port.side;
  const horizontal =
    (sourceSide === "east" && targetSide === "west") ||
    (sourceSide === "west" && targetSide === "east");
  const vertical =
    (sourceSide === "south" && targetSide === "north") ||
    (sourceSide === "north" && targetSide === "south");
  if (!horizontal && !vertical) return null;

  const source = sourceNode.frame;
  const target = targetNode.frame;
  const gapFacing = horizontal
    ? sourceSide === "east"
      ? target.x >= source.x + source.width - 0.001
      : target.x + target.width <= source.x + 0.001
    : sourceSide === "south"
      ? target.y >= source.y + source.height - 0.001
      : target.y + target.height <= source.y + 0.001;
  if (!gapFacing) return null;

  const grid = Math.max(1, gridSize);
  const insetFor = (frame: Rect): number =>
    Math.min(
      Math.max(6, grid),
      Math.max(0, Math.min(frame.width, frame.height) / 2 - 0.5),
    );
  const sourceInset = insetFor(source);
  const targetInset = insetFor(target);
  const sourceLow = horizontal ? source.y + sourceInset : source.x + sourceInset;
  const sourceHigh = horizontal
    ? source.y + source.height - sourceInset
    : source.x + source.width - sourceInset;
  const targetLow = horizontal ? target.y + targetInset : target.x + targetInset;
  const targetHigh = horizontal
    ? target.y + target.height - targetInset
    : target.x + target.width - targetInset;
  const min = Math.max(sourceLow, targetLow);
  const max = Math.min(sourceHigh, targetHigh);
  if (max < min) return null;
  return { axis: horizontal ? "y" : "x", min, max };
};

const pointInPolygon = (value: Point, polygon: readonly Point[]): boolean => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a === undefined || b === undefined) continue;
    const crosses =
      (a.y > value.y) !== (b.y > value.y) &&
      value.x < ((b.x - a.x) * (value.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const distanceToSegment = (value: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  if (squared <= 1e-9) return Math.hypot(value.x - a.x, value.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((value.x - a.x) * dx + (value.y - a.y) * dy) / squared),
  );
  return Math.hypot(value.x - (a.x + t * dx), value.y - (a.y + t * dy));
};

const circuitOutlineContains = (
  value: Point,
  outline: readonly Point[],
  margin: number,
): boolean => {
  if (pointInPolygon(value, outline)) return true;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    if (a !== undefined && b !== undefined && distanceToSegment(value, a, b) <= margin) {
      return true;
    }
  }
  return false;
};

/** True when a circuit wire would be dropped on a component body, not a pin. */
const overCircuitComponentBody = (
  nodes: Readonly<Record<string, NodeLayout>>,
  world: Point,
  excludeNodeId: string,
): boolean =>
  Object.values(nodes).some(
    (node) =>
      node.kind === "circuitComponent" &&
      node.nodeId !== excludeNodeId &&
      rectContainsPoint(node.bounds, world),
  );

const frameFullyInside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - 0.001 &&
  inner.y >= outer.y - 0.001 &&
  inner.x + inner.width <= outer.x + outer.width + 0.001 &&
  inner.y + inner.height <= outer.y + outer.height + 0.001;

const orientation = (a: Point, b: Point, c: Point): number =>
  (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const segmentsIntersect = (
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  const onSegment = (p: Point, q: Point, r: Point): boolean =>
    Math.min(p.x, r.x) - 0.001 <= q.x &&
    q.x <= Math.max(p.x, r.x) + 0.001 &&
    Math.min(p.y, r.y) - 0.001 <= q.y &&
    q.y <= Math.max(p.y, r.y) + 0.001;
  return (
    (Math.abs(o1) <= 0.001 && onSegment(a, c, b)) ||
    (Math.abs(o2) <= 0.001 && onSegment(a, d, b)) ||
    (Math.abs(o3) <= 0.001 && onSegment(c, a, d)) ||
    (Math.abs(o4) <= 0.001 && onSegment(c, b, d))
  );
};

const segmentCrossesRect = (a: Point, b: Point, rect: Rect): boolean => {
  if (rectContainsPoint(rect, a) || rectContainsPoint(rect, b)) return true;
  const corners = [
    point(rect.x, rect.y),
    point(rect.x + rect.width, rect.y),
    point(rect.x + rect.width, rect.y + rect.height),
    point(rect.x, rect.y + rect.height),
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const c = corners[index];
    const d = corners[(index + 1) % corners.length];
    if (c !== undefined && d !== undefined && segmentsIntersect(a, b, c, d)) {
      return true;
    }
  }
  return false;
};

const polylineCrossesRect = (points: readonly Point[], rect: Rect): boolean => {
  if (points.some((entry) => rectContainsPoint(rect, entry))) return true;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined && segmentCrossesRect(a, b, rect)) {
      return true;
    }
  }
  return false;
};

/** Port reference in the form the document stores. */
const attachmentFor = (port: PortGeometry): PortAttachmentRef => ({
  nodeId: port.nodeId,
  port: port.ref,
});

const closestPointOnPolyline = (
  points: readonly Point[],
  target: Point,
): { readonly distance: number; readonly t: number; readonly point: Point; readonly segmentIndex: number } | null => {
  const first = points[0];
  if (first === undefined) return null;
  if (points.length === 1) {
    return {
      distance: Math.hypot(first.x - target.x, first.y - target.y),
      t: 0,
      point: first,
      segmentIndex: 0,
    };
  }
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let travelled = 0;
  let best: { distance: number; t: number; point: Point; segmentIndex: number } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLength = Math.hypot(dx, dy);
    const ratio = segmentLength === 0
      ? 0
      : clampValue(((target.x - a.x) * dx + (target.y - a.y) * dy) / (segmentLength * segmentLength), 0, 1);
    const point = { x: a.x + dx * ratio, y: a.y + dy * ratio };
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (best === null || distance < best.distance) {
      best = {
        distance,
        t: total === 0 ? 0 : (travelled + segmentLength * ratio) / total,
        point,
        segmentIndex: index - 1,
      };
    }
    travelled += segmentLength;
  }
  return best;
};

/**
 * Project a source point onto the same polyline segment the pointer is over so
 * the new wire leaves the target wire perpendicularly.
 */
const perpendicularPointOnPolyline = (
  points: readonly Point[],
  segmentIndex: number,
  source: Point,
  target: Point,
  maxSnapDistance: number,
): { readonly t: number; readonly point: Point } | null => {
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  if (a === undefined || b === undefined) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segmentLength = Math.hypot(dx, dy);
  if (segmentLength < 1e-6) return null;
  let point: Point;
  let ratio: number;
  if (Math.abs(dy) < 1e-6) {
    point = { x: clampValue(source.x, Math.min(a.x, b.x), Math.max(a.x, b.x)), y: a.y };
    ratio = dx === 0 ? 0 : (point.x - a.x) / dx;
  } else if (Math.abs(dx) < 1e-6) {
    point = { x: a.x, y: clampValue(source.y, Math.min(a.y, b.y), Math.max(a.y, b.y)) };
    ratio = dy === 0 ? 0 : (point.y - a.y) / dy;
  } else {
    return null;
  }
  if (Math.hypot(point.x - target.x, point.y - target.y) > maxSnapDistance) {
    return null;
  }
  const total = points.slice(1).reduce((sum, entry, index) => {
    const previous = points[index];
    return previous === undefined
      ? sum
      : sum + Math.hypot(entry.x - previous.x, entry.y - previous.y);
  }, 0);
  const before = points.slice(1, segmentIndex + 1).reduce((sum, entry, index) => {
    const previous = points[index];
    return previous === undefined
      ? sum
      : sum + Math.hypot(entry.x - previous.x, entry.y - previous.y);
  }, 0);
  return {
    point,
    t: total === 0 ? 0 : (before + segmentLength * ratio) / total,
  };
};

const EdgeHitLayer = ({
  edges,
  onSelect,
  onReroute,
  allowContextReroute,
  slideEdgeIds,
}: {
  readonly edges: readonly { readonly id: string; readonly points: readonly Point[] }[];
  readonly onSelect: (edgeId: string, event: React.PointerEvent<SVGPolylineElement>) => void;
  readonly onReroute: (edgeId: string) => void;
  readonly allowContextReroute?: boolean;
  readonly slideEdgeIds?: ReadonlySet<string>;
}) => (
  <g>
    {edges.map((edge) => {
      const points = edge.points.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <g key={edge.id} className="edge-hover-group">
          <polyline
            className="edge-hover-halo"
            points={points}
            fill="none"
            strokeWidth={7}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <polyline
            className="edge-hover-core"
            points={points}
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <polyline
            data-edge-hit={edge.id}
            points={points}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: slideEdgeIds?.has(edge.id) ? "grab" : "pointer" }}
            pointerEvents="stroke"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onSelect(edge.id, event);
            }}
            onContextMenu={(event) => {
              if (allowContextReroute !== true) return;
              event.preventDefault();
              event.stopPropagation();
              onReroute(edge.id);
            }}
          />
        </g>
      );
    })}
  </g>
);

interface InsertionTarget {
  readonly edgeId: string;
  readonly point: Point;
  readonly orientation: WireOrientation;
}

const nearestInsertionTarget = (
  edges: readonly EdgeLayout[],
  world: Point,
  tolerance: number,
): InsertionTarget | null => {
  let best: InsertionTarget | null = null;
  let bestDistance = tolerance;
  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      const a = edge.points[index - 1];
      const b = edge.points[index];
      if (a === undefined || b === undefined) continue;
      const horizontal = Math.abs(a.y - b.y) < 0.001;
      const vertical = Math.abs(a.x - b.x) < 0.001;
      if (!horizontal && !vertical) continue;
      const point = horizontal
        ? {
            x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), world.x)),
            y: a.y,
          }
        : {
            x: a.x,
            y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), world.y)),
          };
      const distance = Math.hypot(point.x - world.x, point.y - world.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          edgeId: edge.edgeId,
          point,
          orientation: horizontal ? "horizontal" : "vertical",
        };
      }
    }
  }
  return best;
};

const coincidentDragHighlights = (
  scene: SceneDocument,
  layout: LayoutSnapshot,
  interaction: {
    readonly nodeId: string;
    readonly frame: Rect;
    readonly childIds: readonly string[];
    readonly childFrames: Readonly<Record<string, Rect>>;
  },
): readonly Point[] => {
  const grid = scene.canvas.grid.size;
  const tolerance = Math.max(0.5, grid * 0.25);
  const movingIds = new Set([interaction.nodeId, ...interaction.childIds]);
  const frames: Record<string, Rect> = {
    [interaction.nodeId]: interaction.frame,
    ...interaction.childFrames,
  };
  const movingPoints: Point[] = [];
  for (const id of movingIds) {
    const node = scene.nodes[id];
    const frame = frames[id] ?? node?.frame;
    if (node === undefined || frame === undefined) continue;
    if (node.kind === "circuitJunction") {
      if (node.measurement !== undefined) continue;
      movingPoints.push(rectCenter(frame));
    } else if (node.kind === "circuitComponent") {
      const definition = circuitComponent(node.component);
      if (definition === undefined) continue;
      const center = rectCenter(frame);
      for (const pin of definition.pins) {
        movingPoints.push(
          add(center, rotatePoint(point(pin.x, pin.y), node.rotation)),
        );
      }
    }
  }
  const staticPoints: Point[] = [];
  for (const nodeLayout of Object.values(layout.nodes)) {
    if (movingIds.has(nodeLayout.nodeId)) continue;
    if (nodeLayout.kind === "circuitJunction") {
      if (nodeLayout.measurement !== undefined) continue;
      staticPoints.push(nodeLayout.center);
    } else if (nodeLayout.kind === "circuitComponent") {
      for (const pin of nodeLayout.pins) staticPoints.push(pin.point);
    }
  }
  const result: Point[] = [];
  const seen = new Set<string>();
  const addPoint = (entry: Point): void => {
    const key = `${Math.round(entry.x * 100) / 100}:${Math.round(entry.y * 100) / 100}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  };
  for (const moving of movingPoints) {
    for (const stationary of staticPoints) {
      if (Math.hypot(moving.x - stationary.x, moving.y - stationary.y) <= tolerance) {
        addPoint(moving);
        addPoint(stationary);
      }
    }
  }
  return result;
};

const circuitRotateHandleGeometry = (
  frame: Rect,
  rotation: number,
  zoom: number,
): { readonly center: Point; readonly radius: number; readonly point: Point } => {
  const center = rectCenter(frame);
  const baseAngle = Math.atan2(-frame.height / 2, frame.width / 2);
  const radius = Math.hypot(frame.width / 2, frame.height / 2) + 18 / zoom;
  const angle = baseAngle + (rotation * Math.PI) / 180;
  return {
    center,
    radius,
    point: {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    },
  };
};

const EndpointHandle = ({  point,
  label,
  zoom,
  color,
  onDragStart,
}: {
  readonly point: Point;
  readonly label: string;
  readonly zoom: number;
  readonly color: string;
  readonly onDragStart: (event: React.PointerEvent<SVGGElement>) => void;
}) => (
  <g
    data-endpoint-handle={label}
    style={{ cursor: "grab" }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      onDragStart(event);
    }}
  >
    <title>{`${label} · drag to reconnect`}</title>
    <circle cx={point.x} cy={point.y} r={8 / zoom} fill="transparent" />
    <rect
      x={point.x - 4 / zoom}
      y={point.y - 4 / zoom}
      width={8 / zoom}
      height={8 / zoom}
      rx={1.5 / zoom}
      fill="white"
      stroke={color}
      strokeWidth={1.4 / zoom}
    />
  </g>
);

const CenterLabelHitLayer = ({
  edges,
  zoom,
  onDragStart,
  onDoublePress,
}: {
  readonly edges: readonly { readonly id: string; readonly layout: EdgeLayout }[];
  readonly zoom: number;
  readonly onDragStart: (
    edgeId: string,
    labelId: string,
    event: React.PointerEvent<SVGRectElement>,
  ) => void;
  readonly onDoublePress: (edgeId: string, world: Point) => void;
}) => (
  <g>
    {edges.map(({ id, layout }) => {
      const label = layout.labels.find((entry) => entry.zone === "center");
      if (label === undefined) return null;
      const centerWorld = {
        x: label.frame.x + label.frame.width / 2,
        y: label.frame.y + label.frame.height / 2,
      };
      return (
        <rect
          key={`center-label-hit-${id}`}
          data-center-label-hit={id}
          className="edge-label-hover"
          x={label.frame.x - 3 / zoom}
          y={label.frame.y - 3 / zoom}
          width={label.frame.width + 6 / zoom}
          height={label.frame.height + 6 / zoom}
          rx={2 / zoom}
          fill="transparent"
          pointerEvents="all"
          style={{ cursor: "grab" }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            onDragStart(id, label.labelId, event);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDoublePress(id, centerWorld);
          }}
        />
      );
    })}
  </g>
);

const NodeLabelHitLayer = ({
  nodes,
  zoom,
  onDragStart,
  onDoublePress,
}: {
  readonly nodes: readonly {
    readonly id: string;
    readonly frame: Rect;
  }[];
  readonly zoom: number;
  readonly onDragStart: (
    nodeId: string,
    event: React.PointerEvent<SVGRectElement>,
  ) => void;
  readonly onDoublePress: (nodeId: string) => void;
}) => (
  <g>
    {nodes.map(({ id, frame }) => (
      <rect
        key={`node-label-hit-${id}`}
        data-node-label-hit={id}
        className="edge-label-hover"
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        rx={2 / zoom}
        fill="transparent"
        pointerEvents="all"
        style={{ cursor: "grab" }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          onDragStart(id, event);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDoublePress(id);
        }}
      />
    ))}
  </g>
);

const TerminalHitLayer = ({
  edges,
  zoom,
  onReattachStart,
  onHoverTerminal,
  onLabelDragStart,
  onDoublePress,
}: {
  readonly edges: readonly {
    readonly id: string;
    readonly layout: EdgeLayout;
  }[];
  readonly zoom: number;
  readonly onReattachStart: (
    edgeId: string,
    end: EdgeEnd,
    event: React.PointerEvent<SVGCircleElement>,
  ) => void;
  readonly onHoverTerminal: (
    edgeId: string,
    end: EdgeEnd | null,
    center?: Point,
    radius?: number,
  ) => void;
  readonly onLabelDragStart: (
    edgeId: string,
    labelId: string,
    event: React.PointerEvent<SVGRectElement>,
    end: EdgeEnd,
  ) => void;
  readonly onDoublePress: (edgeId: string, end: EdgeEnd) => void;
}) => (
  <g>
    {edges.map(({ id, layout }) => {
      const source = layout.points[0];
      const target = layout.points[layout.points.length - 1];
      const second = layout.points[1];
      const previous = layout.points[layout.points.length - 2];
      const terminalRadius = Math.max(
        TERMINAL_HOVER_RADIUS,
        TERMINAL_HOVER_MIN_SCREEN_RADIUS / zoom,
      );
      const sourceCenter = source === undefined || second === undefined
        ? source
        : outwardPoint(source, second, terminalRadius);
      const targetCenter = target === undefined || previous === undefined
        ? target
        : outwardPoint(target, previous, terminalRadius);
      const sourceLabel = layout.labels.find((label) => label.zone === "source");
      const targetLabel = layout.labels.find((label) => label.zone === "target");
      return (
        <g key={`terminal-hit-${id}`}>
          {sourceCenter === undefined ? null : (
            <circle
              data-terminal-hit={`${id}:source`}
              cx={sourceCenter.x}
              cy={sourceCenter.y}
              r={terminalRadius}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: "pointer" }}
              onPointerEnter={() => onHoverTerminal(id, "source", sourceCenter, terminalRadius)}
              onPointerLeave={() => onHoverTerminal(id, null)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                onReattachStart(id, "source", event);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDoublePress(id, "source");
              }}
            />
          )}
          {targetCenter === undefined ? null : (
            <circle
              data-terminal-hit={`${id}:target`}
              cx={targetCenter.x}
              cy={targetCenter.y}
              r={terminalRadius}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: "pointer" }}
              onPointerEnter={() => onHoverTerminal(id, "target", targetCenter, terminalRadius)}
              onPointerLeave={() => onHoverTerminal(id, null)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                onReattachStart(id, "target", event);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDoublePress(id, "target");
              }}
            />
          )}
          {[sourceLabel, targetLabel].map((label, index) => {
            if (label === undefined) return null;
            return (
              <rect
                key={`${id}-terminal-label-hit-${index}`}
                data-terminal-label-hit={`${id}:${label.zone}`}
                className="edge-label-hover"
                x={label.frame.x - 3 / zoom}
                y={label.frame.y - 3 / zoom}
                width={label.frame.width + 6 / zoom}
                height={label.frame.height + 6 / zoom}
                rx={2 / zoom}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: "grab" }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  onLabelDragStart(
                    id,
                    label.labelId,
                    event,
                    label.zone === "source" ? "source" : "target",
                  );
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDoublePress(id, label.zone === "source" ? "source" : "target");
                }}
              />
            );
          })}
        </g>
      );
    })}
  </g>
);


export const CanvasStage = forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage({
  scene,
  layout,
  camera,
  zoom,
  gridVisible,
  gridSize,
  majorEvery,
  snapEnabled,
  showCompactAddButton,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  imageAssets,
  onDropImageFiles,
  onAssignImageToNode,
  onUseImageAsset,
  onRemoveImageFromNode,
  selectedNodeId,
  selectedNodeIds,
  selectedEdgeId,
  selectedEdgeIds,
  selectedActivation,
  fitNonce,
  onSelectNode,
  onSelectNodes,
  onToggleNodeSelection,
  onSelectEdge,
  onSelectEdges,
  onSelectActivation,
  onSetMarker,
  onSetEdgeLabel,
  onSetEdgeLabelStyle,
  onConvertToRelationAttribute,
  onSetStrokePattern,
  onSetStrokeWidth,
  onSetRoutingMode,
  onRerouteEdge,
  onAddJunctionAtWire,
  onBeginShiftDrag,
  onCommitShiftDrag,
  onBeginDuplicateDrag,
  onCommitDuplicateDrag,
  onBeginDetachDrag,
  onCommitDetachDrag,
  onInsertComponentOnWire,
  onReattachEdge,
  onMoveSequenceEdge,
  onSlideStraightEdge,
  onMoveEdgeLabel,
  onTextDoubleClick,
  nodeFocus,
  focusRequest,
  onNodePartClick,
  onClearNodeFocus,
  onUpdateNode,
  onUpdateRow,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onFocusRow,
  onAddSection,
  onUpdateSection,
  onSetSectionVisibility,
  onDeleteSection,
  onAddObject,
  onAddActivation,
  onUpdateActivation,
  onCreateEdge,
  onExtendWireToPoint,
  onReattachEdgeToPoint,
  onPreviewRotation,
  onCommitRotation,
  onDeleteNode,
  onMergeJunction,
  onMoveNodeLabel,
  onViewChange,
  onPreviewFrames,
  onCommitFrames,
  onCommitWireTranslation,
  onViewport,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const openAddMenuRef = useRef<((origin: "panel" | "canvas") => void) | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const suppressNodePartClickRef = useRef(false);
  const layoutRef = useRef(layout);
  const sceneRef = useRef(scene);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const hoveredObjectNodeIdRef = useRef<string | null>(null);
  const branchIntentRef = useRef<ShiftBranchDrag | null>(null);
  const branchDragRef = useRef<{ readonly groups: readonly ShiftBranchGroup[] } | null>(null);
  const duplicateIntentRef = useRef<{
    readonly nodeIds: readonly string[];
    readonly primaryId: string;
    readonly parallelBranch: boolean;
  } | null>(null);
  const ctrlClickToggleRef = useRef<string | null>(null);
  const duplicateDragRef = useRef(false);
  const detachIntentRef = useRef<readonly NodeId[] | null>(null);
  const detachDragRef = useRef(false);
  const portClickFocusRef = useRef<{
    readonly nodeId: NodeId;
    readonly additive: boolean;
  } | null>(null);
  const lastFittedSceneIdRef = useRef<string | null>(null);
  const wireInsertNodeIdRef = useRef<string | null>(null);
  const insertTargetRef = useRef<InsertionTarget | null>(null);
  const [insertTarget, setInsertTarget] = useState<InsertionTarget | null>(null);
  const [coincidentHighlights, setCoincidentHighlights] = useState<readonly Point[]>([]);
  const [rotationHandleOverride, setRotationHandleOverride] = useState<
    { readonly nodeId: string; readonly point: Point } | null
  >(null);
  useEffect(() => {
    if (wireInsertNodeIdRef.current === null && insertTarget !== null) {
      insertTargetRef.current = null;
      setInsertTarget(null);
    }
  }, [insertTarget]);
  const [branchDistance, setBranchDistance] = useState(0);
  const [branchTargetIds, setBranchTargetIds] = useState<readonly string[]>([]);
  const cameraRef = useRef(camera);
  const zoomRef = useRef(zoom);
  const onViewChangeRef = useRef(onViewChange);
  const onViewportRef = useRef(onViewport);
  const lastPointerScreenRef = useRef<Point | null>(null);

  useImperativeHandle(ref, () => ({
    openAddObjectMenu: () => openAddMenuRef.current?.("panel"),
    getPointerWorld: () => {
      const screen = lastPointerScreenRef.current;
      return screen === null
        ? null
        : screenToWorld(screen, cameraRef.current, zoomRef.current);
    },
  }), []);

  layoutRef.current = layout;
  sceneRef.current = scene;
  selectedNodeIdsRef.current = selectedNodeIds;
  cameraRef.current = camera;
  zoomRef.current = zoom;
  onViewChangeRef.current = onViewChange;
  onViewportRef.current = onViewport;

  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [cursorWorld, setCursorWorld] = useState<Point>({ x: 0, y: 0 });
  const [guides, setGuides] = useState<readonly SnapGuide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [hoveredPort, setHoveredPort] = useState<PortGeometry | null>(null);
  const [hoveredObjectNodeId, setHoveredObjectNodeId] = useState<string | null>(null);
  hoveredObjectNodeIdRef.current = hoveredObjectNodeId;
  const [hoveredNodePart, setHoveredNodePart] = useState<NodeFocus | null>(null);
  const [hoveredTerminal, setHoveredTerminal] = useState<{
    readonly edgeId: string;
    readonly end: EdgeEnd;
    readonly center: Point;
    readonly radius: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState<EdgeEnd | null>(null);
  const [linePopover, setLinePopover] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [terminalFocusToken, setTerminalFocusToken] = useState(0);
  const [lineFocusToken, setLineFocusToken] = useState(0);
  const [addMenu, setAddMenu] = useState<{
    readonly left: number;
    readonly top: number;
    readonly world: Point;
    readonly source: "button" | "context";
  } | null>(null);
  const [draftEdge, setDraftEdge] = useState<DraftEdge | null>(null);
  const draftTargetRef = useRef<DrawTarget | null>(null);
  const edgePressRef = useRef<{ readonly edgeId: string; readonly time: number } | null>(null);
  const pendingEdgeSplitRef = useRef<{
    readonly edgeId: string;
    readonly point: Point;
    readonly pointerId: number;
  } | null>(null);
  const [reattachPreview, setReattachPreview] = useState<DraftEdge & {
    readonly edgeId: string;
  } | null>(null);
  const reattachTargetRef = useRef<DrawTarget | null>(null);
  const [sequenceMovePreview, setSequenceMovePreview] = useState<{
    readonly edgeId: string;
    readonly deltaY: number;
  } | null>(null);
  const [edgeSlidePreview, setEdgeSlidePreview] = useState<{
    readonly edgeId: string;
    readonly axis: "x" | "y";
    readonly position: number;
  } | null>(null);
  const [labelDraft, setLabelDraft] = useState<{
    readonly edgeId: string;
    readonly labelId: string;
    readonly delta: Point;
  } | null>(null);
  const [nodeLabelDraft, setNodeLabelDraft] = useState<{
    readonly nodeId: string;
    readonly delta: Point;
  } | null>(null);
  /**
   * Label drags capture the pointer on the SVG, so the browser retargets the
   * following pointerup/click/dblclick to the SVG rather than the label hit
   * rectangle. Track the press here and open the editor directly on the second
   * press instead of relying on a dblclick handler that never fires.
   */
  const labelPressRef = useRef<{
    readonly edgeId: string;
    readonly labelId: string;
    readonly time: number;
  } | null>(null);
  const nodeLabelPressRef = useRef<{
    readonly nodeId: string;
    readonly time: number;
  } | null>(null);
  const panMovedRef = useRef(false);
  const [activationDraft, setActivationDraft] = useState<{
    readonly nodeId: string;
    readonly id: ActivationId;
    readonly top: number;
    readonly height: number;
  } | null>(null);

  useEffect(() => {
    if (selectedActivation !== null && selectedActivation.nodeId !== selectedNodeId) {
      onSelectActivation(null);
    }
  }, [onSelectActivation, selectedActivation, selectedNodeId]);

  useEffect(() => {
    setAddMenu(null);
    setDraftEdge(null);
    setEdgeSlidePreview(null);
  }, [scene.id]);

  useEffect(() => {
    const anyMenuOpen =
      addMenu !== null ||
      activeEndpoint !== null ||
      linePopover !== null ||
      nodeFocus !== null;
    if (!anyMenuOpen) return;

    const closeTopMenu = (): void => {
      if (addMenu !== null) {
        setAddMenu(null);
      } else if (activeEndpoint !== null) {
        setActiveEndpoint(null);
      } else if (linePopover !== null) {
        setLinePopover(null);
      } else if (nodeFocus !== null) {
        onClearNodeFocus();
      }
    };

    const handleMenuKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTopMenu();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      // A field handled Enter itself (e.g. row entry moves focus instead of
      // committing); do not close the menu underneath it.
      if (event.defaultPrevented) return;
      // Single-line fields commit on Enter; multiline notes and pickers do not.
      if (!(event.target instanceof HTMLInputElement)) return;
      if (!["text", "search", "number", "email", "url", "tel", "password"].includes(event.target.type)) {
        return;
      }
      event.preventDefault();
      closeTopMenu();
    };

    window.addEventListener("keydown", handleMenuKey);
    return () => window.removeEventListener("keydown", handleMenuKey);
  }, [activeEndpoint, addMenu, linePopover, nodeFocus, onClearNodeFocus]);

  useEffect(() => {
    if (selectedEdgeId === null) {
      setActiveEndpoint(null);
      setLinePopover(null);
    }
  }, [selectedEdgeId]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const next = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      setViewport(next);
      onViewportRef.current(next);
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    setViewport({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewport.width < 1 || viewport.height < 1) return;
    const sceneChanged = lastFittedSceneIdRef.current !== scene.id;
    lastFittedSceneIdRef.current = scene.id;
    const defaultZoom =
      sceneChanged && scene.meta.diagramKind === "circuit" ? 2 : undefined;
    const fitted = fitBounds(layoutRef.current.fitBounds, viewport, 64, defaultZoom);
    onViewChangeRef.current(fitted.camera, fitted.zoom);
    // Fit only when requested or the viewport changes; never on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, viewport.width, viewport.height, scene.id, scene.meta.diagramKind]);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const handleWheel = (event: WheelEvent): void => {
      const wheelTarget = event.target;
      if (
        wheelTarget instanceof Element &&
        wheelTarget.closest(".add-object-menu") !== null
      ) {
        return;
      }
      event.preventDefault();
      const svg = svgRef.current;
      if (svg === null) return;
      if (event.shiftKey && sceneRef.current.meta.diagramKind === "circuit") {
        const selected = selectedNodeIdsRef.current;
        const targetIds = selected.length > 0
          ? selected
          : hoveredObjectNodeIdRef.current === null
            ? []
            : [hoveredObjectNodeIdRef.current];
        const selectedSet = new Set(targetIds);
        const selectedComponentIds = targetIds.filter(
          (id) => sceneRef.current.nodes[id]?.kind === "circuitComponent",
        );
        const indicatorIds = selectedComponentIds.filter((id) => {
          const node = sceneRef.current.nodes[id];
          if (node?.kind !== "circuitComponent") return false;
          const definition = circuitComponent(node.component);
          if (definition === undefined) return false;
          return Object.values(sceneRef.current.edges).some((edge) => {
            if (edge.semantic.family !== "circuit") return false;
            const atPin = definition.pins.some(
              (pin) =>
                (edge.source.target === "node" &&
                  edge.source.nodeId === node.id &&
                  edge.source.port.kind === "pin" &&
                  edge.source.port.pinId === pin.id) ||
                (edge.target.target === "node" &&
                  edge.target.nodeId === node.id &&
                  edge.target.port.kind === "pin" &&
                  edge.target.port.pinId === pin.id),
            );
            if (!atPin) return false;
            const other = edge.source.target === "node" &&
              edge.source.nodeId === node.id
              ? edge.target
              : edge.source;
            return other.target !== "node" || !selectedSet.has(other.nodeId);
          });
        });
        const junctionIndicatorIds = targetIds.filter((id) => {
          const node = sceneRef.current.nodes[id];
          if (node?.kind !== "circuitJunction") return false;
          return Object.values(sceneRef.current.edges).some((edge) => {
            if (edge.semantic.family !== "circuit") return false;
            const atJunction =
              edge.source.target === "node" &&
              edge.source.nodeId === node.id &&
              edge.source.port.kind === "center"
                ? true
                : edge.target.target === "node" &&
                  edge.target.nodeId === node.id &&
                  edge.target.port.kind === "center";
            if (!atJunction) return false;
            const other =
              edge.source.target === "node" && edge.source.nodeId === node.id
                ? edge.target
                : edge.source;
            return other.target !== "node" || !selectedSet.has(other.nodeId);
          });
        });
        if (selectedComponentIds.length > 0) {
          const direction = event.deltaY < 0 ? 1 : -1;
          setBranchDistance((current) => Math.max(0, current + direction));
          setBranchTargetIds([...indicatorIds, ...junctionIndicatorIds]);
          return;
        }
      }
      const cursor = pointFromEvent(event, svg);
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = zoomAtScreenPoint(cursor, cameraRef.current, zoomRef.current, factor);
      onViewChangeRef.current(next.camera, next.zoom);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const clearPreview = (): void => {
      setBranchDistance(0);
      setBranchTargetIds([]);
      setGuides([]);
      setCoincidentHighlights([]);
      setRotationHandleOverride(null);
      wireInsertNodeIdRef.current = null;
      portClickFocusRef.current = null;
      insertTargetRef.current = null;
      setInsertTarget(null);
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== "Shift" || branchDragRef.current !== null || branchIntentRef.current !== null) {
        return;
      }
      clearPreview();
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "hidden") clearPreview();
    };
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearPreview);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearPreview);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const beginInteraction = (
    event: React.PointerEvent<SVGElement>,
    next: Interaction,
    captureImmediately: boolean,
  ): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    interactionRef.current = next;
    if (next.kind === "drag" || next.kind === "resize") next.captured = captureImmediately;
    if (captureImmediately) {
      try {
        svgRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events (tests) do not own a real pointer id.
      }
    }
  };

  const beginPan = (event: React.PointerEvent<SVGElement>): void => {
    const svg = svgRef.current;
    if (svg === null) return;
    const screen = pointFromEvent(event, svg);
    panMovedRef.current = false;
    interactionRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startScreen: screen,
      startCamera: cameraRef.current,
    };
    setPanning(true);
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // See beginInteraction.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  /** Ellipse attachment on the side facing the partner, not the drop point. */
  const useCaseTarget = (node: NodeLayout, toward: Point): DrawTarget => {
    const center = {
      x: node.frame.x + node.frame.width / 2,
      y: node.frame.y + node.frame.height / 2,
    };
    const rx = Math.max(1, node.frame.width / 2);
    const ry = Math.max(1, node.frame.height / 2);
    const theta = Math.atan2((toward.y - center.y) / ry, (toward.x - center.x) / rx);
    const angle = ((theta * 180) / Math.PI + 360) % 360;
    return {
      point: {
        x: center.x + rx * Math.cos(theta),
        y: center.y + ry * Math.sin(theta),
      },
      attachment: { nodeId: node.nodeId, port: { kind: "angle", angle } },
    };
  };

  const findDrawTarget = (
    world: Point,
    sourceNodeId: string,
    excludeEdgeId?: string,
    preferredPoint?: Point,
  ): DrawTarget | null => {
    const nearby = nearestPort(layout.ports, world, 18 / zoomRef.current);
    if (nearby !== null && nearby.nodeId !== sourceNodeId) {
      const nearbyLayout = layout.nodes[nearby.nodeId];
      if (nearbyLayout?.kind === "useCase" && preferredPoint !== undefined) {
        return useCaseTarget(nearbyLayout, preferredPoint);
      }
      return {
        point: nearby.point,
        attachment: { nodeId: nearby.nodeId, port: nearby.ref },
      };
    }

    const containing = Object.values(layout.nodes)
      .filter(
        (node) =>
          node.nodeId !== sourceNodeId &&
          node.kind !== "frame" &&
          rectContainsPoint(node.frame, world),
      )
      .sort(
        (a, b) =>
          (scene.nodes[b.nodeId]?.z ?? 0) - (scene.nodes[a.nodeId]?.z ?? 0),
      );
    const node = containing[0];
    if (node !== undefined) {
      if (node.kind === "lifeline") {
        const { from, to } = node.spine;
        const span = Math.max(1, to.y - from.y);
        const t = clampValue((world.y - from.y) / span, 0, 1);
        return {
          point: { x: from.x, y: from.y + span * t },
          attachment: { nodeId: node.nodeId, port: { kind: "spine", t } },
        };
      }

      if (node.kind === "useCase") {
        return useCaseTarget(node, preferredPoint ?? world);
      }

      if (node.kind === "circuitJunction") {
        return {
          point: node.center,
          attachment: { nodeId: node.nodeId, port: { kind: "center" } },
        };
      }

      const perimeter = node.ports.filter((port) => port.ref.kind === "perimeter");
      if (perimeter.length > 0) {
        const closest = perimeter.reduce((best, candidate) => {
          const bestDistance = Math.hypot(best.point.x - world.x, best.point.y - world.y);
          const candidateDistance = Math.hypot(candidate.point.x - world.x, candidate.point.y - world.y);
          return candidateDistance < bestDistance ? candidate : best;
        });
        return {
          point: closest.point,
          attachment: { nodeId: node.nodeId, port: closest.ref },
        };
      }
    }

    // Relation attributes and annotation anchors can target a connector.
    // Nodes win first, so a line passing under an entity is not intercepted.
    const edgeThreshold = 10 / zoomRef.current;
    let bestEdge: {
      edgeId: EdgeAttachmentRef["edgeId"];
      distance: number;
      t: number;
      point: Point;
      segmentIndex: number;
    } | null = null;
    let bestDistance = edgeThreshold;
    for (const edge of Object.values(layout.edges)) {
      if (edge.edgeId === excludeEdgeId) continue;
      const sceneEdge = scene.edges[edge.edgeId];
      if (sceneEdge === undefined || !sceneEdge.visible) continue;
      const hit = closestPointOnPolyline(edge.points, world);
      if (hit === null || hit.distance > bestDistance) continue;
      bestDistance = hit.distance;
      bestEdge = {
        edgeId: edge.edgeId,
        distance: hit.distance,
        t: hit.t,
        point: hit.point,
        segmentIndex: hit.segmentIndex,
      };
    }
    if (bestEdge !== null) {
      let targetPoint = bestEdge.point;
      let targetT = bestEdge.t;
      if (scene.meta.diagramKind === "circuit" && preferredPoint !== undefined) {
        const targetPoints = layout.edges[bestEdge.edgeId]?.points;
        const perpendicular = targetPoints === undefined
          ? null
          : perpendicularPointOnPolyline(
              targetPoints,
              bestEdge.segmentIndex,
              preferredPoint,
              bestEdge.point,
              Math.max(1, scene.canvas.grid.size),
            );
        if (perpendicular !== null) {
          targetPoint = perpendicular.point;
          targetT = perpendicular.t;
        }
      }
      return {
        point: targetPoint,
        attachment: { edgeId: bestEdge.edgeId, t: targetT },
      };
    }
    return null;
  };

  /**
   * While drawing, snap a lifeline-spine target to the source's horizontal
   * axis when the raw line is within 5° of horizontal. Holding Alt bypasses
   * the snap. Only the spine y is adjustable, so vertical snapping would move
   * the target off its lifeline and is intentionally not applied.
   */
  const snapDrawTarget = (
    target: DrawTarget,
    source: Point,
    altKey: boolean,
  ): DrawTarget => {
    if (altKey || !("nodeId" in target.attachment)) return target;
    const attachment = target.attachment;
    if (attachment.port.kind !== "spine") return target;
    const dx = target.point.x - source.x;
    const dy = target.point.y - source.y;
    if (Math.hypot(dx, dy) < 1) return target;
    const angle = Math.atan2(dy, dx);
    const quarter = Math.PI / 2;
    const nearest = Math.round(angle / quarter) * quarter;
    const difference = Math.abs(angle - nearest);
    if (difference > (5 * Math.PI) / 180) return target;
    if (Math.abs(Math.cos(nearest)) < 0.5) return target;

    const nodeLayout = layout.nodes[attachment.nodeId];
    if (nodeLayout === undefined || nodeLayout.kind !== "lifeline") return target;
    const { from, to } = nodeLayout.spine;
    if (source.y < from.y - 0.5 || source.y > to.y + 0.5) return target;
    const span = Math.max(1, to.y - from.y);
    const t = clampValue((source.y - from.y) / span, 0, 1);
    return {
      point: { x: from.x, y: source.y },
      attachment: {
        nodeId: attachment.nodeId,
        port: { kind: "spine", t },
      },
    };
  };

  const beginReattach = (
    edgeId: string,
    end: EdgeEnd,
    event: React.PointerEvent<SVGElement>,
  ): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const edgeLayout = layout.edges[edgeId];
    if (svg === null || edgeLayout === undefined || edgeLayout.points.length < 2) return;
    const endPoint = end === "source"
      ? edgeLayout.points[0]
      : edgeLayout.points[edgeLayout.points.length - 1];
    const otherPoint = end === "source"
      ? edgeLayout.points[edgeLayout.points.length - 1]
      : edgeLayout.points[0];
    if (endPoint === undefined || otherPoint === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);

    setActiveEndpoint(null);
    setLinePopover(null);
    onSelectActivation(null);
    onSelectNode(null);
    onSelectEdge(edgeId);
    reattachTargetRef.current = null;
    setReattachPreview({
      edgeId,
      from: otherPoint,
      to: endPoint,
      snapped: true,
    });
    interactionRef.current = {
      kind: "reattach",
      pointerId: event.pointerId,
      edgeId,
      end,
      startWorld: world,
      startScreen: screen,
      lastWorld: world,
      pointerTravel: 0,
      moved: false,
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const beginLabelDrag = (
    edgeId: string,
    labelId: string,
    event: React.PointerEvent<SVGRectElement>,
    menu: "line" | "terminal",
    end?: EdgeEnd,
  ): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const label = layout.edges[edgeId]?.labels.find(
      (candidate) => candidate.labelId === labelId,
    );
    if (svg === null || label === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const now = performance.now();
    const previousPress = labelPressRef.current;
    if (
      previousPress !== null &&
      previousPress.edgeId === edgeId &&
      previousPress.labelId === labelId &&
      now - previousPress.time <= LABEL_DOUBLE_PRESS_MS
    ) {
      labelPressRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      setActiveEndpoint(null);
      setLinePopover(null);
      onSelectActivation(null);
      onSelectNode(null);
      onSelectEdge(edgeId);
      onClearNodeFocus();
      if (menu === "line") {
        openLineMenuAt(edgeId, world, true);
      } else if (end !== undefined) {
        openTerminalMenu(edgeId, end, true);
      }
      return;
    }
    labelPressRef.current = { edgeId, labelId, time: now };
    const startOffset = {
      x: label.frame.x + label.frame.width / 2 - label.anchorPoint.x,
      y: label.frame.y + label.frame.height / 2 - label.anchorPoint.y,
    };

    setActiveEndpoint(null);
    setLinePopover(null);
    onSelectActivation(null);
    onSelectNode(null);
    onSelectEdge(edgeId);
    onClearNodeFocus();
    setLabelDraft({ edgeId, labelId, delta: { x: 0, y: 0 } });
    interactionRef.current = {
      kind: "label-drag",
      pointerId: event.pointerId,
      edgeId,
      labelId,
      menu,
      end,
      startWorld: world,
      startOffset,
      moved: false,
      lastDelta: { x: 0, y: 0 },
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const beginNodeLabelDrag = (
    nodeId: string,
    event: React.PointerEvent<SVGRectElement>,
  ): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const node = scene.nodes[nodeId];
    const nodeLayout = layout.nodes[nodeId];
    if (
      svg === null ||
      node === undefined ||
      (node.kind !== "circuitComponent" && node.kind !== "circuitJunction") ||
      nodeLayout?.kind !== node.kind ||
      nodeLayout.labelFrame === undefined
    ) {
      return;
    }
    const now = performance.now();
    const previousPress = nodeLabelPressRef.current;
    if (
      previousPress !== null &&
      previousPress.nodeId === nodeId &&
      now - previousPress.time <= LABEL_DOUBLE_PRESS_MS
    ) {
      nodeLabelPressRef.current = null;
      interactionRef.current = null;
      setNodeLabelDraft(null);
      event.preventDefault();
      event.stopPropagation();
      onSelectNode(nodeId);
      onTextDoubleClick(nodeId, { kind: "nodeName" });
      return;
    }
    nodeLabelPressRef.current = { nodeId, time: now };
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const frame = nodeLayout.labelFrame;
    const labelCenter = {
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2,
    };
    const rawOffset = sub(labelCenter, nodeLayout.center);
    const rotation = node.kind === "circuitComponent" ? node.rotation : 0;
    const startOffset = rotation === 0
      ? rawOffset
      : rotatePoint(rawOffset, -rotation);

    setActiveEndpoint(null);
    setLinePopover(null);
    onSelectActivation(null);
    onSelectEdge(null);
    onSelectNode(nodeId);
    onClearNodeFocus();
    setNodeLabelDraft({ nodeId, delta: { x: 0, y: 0 } });
    interactionRef.current = {
      kind: "node-label-drag",
      pointerId: event.pointerId,
      nodeId,
      startWorld: world,
      startOffset,
      rotation,
      moved: false,
      lastDelta: { x: 0, y: 0 },
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const beginEdgeDraw = (
    port: PortGeometry,
    event: React.PointerEvent<SVGCircleElement>,
  ): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setAddMenu(null);
    setActiveEndpoint(null);
    setLinePopover(null);
    onClearNodeFocus();
    const owner = sceneRef.current.nodes[port.nodeId];
    portClickFocusRef.current =
      owner?.kind === "circuitJunction" && port.ref.kind === "center"
        ? {
            nodeId: port.nodeId,
            additive: event.ctrlKey || event.metaKey,
          }
        : null;
    const svg = svgRef.current;
    const screen = svg === null ? { x: 0, y: 0 } : pointFromEvent(event, svg);
    interactionRef.current = {
      kind: "draw",
      pointerId: event.pointerId,
      source: port,
      startScreen: screen,
      lastWorld: port.point,
      pointerTravel: 0,
    };
    draftTargetRef.current = null;
    setDraftEdge({ from: port.point, to: port.point, snapped: false });
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
  };

  const handleStagePointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    // Panning is deliberately on the secondary (and middle) button so the
    // primary button stays available for selection and future marquee select.
    if (event.button === 2 || event.button === 1) beginPan(event);
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>): void => {
    event.preventDefault();
    if (panMovedRef.current) {
      panMovedRef.current = false;
      return;
    }
    const svg = svgRef.current;
    if (svg === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const empty =
      target === svg ||
      target.closest("[data-canvas-background]") !== null;
    if (!empty) return;

    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const menuWidth = scene.meta.diagramKind === "circuit" ? 450 : 318;
    const menuHeight = scene.meta.diagramKind === "circuit" ? 620 : 474;
    setAddMenu({
      left: clampValue(screen.x + 8, 10, Math.max(10, viewport.width - menuWidth)),
      top: clampValue(screen.y + 8, 10, Math.max(10, viewport.height - menuHeight)),
      world,
      source: "context",
    });
    setActiveEndpoint(null);
    setLinePopover(null);
    onClearNodeFocus();
    onSelectEdge(null);
    onSelectNode(null);
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<SVGRectElement>): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    if (svg === null) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    onSelectActivation(null);
    setActivationDraft(null);
    setActiveEndpoint(null);
    setLinePopover(null);
    onClearNodeFocus();
    onSelectEdge(null);
    const additive = event.ctrlKey || event.metaKey;
    if (!additive) onSelectNode(null);
    interactionRef.current = {
      kind: "marquee",
      pointerId: event.pointerId,
      startWorld: world,
      currentWorld: world,
      additive,
      baseIds: additive ? selectedNodeIds : [],
      moved: false,
    };
    setMarquee(null);
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
  };

  const handleNodePointerDown = (event: React.PointerEvent<SVGGElement>, nodeId: string): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const nodeLayout = layout.nodes[nodeId];
    if (svg === null || nodeLayout === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const duplicate = event.ctrlKey || event.metaKey;
    const alreadySelected = selectedNodeIds.includes(nodeId);
    const duplicateIds = [
      nodeId,
      ...(alreadySelected ? selectedNodeIds.filter((id) => id !== nodeId) : []),
    ];
    const movingIds = duplicate
      ? duplicateIds
      : alreadySelected && selectedNodeIds.length > 0
        ? selectedNodeIds
        : [nodeId];
    if (duplicate) {
      duplicateIntentRef.current = {
        nodeIds: duplicateIds,
        primaryId: nodeId,
        parallelBranch: event.shiftKey,
      };
      // Ctrl/Cmd alone is duplicate-only; a shift branch must never leak in
      // from an earlier gesture.
      branchIntentRef.current = null;
      branchDragRef.current = null;
      ctrlClickToggleRef.current = nodeId;
      onClearNodeFocus();
      event.preventDefault();
      event.stopPropagation();
    } else if (!alreadySelected) {
      onSelectNodes([nodeId], nodeId);
    } else if (selectedNodeId !== nodeId) {
      onSelectNodes(movingIds, nodeId);
    }

    const primaryNode = scene.nodes[nodeId];
    const primaryDef = primaryNode?.kind === "circuitComponent"
      ? circuitComponent(primaryNode.component)
      : undefined;
    const detach = !duplicate &&
      event.altKey &&
      primaryNode?.kind === "circuitComponent";
    const insertable =
      !duplicate &&
      !event.altKey &&
      event.shiftKey &&
      scene.meta.diagramKind === "circuit" &&
      primaryNode?.kind === "circuitComponent" &&
      primaryDef?.pins.length === 2 &&
      movingIds.length === 1 &&
      !Object.values(scene.edges).some(
        (edge) =>
          edge.semantic.family === "circuit" &&
          primaryDef.pins.some(
            (pin) =>
              (edge.source.target === "node" &&
                edge.source.nodeId === primaryNode.id &&
                edge.source.port.kind === "pin" &&
                edge.source.port.pinId === pin.id) ||
              (edge.target.target === "node" &&
                edge.target.nodeId === primaryNode.id &&
                edge.target.port.kind === "pin" &&
                edge.target.port.pinId === pin.id),
          ),
      );
    wireInsertNodeIdRef.current = insertable ? primaryNode.id : null;
    if (detach) {
      detachIntentRef.current = movingIds
        .filter((id) => scene.nodes[id]?.kind === "circuitComponent")
        .map((id) => id as NodeId);
    } else {
      detachIntentRef.current = null;
    }
    if (
      !duplicate &&
      !insertable &&
      !detach &&
      event.shiftKey &&
      scene.meta.diagramKind === "circuit" &&
      primaryNode?.kind === "circuitComponent"
    ) {
      const branchIds: NodeId[] = movingIds
        .filter((id) => scene.nodes[id]?.kind === "circuitComponent")
        .map((id) => id as NodeId);
      const originalFrames: Record<string, Rect> = {};
      for (const id of branchIds) {
        const frame = layout.nodes[id]?.frame ?? scene.nodes[id]?.frame;
        if (frame !== undefined) originalFrames[id] = frame;
      }
      if (branchIds.length > 0) {
        branchIntentRef.current = {
          nodeIds: branchIds,
          junctionIds: movingIds
            .filter((id) => scene.nodes[id]?.kind === "circuitJunction")
            .map((id) => id as NodeId),
          selectedNodeIds: movingIds.map((id) => id as NodeId),
          originalFrames,
          distance: branchDistance * scene.canvas.grid.size,
        };
        branchDragRef.current = null;
        setBranchDistance(0);
        setBranchTargetIds([]);
      }
    }

    onSelectActivation(null);
    setActivationDraft(null);
    setActiveEndpoint(null);
    setLinePopover(null);
    onSelectEdge(null);

    const movingSet = new Set<string>();
    for (const id of movingIds) {
      movingSet.add(id);
      for (const child of childrenOfBoundary(scene, id)) movingSet.add(String(child.id));
    }
    // Auto-merged junction nodes at shared endings of the moved group must
    // travel with it, or the next merge creates a second, off-grid junction.
    if (
      scene.meta.diagramKind === "circuit" &&
      !duplicate &&
      !detach
    ) {
      const componentPins: { readonly nodeId: string; readonly point: Point }[] = [];
      const junctionTolerance = Math.max(0.5, scene.canvas.grid.size * 0.25);
      for (const id of movingSet) {
        const nodeLayout = layout.nodes[id];
        if (nodeLayout?.kind !== "circuitComponent") continue;
        for (const pin of nodeLayout.pins) {
          componentPins.push({ nodeId: id, point: pin.point });
        }
      }
      for (const nodeLayout of Object.values(layout.nodes)) {
        if (nodeLayout.kind !== "circuitJunction" || movingSet.has(nodeLayout.nodeId)) {
          continue;
        }
        const owners = componentPins
          .filter(
            (pin) =>
              Math.hypot(
                pin.point.x - nodeLayout.center.x,
                pin.point.y - nodeLayout.center.y,
              ) <= junctionTolerance,
          )
          .map((pin) => pin.nodeId);
        if (owners.length >= 2 && owners.every((owner) => movingSet.has(owner))) {
          movingSet.add(nodeLayout.nodeId);
        }
      }
    }
    movingSet.delete(nodeId);
    if (branchIntentRef.current !== null) {
      const branchAllNodeIds = [nodeId, ...movingSet];
      const branchNodeIds = branchAllNodeIds
        .filter((id) => scene.nodes[id]?.kind === "circuitComponent")
        .map((id) => asNodeId(id));
      branchIntentRef.current = {
        ...branchIntentRef.current,
        nodeIds: branchNodeIds,
        junctionIds: branchAllNodeIds
          .filter((id) => scene.nodes[id]?.kind === "circuitJunction")
          .map((id) => asNodeId(id)),
        selectedNodeIds: branchAllNodeIds.map((id) => asNodeId(id)),
      };
    }
    const childIds = [...movingSet];
    const childStartFrames: Record<string, Rect> = Object.fromEntries(
      childIds.flatMap((childId) => {
        const frame = layout.nodes[childId]?.frame ?? scene.nodes[childId]?.frame;
        if (frame === undefined) return [];
        if (scene.nodes[childId]?.kind === "circuitJunction") {
          // Auto-merged junctions can carry sub-pixel drift; start the group
          // move from a grid-aligned junction frame.
          const center = rectCenter(frame);
          const snapped = {
            x: snap(center.x, scene.canvas.grid.size),
            y: snap(center.y, scene.canvas.grid.size),
          };
          return [[childId, {
            ...frame,
            x: snapped.x - frame.width / 2,
            y: snapped.y - frame.height / 2,
          }] as const];
        }
        return [[childId, frame] as const];
      }),
    );
    beginInteraction(event, {
      kind: "drag",
      pointerId: event.pointerId,
      nodeId,
      startWorld: world,
      startFrame: nodeLayout.frame,
      childIds,
      childStartFrames,
      captured: false,
      lastFrame: nodeLayout.frame,
      lastChildFrames: { ...childStartFrames },
    }, false);
  };

  const edgeTranslateSetup = (
    edgeId: string,
  ): {
    readonly axis: "x" | "y";
    readonly nodeIds: readonly NodeId[];
    readonly frames: Readonly<Record<string, Rect>>;
  } | null => {
    const edge = scene.edges[edgeId];
    const edgeLayout = layout.edges[edgeId];
    if (
      edge === undefined ||
      edgeLayout === undefined ||
      edgeLayout.points.length < 2 ||
      edge.semantic.family !== "circuit" ||
      edge.source.target !== "node" ||
      edge.target.target !== "node" ||
      edge.source.port.kind !== "center" ||
      edge.target.port.kind !== "center"
    ) {
      return null;
    }
    const sourceNode = scene.nodes[edge.source.nodeId];
    const targetNode = scene.nodes[edge.target.nodeId];
    if (sourceNode?.kind !== "circuitJunction" || targetNode?.kind !== "circuitJunction") {
      return null;
    }
    const first = edgeLayout.points[0];
    const last = edgeLayout.points[edgeLayout.points.length - 1];
    if (first === undefined || last === undefined) return null;
    const wireAxis = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y) ? "x" : "y";
    const moveAxis = wireAxis === "x" ? "y" : "x";
    const junctionIds = [sourceNode.id, targetNode.id];
    for (const junctionId of junctionIds) {
      for (const other of Object.values(scene.edges)) {
        if (other.id === edge.id || other.semantic.family !== "circuit") continue;
        const atSource =
          other.source.target === "node" &&
          other.source.nodeId === junctionId &&
          other.source.port.kind === "center";
        const atTarget =
          other.target.target === "node" &&
          other.target.nodeId === junctionId &&
          other.target.port.kind === "center";
        if (!atSource && !atTarget) continue;
        const otherLayout = layout.edges[other.id];
        if (otherLayout === undefined || otherLayout.points.length < 2) continue;
        const from = atSource
          ? otherLayout.points[0]
          : otherLayout.points[otherLayout.points.length - 1];
        const neighbor = atSource
          ? otherLayout.points[1]
          : otherLayout.points[otherLayout.points.length - 2];
        if (from === undefined || neighbor === undefined) continue;
        // Other branches must be perpendicular to this wire so shifting the
        // wire changes their length without skewing them.
        const otherAxis =
          Math.abs(neighbor.x - from.x) >= Math.abs(neighbor.y - from.y)
            ? "x"
            : "y";
        if (otherAxis !== moveAxis) return null;
      }
    }
    return {
      axis: moveAxis,
      nodeIds: junctionIds,
      frames: Object.fromEntries(
        junctionIds.map((id) => [id, scene.nodes[id]?.frame ?? sourceNode.frame]),
      ),
    };
  };

  const handleEdgePointerDown = (
    edgeId: string,
    event: React.PointerEvent<SVGPolylineElement>,
  ): void => {
    const svg = svgRef.current;
    const edgeLayout = layout.edges[edgeId];
    if (svg === null || edgeLayout === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const now = performance.now();
    const previousPress = edgePressRef.current;
    if (
      scene.meta.diagramKind === "circuit" &&
      previousPress !== null &&
      previousPress.edgeId === edgeId &&
      now - previousPress.time <= LABEL_DOUBLE_PRESS_MS
    ) {
      edgePressRef.current = null;
      pendingEdgeSplitRef.current = {
        edgeId,
        point: world,
        pointerId: event.pointerId,
      };
      setLinePopover(null);
      setActiveEndpoint(null);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    edgePressRef.current = { edgeId, time: now };
    const source = edgeLayout.points[0];
    const target = edgeLayout.points[edgeLayout.points.length - 1];
    const screenPoint = (p: Point): Point => ({ x: p.x * zoomRef.current + cameraRef.current.x, y: p.y * zoomRef.current + cameraRef.current.y });
    const sourceScreen = source === undefined ? null : screenPoint(source);
    const targetScreen = target === undefined ? null : screenPoint(target);
    const sourceDistance = sourceScreen === null
      ? Number.POSITIVE_INFINITY
      : Math.hypot(sourceScreen.x - screen.x, sourceScreen.y - screen.y);
    const targetDistance = targetScreen === null
      ? Number.POSITIVE_INFINITY
      : Math.hypot(targetScreen.x - screen.x, targetScreen.y - screen.y);
    onSelectActivation(null);
    setActivationDraft(null);
    setLinePopover(null);
    onSelectNode(null);
    onSelectEdge(edgeId);
    const translate = scene.meta.diagramKind === "circuit"
      ? edgeTranslateSetup(edgeId)
      : null;
    if (translate !== null) {
      const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
      setActiveEndpoint(null);
      setLinePopover(null);
      interactionRef.current = {
        kind: "edge-translate",
        pointerId: event.pointerId,
        edgeId,
        axis: translate.axis,
        startWorld: world,
        startScreen: screen,
        startFrames: translate.frames,
        lastFrames: translate.frames,
        moved: false,
      };
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events cannot own capture.
      }
      event.preventDefault();
      return;
    }
    if (scene.meta.diagramKind !== "circuit" && Math.min(sourceDistance, targetDistance) <= 16) {
      const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
      setActiveEndpoint(null);
      setLinePopover(null);
      interactionRef.current = {
        kind: "edge-press",
        pointerId: event.pointerId,
        edgeId,
        end: sourceDistance <= targetDistance ? "source" : "target",
        startWorld: world,
        startScreen: screen,
        lastWorld: world,
        pointerTravel: 0,
        moved: false,
      };
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events cannot own capture.
      }
      event.preventDefault();
      return;
    }
    const edge = scene.edges[edgeId];
    const slide = edge === undefined
      ? null
      : straightSlideInfo(edge, scene, edgeLayout.points, gridSize);
    const firstPoint = edgeLayout.points[0];
    if (slide !== null && firstPoint !== undefined) {
      const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
      const startPosition = slide.axis === "y" ? firstPoint.y : firstPoint.x;
      setActiveEndpoint(null);
      setLinePopover(null);
      setSequenceMovePreview(null);
      setEdgeSlidePreview(null);
      interactionRef.current = {
        kind: "edge-slide",
        pointerId: event.pointerId,
        edgeId,
        axis: slide.axis,
        startWorld: world,
        startPosition,
        min: slide.min,
        max: slide.max,
        lastPosition: Math.min(slide.max, Math.max(slide.min, startPosition)),
        moved: false,
      };
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events cannot own capture.
      }
      event.preventDefault();
      return;
    }
    if (scene.edges[edgeId]?.semantic.family === "sequence") {
      const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
      setActiveEndpoint(null);
      setSequenceMovePreview(null);
      interactionRef.current = {
        kind: "edge-move",
        pointerId: event.pointerId,
        edgeId,
        startWorld: world,
        moved: false,
        lastDelta: 0,
      };
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events cannot own capture.
      }
    } else {
      const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
      setActiveEndpoint(null);
      setLinePopover(null);
      interactionRef.current = {
        kind: "edge-press",
        pointerId: event.pointerId,
        edgeId,
        end: null,
        startWorld: world,
        startScreen: screen,
        lastWorld: world,
        pointerTravel: 0,
        moved: false,
      };
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events cannot own capture.
      }
      event.preventDefault();
    }
  };

  const openTerminalMenu = (edgeId: string, end: EdgeEnd, focusField: boolean): void => {
    if (scene.meta.diagramKind === "circuit") return;
    setLinePopover(null);
    onSelectNode(null);
    onSelectEdge(edgeId);
    setActiveEndpoint(end);
    if (focusField) setTerminalFocusToken((value) => value + 1);
  };

  const openLineMenuAt = (
    edgeId: string,
    world: Point,
    focusField: boolean,
  ): void => {
    const screen = {
      x: world.x * zoom + camera.x,
      y: world.y * zoom + camera.y,
    };
    const edgeLayout = layout.edges[edgeId];
    const centerLabel = edgeLayout?.labels.find((label) => label.zone === "center");
    const menuWidth = 320;
    // The compact inspector is about 294 px tall; leave a small buffer without
    // pretending it fills the old 390 px estimate, which caused clamped menus
    // to jump back over their label on shorter viewports.
    const menuHeight = 310;
    const gap = 14;
    const margin = 10;
    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(value, max));
    const screenOf = (value: Point): Point => ({
      x: value.x * zoom + camera.x,
      y: value.y * zoom + camera.y,
    });
    const labelLeft = centerLabel === undefined ? screen.x : centerLabel.frame.x * zoom + camera.x;
    const labelRight = centerLabel === undefined
      ? screen.x
      : (centerLabel.frame.x + centerLabel.frame.width) * zoom + camera.x;
    const labelTop = centerLabel === undefined ? screen.y : centerLabel.frame.y * zoom + camera.y;
    const labelBottom = centerLabel === undefined
      ? screen.y
      : (centerLabel.frame.y + centerLabel.frame.height) * zoom + camera.y;
    const labelCenterX = (labelLeft + labelRight) / 2;
    const labelCenterY = (labelTop + labelBottom) / 2;
    const anchor = centerLabel?.anchorPoint ?? world;
    const anchorScreen = screenOf(anchor);
    const points = edgeLayout?.points ?? [];
    let horizontal = true;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared === 0
        ? 0
        : clamp(((anchor.x - a.x) * dx + (anchor.y - a.y) * dy) / lengthSquared, 0, 1);
      const distance = Math.hypot(anchor.x - (a.x + dx * t), anchor.y - (a.y + dy * t));
      if (distance < bestDistance) {
        bestDistance = distance;
        horizontal = Math.abs(dx) >= Math.abs(dy);
      }
    }

    const labelRects: Rect[] = (edgeLayout?.labels ?? []).map((label) => {
      const topLeft = screenOf({ x: label.frame.x, y: label.frame.y });
      return {
        x: topLeft.x,
        y: topLeft.y,
        width: label.frame.width * zoom,
        height: label.frame.height * zoom,
      };
    });
    const lineRects: Rect[] = [];
    for (let index = 0; index + 1 < points.length; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (a === undefined || b === undefined) continue;
      const from = screenOf(a);
      const to = screenOf(b);
      lineRects.push({
        x: Math.min(from.x, to.x) - 5,
        y: Math.min(from.y, to.y) - 5,
        width: Math.abs(to.x - from.x) + 10,
        height: Math.abs(to.y - from.y) + 10,
      });
    }

    const candidates: { left: number; top: number }[] = horizontal
      ? [
          { left: labelCenterX - menuWidth / 2, top: Math.max(labelBottom, anchorScreen.y) + gap },
          { left: labelCenterX - menuWidth / 2, top: Math.min(labelTop, anchorScreen.y) - menuHeight - gap },
          { left: Math.max(labelRight, anchorScreen.x) + gap, top: labelCenterY - menuHeight / 2 },
          { left: Math.min(labelLeft, anchorScreen.x) - menuWidth - gap, top: labelCenterY - menuHeight / 2 },
        ]
      : [
          { left: Math.max(labelRight, anchorScreen.x) + gap, top: labelCenterY - menuHeight / 2 },
          { left: Math.min(labelLeft, anchorScreen.x) - menuWidth - gap, top: labelCenterY - menuHeight / 2 },
          { left: labelCenterX - menuWidth / 2, top: Math.max(labelBottom, anchorScreen.y) + gap },
          { left: labelCenterX - menuWidth / 2, top: Math.min(labelTop, anchorScreen.y) - menuHeight - gap },
        ];

    let left = margin;
    let top = margin;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index] as { left: number; top: number };
      const nextLeft = clamp(
        candidate.left,
        margin,
        Math.max(margin, viewport.width - menuWidth - margin),
      );
      const nextTop = clamp(
        candidate.top,
        margin,
        Math.max(margin, viewport.height - menuHeight - margin),
      );
      const rect = {
        x: nextLeft,
        y: nextTop,
        width: menuWidth,
        height: menuHeight,
      };
      const overlapsLine = lineRects.filter((line) => rectsIntersect(rect, line)).length;
      const overlapsLabels = labelRects.filter((label) => rectsIntersect(rect, label)).length;
      const shift = Math.abs(nextLeft - candidate.left) + Math.abs(nextTop - candidate.top);
      const score = overlapsLine * 10_000 + overlapsLabels * 5_000 + shift + index;
      if (score < bestScore) {
        bestScore = score;
        left = nextLeft;
        top = nextTop;
      }
    }

    setActiveEndpoint(null);
    setLinePopover({ edgeId, x: left, y: top });
    onSelectNode(null);
    onSelectEdge(edgeId);
    if (focusField) setLineFocusToken((value) => value + 1);
  };

  const revealFrame = (frame: Rect): void => {
    const z = zoomRef.current;
    const cameraValue = cameraRef.current;
    const margin = 48;
    const left = frame.x * z + cameraValue.x;
    const top = frame.y * z + cameraValue.y;
    const right = (frame.x + frame.width) * z + cameraValue.x;
    const bottom = (frame.y + frame.height) * z + cameraValue.y;
    let x = cameraValue.x;
    let y = cameraValue.y;

    if (right - left > viewport.width - margin * 2) {
      x = margin - frame.x * z;
    } else if (left < margin) {
      x += margin - left;
    } else if (right > viewport.width - margin) {
      x -= right - (viewport.width - margin);
    }

    if (bottom - top > viewport.height - margin * 2) {
      // Tall objects (a lifeline lane) cannot fit; keep the head/top edge
      // visible instead of centring the frame and hiding it above the viewport.
      y = margin - frame.y * z;
    } else if (top < margin) {
      y += margin - top;
    } else if (bottom > viewport.height - margin) {
      y -= bottom - (viewport.height - margin);
    }

    if (Math.abs(x - cameraValue.x) > 0.5 || Math.abs(y - cameraValue.y) > 0.5) {
      onViewChangeRef.current({ x, y }, z);
    }
  };

  const openAddMenuFromButton = (origin: "panel" | "canvas" = "canvas"): void => {
    // Prefer the lower half of the viewport: fitted scenes usually leave room
    // there, while the centre is often occupied by an existing object.
    const world = screenToWorld(
      { x: viewport.width * 0.5, y: viewport.height * 0.72 },
      cameraRef.current,
      zoomRef.current,
    );
    const preferredLeft = origin === "panel" ? 12 : 54;
    setAddMenu({
      left: Math.max(10, Math.min(preferredLeft, viewport.width - 310)),
      top: 12,
      world,
      source: "button",
    });
    setActiveEndpoint(null);
    setLinePopover(null);
    onClearNodeFocus();
    onSelectEdge(null);
    onSelectNode(null);
  };
  openAddMenuRef.current = openAddMenuFromButton;

  const handleImageDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleImageDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    const allFiles = [...event.dataTransfer.files];
    if (allFiles.length === 0 || svgRef.current === null) return;
    event.preventDefault();
    setAddMenu(null);
    const files = allFiles.filter(isSupportedImageFile);
    const screen = pointFromEvent(event, svgRef.current);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    onDropImageFiles(files.length > 0 ? files : allFiles, world);
  };

  const handleResizePointerDown = (
    corner: ResizeCorner,
    event: React.PointerEvent<SVGRectElement>,
  ): void => {
    if (event.button !== 0 || selectedNodeIds.length !== 1 || selectedNodeId === null) return;
    const svg = svgRef.current;
    const nodeLayout = layout.nodes[selectedNodeId];
    if (svg === null || nodeLayout === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    beginInteraction(event, {
      kind: "resize",
      pointerId: event.pointerId,
      nodeId: selectedNodeId,
      corner,
      startWorld: world,
      startFrame: nodeLayout.frame,
      captured: true,
      lastFrame: nodeLayout.frame,
    }, true);
  };

  const handleActivationPointerDown = (
    nodeId: string,
    activationId: string,
    event: React.PointerEvent<SVGRectElement>,
    edge: "top" | "bottom" | "body",
  ): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const nodeLayout = layout.nodes[nodeId];
    if (svg === null || nodeLayout === undefined || nodeLayout.kind !== "lifeline") return;
    const activation = nodeLayout.activations.find(
      (candidate) => candidate.id === activationId,
    );
    if (activation === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const startTop = activation.frame.y - nodeLayout.frame.y;
    const startHeight = activation.frame.height;

    onSelectNode(nodeId);
    onSelectEdge(null);
    onClearNodeFocus();
    onSelectActivation({ nodeId, activationId: activation.id });
    setActivationDraft({ nodeId, id: activation.id, top: startTop, height: startHeight });
    interactionRef.current = {
      kind: edge === "body" ? "activation-move" : "activation-resize",
      pointerId: event.pointerId,
      nodeId,
      activationId: activation.id,
      edge: edge === "body" ? "bottom" : edge,
      startWorld: world,
      startTop,
      startHeight,
      frameHeight: nodeLayout.frame.height,
      lastTop: startTop,
      lastHeight: startHeight,
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
  };

  const handleActivationResize = (
    edge: "top" | "bottom",
    event: React.PointerEvent<SVGRectElement>,
  ): void => {
    if (event.button !== 0 || selectedActivation === null) return;
    const svg = svgRef.current;
    const nodeLayout = layout.nodes[selectedActivation.nodeId];
    if (svg === null || nodeLayout === undefined || nodeLayout.kind !== "lifeline") return;
    const activation = nodeLayout.activations.find(
      (candidate) => candidate.id === selectedActivation.activationId,
    );
    if (activation === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    const startTop = activation.frame.y - nodeLayout.frame.y;
    const startHeight = activation.frame.height;

    setActivationDraft({
      nodeId: selectedActivation.nodeId,
      id: activation.id,
      top: startTop,
      height: startHeight,
    });
    interactionRef.current = {
      kind: "activation-resize",
      pointerId: event.pointerId,
      nodeId: selectedActivation.nodeId,
      activationId: activation.id,
      edge,
      startWorld: world,
      startTop,
      startHeight,
      frameHeight: nodeLayout.frame.height,
      lastTop: startTop,
      lastHeight: startHeight,
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleRotatePointerDown = (
    nodeId: string,
    event: React.PointerEvent<SVGCircleElement>,
  ): void => {
    if (event.button !== 0) return;
    const nodeLayout = layout.nodes[nodeId];
    const svg = svgRef.current;
    if (
      nodeLayout === undefined ||
      !(
        nodeLayout.kind === "circuitComponent" ||
        (nodeLayout.kind === "circuitJunction" &&
          nodeLayout.measurement !== undefined)
      ) ||
      svg === null
    ) {
      return;
    }
    const screen = pointFromEvent(event, svg);
    const centerScreen = {
      x: nodeLayout.center.x * zoomRef.current + cameraRef.current.x,
      y: nodeLayout.center.y * zoomRef.current + cameraRef.current.y,
    };
    const radius = Math.hypot(
      nodeLayout.frame.width / 2,
      nodeLayout.frame.height / 2,
    ) + 18 / zoomRef.current;
    const pointerAngle = (Math.atan2(
      screen.y - centerScreen.y,
      screen.x - centerScreen.x,
    ) * 180) / Math.PI;
    setAddMenu(null);
    setActiveEndpoint(null);
    setLinePopover(null);
    onClearNodeFocus();
    onSelectNode(nodeId);
    interactionRef.current = {
      kind: "rotate",
      pointerId: event.pointerId,
      nodeId,
      center: nodeLayout.center,
      radius,
      startPointerAngle: pointerAngle,
      startRotation: nodeLayout.rotation,
      lastRotation: nodeLayout.rotation,
    };
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const finish = (commit: boolean): void => {
    const interaction = interactionRef.current;
    if (interaction === null) return;
    setGuides([]);
    setCoincidentHighlights([]);

    if (interaction.kind === "marquee") {
      if (commit && interaction.moved) {
        const region = rectFromPoints(interaction.startWorld, interaction.currentWorld);
        const contained = Object.values(layout.nodes)
          .filter((node) => frameFullyInside(selectionFrameFor(node), region))
          .sort(
            (a, b) =>
              (scene.nodes[a.nodeId]?.z ?? 0) - (scene.nodes[b.nodeId]?.z ?? 0),
          )
          .map((node) => node.nodeId);
        const next = interaction.additive
          ? [...new Set([...interaction.baseIds, ...contained])]
          : contained;
        if (next.length > 0) {
          onSelectNodes(next, next[next.length - 1] ?? null);
        } else if (!interaction.additive) {
          const marqueeEdges = Object.values(scene.edges)
            .sort((a, b) => b.z - a.z)
            .filter((edge) => {
              const edgeLayout = layout.edges[edge.id];
              return edgeLayout !== undefined &&
                polylineCrossesRect(edgeLayout.points, region);
            });
          if (marqueeEdges.length > 0) {
            onSelectNodes([], null);
            onSelectEdges(marqueeEdges.map((edge) => edge.id));
          } else {
            onSelectNode(null);
            onSelectEdge(null);
          }
        }
      } else if (commit && !interaction.additive) {
        onSelectNode(null);
        onSelectEdge(null);
      }
      setMarquee(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "edge-translate") {
      if (commit && interaction.moved) {
        onCommitWireTranslation(interaction.lastFrames, interaction.edgeId);
      } else {
        onPreviewFrames({});
        if (commit) {
          openLineMenuAt(interaction.edgeId, interaction.startWorld, true);
        }
      }
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "rotate") {
      const rotatedNodeId = interaction.nodeId;
      if (commit) {
        onCommitRotation(rotatedNodeId, interaction.lastRotation);
        onNodePartClick({ kind: "object", nodeId: asNodeId(rotatedNodeId) });
      }
      onPreviewRotation(rotatedNodeId, null);
      setRotationHandleOverride(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "activation-move" || interaction.kind === "activation-resize") {
      const changed =
        Math.abs(interaction.lastTop - interaction.startTop) > 1e-6 ||
        Math.abs(interaction.lastHeight - interaction.startHeight) > 1e-6;
      if (commit && changed) {
        onUpdateActivation(
          interaction.nodeId,
          interaction.activationId,
          interaction.lastTop,
          interaction.lastHeight,
        );
      }
      setActivationDraft(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "draw") {
      const clickFocus = portClickFocusRef.current;
      portClickFocusRef.current = null;
      const target = draftTargetRef.current;
      if (
        commit &&
        clickFocus !== null &&
        interaction.pointerTravel <= 3 &&
        target === null
      ) {
        onNodePartClick(
          { kind: "object", nodeId: clickFocus.nodeId },
          clickFocus.additive,
        );
        draftTargetRef.current = null;
        setDraftEdge(null);
        interactionRef.current = null;
        setPanning(false);
        const pointerId = interaction.pointerId;
        if (svgRef.current?.hasPointerCapture(pointerId) === true) {
          svgRef.current.releasePointerCapture(pointerId);
        }
        return;
      }
      if (commit) {
        if (target !== null) {
          const edgeTarget = "edgeId" in target.attachment;
          const tooClose =
            scene.meta.diagramKind === "circuit" &&
            edgeTarget &&
            (interaction.pointerTravel < MIN_EXTEND_SCREEN_PX ||
              Math.hypot(
                target.point.x - interaction.source.point.x,
                target.point.y - interaction.source.point.y,
              ) < minExtendWorld(gridSize));
          if (!tooClose) {
            onCreateEdge(attachmentFor(interaction.source), target.attachment);
          }
        } else if (
          scene.meta.diagramKind === "circuit" &&
          !overCircuitComponentBody(layout.nodes, interaction.lastWorld, interaction.source.nodeId)
        ) {
          const candidate = snapEnabled
            ? {
                x: snap(interaction.lastWorld.x, Math.max(1, gridSize)),
                y: snap(interaction.lastWorld.y, Math.max(1, gridSize)),
              }
            : interaction.lastWorld;
          if (
            canExtendToEmpty({
              pointerTravelPx: interaction.pointerTravel,
              source: interaction.source.point,
              candidate,
              gridSize,
            })
          ) {
            onExtendWireToPoint(attachmentFor(interaction.source), candidate);
          }
        }
      }
      draftTargetRef.current = null;
      setDraftEdge(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "pan") {
      interactionRef.current = null;
      setGuides([]);
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "reattach") {
      if (commit) {
        if (interaction.moved && reattachTargetRef.current !== null) {
          const edgeTarget = "edgeId" in reattachTargetRef.current.attachment;
          const tooClose =
            scene.meta.diagramKind === "circuit" &&
            edgeTarget &&
            interaction.pointerTravel < MIN_EXTEND_SCREEN_PX;
          if (!tooClose) {
            onReattachEdge(
              interaction.edgeId,
              interaction.end,
              reattachTargetRef.current.attachment,
            );
          }
        } else if (
          interaction.moved &&
          scene.meta.diagramKind === "circuit" &&
          !overCircuitComponentBody(layout.nodes, interaction.lastWorld, "")
        ) {
          const candidate = snapEnabled
            ? {
                x: snap(interaction.lastWorld.x, Math.max(1, gridSize)),
                y: snap(interaction.lastWorld.y, Math.max(1, gridSize)),
              }
            : interaction.lastWorld;
          const points = layout.edges[interaction.edgeId]?.points;
          const movingPoint = points === undefined
            ? undefined
            : interaction.end === "source"
              ? points[0]
              : points[points.length - 1];
          if (
            movingPoint !== undefined &&
            canExtendToEmpty({
              pointerTravelPx: interaction.pointerTravel,
              source: movingPoint,
              candidate,
              gridSize,
            })
          ) {
            onReattachEdgeToPoint(interaction.edgeId, interaction.end, candidate);
          }
        } else if (!interaction.moved) {
          openTerminalMenu(interaction.edgeId, interaction.end, false);
        }
      }
      reattachTargetRef.current = null;
      setReattachPreview(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "edge-move") {
      if (commit) {
        if (interaction.moved && Math.abs(interaction.lastDelta) > 0.5) {
          onMoveSequenceEdge(interaction.edgeId, interaction.lastDelta);
        } else if (!interaction.moved) {
          openLineMenuAt(interaction.edgeId, interaction.startWorld, true);
        }
      }
      setSequenceMovePreview(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "edge-slide") {
      if (commit) {
        if (interaction.moved) {
          onSlideStraightEdge(interaction.edgeId, interaction.lastPosition);
        } else {
          openLineMenuAt(interaction.edgeId, interaction.startWorld, true);
        }
      }
      setEdgeSlidePreview(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "edge-press") {
      if (commit) {
        const edge = scene.edges[interaction.edgeId];
        const edgeLayout = layout.edges[interaction.edgeId];
        if (interaction.moved) {
          // Re-check on release: the route or endpoint alignment may have
          // changed since pointerdown, so a drag can still become a slide.
          const slide = edge === undefined || edgeLayout === undefined
            ? null
            : straightSlideInfo(edge, scene, edgeLayout.points, gridSize);
          const firstPoint = edgeLayout?.points[0];
          if (slide !== null && firstPoint !== undefined) {
            const pointerAxis = slide.axis === "y"
              ? interaction.lastWorld.y
              : interaction.lastWorld.x;
            const originAxis = slide.axis === "y"
              ? interaction.startWorld.y
              : interaction.startWorld.x;
            const startPosition = slide.axis === "y" ? firstPoint.y : firstPoint.x;
            const step = snapEnabled ? Math.max(1, gridSize) : 1;
            const position = Math.min(
              slide.max,
              Math.max(slide.min, startPosition + snap(pointerAxis - originAxis, step)),
            );
            onSlideStraightEdge(interaction.edgeId, position);
          }
        } else if (interaction.end !== null) {
          // Menus are deferred to pointer release so a press that turns into
          // a drag never flashes a popover under the pointer.
          openTerminalMenu(interaction.edgeId, interaction.end, false);
        } else {
          // Also redo the straight-line check on a plain click; it keeps the
          // hit-test and slide eligibility in sync with the latest layout.
          if (edge !== undefined && edgeLayout !== undefined) {
            straightSlideInfo(edge, scene, edgeLayout.points, gridSize);
          }
          openLineMenuAt(interaction.edgeId, interaction.startWorld, true);
        }
      }
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "node-label-drag") {
      if (commit && interaction.moved) {
        const localDelta = interaction.rotation === 0
          ? interaction.lastDelta
          : rotatePoint(interaction.lastDelta, -interaction.rotation);
        onMoveNodeLabel(
          interaction.nodeId,
          add(interaction.startOffset, localDelta),
        );
      }
      setNodeLabelDraft(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind === "label-drag") {
      if (commit) {
        if (interaction.moved) {
          onMoveEdgeLabel(interaction.edgeId, interaction.labelId, {
            x: interaction.startOffset.x + interaction.lastDelta.x,
            y: interaction.startOffset.y + interaction.lastDelta.y,
          });
        } else if (interaction.menu === "line") {
          openLineMenuAt(interaction.edgeId, interaction.startWorld, true);
        } else if (interaction.end !== undefined) {
          openTerminalMenu(interaction.edgeId, interaction.end, false);
        }
      }
      setLabelDraft(null);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (
      interaction.kind === "drag" &&
      commit &&
      duplicateIntentRef.current !== null &&
      !duplicateDragRef.current
    ) {
      const nodeId = ctrlClickToggleRef.current;
      duplicateIntentRef.current = null;
      ctrlClickToggleRef.current = null;
      suppressNextNodePartClick();
      if (nodeId !== null) onToggleNodeSelection(nodeId);
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (
      interaction.kind === "drag" &&
      commit &&
      detachIntentRef.current !== null &&
      !detachDragRef.current
    ) {
      detachIntentRef.current = null;
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }

    if (interaction.kind !== "drag" && interaction.kind !== "resize") return;
    const childChanged =
      interaction.kind === "drag" &&
      Object.entries(interaction.lastChildFrames).some(([childId, frame]) => {
        const start = interaction.childStartFrames[childId];
        return start !== undefined &&
          (Math.abs(frame.x - start.x) > 1e-6 || Math.abs(frame.y - start.y) > 1e-6);
      });
    const changed =
      childChanged ||
      Math.abs(interaction.lastFrame.x - interaction.startFrame.x) > 1e-6 ||
      Math.abs(interaction.lastFrame.y - interaction.startFrame.y) > 1e-6 ||
      Math.abs(interaction.lastFrame.width - interaction.startFrame.width) > 1e-6 ||
      Math.abs(interaction.lastFrame.height - interaction.startFrame.height) > 1e-6;
    const movedDrag = interaction.kind === "drag" && interaction.captured;
    const shouldCommit =
      changed && (interaction.kind === "resize" || movedDrag);
    const committedFrames = {
      [interaction.nodeId]: interaction.lastFrame,
      ...(interaction.kind === "drag" ? interaction.lastChildFrames : {}),
    };
    const insertNodeId = wireInsertNodeIdRef.current;
    let insertTargetCurrent = insertTargetRef.current;
    if (
      insertNodeId !== null &&
      insertTargetCurrent === null &&
      interaction.kind === "drag"
    ) {
      insertTargetCurrent = nearestInsertionTarget(
        Object.values(layout.edges),
        {
          x: interaction.lastFrame.x + interaction.lastFrame.width / 2,
          y: interaction.lastFrame.y + interaction.lastFrame.height / 2,
        },
        Math.max(18, scene.canvas.grid.size * 2),
      );
    }
    if (
      commit &&
      interaction.kind === "drag" &&
      insertNodeId !== null &&
      insertTargetCurrent !== null
    ) {
      const target = insertTargetCurrent;
      onInsertComponentOnWire(
        insertNodeId,
        target.edgeId,
        target.point,
        target.orientation,
      );
      wireInsertNodeIdRef.current = null;
      insertTargetRef.current = null;
      setInsertTarget(null);
      onPreviewFrames({});
      interactionRef.current = null;
      setPanning(false);
      const pointerId = interaction.pointerId;
      if (svgRef.current?.hasPointerCapture(pointerId) === true) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      return;
    }
    wireInsertNodeIdRef.current = null;
    insertTargetRef.current = null;
    setInsertTarget(null);
    if (commit && shouldCommit) {
      if (interaction.kind === "drag" && detachDragRef.current) {
        onCommitDetachDrag(committedFrames);
      } else if (interaction.kind === "drag" && duplicateDragRef.current) {
        onCommitDuplicateDrag(committedFrames);
      } else {
        const branch = branchDragRef.current;
        if (interaction.kind === "drag" && branch !== null) {
          onCommitShiftDrag(committedFrames, branch.groups);
        } else {
          onCommitFrames(committedFrames);
        }
      }
    } else {
      onPreviewFrames({});
    }
    branchDragRef.current = null;
    branchIntentRef.current = null;
    duplicateDragRef.current = false;
    duplicateIntentRef.current = null;
    ctrlClickToggleRef.current = null;
    detachDragRef.current = false;
    detachIntentRef.current = null;
    if (movedDrag && changed) suppressNextNodePartClick();
    interactionRef.current = null;
    setGuides([]);
    setPanning(false);
    const pointerId = interaction.pointerId;
    if (svgRef.current?.hasPointerCapture(pointerId) === true) {
      svgRef.current.releasePointerCapture(pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    if (svg === null) return;
    const screen = pointFromEvent(event, svg);
    lastPointerScreenRef.current = screen;
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    setCursorWorld(world);
    if (wireInsertNodeIdRef.current === null && insertTargetRef.current !== null) {
      insertTargetRef.current = null;
      setInsertTarget(null);
    }

    // Hovering a diagram object reveals its connection handles. Tracking this
    // from the SVG pointer position (rather than the node's own pointerleave)
    // keeps the handles mounted while the pointer travels to a perimeter port.
    const hoverMargin = 10 / zoomRef.current;
    const hoveredObject = Object.values(layout.nodes)
      .filter((nodeLayout) => scene.nodes[nodeLayout.nodeId]?.visible !== false)
      .sort((a, b) =>
        (scene.nodes[b.nodeId]?.z ?? 0) - (scene.nodes[a.nodeId]?.z ?? 0))
      .find((nodeLayout) =>
        nodeLayout.kind === "circuitComponent"
          ? circuitOutlineContains(world, nodeLayout.focusOutline, hoverMargin)
          : rectContainsPoint(
              expandRect(selectionFrameFor(nodeLayout), hoverMargin),
              world,
            ),
      );
    setHoveredObjectNodeId(hoveredObject?.nodeId ?? null);

    const nearby = nearestPort(layout.ports, world, 9 / zoomRef.current);
    setHoveredPort(nearby);

    let interaction = interactionRef.current;
    if (interaction === null) return;
    if (
      interaction.kind === "drag" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      wireInsertNodeIdRef.current === null &&
      branchDragRef.current === null &&
      selectedNodeIds.length <= 1
    ) {
      const dragged = scene.nodes[interaction.nodeId];
      if (dragged?.kind === "circuitComponent") {
        const definition = circuitComponent(dragged.component);
        const unconnected = definition !== undefined &&
          definition.pins.length === 2 &&
          !Object.values(scene.edges).some(
            (edge) =>
              edge.semantic.family === "circuit" &&
              definition.pins.some(
                (pin) =>
                  (edge.source.target === "node" &&
                    edge.source.nodeId === dragged.id &&
                    edge.source.port.kind === "pin" &&
                    edge.source.port.pinId === pin.id) ||
                  (edge.target.target === "node" &&
                    edge.target.nodeId === dragged.id &&
                    edge.target.port.kind === "pin" &&
                    edge.target.port.pinId === pin.id),
              ),
          );
        if (unconnected) wireInsertNodeIdRef.current = dragged.id;
      }
    }

    if (interaction.kind === "marquee") {
      const moved = interaction.moved ||
        Math.hypot(world.x - interaction.startWorld.x, world.y - interaction.startWorld.y) *
          zoomRef.current > 3;
      interaction.moved = moved;
      interaction.currentWorld = world;
      setMarquee(moved ? rectFromPoints(interaction.startWorld, world) : null);
      return;
    }

    if (interaction.kind === "draw") {
      interaction.lastWorld = world;
      interaction.pointerTravel = Math.hypot(
        screen.x - interaction.startScreen.x,
        screen.y - interaction.startScreen.y,
      );
      if (interaction.pointerTravel > 3) portClickFocusRef.current = null;
      const rawTarget = findDrawTarget(
        world,
        interaction.source.nodeId,
        undefined,
        interaction.source.point,
      );
      const target = rawTarget === null
        ? null
        : snapDrawTarget(rawTarget, interaction.source.point, event.altKey);
      draftTargetRef.current = target;
      setDraftEdge({
        from: interaction.source.point,
        to: target?.point ?? world,
        snapped: target !== null,
      });
      return;
    }

    if (interaction.kind === "reattach") {
      interaction.lastWorld = world;
      interaction.pointerTravel = Math.hypot(
        screen.x - interaction.startScreen.x,
        screen.y - interaction.startScreen.y,
      );
      const moved = interaction.moved ||
        interaction.pointerTravel > 3;
      interaction.moved = moved;
      if (!moved) return;
      const edgeLayout = layout.edges[interaction.edgeId];
      if (edgeLayout === undefined || edgeLayout.points.length < 2) return;
      const fixed = interaction.end === "source"
        ? edgeLayout.points[edgeLayout.points.length - 1]
        : edgeLayout.points[0];
      if (fixed === undefined) return;
      const rawTarget = findDrawTarget(world, "", interaction.edgeId, fixed);
      const target = rawTarget === null
        ? null
        : snapDrawTarget(rawTarget, fixed, event.altKey);
      reattachTargetRef.current = target;
      setReattachPreview({
        edgeId: interaction.edgeId,
        from: fixed,
        to: target?.point ?? world,
        snapped: target !== null,
      });
      return;
    }

    if (interaction.kind === "edge-move") {
      const moved = interaction.moved ||
        Math.hypot(world.x - interaction.startWorld.x, world.y - interaction.startWorld.y) * zoomRef.current > 3;
      interaction.moved = moved;
      if (!moved) return;
      const deltaY = snap(world.y - interaction.startWorld.y, Math.max(1, gridSize));
      interaction.lastDelta = deltaY;
      setSequenceMovePreview({ edgeId: interaction.edgeId, deltaY });
      return;
    }

    if (interaction.kind === "edge-press") {
      interaction.lastWorld = world;
      interaction.pointerTravel = Math.hypot(
        world.x - interaction.startWorld.x,
        world.y - interaction.startWorld.y,
      ) * zoomRef.current;
      interaction.moved = interaction.moved || interaction.pointerTravel > 3;
      return;
    }

    if (interaction.kind === "edge-slide") {
      const moved = interaction.moved ||
        Math.hypot(world.x - interaction.startWorld.x, world.y - interaction.startWorld.y) * zoomRef.current > 3;
      interaction.moved = moved;
      if (!moved) return;
      const pointerAxis = interaction.axis === "y" ? world.y : world.x;
      const originAxis = interaction.axis === "y"
        ? interaction.startWorld.y
        : interaction.startWorld.x;
      const step = snapEnabled ? Math.max(1, gridSize) : 1;
      const position = Math.min(
        interaction.max,
        Math.max(
          interaction.min,
          interaction.startPosition + snap(pointerAxis - originAxis, step),
        ),
      );
      interaction.lastPosition = position;
      setEdgeSlidePreview({
        edgeId: interaction.edgeId,
        axis: interaction.axis,
        position,
      });
      return;
    }

    if (interaction.kind === "label-drag") {
      const delta = {
        x: world.x - interaction.startWorld.x,
        y: world.y - interaction.startWorld.y,
      };
      const moved = interaction.moved ||
        Math.hypot(delta.x, delta.y) * zoomRef.current > 3;
      interaction.moved = moved;
      interaction.lastDelta = delta;
      if (moved) {
        labelPressRef.current = null;
        setLabelDraft({
          edgeId: interaction.edgeId,
          labelId: interaction.labelId,
          delta,
        });
      }
      return;
    }

    if (interaction.kind === "node-label-drag") {
      const delta = {
        x: world.x - interaction.startWorld.x,
        y: world.y - interaction.startWorld.y,
      };
      const moved = interaction.moved ||
        Math.hypot(delta.x, delta.y) * zoomRef.current > 3;
      interaction.moved = moved;
      interaction.lastDelta = delta;
      if (moved) {
        setNodeLabelDraft({ nodeId: interaction.nodeId, delta });
      }
      return;
    }

    if (interaction.kind === "edge-translate") {
      const rawDelta = interaction.axis === "x"
        ? world.x - interaction.startWorld.x
        : world.y - interaction.startWorld.y;
      const delta = snap(rawDelta, Math.max(1, gridSize));
      interaction.moved = interaction.moved || Math.abs(delta) > 1e-6;
      const frames: Record<string, Rect> = {};
      for (const [id, frame] of Object.entries(interaction.startFrames)) {
        frames[id] = {
          ...frame,
          x: frame.x + (interaction.axis === "x" ? delta : 0),
          y: frame.y + (interaction.axis === "y" ? delta : 0),
        };
      }
      interaction.lastFrames = frames;
      if (interaction.moved) onPreviewFrames(frames);
      return;
    }

    if (interaction.kind === "rotate") {
      const centerScreen = {
        x: interaction.center.x * zoomRef.current + cameraRef.current.x,
        y: interaction.center.y * zoomRef.current + cameraRef.current.y,
      };
      const angle = (Math.atan2(screen.y - centerScreen.y, screen.x - centerScreen.x) * 180) / Math.PI;
      const rawRotation =
        interaction.startRotation + (angle - interaction.startPointerAngle);
      const rotatingNode = scene.nodes[interaction.nodeId];
      if (
        rotatingNode?.kind === "circuitJunction" &&
        rotatingNode.measurement !== undefined
      ) {
        const wrapped = ((rawRotation % 360) + 360) % 360;
        const nearest = (Math.round(wrapped / 45) * 45) % 360;
        interaction.lastRotation =
          Math.abs(wrapped - nearest) <= 4
            ? nearest
            : Math.round(wrapped * 10) / 10;
      } else {
        interaction.lastRotation = normalizeRotation(rawRotation);
      }
      const radians = (angle * Math.PI) / 180;
      setRotationHandleOverride({
        nodeId: interaction.nodeId,
        point: {
          x: interaction.center.x + interaction.radius * Math.cos(radians),
          y: interaction.center.y + interaction.radius * Math.sin(radians),
        },
      });
      onPreviewRotation(interaction.nodeId, interaction.lastRotation);
      return;
    }

    if (interaction.kind === "activation-move" || interaction.kind === "activation-resize") {
      const deltaY = world.y - interaction.startWorld.y;
      const grid = Math.max(1, gridSize);
      const minimumHeight = Math.max(18, grid * 2);
      let top = interaction.startTop;
      let height = interaction.startHeight;

      if (interaction.kind === "activation-move") {
        top = clampValue(
          snap(interaction.startTop + deltaY, grid),
          0,
          Math.max(0, interaction.frameHeight - interaction.startHeight),
        );
      } else if (interaction.edge === "bottom") {
        height = clampValue(
          snap(interaction.startHeight + deltaY, grid),
          minimumHeight,
          Math.max(minimumHeight, interaction.frameHeight - interaction.startTop),
        );
      } else {
        const fixedBottom = interaction.startTop + interaction.startHeight;
        top = clampValue(
          snap(interaction.startTop + deltaY, grid),
          0,
          Math.max(0, fixedBottom - minimumHeight),
        );
        height = fixedBottom - top;
      }

      interaction.lastTop = top;
      interaction.lastHeight = height;
      setActivationDraft({
        nodeId: interaction.nodeId,
        id: interaction.activationId,
        top,
        height,
      });
      return;
    }

    if (interaction.kind === "pan") {
      const dx = screen.x - interaction.startScreen.x;
      const dy = screen.y - interaction.startScreen.y;
      if (Math.hypot(dx, dy) > 3) panMovedRef.current = true;
      onViewChangeRef.current(
        { x: interaction.startCamera.x + dx, y: interaction.startCamera.y + dy },
        zoomRef.current,
      );
      return;
    }

    if (interaction.kind !== "drag" && interaction.kind !== "resize") return;
    const activeNodeId = interaction.nodeId;
    const delta = sub(world, interaction.startWorld);
    if (
      interaction.kind === "drag" &&
      !interaction.captured &&
      Math.hypot(delta.x, delta.y) * zoomRef.current > 3
    ) {
      try {
        svg.setPointerCapture(event.pointerId);
        interaction.captured = true;
      } catch {
        // Synthetic pointer events cannot own capture.
      }
    }
    const childIds = interaction.kind === "drag" ? interaction.childIds : [];
    const others = Object.values(layout.nodes).filter(
      (node) =>
        node.nodeId !== activeNodeId &&
        !childIds.includes(node.nodeId),
    );

    if (interaction.kind === "drag") {
      const candidate = {
        ...interaction.startFrame,
        x: interaction.startFrame.x + delta.x,
        y: interaction.startFrame.y + delta.y,
      };
      const snapped = snapMovingFrame(candidate, {
        gridSize,
        gridEnabled: snapEnabled,
        alignmentEnabled: snapEnabled,
        threshold: 6 / zoomRef.current,
        others,
      });
      interaction.lastFrame = snapped.frame;
      if (interaction.captured && detachIntentRef.current !== null) {
        const detached = detachCircuitComponentEndings(
          sceneRef.current,
          detachIntentRef.current,
        );
        detachIntentRef.current = null;
        if (detached !== sceneRef.current) {
          onBeginDetachDrag(detached);
          detachDragRef.current = true;
        }
      }
      if (wireInsertNodeIdRef.current !== null) {
        const target = nearestInsertionTarget(
          Object.values(layout.edges),
          {
            x: snapped.frame.x + snapped.frame.width / 2,
            y: snapped.frame.y + snapped.frame.height / 2,
          },
          Math.max(12, scene.canvas.grid.size),
        );
        insertTargetRef.current = target;
        setInsertTarget(target);
      }
      if (
        duplicateIntentRef.current !== null &&
        (snapped.frame.x !== interaction.startFrame.x ||
          snapped.frame.y !== interaction.startFrame.y)
      ) {
        const intent = duplicateIntentRef.current;
        const payload = copySceneNodes(sceneRef.current, intent.nodeIds);
        const duplicated = payload === null
          ? null
          : pasteSceneClipboard(sceneRef.current, payload, { x: 0, y: 0 });
        duplicateIntentRef.current = null;
        ctrlClickToggleRef.current = null;
        if (duplicated !== null && duplicated.nodeIds[0] !== undefined) {
          const duplicateIds = duplicated.nodeIds.map(String);
          const primaryDuplicateId = duplicateIds[0]!;
          let duplicateScene = duplicated.scene;
          let parallelGroup2Ids: string[] = [];
          if (
            intent.parallelBranch &&
            event.shiftKey &&
            sceneRef.current.meta.diagramKind === "circuit"
          ) {
            const pairs = intent.nodeIds.flatMap((sourceId) => {
              const duplicateId = duplicated.nodeIdMap.get(asNodeId(sourceId));
              if (duplicateId === undefined) return [];
              const source = sceneRef.current.nodes[sourceId];
              const duplicate = duplicated.scene.nodes[duplicateId];
              if (
                source?.kind !== "circuitComponent" ||
                duplicate?.kind !== "circuitComponent"
              ) {
                return [];
              }
              return [{ sourceId: asNodeId(sourceId), duplicateId }];
            });
            const junctionPairs = intent.nodeIds.flatMap((sourceId) => {
              const duplicateId = duplicated.nodeIdMap.get(asNodeId(sourceId));
              if (duplicateId === undefined) return [];
              const source = sceneRef.current.nodes[sourceId];
              const duplicate = duplicated.scene.nodes[duplicateId];
              if (
                source?.kind !== "circuitJunction" ||
                duplicate?.kind !== "circuitJunction"
              ) {
                return [];
              }
              return [{ sourceId: asNodeId(sourceId), duplicateId }];
            });
            if (pairs.length > 0 || junctionPairs.length > 0) {
              const parallel = createDuplicateParallelBranches(
                duplicateScene,
                pairs,
                Math.max(0, branchDistance) * sceneRef.current.canvas.grid.size,
                intent.nodeIds.map((id) => asNodeId(id)),
                junctionPairs,
              );
              duplicateScene = parallel.scene;
              parallelGroup2Ids = parallel.group2Ids.map(String);
              setBranchDistance(0);
              setBranchTargetIds([]);
            }
          }
          const originalPrimary = duplicateScene.nodes[primaryDuplicateId];
          const childIds = [...duplicateIds.slice(1), ...parallelGroup2Ids];
          const childStartFrames: Record<string, Rect> = {};
          const lastChildFrames: Record<string, Rect> = {};
          const delta = {
            x: snapped.frame.x - interaction.startFrame.x,
            y: snapped.frame.y - interaction.startFrame.y,
          };
          for (const id of childIds) {
            const frame = duplicateScene.nodes[id]?.frame;
            if (frame === undefined) continue;
            childStartFrames[id] = frame;
            lastChildFrames[id] = {
              ...frame,
              x: frame.x + delta.x,
              y: frame.y + delta.y,
            };
          }
          onBeginDuplicateDrag(duplicateScene, duplicateIds);
          interaction = {
            kind: "drag",
            pointerId: interaction.pointerId,
            nodeId: primaryDuplicateId,
            startWorld: interaction.startWorld,
            startFrame: originalPrimary?.frame ?? interaction.startFrame,
            childIds,
            childStartFrames,
            captured: true,
            lastFrame: snapped.frame,
            lastChildFrames,
          };
          interactionRef.current = interaction;
          duplicateDragRef.current = true;
        }
      }
      if (
        branchIntentRef.current !== null &&
        (Math.abs(snapped.frame.x - interaction.startFrame.x) >= gridSize - 1e-6 ||
          Math.abs(snapped.frame.y - interaction.startFrame.y) >= gridSize - 1e-6)
      ) {
        const result = createShiftDragBranchesResult(
          sceneRef.current,
          branchIntentRef.current,
          false,
        );
        branchIntentRef.current = null;
        if (result.groups.length > 0) {
          onBeginShiftDrag(result.scene);
          const branchFrames: Record<string, Rect> = {};
          for (const group2Id of result.group2Ids) {
            const frame = result.scene.nodes[group2Id]?.frame;
            if (frame !== undefined) branchFrames[group2Id] = frame;
          }
          interaction.childIds = [...interaction.childIds, ...result.group2Ids];
          interaction.childStartFrames = {
            ...interaction.childStartFrames,
            ...branchFrames,
          };
          interaction.lastChildFrames = {
            ...interaction.lastChildFrames,
            ...branchFrames,
          };
          branchDragRef.current = { groups: result.groups };
        }
      }
      if (scene.meta.diagramKind === "circuit" && wireInsertNodeIdRef.current === null) {
        setCoincidentHighlights(
          coincidentDragHighlights(
            scene,
            layout,
            {
              nodeId: interaction.nodeId,
              frame: snapped.frame,
              childIds: interaction.childIds,
              childFrames: interaction.lastChildFrames,
            },
          ),
        );
      } else {
        setCoincidentHighlights([]);
      }
      const childDelta = {
        x: snapped.frame.x - interaction.startFrame.x,
        y: snapped.frame.y - interaction.startFrame.y,
      };
      const childFrames: Record<string, Rect> = {};
      for (const childId of interaction.childIds) {
        const start = interaction.childStartFrames[childId];
        if (start === undefined) continue;
        childFrames[childId] = {
          ...start,
          x: start.x + childDelta.x,
          y: start.y + childDelta.y,
        };
      }
      interaction.lastChildFrames = childFrames;
      setGuides(snapped.guides);
      onPreviewFrames({ [interaction.nodeId]: snapped.frame, ...childFrames });
      return;
    }

    const resizedNode = scene.nodes[interaction.nodeId];
    const imageLayout =
      resizedNode?.kind === "image" ? layout.nodes[interaction.nodeId] : undefined;
    const aspectRatio =
      imageLayout?.kind === "image"
        ? imageLayout.imageFrame.width / Math.max(1, imageLayout.imageFrame.height)
        : undefined;
    const extraHeight =
      imageLayout?.kind === "image"
        ? imageLayout.frame.height - imageLayout.imageFrame.height
        : 0;
    const snapped = resizeFrameFromCorner(
      interaction.startFrame,
      interaction.corner,
      delta,
      gridSize,
      snapEnabled,
      aspectRatio,
      extraHeight,
    );
    interaction.lastFrame = snapped;
    setGuides([]);
    onPreviewFrames({ [interaction.nodeId]: snapped });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>): void => {
    const pendingSplit = pendingEdgeSplitRef.current;
    if (pendingSplit !== null) {
      pendingEdgeSplitRef.current = null;
      if (pendingSplit.pointerId === event.pointerId) {
        onAddJunctionAtWire(pendingSplit.edgeId, pendingSplit.point);
        event.preventDefault();
        return;
      }
    }
    const interaction = interactionRef.current;
    if (interaction?.kind === "marquee") {
      const svg = svgRef.current;
      if (svg !== null) {
        // Pointer-up can land at a position that had no preceding pointermove
        // (fast release, touch, or a pointer captured on the way out). Commit
        // the marquee against the release position, not a stale move.
        const screen = pointFromEvent(event, svg);
        const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
        interaction.currentWorld = world;
        interaction.moved = interaction.moved ||
          Math.hypot(
            world.x - interaction.startWorld.x,
            world.y - interaction.startWorld.y,
          ) * zoomRef.current > 3;
      }
    }
    finish(true);
  };

  const handlePointerCancel = (event: React.PointerEvent<SVGSVGElement>): void => {
    event.preventDefault();
    finish(false);
  };

  const suppressNextNodePartClick = (): void => {
    suppressNodePartClickRef.current = true;
    window.setTimeout(() => {
      suppressNodePartClickRef.current = false;
    }, 0);
  };

  const handleNodePartClick = (focus: NodeFocus): void => {
    if (suppressNodePartClickRef.current) {
      suppressNodePartClickRef.current = false;
      return;
    }
    onNodePartClick(focus);
  };

  const singleSelectedNodeId = selectedNodeIds.length === 1
    ? selectedNodeId ?? selectedNodeIds[0] ?? null
    : null;
  const selectedLayout =
    singleSelectedNodeId === null ? undefined : layout.nodes[singleSelectedNodeId];
  const selectedResizeFrame =
    selectedLayout?.kind === "circuitJunction"
      ? selectedLayout.hitFrame ?? selectedLayout.frame
      : selectedLayout?.frame;
  const rotateHandle =
    selectedLayout !== undefined &&
    (selectedLayout.kind === "circuitComponent" ||
      (selectedLayout.kind === "circuitJunction" &&
        selectedLayout.measurement !== undefined))
      ? (() => {
          const rotation =
            selectedLayout.kind === "circuitComponent"
              ? selectedLayout.rotation
              : selectedLayout.rotation;
          const geometry = circuitRotateHandleGeometry(
            selectedLayout.frame,
            rotation,
            zoom,
          );
          const override = rotationHandleOverride?.nodeId === selectedLayout.nodeId
            ? rotationHandleOverride.point
            : null;
          return {
            nodeId: selectedLayout.nodeId,
            x: override?.x ?? geometry.point.x,
            y: override?.y ?? geometry.point.y,
            center: geometry.center,
            rotation,
            measurement: selectedLayout.kind === "circuitJunction",
          };
        })()
      : null;
  const selectedPorts = singleSelectedNodeId === null
    ? []
    : (() => {
        const selectedNodeLayout = layout.nodes[singleSelectedNodeId];
        if (
          selectedNodeLayout?.kind === "circuitJunction" &&
          selectedNodeLayout.measurement !== undefined
        ) {
          return [];
        }
        if (
          selectedNodeLayout?.kind === "circuitComponent" &&
          hoveredObjectNodeId !== singleSelectedNodeId &&
          hoveredPort?.nodeId !== singleSelectedNodeId
        ) {
          return [];
        }
        return snapHandlesForNode(layout.ports, singleSelectedNodeId);
      })();
  const hoveredPorts =
    hoveredObjectNodeId === null ||
    selectedEdgeIds.length > 0 ||
    (layout.nodes[hoveredObjectNodeId]?.kind === "circuitJunction" &&
      layout.nodes[hoveredObjectNodeId].measurement !== undefined)
      ? []
      : snapHandlesForNode(layout.ports, hoveredObjectNodeId);
  const visiblePorts = (() => {
    const seen = new Set<string>();
    return [...selectedPorts, ...hoveredPorts].filter((port) => {
      if (seen.has(port.id)) return false;
      seen.add(port.id);
      return true;
    });
  })();
  const selectedActivationFrame = (() => {
    if (selectedActivation === null) return null;
    const nodeLayout = layout.nodes[selectedActivation.nodeId];
    if (nodeLayout === undefined || nodeLayout.kind !== "lifeline") return null;
    const activation = nodeLayout.activations.find(
      (candidate) => candidate.id === selectedActivation.activationId,
    );
    if (activation === undefined) return null;
    const draft = activationDraft?.id === activation.id ? activationDraft : null;
    return {
      x: activation.frame.x,
      y: draft === null ? activation.frame.y : nodeLayout.frame.y + draft.top,
      width: activation.frame.width,
      height: draft === null ? activation.frame.height : draft.height,
      centerX: activation.frame.x + activation.frame.width / 2,
    };
  })();
  const sequenceMode = scene.meta.diagramKind === "uml-sequence";
  const edgeItems = Object.values(scene.edges)
    .sort((a, b) => a.z - b.z)
    .flatMap((edge) => {
      if (sequenceMovePreview?.edgeId === edge.id) return [];
      const edgeLayout = layout.edges[edge.id];
      if (edgeLayout === undefined) return [];
      const markers =
        edge.semantic.family === "sequence" &&
        edge.markers.source.family === "none" &&
        edge.markers.target.family === "none"
          ? {
              source: { family: "none" as const, kind: "none" as const },
              target:
                edge.semantic.messageKind === "reply"
                  ? { family: "generic" as const, kind: "arrow" as const }
                  : { family: "generic" as const, kind: "filledArrow" as const },
            }
          : edge.markers;
      const centerColor = scene.meta.diagramKind === "circuit"
        ? edge.labels.find((label) => label.zone === "center")?.textStyle?.color
        : undefined;
      const baseStroke = scene.meta.diagramKind === "circuit"
        ? scene.theme.shape.stroke
        : edge.style.stroke;
      return [
        edgeLayerItem(
          edgeLayout,
          markers,
          centerColor === undefined
            ? baseStroke
            : { ...baseStroke, color: centerColor },
          scene.meta.diagramKind !== "circuit",
        ),
      ];
    });

  const sortedNodes = Object.values(layout.nodes).sort((a, b) => {
    const nodeA = scene.nodes[a.nodeId];
    const nodeB = scene.nodes[b.nodeId];
    return (nodeA?.z ?? 0) - (nodeB?.z ?? 0);
  });

  const hitEdges = Object.values(scene.edges).flatMap((edge) => {
    const edgeLayout = layout.edges[edge.id];
    return edgeLayout === undefined ? [] : [{ id: edge.id, points: edgeLayout.points }];
  });
  const slideEdgeIds = new Set(
    hitEdges.flatMap(({ id, points }) => {
      const edge = scene.edges[id];
      return edge !== undefined && straightSlideInfo(edge, scene, points, gridSize) !== null
        ? [id]
        : [];
    }),
  );
  const terminalHitItems = Object.values(scene.edges).flatMap((edge) => {
    if (scene.meta.diagramKind === "circuit") return [];
    const edgeLayout = layout.edges[edge.id];
    return edgeLayout === undefined ? [] : [{ id: edge.id, layout: edgeLayout }];
  });
  const centerLabelHitItems = scene.meta.diagramKind === "circuit"
    ? Object.values(scene.edges).flatMap((edge) => {
        const edgeLayout = layout.edges[edge.id];
        return edgeLayout === undefined ? [] : [{ id: edge.id, layout: edgeLayout }];
      })
    : terminalHitItems;
  const nodeLabelHitItems = scene.meta.diagramKind === "circuit"
    ? Object.values(layout.nodes).flatMap((nodeLayout) => {
        const node = scene.nodes[nodeLayout.nodeId];
        if (
          node === undefined ||
          (node.kind !== "circuitComponent" && node.kind !== "circuitJunction") ||
          nodeLayout.kind !== node.kind ||
          node.visible === false ||
          nodeLayout.labelFrame === undefined
        ) {
          return [];
        }
        return [{ id: node.id, frame: nodeLayout.labelFrame }];
      })
    : [];
  const branchIndicators = branchDistance > 0 && branchTargetIds.length > 0
    ? (() => {
        const selected = new Set(branchTargetIds);
        const distance = branchDistance * scene.canvas.grid.size;
        return branchTargetIds.flatMap((nodeId) => {
          const nodeLayout = layout.nodes[nodeId];
          if (nodeLayout?.kind === "circuitJunction") {
            return [
              point(
                nodeLayout.center.x + distance,
                nodeLayout.center.y,
              ),
            ];
          }
          if (nodeLayout?.kind !== "circuitComponent") return [];
          return nodeLayout.pins.flatMap((pin) => {
            const external = Object.values(scene.edges).some((edge) => {
              const atPin =
                (edge.source.target === "node" &&
                  edge.source.nodeId === nodeId &&
                  edge.source.port.kind === "pin" &&
                  edge.source.port.pinId === pin.pinId) ||
                (edge.target.target === "node" &&
                  edge.target.nodeId === nodeId &&
                  edge.target.port.kind === "pin" &&
                  edge.target.port.pinId === pin.pinId);
              if (!atPin) return false;
              const other = edge.source.target === "node" &&
                edge.source.nodeId === nodeId &&
                edge.source.port.kind === "pin" &&
                edge.source.port.pinId === pin.pinId
                ? edge.target
                : edge.source;
              return other.target !== "node" || !selected.has(other.nodeId);
            });
            if (!external) return [];
            return [add(pin.point, scale(pin.normal, distance))];
          });
        });
      })()
    : [];
  const selectedEdge = selectedEdgeId === null ? undefined : scene.edges[selectedEdgeId];
  const selectedEdgeLayout = selectedEdgeId === null ? undefined : layout.edges[selectedEdgeId];
  const centerLabel = selectedEdgeLayout?.labels.find((label) => label.zone === "center");
  const canConvertCenterLabel =
    scene.meta.diagramKind === "er" &&
    selectedEdge !== undefined &&
    selectedEdgeLayout !== undefined &&
    selectedEdge.semantic.family === "er" &&
    selectedEdge.source.target !== "edge" &&
    selectedEdge.target.target !== "edge" &&
    centerLabel !== undefined &&
    centerLabel.text.text.trim().length > 0;
  const convertCenterLabel = (): void => {
    if (!canConvertCenterLabel || selectedEdge === undefined || centerLabel === undefined) return;
    const anchor = {
      x: centerLabel.frame.x + centerLabel.frame.width / 2,
      y: centerLabel.frame.y + centerLabel.frame.height / 2,
    };
    onConvertToRelationAttribute(
      selectedEdge.id,
      { x: anchor.x, y: anchor.y + 108 },
      anchor,
    );
    setLinePopover(null);
  };
  const focusNode = nodeFocus === null ? undefined : scene.nodes[nodeFocus.nodeId];
  const focusJunctionWireCount = focusNode?.kind === "circuitJunction"
    ? Object.values(scene.edges).filter(
        (edge) =>
          edge.semantic.family === "circuit" &&
          ((edge.source.target === "node" &&
            edge.source.nodeId === focusNode.id &&
            edge.source.port.kind === "center") ||
            (edge.target.target === "node" &&
              edge.target.nodeId === focusNode.id &&
              edge.target.port.kind === "center")),
      ).length
    : 0;
  const focusLayout = nodeFocus === null ? undefined : layout.nodes[nodeFocus.nodeId];
  const focusFrame = (() => {
    if (nodeFocus === null || focusLayout === undefined) return null;
    if (nodeFocus.kind === "table") {
      return focusLayout.kind === "table" || focusLayout.kind === "relationAttribute"
        ? focusLayout.header.frame
        : focusLayout.frame;
    }
    if (nodeFocus.kind === "section") {
      if (focusLayout.kind !== "table" && focusLayout.kind !== "relationAttribute") return focusLayout.frame;
      return focusLayout.sections.find((section) => section.sectionId === nodeFocus.sectionId)?.frame ?? focusLayout.frame;
    }
    if (nodeFocus.kind === "row") {
      if (focusLayout.kind !== "table" && focusLayout.kind !== "relationAttribute") return focusLayout.frame;
      return focusLayout.sections
        .flatMap((section) => section.rows)
        .find((row) => row.rowId === nodeFocus.rowId)?.frame ?? focusLayout.frame;
    }
    if (focusLayout.kind === "lifeline") {
      if (nodeFocus.kind === "lifelineSpine") {
        return {
          x: focusLayout.spine.from.x - 8,
          y: nodeFocus.y - 9,
          width: 16,
          height: 18,
        };
      }
      return focusLayout.headFrame;
    }
    if (focusLayout.kind === "circuitJunction") {
      if (focusLayout.measurement !== undefined) {
        return focusLayout.hitFrame ?? focusLayout.frame;
      }
      const size = Math.max(1, scene.canvas.grid.size);
      return {
        x: focusLayout.center.x - size / 2,
        y: focusLayout.center.y - size / 2,
        width: size,
        height: size,
      };
    }
    return focusLayout.frame;
  })();
  const focusOutline = focusLayout?.kind === "circuitComponent"
    ? focusLayout.focusOutline
    : null;
  const focusHighlights: readonly Rect[] = (() => {
    if (focusLayout === undefined || focusFrame === null) return [];
    if (focusLayout.kind === "circuitComponent") return [];
    if (focusLayout.kind !== "lifeline") return [focusFrame];
    if (nodeFocus?.kind === "lifelineSpine") {
      return [{
        x: focusLayout.spine.from.x - 5,
        y: nodeFocus.y - 7,
        width: 10,
        height: 14,
      }];
    }
    return [
      focusLayout.headFrame,
      {
        x: focusLayout.spine.from.x - 2.5,
        y: focusLayout.spine.from.y,
        width: 5,
        height: Math.max(1, focusLayout.spine.to.y - focusLayout.spine.from.y),
      },
    ];
  })();
  const focusMenuKey = (() => {
    if (nodeFocus === null) return "";
    const part = nodeFocus.kind === "section"
      ? nodeFocus.sectionId
      : nodeFocus.kind === "row"
        ? nodeFocus.rowId
        : nodeFocus.kind === "lifelineSpine"
          ? nodeFocus.y
          : "";
    // Camera/viewport and node movement should move the menu; moving the
    // focused row within its table must not, or reordering would drag the
    // menu with it.
    const anchor = nodeFocus.kind === "row" || focusFrame === null || focusLayout === undefined
      ? ""
      : `${focusFrame.x}:${focusFrame.y}:${focusFrame.width}:${focusFrame.height}:${focusLayout.frame.x}:${focusLayout.frame.y}:${focusLayout.frame.width}:${focusLayout.kind === "circuitComponent" ? focusLayout.rotation : 0}`;
    return `${nodeFocus.nodeId}:${nodeFocus.kind}:${part}:${anchor}:${camera.x}:${camera.y}:${zoom}:${viewport.width}:${viewport.height}`;
  })();
  const focusMenuPosition = useMemo(() => {
    if (focusLayout === undefined || focusFrame === null) return null;
    const width = 320;
    const menuHeight = 390;
    const left = focusLayout.frame.x * zoom + camera.x;
    const right = (focusLayout.frame.x + focusLayout.frame.width) * zoom + camera.x;
    let anchorTop = focusFrame.y * zoom + camera.y;
    let leftPosition: number;
    if (focusLayout.kind === "circuitComponent") {
      const handle = circuitRotateHandleGeometry(
        focusLayout.frame,
        focusLayout.rotation,
        zoom,
      ).point;
      const handleScreen = {
        x: handle.x * zoom + camera.x,
        y: handle.y * zoom + camera.y,
      };
      const bounds = focusLayout.bounds;
      const outlineXs = focusLayout.focusOutline.map((entry) => entry.x);
      const outlineYs = focusLayout.focusOutline.map((entry) => entry.y);
      const leftEdge = Math.min(bounds.x, ...outlineXs);
      const topEdge = Math.min(bounds.y, ...outlineYs);
      const rightEdge = Math.max(bounds.x + bounds.width, ...outlineXs);
      const bottomEdge = Math.max(bounds.y + bounds.height, ...outlineYs);
      const componentLeft = leftEdge * zoom + camera.x;
      const componentTop = topEdge * zoom + camera.y;
      const componentRight = rightEdge * zoom + camera.x;
      const componentBottom = bottomEdge * zoom + camera.y;
      const obstacleLeft = Math.min(componentLeft, handleScreen.x - 8);
      const obstacleRight = Math.max(componentRight, handleScreen.x + 8);
      const preferred = obstacleRight + 16;
      const fallback = obstacleLeft - 16 - width;
      anchorTop = Math.min(componentTop, handleScreen.y - 8);
      if (preferred + width <= viewport.width - 10) {
        leftPosition = preferred;
      } else if (fallback >= 10) {
        leftPosition = fallback;
      } else {
        leftPosition = Math.max(
          10,
          Math.min(componentLeft, Math.max(10, viewport.width - width - 10)),
        );
        const below = Math.max(componentBottom, handleScreen.y + 8) + 16;
        const above = Math.min(componentTop, handleScreen.y - 8) - 16 - menuHeight;
        anchorTop = below + menuHeight <= viewport.height - 10
          ? below
          : Math.max(10, above);
      }
    } else {
      leftPosition = right + 16 + width <= viewport.width - 10
        ? right + 16
        : Math.max(10, left - 16 - width);
    }
    return {
      left: Math.max(10, Math.min(leftPosition, Math.max(10, viewport.width - width - 10))),
      top: Math.max(10, Math.min(anchorTop, Math.max(10, viewport.height - menuHeight))),
    };
    // focusMenuKey intentionally captures only the stable focus identity plus
    // camera/viewport; layout-only row movement keeps the current position.
  }, [focusMenuKey]);
  const terminalPlacement = (() => {
    if (activeEndpoint === null || selectedEdgeLayout === undefined) return null;
    const points = selectedEdgeLayout.points;
    const endPoint = activeEndpoint === "source" ? points[0] : points[points.length - 1];
    const neighbor = activeEndpoint === "source" ? points[1] : points[points.length - 2];
    if (endPoint === undefined || neighbor === undefined) return null;
    const screen = {
      x: endPoint.x * zoom + camera.x,
      y: endPoint.y * zoom + camera.y,
    };
    const direction = {
      x: neighbor.x - endPoint.x,
      y: neighbor.y - endPoint.y,
    };
    const endpointLabel = selectedEdgeLayout.labels.find((label) => label.zone === activeEndpoint);
    const labelCenter = endpointLabel === undefined
      ? null
      : {
          x: (endpointLabel.frame.x + endpointLabel.frame.width / 2) * zoom + camera.x,
          y: (endpointLabel.frame.y + endpointLabel.frame.height / 2) * zoom + camera.y,
        };
    const width = 292;
    const height = 292;
    const gap = 14;
    let left: number;
    let top: number;
    if (Math.abs(direction.x) >= Math.abs(direction.y)) {
      left = direction.x >= 0 ? screen.x + gap : screen.x - gap - width;
      const labelAbove = labelCenter !== null && labelCenter.y < screen.y;
      const roomBelow = screen.y + gap + height <= viewport.height - 10;
      const above = labelAbove ? !roomBelow : screen.y - gap - height >= 10;
      top = above ? screen.y - gap - height : screen.y + gap;
    } else {
      const labelRight = labelCenter !== null && labelCenter.x > screen.x;
      const roomLeft = screen.x - gap - width >= 10;
      const roomRight = screen.x + gap + width <= viewport.width - 10;
      const right = labelRight ? roomLeft : roomRight;
      left = right ? screen.x + gap : screen.x - gap - width;
      top = direction.y < 0 ? screen.y - gap - height : screen.y + gap;
    }
    return {
      left: Math.max(10, Math.min(left, Math.max(10, viewport.width - width - 10))),
      top: Math.max(10, Math.min(top, Math.max(10, viewport.height - height - 10))),
    };
  })();

  const takeCanvasFocus = (event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, button, a, [contenteditable='true']") !== null
    ) {
      return;
    }
    // Canvas pointer handlers preventDefault to keep drags from scrolling or
    // selecting page text, which also means the browser would leave focus in
    // whichever field was last edited. That stale field then receives Delete
    // and Ctrl+C and the object shortcuts bail out. Take focus explicitly.
    containerRef.current?.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection !== null && selection.rangeCount > 0) selection.removeAllRanges();
  };

  return (
    <div
      ref={containerRef}
      className="canvas-stage"
      tabIndex={-1}
      style={{ cursor: panning ? "grabbing" : undefined }}
      onPointerDownCapture={takeCanvasFocus}
      onDragOver={handleImageDragOver}
      onDrop={handleImageDrop}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => {
          lastPointerScreenRef.current = null;
          setHoveredPort(null);
          setHoveredObjectNodeId(null);
        }}
        onContextMenu={handleContextMenu}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
      >
        <rect
          width="100%"
          height="100%"
          fill={scene.canvas.background}
          onPointerDown={handleBackgroundPointerDown}
          data-canvas-background="true"
        />
        <Grid
          width={viewport.width}
          height={viewport.height}
          camera={camera}
          zoom={zoom}
          step={gridSize}
          majorEvery={majorEvery}
          visible={gridVisible}
          theme={scene.theme}
        />
        <g transform={`translate(${camera.x} ${camera.y}) scale(${zoom})`}>
          {!sequenceMode ? <EdgeLayer edges={edgeItems} theme={scene.theme} renderLabels={false} /> : null}
          {/* Hit layers sit below nodes so interior object clicks always win. */}
          <EdgeHitLayer
            edges={hitEdges}
            onSelect={handleEdgePointerDown}
            onReroute={onRerouteEdge}
            allowContextReroute={scene.meta.diagramKind === "circuit"}
            slideEdgeIds={slideEdgeIds}
          />
          <TerminalHitLayer
            edges={terminalHitItems}
            zoom={zoom}
            onReattachStart={(edgeId, end, event) =>
              beginReattach(edgeId, end, event)}
            onHoverTerminal={(edgeId, end, center, radius) =>
              setHoveredTerminal(
                end === null || center === undefined || radius === undefined
                  ? null
                  : { edgeId, end, center, radius },
              )}
            onLabelDragStart={(edgeId, labelId, event, end) =>
              beginLabelDrag(edgeId, labelId, event, "terminal", end)}
            onDoublePress={(edgeId, end) => openTerminalMenu(edgeId, end, true)}
          />
          <CenterLabelHitLayer
            edges={centerLabelHitItems}
            zoom={zoom}
            onDragStart={(edgeId, labelId, event) =>
              beginLabelDrag(edgeId, labelId, event, "line")}
            onDoublePress={(edgeId, world) => openLineMenuAt(edgeId, world, true)}
          />
          {sortedNodes.map((nodeLayout) => {
            const node = scene.nodes[nodeLayout.nodeId];
            if (node === undefined) return null;
            return (
              <NodeSkeleton
                key={node.id}
                node={node}
                layout={nodeLayout}
                theme={scene.theme}
                selected={selectedNodeIds.includes(node.id)}
                gridSize={scene.canvas.grid.size}
                skeleton={false}
                hoveredPart={hoveredNodePart?.nodeId === node.id ? hoveredNodePart : null}
                onHoverPart={(focus) =>
                  setHoveredNodePart((current) =>
                    sameNodeFocus(current, focus) ? current : focus,
                  )}
                imageAsset={
                  node.kind === "image" && node.assetId !== undefined
                    ? imageAssets[node.assetId]
                    : undefined
                }
                onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                onTextDoubleClick={(target) => onTextDoubleClick(node.id, target)}
                onPartClick={handleNodePartClick}
                labelDelta={
                  nodeLabelDraft?.nodeId === node.id
                    ? nodeLabelDraft.delta
                    : undefined
                }
                activationDraft={
                  activationDraft?.nodeId === node.id
                    ? {
                        id: activationDraft.id,
                        top: activationDraft.top,
                        height: activationDraft.height,
                      }
                    : null
                }
                onActivationPointerDown={handleActivationPointerDown}
              />
            );
          })}
          {selectedActivationFrame !== null ? (
            <g>
              <rect
                x={selectedActivationFrame.x - 1}
                y={selectedActivationFrame.y - 1}
                width={selectedActivationFrame.width + 2}
                height={selectedActivationFrame.height + 2}
                fill="#2563eb"
                fillOpacity={0.05}
                stroke={scene.theme.colors.selection}
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              {(["top", "bottom"] as const).map((edge) => {
                const y = edge === "top"
                  ? selectedActivationFrame.y - 12 / zoom
                  : selectedActivationFrame.y + selectedActivationFrame.height + 12 / zoom;
                return (
                  <rect
                    key={`activation-resize-${edge}`}
                    data-activation-resize={edge}
                    x={selectedActivationFrame.centerX - 5 / zoom}
                    y={y - 5 / zoom}
                    width={10 / zoom}
                    height={10 / zoom}
                    rx={1.5 / zoom}
                    fill={scene.theme.colors.selection}
                    stroke="white"
                    strokeWidth={1 / zoom}
                    style={{ cursor: "ns-resize" }}
                    onPointerDown={(event) => handleActivationResize(edge, event)}
                  />
                );
              })}
            </g>
          ) : null}
          {[draftEdge, reattachPreview].map((preview, index) => {
            if (preview === null) return null;
            const interaction = interactionRef.current;
            const circuitGhost =
              index === 0 &&
              !preview.snapped &&
              scene.meta.diagramKind === "circuit" &&
              interaction?.kind === "draw" &&
              canExtendToEmpty({
                pointerTravelPx: interaction.pointerTravel,
                source: interaction.source.point,
                candidate: preview.to,
                gridSize,
              });
            return (
              <g pointerEvents="none" key={`edge-preview-${index}`}>
                <line
                  x1={preview.from.x}
                  y1={preview.from.y}
                  x2={preview.to.x}
                  y2={preview.to.y}
                  stroke={scene.theme.colors.selection}
                  strokeWidth={1.6}
                  strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={preview.from.x}
                  cy={preview.from.y}
                  r={3 / zoom}
                  fill={scene.theme.colors.selection}
                />
                {preview.snapped || circuitGhost ? (
                  <circle
                    cx={preview.to.x}
                    cy={preview.to.y}
                    r={(preview.snapped ? 5 : 4) / zoom}
                    fill={preview.snapped ? scene.theme.colors.selection : "white"}
                    stroke={scene.theme.colors.selection}
                    strokeWidth={1.4 / zoom}
                  />
                ) : null}
              </g>
            );
          })}
          {sequenceMode ? (
            <EdgeLayer
              edges={edgeItems}
              theme={scene.theme}
              hiddenLabelId={labelDraft?.labelId}
            />
          ) : (
            <EdgeLayer
              edges={edgeItems}
              theme={scene.theme}
              renderLines={false}
              hiddenLabelId={labelDraft?.labelId}
            />
          )}
          <NodeLabelHitLayer
            nodes={nodeLabelHitItems}
            zoom={zoom}
            onDragStart={beginNodeLabelDrag}
            onDoublePress={(nodeId) =>
              onTextDoubleClick(nodeId, { kind: "nodeName" })}
          />
          {insertTarget !== null ? (() => {
            const targetEdge = layout.edges[insertTarget.edgeId];
            if (targetEdge === undefined) return null;
            return (
              <polyline
                data-insert-wire-target="true"
                points={targetEdge.points.map((entry) => `${entry.x},${entry.y}`).join(" ")}
                fill="none"
                stroke={scene.theme.colors.selection}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            );
          })() : null}
          {coincidentHighlights.map((highlight, index) => (
            <circle
              key={`coincident-highlight-${index}`}
              data-coincident-highlight="true"
              cx={highlight.x}
              cy={highlight.y}
              r={6 / zoom}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          {branchIndicators.map((indicator, index) => (
            <circle
              key={`branch-indicator-${index}`}
              data-branch-indicator="true"
              cx={indicator.x}
              cy={indicator.y}
              r={7 / zoom}
              fill="none"
              stroke={scene.theme.colors.selection}
              strokeWidth={2.5}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          {hoveredTerminal !== null ? (
            <circle
              className="terminal-hover-ring"
              cx={hoveredTerminal.center.x}
              cy={hoveredTerminal.center.y}
              r={hoveredTerminal.radius}
            />
          ) : null}
          {sequenceMovePreview !== null ? (() => {
            const previewLayout = layout.edges[sequenceMovePreview.edgeId];
            if (previewLayout === undefined) return null;
            return (
              <polyline
                points={previewLayout.points
                  .map((p) => `${p.x},${p.y + sequenceMovePreview.deltaY}`)
                  .join(" ")}
                fill="none"
                stroke={scene.theme.colors.selection}
                strokeWidth={2.2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            );
          })() : null}
          {labelDraft !== null ? (() => {
            const label = layout.edges[labelDraft.edgeId]?.labels.find(
              (candidate) => candidate.labelId === labelDraft.labelId,
            );
            if (label === undefined) return null;
            const shifted: EdgeLabelLayout = {
              ...label,
              frame: {
                ...label.frame,
                x: label.frame.x + labelDraft.delta.x,
                y: label.frame.y + labelDraft.delta.y,
              },
              textFrame: {
                ...label.textFrame,
                x: label.textFrame.x + labelDraft.delta.x,
                y: label.textFrame.y + labelDraft.delta.y,
              },
            };
            return (
              <g opacity={0.96} pointerEvents="none">
                <EdgeLabelView label={shifted} theme={scene.theme} />
              </g>
            );
          })() : null}
          {focusOutline !== null ? (
            <polygon
              data-focus-outline="true"
              points={focusOutline.map((entry) => `${entry.x},${entry.y}`).join(" ")}
              fill="#2563eb"
              fillOpacity={0.06}
              stroke={scene.theme.colors.selection}
              strokeWidth={1.2 / zoom}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {focusHighlights.map((frame, index) => (
            <rect
              key={`focus-${index}`}
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              fill="#2563eb"
              fillOpacity={0.06}
              stroke={scene.theme.colors.selection}
              strokeWidth={1.2 / zoom}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          {selectedEdgeIds.length > 1 &&
          sequenceMovePreview === null &&
          reattachPreview === null &&
          activeEndpoint === null
            ? selectedEdgeIds.map((edgeId) => {
                const edgeLayout = layout.edges[edgeId];
                const edge = scene.edges[edgeId];
                if (edgeLayout === undefined || edge === undefined) return null;
                return (
                  <path
                    key={`multi-edge-${edgeId}`}
                    d={edgePathData(
                      edgeLinePoints(edgeLayout, edge.markers),
                      edgeLayout.bridges ?? [],
                    )}
                    fill="none"
                    stroke={scene.theme.colors.selection}
                    strokeWidth={2.4}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                    opacity={0.85}
                  />
                );
              })
            : null}
          {selectedEdgeLayout !== undefined &&
          sequenceMovePreview === null &&
          reattachPreview === null &&
          edgeSlidePreview?.edgeId !== selectedEdgeLayout.edgeId ? (
            <>
              {activeEndpoint === null ? (
                <path
                  d={edgePathData(
                    edgeLinePoints(selectedEdgeLayout, selectedEdge?.markers ?? { source: { family: "none", kind: "none" }, target: { family: "none", kind: "none" } }),
                    selectedEdgeLayout.bridges ?? [],
                  )}
                  fill="none"
                  stroke={scene.theme.colors.selection}
                  strokeWidth={2.4}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  opacity={0.85}
                />
              ) : (() => {
                const points = selectedEdgeLayout.points;
                const terminal = activeEndpoint === "source" ? points[0] : points[points.length - 1];
                const neighbor = activeEndpoint === "source" ? points[1] : points[points.length - 2];
                if (terminal === undefined || neighbor === undefined) return null;
                const radius = Math.max(
                  TERMINAL_HOVER_RADIUS,
                  TERMINAL_HOVER_MIN_SCREEN_RADIUS / zoom,
                );
                const center = outwardPoint(terminal, neighbor, radius);
                return (
                  <circle
                    className="terminal-selected-ring"
                    cx={center.x}
                    cy={center.y}
                    r={radius}
                  />
                );
              })()}
              {selectedEdgeLayout.points[0] !== undefined ? (
                <EndpointHandle
                  point={selectedEdgeLayout.points[0]}
                  label="source endpoint"
                  zoom={zoom}
                  color={scene.theme.colors.selection}
                  onDragStart={(event) => beginReattach(selectedEdgeLayout.edgeId, "source", event)}
                />
              ) : null}
              {selectedEdgeLayout.points[selectedEdgeLayout.points.length - 1] !== undefined ? (
                <EndpointHandle
                  point={selectedEdgeLayout.points[selectedEdgeLayout.points.length - 1] as Point}
                  label="target endpoint"
                  zoom={zoom}
                  color={scene.theme.colors.selection}
                  onDragStart={(event) => beginReattach(selectedEdgeLayout.edgeId, "target", event)}
                />
              ) : null}
            </>
          ) : null}
          {edgeSlidePreview !== null &&
          selectedEdgeLayout?.edgeId === edgeSlidePreview.edgeId &&
          selectedEdgeLayout.points.length === 2 ? (() => {
            const first = selectedEdgeLayout.points[0];
            const last = selectedEdgeLayout.points[selectedEdgeLayout.points.length - 1];
            if (first === undefined || last === undefined) return null;
            const from = edgeSlidePreview.axis === "y"
              ? { x: first.x, y: edgeSlidePreview.position }
              : { x: edgeSlidePreview.position, y: first.y };
            const to = edgeSlidePreview.axis === "y"
              ? { x: last.x, y: edgeSlidePreview.position }
              : { x: edgeSlidePreview.position, y: last.y };
            return (
              <g pointerEvents="none">
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={scene.theme.colors.selection}
                  strokeWidth={2.2}
                  strokeDasharray={`${5 / zoom} ${3 / zoom}`}
                  vectorEffect="non-scaling-stroke"
                />
                {[from, to].map((handle, index) => (
                  <circle
                    key={`edge-slide-preview-${index}`}
                    cx={handle.x}
                    cy={handle.y}
                    r={3.5 / zoom}
                    fill={scene.theme.colors.selection}
                    stroke="white"
                    strokeWidth={1 / zoom}
                  />
                ))}
              </g>
            );
          })() : null}
          {visiblePorts.length > 0 && activationDraft === null ? (
            <PortHandles
              ports={visiblePorts}
              zoom={zoom}
              hoveredPortId={hoveredPort?.id}
              theme={scene.theme}
              onHover={setHoveredPort}
              onStartEdge={beginEdgeDraw}
            />
          ) : null}
          {selectedLayout !== undefined &&
          selectedActivation === null &&
          selectedLayout.kind !== "circuitComponent" &&
          !(
            selectedLayout.kind === "circuitJunction" &&
            selectedLayout.measurement === undefined
          ) ? (
            <>
              {([
                { corner: "nw", x: selectedResizeFrame?.x ?? 0, y: selectedResizeFrame?.y ?? 0, cursor: "nwse-resize" },
                {
                  corner: "ne",
                  x: (selectedResizeFrame?.x ?? 0) + (selectedResizeFrame?.width ?? 0),
                  y: selectedResizeFrame?.y ?? 0,
                  cursor: "nesw-resize",
                },
                {
                  corner: "sw",
                  x: selectedResizeFrame?.x ?? 0,
                  y: (selectedResizeFrame?.y ?? 0) + (selectedResizeFrame?.height ?? 0),
                  cursor: "nesw-resize",
                },
                {
                  corner: "se",
                  x: (selectedResizeFrame?.x ?? 0) + (selectedResizeFrame?.width ?? 0),
                  y: (selectedResizeFrame?.y ?? 0) + (selectedResizeFrame?.height ?? 0),
                  cursor: "nwse-resize",
                },
              ] as const).map((handle) => (
                <rect
                  key={`resize-${handle.corner}`}
                  data-resize-handle="true"
                  data-resize-corner={handle.corner}
                  x={handle.x - 5 / zoom}
                  y={handle.y - 5 / zoom}
                  width={10 / zoom}
                  height={10 / zoom}
                  rx={2 / zoom}
                  fill={scene.theme.colors.selection}
                  stroke="white"
                  strokeWidth={1 / zoom}
                  style={{ cursor: handle.cursor }}
                  onPointerDown={(event) => handleResizePointerDown(handle.corner, event)}
                />
              ))}
            </>
          ) : null}
          {rotateHandle !== null ? (
            <g data-rotate-handle={rotateHandle.nodeId} style={{ cursor: "grab" }}>
              <line
                x1={rotateHandle.center.x}
                y1={rotateHandle.center.y}
                x2={rotateHandle.x}
                y2={rotateHandle.y}
                stroke={scene.theme.colors.selection}
                strokeWidth={1 / zoom}
                strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                pointerEvents="none"
              />
              <circle
                cx={rotateHandle.x}
                cy={rotateHandle.y}
                r={11 / zoom}
                fill="white"
                stroke={scene.theme.colors.selection}
                strokeWidth={1.4 / zoom}
                onPointerDown={(event) => handleRotatePointerDown(rotateHandle.nodeId, event)}
              >
                <title>
                  {rotateHandle.measurement
                    ? `Rotate ${rotateHandle.rotation}° · snaps near 45°`
                    : `Rotate ${rotateHandle.rotation}° · drag in 45° steps`}
                </title>
              </circle>
              <path
                d={`M ${rotateHandle.x - 5 / zoom} ${rotateHandle.y - 1 / zoom} A ${5 / zoom} ${5 / zoom} 0 1 1 ${rotateHandle.x + 3 / zoom} ${rotateHandle.y + 4 / zoom}`}
                fill="none"
                stroke={scene.theme.colors.selection}
                strokeWidth={1.4 / zoom}
                strokeLinecap="round"
                pointerEvents="none"
              />
              <path
                d={`M ${rotateHandle.x + 0.6 / zoom} ${rotateHandle.y + 4.4 / zoom} L ${rotateHandle.x + 3.4 / zoom} ${rotateHandle.y + 4 / zoom} L ${rotateHandle.x + 2.4 / zoom} ${rotateHandle.y + 1.4 / zoom}`}
                fill="none"
                stroke={scene.theme.colors.selection}
                strokeWidth={1.4 / zoom}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            </g>
          ) : null}
          {marquee !== null ? (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill={scene.theme.colors.selection}
              fillOpacity={0.08}
              stroke={scene.theme.colors.selection}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {guides.map((guide) => (
            <line
              key={`${guide.axis}-${guide.position}`}
              x1={guide.axis === "x" ? guide.position : guide.from}
              y1={guide.axis === "y" ? guide.position : guide.from}
              x2={guide.axis === "x" ? guide.position : guide.to}
              y2={guide.axis === "y" ? guide.position : guide.to}
              stroke={scene.theme.colors.selection}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              opacity={0.7}
              pointerEvents="none"
            />
          ))}
        </g>
      </svg>

      {nodeFocus !== null && focusNode !== undefined && focusLayout !== undefined && focusMenuPosition !== null ? (
        <DraggablePanel
          className="node-focus-position"
          left={focusMenuPosition.left}
          top={focusMenuPosition.top}
          bounds={viewport}
          resetKey={`${focusNode.id}:${nodeFocus.kind}:${
            nodeFocus.kind === "section"
              ? nodeFocus.sectionId
              : nodeFocus.kind === "row"
                ? nodeFocus.rowId
                : nodeFocus.kind === "lifelineSpine"
                  ? nodeFocus.y
                  : ""
          }`}
        >
          <NodeFocusMenu
            node={focusNode}
            focus={nodeFocus}
            focusRequest={focusRequest}
            onUpdateNode={onUpdateNode}
            onUpdateRow={onUpdateRow}
            onAddRow={onAddRow}
            onDeleteRow={onDeleteRow}
            onMoveRow={onMoveRow}
            onFocusRow={onFocusRow}
            onAddSection={onAddSection}
            onUpdateSection={onUpdateSection}
            onSetSectionVisibility={onSetSectionVisibility}
            onDeleteSection={onDeleteSection}
            onDeleteNode={onDeleteNode}
            onMergeJunction={onMergeJunction}
            junctionWireCount={focusJunctionWireCount}
            onAddActivation={onAddActivation}
            imageAssets={imageAssets}
            onAssignImage={onAssignImageToNode}
            onUseImageAsset={onUseImageAsset}
            onRemoveImage={onRemoveImageFromNode}
            onClose={onClearNodeFocus}
          />
        </DraggablePanel>
      ) : null}

      {activeEndpoint !== null && selectedEdge !== undefined && terminalPlacement !== null ? (
        <DraggablePanel
          className="endpoint-popover-position"
          left={terminalPlacement.left}
          top={terminalPlacement.top}
          bounds={viewport}
          resetKey={`${selectedEdge.id}:${activeEndpoint}`}
        >
          <EdgeEndpointPopover
            edge={selectedEdge}
            end={activeEndpoint}
            diagramKind={scene.meta.diagramKind}
            focusToken={terminalFocusToken}
            labelTextStyle={scene.theme.edge.labelText}
            onSetMarker={(marker) => onSetMarker(selectedEdge.id, activeEndpoint, marker)}
            onSetLabel={(text) => onSetEdgeLabel(selectedEdge.id, activeEndpoint, text)}
            onSetLabelStyle={(style) => onSetEdgeLabelStyle(selectedEdge.id, activeEndpoint, style)}
            onClose={() => setActiveEndpoint(null)}
          />
        </DraggablePanel>
      ) : null}

      {linePopover !== null && selectedEdge !== undefined && selectedEdgeLayout !== undefined ? (
        <DraggablePanel
          className="line-popover-position"
          left={Math.max(10, Math.min(linePopover.x, Math.max(10, viewport.width - 320)))}
          top={Math.max(10, Math.min(linePopover.y, Math.max(10, viewport.height - 310)))}
          bounds={viewport}
          resetKey={`${linePopover.edgeId}:${linePopover.x}:${linePopover.y}`}
        >
          <div className="line-popover">
            <div className="popover-head">
              <div>
                <strong>{scene.meta.diagramKind === "circuit" ? "Wire" : "Connector"}</strong>
                <span>{scene.meta.diagramKind === "circuit" ? "Wire options" : "Line options"}</span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setLinePopover(null)}
                title="Close line menu"
              >
                ×
              </button>
            </div>
            <EdgeInspector
              edge={selectedEdge}
              layout={selectedEdgeLayout}
              compact
              variant={scene.meta.diagramKind === "circuit" ? "circuit" : "default"}
              idPrefix="canvas"
              focusToken={lineFocusToken}
              labelTextStyle={scene.theme.edge.labelText}
              onSetLabel={(zone, text) => onSetEdgeLabel(selectedEdge.id, zone, text)}
              onSetLabelStyle={(zone, style) => onSetEdgeLabelStyle(selectedEdge.id, zone, style)}
              onConvertCenterLabel={canConvertCenterLabel ? convertCenterLabel : undefined}
              onSetStrokePattern={(pattern) => onSetStrokePattern(selectedEdge.id, pattern)}
              onSetStrokeWidth={(width) => onSetStrokeWidth(selectedEdge.id, width)}
              onSetRoutingMode={(mode) =>
                onSetRoutingMode(selectedEdge.id, mode)}
              onReroute={() => onRerouteEdge(selectedEdge.id)}
            />
          </div>
        </DraggablePanel>
      ) : null}

      <div className={`canvas-history-controls${showCompactAddButton ? " with-add" : ""}`}>
        <button
          type="button"
          className="canvas-history-button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          className="canvas-history-button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          ↷
        </button>
      </div>

      {showCompactAddButton ? (
        <button
          type="button"
          className="canvas-add-compact"
          onClick={() => openAddMenuFromButton("canvas")}
          title="Add an object to this diagram"
          aria-label="Add object"
          aria-haspopup="menu"
          aria-expanded={addMenu !== null}
        >
          <svg
            className="add-glyph"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M6 1.4v9.2M1.4 6h9.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}

      {addMenu !== null ? (
        <>
          <div
            className="add-menu-backdrop"
            onPointerDown={() => setAddMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setAddMenu(null);
            }}
          />
          <DraggablePanel
            className="add-object-position"
            left={addMenu.left}
            top={addMenu.top}
            bounds={viewport}
            resetKey="add-object"
          >
            <AddObjectMenu
              diagramKind={scene.meta.diagramKind}
              standard={resolveCircuitSettings(scene).standard}
              onPick={(templateId) => {
                const created = onAddObject(templateId, addMenu.world);
                if (created !== null && addMenu.source === "button") {
                  revealFrame(created.frame);
                }
                setAddMenu(null);
              }}
              onClose={() => setAddMenu(null)}
            />
          </DraggablePanel>
        </>
      ) : null}

      <div className="canvas-hud canvas-hud-bottom">
        <span>{Math.round(zoom * 100)}%</span>
        <span className="hud-divider" />
        <span>
          x {cursorWorld.x.toFixed(1)} · y {cursorWorld.y.toFixed(1)}
        </span>
        {/* <span className="hud-divider" />
        <span>grid {gridSize}pt</span> */}
        {/* <span className="hud-divider" />
        <span>{hoveredPort?.label ?? "no port"}</span> */}
      </div>
    </div>
  );
});
