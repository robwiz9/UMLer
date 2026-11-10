import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { SceneDocument } from "../model/scene.ts";
import type { EdgeLabelLayout, EdgeLayout, LayoutSnapshot, NodeLayout, PortGeometry } from "../model/layout.ts";
import type { CanvasTextFocusRequest, CanvasTextTarget } from "../model/text-targets.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { ImageAsset, SceneNode, TableRow, TableSection } from "../model/nodes.ts";
import type { ActivationId, RowId, SectionId } from "../model/ids.ts";
import { NodeFocusMenu } from "./NodeFocusMenu.tsx";
import { DraggablePanel } from "./DraggablePanel.tsx";
import type { Point, Rect } from "../model/geometry.ts";
import { rectContainsPoint, snap, sub } from "../model/geometry.ts";
import type { ObjectTemplateId } from "../model/object-catalog.ts";
import type { EdgeAttachmentRef, PortAttachmentRef } from "../model/edge-create.ts";
import { childrenOfBoundary } from "../model/containment.ts";
import { AddObjectMenu } from "./AddObjectMenu.tsx";
import type { Camera } from "./camera.ts";
import { fitBounds, zoomAtScreenPoint, type ViewportSize } from "./camera.ts";
import { Grid } from "./Grid.tsx";
import { NodeSkeleton } from "./NodeSkeleton.tsx";
import { EdgeLabelView, EdgeLayer, edgeLayerItem, edgeLinePoints } from "./Edges.tsx";
import { EdgeEndpointPopover } from "./EdgeEndpointPopover.tsx";
import { EdgeInspector } from "../app/EdgeInspector.tsx";
import { isSupportedImageFile } from "../app/image-assets.ts";
import { PortHandles } from "./PortHandles.tsx";
import type { EdgeEnd } from "../model/markers.ts";
import type { EdgeLabelZone, EdgeRoutingMode } from "../model/edges.ts";
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
  readonly imageAssets: Readonly<Record<string, ImageAsset>>;
  readonly onDropImageFiles: (files: readonly File[], world: Point) => void;
  readonly onAssignImageToNode: (nodeId: string, file: File) => Promise<void>;
  readonly onUseImageAsset: (nodeId: string, assetId: string) => void;
  readonly onRemoveImageFromNode: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
  readonly selectedEdgeId: string | null;
  readonly selectedActivation: {
    readonly nodeId: string;
    readonly activationId: ActivationId;
  } | null;
  readonly fitNonce: number;
  readonly onSelectNode: (nodeId: string | null) => void;
  readonly onSelectEdge: (edgeId: string | null) => void;
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
  readonly onReattachEdge: (
    edgeId: string,
    end: EdgeEnd,
    target: PortAttachmentRef | EdgeAttachmentRef,
  ) => void;
  readonly onMoveSequenceEdge: (edgeId: string, deltaY: number) => void;
  readonly onMoveEdgeLabel: (
    edgeId: string,
    labelId: string,
    offset: Point,
  ) => void;
  readonly onTextDoubleClick: (nodeId: string, target: CanvasTextTarget) => void;
  readonly nodeFocus: NodeFocus | null;
  readonly focusRequest: CanvasTextFocusRequest | null;
  readonly onNodePartClick: (focus: NodeFocus) => void;
  readonly onClearNodeFocus: () => void;
  readonly onUpdateNode: (nodeId: string, patch: Partial<SceneNode>) => void;
  readonly onUpdateRow: (nodeId: string, rowId: RowId, patch: Partial<TableRow>) => void;
  readonly onAddRow: (nodeId: string, sectionId?: SectionId) => void;
  readonly onDeleteRow: (nodeId: string, rowId: RowId) => void;
  readonly onAddSection: (nodeId: string) => void;
  readonly onUpdateSection: (nodeId: string, sectionId: SectionId, patch: Partial<TableSection>) => void;
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
  readonly onDeleteNode: (nodeId: string) => void;
  readonly onViewChange: (camera: Camera, zoom: number) => void;
  readonly onPreviewFrames: (frames: Readonly<Record<string, Rect>>) => void;
  readonly onCommitFrames: (frames: Readonly<Record<string, Rect>>) => void;
  readonly onViewport: (viewport: ViewportSize) => void;
}

export interface CanvasStageHandle {
  readonly openAddObjectMenu: () => void;
}

type Interaction =
  | {
      readonly kind: "pan";
      readonly pointerId: number;
      readonly startScreen: Point;
      readonly startCamera: Camera;
    }
  | {
      readonly kind: "drag";
      readonly pointerId: number;
      readonly nodeId: string;
      readonly startWorld: Point;
      readonly startFrame: Rect;
      readonly childIds: readonly string[];
      readonly childStartFrames: Readonly<Record<string, Rect>>;
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

/** Port reference in the form the document stores. */
const attachmentFor = (port: PortGeometry): PortAttachmentRef => ({
  nodeId: port.nodeId,
  port: port.ref,
});

const closestPointOnPolyline = (
  points: readonly Point[],
  target: Point,
): { readonly distance: number; readonly t: number; readonly point: Point } | null => {
  const first = points[0];
  if (first === undefined) return null;
  if (points.length === 1) {
    return {
      distance: Math.hypot(first.x - target.x, first.y - target.y),
      t: 0,
      point: first,
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
  let best: { distance: number; t: number; point: Point } | null = null;
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
      };
    }
    travelled += segmentLength;
  }
  return best;
};

const EdgeHitLayer = ({
  edges,
  onSelect,
  onReroute,
}: {
  readonly edges: readonly { readonly id: string; readonly points: readonly Point[] }[];
  readonly onSelect: (edgeId: string, event: React.PointerEvent<SVGPolylineElement>) => void;
  readonly onReroute: (edgeId: string) => void;
}) => (
  <g>
    {edges.map((edge) => (
      <polyline
        key={edge.id}
        data-edge-hit={edge.id}
        points={edge.points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: "pointer" }}
        pointerEvents="stroke"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          onSelect(edge.id, event);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onReroute(edge.id);
        }}
      />
    ))}
  </g>
);

const EndpointHandle = ({
  point,
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

const TerminalHitLayer = ({
  edges,
  zoom,
  onPress,
  onLabelDragStart,
  onDoublePress,
}: {
  readonly edges: readonly { readonly id: string; readonly layout: EdgeLayout }[];
  readonly zoom: number;
  readonly onPress: (edgeId: string, end: EdgeEnd) => void;
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
      const sourceLabel = layout.labels.find((label) => label.zone === "source");
      const targetLabel = layout.labels.find((label) => label.zone === "target");
      return (
        <g key={`terminal-hit-${id}`}>
          {source === undefined ? null : (
            <circle
              data-terminal-hit={`${id}:source`}
              cx={source.x}
              cy={source.y}
              r={22 / zoom}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: "pointer" }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                onPress(id, "source");
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDoublePress(id, "source");
              }}
            />
          )}
          {target === undefined ? null : (
            <circle
              data-terminal-hit={`${id}:target`}
              cx={target.x}
              cy={target.y}
              r={22 / zoom}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: "pointer" }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                onPress(id, "target");
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
  imageAssets,
  onDropImageFiles,
  onAssignImageToNode,
  onUseImageAsset,
  onRemoveImageFromNode,
  selectedNodeId,
  selectedEdgeId,
  selectedActivation,
  fitNonce,
  onSelectNode,
  onSelectEdge,
  onSelectActivation,
  onSetMarker,
  onSetEdgeLabel,
  onSetEdgeLabelStyle,
  onConvertToRelationAttribute,
  onSetStrokePattern,
  onSetStrokeWidth,
  onSetRoutingMode,
  onRerouteEdge,
  onReattachEdge,
  onMoveSequenceEdge,
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
  onAddSection,
  onUpdateSection,
  onDeleteSection,
  onAddObject,
  onAddActivation,
  onUpdateActivation,
  onCreateEdge,
  onDeleteNode,
  onViewChange,
  onPreviewFrames,
  onCommitFrames,
  onViewport,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const openAddMenuRef = useRef<((origin: "panel" | "canvas") => void) | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const layoutRef = useRef(layout);
  const cameraRef = useRef(camera);
  const zoomRef = useRef(zoom);
  const onViewChangeRef = useRef(onViewChange);
  const onViewportRef = useRef(onViewport);

  useImperativeHandle(ref, () => ({
    openAddObjectMenu: () => openAddMenuRef.current?.("panel"),
  }), []);

  layoutRef.current = layout;
  cameraRef.current = camera;
  zoomRef.current = zoom;
  onViewChangeRef.current = onViewChange;
  onViewportRef.current = onViewport;

  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [cursorWorld, setCursorWorld] = useState<Point>({ x: 0, y: 0 });
  const [guides, setGuides] = useState<readonly SnapGuide[]>([]);
  const [hoveredPort, setHoveredPort] = useState<PortGeometry | null>(null);
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
  const [reattachPreview, setReattachPreview] = useState<DraftEdge & {
    readonly edgeId: string;
  } | null>(null);
  const reattachTargetRef = useRef<DrawTarget | null>(null);
  const [sequenceMovePreview, setSequenceMovePreview] = useState<{
    readonly edgeId: string;
    readonly deltaY: number;
  } | null>(null);
  const [labelDraft, setLabelDraft] = useState<{
    readonly edgeId: string;
    readonly labelId: string;
    readonly delta: Point;
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
    const fitted = fitBounds(layoutRef.current.fitBounds, viewport, 64);
    onViewChangeRef.current(fitted.camera, fitted.zoom);
    // Fit only when requested or the viewport changes; never on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, viewport.width, viewport.height]);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const svg = svgRef.current;
      if (svg === null) return;
      const cursor = pointFromEvent(event, svg);
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = zoomAtScreenPoint(cursor, cameraRef.current, zoomRef.current, factor);
      onViewChangeRef.current(next.camera, next.zoom);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
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
      };
    }
    if (bestEdge !== null) {
      return {
        point: bestEdge.point,
        attachment: { edgeId: bestEdge.edgeId, t: bestEdge.t },
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
    event: React.PointerEvent<SVGGElement>,
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
    interactionRef.current = {
      kind: "draw",
      pointerId: event.pointerId,
      source: port,
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
    setAddMenu({
      left: clampValue(screen.x + 8, 10, Math.max(10, viewport.width - 318)),
      top: clampValue(screen.y + 8, 10, Math.max(10, viewport.height - 474)),
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
    onSelectActivation(null);
    setActivationDraft(null);
    setActiveEndpoint(null);
    setLinePopover(null);
    onSelectEdge(null);
    onSelectNode(null);
    event.preventDefault();
  };

  const handleNodePointerDown = (event: React.PointerEvent<SVGGElement>, nodeId: string): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const nodeLayout = layout.nodes[nodeId];
    if (svg === null || nodeLayout === undefined) return;
    const screen = pointFromEvent(event, svg);
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    onSelectActivation(null);
    setActivationDraft(null);
    setActiveEndpoint(null);
    setLinePopover(null);
    onSelectEdge(null);
    onSelectNode(nodeId);
    const childIds = childrenOfBoundary(scene, nodeId).map((child) => child.id);
    const childStartFrames = Object.fromEntries(
      childIds.map((childId) => [
        childId,
        layout.nodes[childId]?.frame ?? scene.nodes[childId]?.frame ?? nodeLayout.frame,
      ]),
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

  const handleEdgePointerDown = (
    edgeId: string,
    event: React.PointerEvent<SVGPolylineElement>,
  ): void => {
    const svg = svgRef.current;
    const edgeLayout = layout.edges[edgeId];
    if (svg === null || edgeLayout === undefined) return;
    const screen = pointFromEvent(event, svg);
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
    if (Math.min(sourceDistance, targetDistance) <= 16) {
      setActiveEndpoint(sourceDistance <= targetDistance ? "source" : "target");
    } else if (scene.edges[edgeId]?.semantic.family === "sequence") {
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
      setActiveEndpoint(null);
      setLinePopover({ edgeId, x: screen.x + 12, y: screen.y + 12 });
    }
  };

  const openTerminalMenu = (edgeId: string, end: EdgeEnd, focusField: boolean): void => {
    setLinePopover(null);
    onSelectNode(null);
    onSelectEdge(edgeId);
    setActiveEndpoint(end);
    if (focusField) setTerminalFocusToken((value) => value + 1);
  };

  const openLineMenuAt = (edgeId: string, world: Point, focusField: boolean): void => {
    const screen = {
      x: world.x * zoom + camera.x,
      y: world.y * zoom + camera.y,
    };
    const centerLabel = layout.edges[edgeId]?.labels.find((label) => label.zone === "center");
    const halfWidth = (centerLabel?.frame.width ?? 0) / 2;
    const right = screen.x + halfWidth + 14 + 320 <= viewport.width - 10;
    setActiveEndpoint(null);
    setLinePopover({
      edgeId,
      x: right
        ? screen.x + halfWidth + 14
        : Math.max(10, screen.x - halfWidth - 14 - 320),
      y: screen.y - 170,
    });
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
    if (event.button !== 0 || selectedNodeId === null) return;
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

  const finish = (commit: boolean): void => {
    const interaction = interactionRef.current;
    if (interaction === null) return;

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
      const target = draftTargetRef.current;
      if (commit && target !== null) {
        onCreateEdge(attachmentFor(interaction.source), target.attachment);
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
          onReattachEdge(
            interaction.edgeId,
            interaction.end,
            reattachTargetRef.current.attachment,
          );
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
          openLineMenuAt(interaction.edgeId, interaction.startWorld, false);
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

    if (interaction.kind === "label-drag") {
      if (commit) {
        if (interaction.moved) {
          onMoveEdgeLabel(interaction.edgeId, interaction.labelId, {
            x: interaction.startOffset.x + interaction.lastDelta.x,
            y: interaction.startOffset.y + interaction.lastDelta.y,
          });
        } else if (interaction.menu === "line") {
          openLineMenuAt(interaction.edgeId, interaction.startWorld, false);
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
    if (commit && changed) {
      onCommitFrames({
        [interaction.nodeId]: interaction.lastFrame,
        ...(interaction.kind === "drag" ? interaction.lastChildFrames : {}),
      });
    } else {
      onPreviewFrames({});
    }
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
    const world = screenToWorld(screen, cameraRef.current, zoomRef.current);
    setCursorWorld(world);

    const nearby = nearestPort(layout.ports, world, 9 / zoomRef.current);
    setHoveredPort(nearby);

    const interaction = interactionRef.current;
    if (interaction === null) return;

    if (interaction.kind === "draw") {
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
      const moved = interaction.moved ||
        Math.hypot(world.x - interaction.startWorld.x, world.y - interaction.startWorld.y) * zoomRef.current > 3;
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
        setLabelDraft({
          edgeId: interaction.edgeId,
          labelId: interaction.labelId,
          delta,
        });
      }
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
        node.nodeId !== interaction.nodeId &&
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

  const handlePointerUp = (): void => {
    finish(true);
  };

  const handlePointerCancel = (event: React.PointerEvent<SVGSVGElement>): void => {
    event.preventDefault();
    finish(false);
  };

  const selectedLayout = selectedNodeId !== null ? layout.nodes[selectedNodeId] : undefined;
  const selectedPorts = selectedNodeId !== null ? snapHandlesForNode(layout.ports, selectedNodeId) : [];
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
      return [edgeLayerItem(edgeLayout, markers, edge.style.stroke)];
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
  const terminalHitItems = Object.values(scene.edges).flatMap((edge) => {
    const edgeLayout = layout.edges[edge.id];
    return edgeLayout === undefined ? [] : [{ id: edge.id, layout: edgeLayout }];
  });
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
    return focusLayout.frame;
  })();
  const focusHighlights: readonly Rect[] = (() => {
    if (focusLayout === undefined || focusFrame === null) return [];
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
  const focusMenuPosition = (() => {
    if (focusLayout === undefined || focusFrame === null) return null;
    const width = 320;
    const left = focusLayout.frame.x * zoom + camera.x;
    const right = (focusLayout.frame.x + focusLayout.frame.width) * zoom + camera.x;
    const anchorTop = focusFrame.y * zoom + camera.y;
    const preferredLeft = right + 16;
    const leftPosition = preferredLeft + width <= viewport.width - 10
      ? preferredLeft
      : Math.max(10, left - 16 - width);
    return {
      left: Math.max(10, Math.min(leftPosition, Math.max(10, viewport.width - width - 10))),
      top: Math.max(10, Math.min(anchorTop, Math.max(10, viewport.height - 390))),
    };
  })();
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

  return (
    <div
      ref={containerRef}
      className="canvas-stage"
      style={{ cursor: panning ? "grabbing" : undefined }}
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
        onPointerLeave={() => setHoveredPort(null)}
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
          />
          <TerminalHitLayer
            edges={terminalHitItems}
            zoom={zoom}
            onPress={(edgeId, end) => openTerminalMenu(edgeId, end, false)}
            onLabelDragStart={(edgeId, labelId, event, end) =>
              beginLabelDrag(edgeId, labelId, event, "terminal", end)}
            onDoublePress={(edgeId, end) => openTerminalMenu(edgeId, end, true)}
          />
          <CenterLabelHitLayer
            edges={terminalHitItems}
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
                selected={node.id === selectedNodeId}
                skeleton={false}
                imageAsset={
                  node.kind === "image" && node.assetId !== undefined
                    ? imageAssets[node.assetId]
                    : undefined
                }
                onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                onTextDoubleClick={(target) => onTextDoubleClick(node.id, target)}
                onPartClick={onNodePartClick}
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
                <circle
                  cx={preview.to.x}
                  cy={preview.to.y}
                  r={(preview.snapped ? 5 : 3) / zoom}
                  fill={preview.snapped ? scene.theme.colors.selection : "white"}
                  stroke={scene.theme.colors.selection}
                  strokeWidth={1.4 / zoom}
                />
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
          {selectedEdgeLayout !== undefined &&
          sequenceMovePreview === null &&
          reattachPreview === null ? (
            <>
              <polyline
                points={edgeLinePoints(selectedEdgeLayout, selectedEdge?.markers ?? { source: { family: "none", kind: "none" }, target: { family: "none", kind: "none" } }).map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={scene.theme.colors.selection}
                strokeWidth={2.4}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
                opacity={0.85}
              />
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
          {selectedPorts.length > 0 && activationDraft === null ? (
            <PortHandles
              ports={selectedPorts}
              zoom={zoom}
              hoveredPortId={hoveredPort?.id}
              theme={scene.theme}
              onHover={setHoveredPort}
              onStartEdge={beginEdgeDraw}
            />
          ) : null}
          {selectedLayout !== undefined && selectedActivation === null ? (
            <>
              {([
                { corner: "nw", x: selectedLayout.frame.x, y: selectedLayout.frame.y, cursor: "nwse-resize" },
                {
                  corner: "ne",
                  x: selectedLayout.frame.x + selectedLayout.frame.width,
                  y: selectedLayout.frame.y,
                  cursor: "nesw-resize",
                },
                {
                  corner: "sw",
                  x: selectedLayout.frame.x,
                  y: selectedLayout.frame.y + selectedLayout.frame.height,
                  cursor: "nesw-resize",
                },
                {
                  corner: "se",
                  x: selectedLayout.frame.x + selectedLayout.frame.width,
                  y: selectedLayout.frame.y + selectedLayout.frame.height,
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
            onAddSection={onAddSection}
            onUpdateSection={onUpdateSection}
            onDeleteSection={onDeleteSection}
            onDeleteNode={onDeleteNode}
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
          left={Math.max(10, Math.min(linePopover.x, Math.max(10, viewport.width - 330)))}
          top={Math.max(10, Math.min(linePopover.y, Math.max(10, viewport.height - 430)))}
          bounds={viewport}
          resetKey={`${linePopover.edgeId}:${linePopover.x}:${linePopover.y}`}
        >
          <div className="line-popover">
            <div className="popover-head">
              <div>
                <strong>Connector</strong>
                <span>Line options</span>
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
        <span className="hud-divider" />
        <span>grid {gridSize}pt</span>
        <span className="hud-divider" />
        <span>{hoveredPort?.label ?? "no port"}</span>
      </div>
    </div>
  );
});
