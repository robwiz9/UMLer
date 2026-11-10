/**
 * Smart connectors.
 *
 * Attachment points are *references*, never coordinates. A row can be renamed
 * or a node resized without invalidating the edge. Port geometry is resolved
 * in the Phase 1 layout pass and cached in `LayoutSnapshot`.
 */

import type { EdgeId, LabelId, NodeId, RowId, WaypointId } from "./ids.ts";
import type { CompassSide, Direction, HorizontalSide, Point } from "./geometry.ts";
import type { EdgeStyle, TextStyleOverride } from "./styles.ts";
import type {
  EndpointMarker,
  UmlRelationshipKind,
} from "./markers.ts";

export interface RowPortRef {
  readonly kind: "row";
  readonly rowId: RowId;
  readonly side: HorizontalSide;
}

export interface PerimeterPortRef {
  readonly kind: "perimeter";
  readonly side: CompassSide;
}

/** Arbitrary perimeter attachment (useful for ellipses and actors). */
export interface AnglePortRef {
  readonly kind: "angle";
  /**
   * Degrees in scene orientation (0 = east, 90 = south because y grows down).
   * `auto` anchors follow the partner node on every layout pass; manually
   * placed anchors leave it unset and keep their exact curve point.
   */
  readonly angle: number;
  readonly auto?: boolean;
}

/** A point along a lifeline spine or another path-like node. */
export interface SpinePortRef {
  readonly kind: "spine";
  /** 0 = top, 1 = bottom. */
  readonly t: number;
}

export type NodePortRef = RowPortRef | PerimeterPortRef | AnglePortRef | SpinePortRef;

export interface NodeAttachment {
  readonly target: "node";
  readonly nodeId: NodeId;
  readonly port: NodePortRef;
}

/** Edge-to-edge attachment, e.g. a relation attribute tethered to a line. */
export interface EdgeAttachmentPoint {
  readonly target: "edge";
  readonly edgeId: EdgeId;
  /** 0 = source end, 1 = target end. */
  readonly t: number;
}

/** Escape hatch for a temporary free endpoint or a future drawing tool. */
export interface FreeAttachment {
  readonly target: "free";
  readonly point: Point;
}

export type EdgeAttachment = NodeAttachment | EdgeAttachmentPoint | FreeAttachment;

export interface Waypoint {
  readonly id: WaypointId;
  readonly point: Point;
  /** Pinned waypoints survive auto-layout and A* reroutes. */
  readonly locked: boolean;
}

export type EdgeRoutingMode = "straight" | "orthogonal" | "polyline" | "bezier";

export interface EdgeRouting {
  readonly mode: EdgeRoutingMode;
  readonly avoidObstacles: boolean;
  /** Clearance from an object's frame, in scene units. */
  readonly obstaclePadding: number;
  /** Minimum length of the first/last orthogonal segment. */
  readonly stubLength: number;
  readonly waypoints: readonly Waypoint[];
  readonly sourceDirection?: Direction;
  readonly targetDirection?: Direction;
}

export type EdgeLabelZone = "source" | "center" | "target";

export type EdgeLabelAnchor =
  | { readonly kind: "edgePoint"; readonly t: number }
  | { readonly kind: "endpoint"; readonly end: "source" | "target" };

export interface EdgeLabel {
  readonly id: LabelId;
  readonly zone: EdgeLabelZone;
  readonly text: string;
  readonly anchor: EdgeLabelAnchor;
  /** Manual offset from the resolved anchor, in scene units. */
  readonly offset: Point;
  /** Pinned labels do not move when the line is rerouted. */
  readonly locked: boolean;
  readonly visible: boolean;
  readonly maxWidth?: number;
  readonly textStyle?: TextStyleOverride;
}

export type SequenceMessageKind = "sync" | "async" | "reply" | "create" | "delete";

export type EdgeSemantic =
  | {
      readonly family: "uml";
      readonly relationship?: UmlRelationshipKind;
      readonly sourceRole?: string;
      readonly targetRole?: string;
    }
  | {
      readonly family: "er";
      readonly name?: string;
      readonly identifying?: boolean;
      readonly weak?: boolean;
    }
  | {
      readonly family: "sequence";
      readonly messageKind: SequenceMessageKind;
      readonly signature?: string;
      readonly sequence?: string;
    }
  | {
      readonly family: "communication";
      readonly sequence: string;
      readonly signature?: string;
      readonly direction: "forward" | "reverse";
    }
  | {
      readonly family: "state";
      readonly trigger?: string;
      readonly guard?: string;
      readonly effect?: string;
    }
  | { readonly family: "generic" };

export interface EdgeMarkerSet {
  readonly source: EndpointMarker;
  readonly target: EndpointMarker;
}

export interface SceneEdge {
  readonly id: EdgeId;
  readonly source: EdgeAttachment;
  readonly target: EdgeAttachment;
  readonly routing: EdgeRouting;
  readonly markers: EdgeMarkerSet;
  readonly labels: readonly EdgeLabel[];
  readonly semantic: EdgeSemantic;
  readonly style: EdgeStyle;
  readonly locked: boolean;
  readonly visible: boolean;
  readonly z: number;
}

export const NO_MARKER: EndpointMarker = { family: "none", kind: "none" };

export const edgeLabel = (zone: EdgeLabelZone, edge: SceneEdge): EdgeLabel | undefined =>
  edge.labels.find((label) => label.zone === zone);

export const hasEdgeToEdgeAttachment = (edge: SceneEdge): boolean =>
  edge.source.target === "edge" || edge.target.target === "edge";

/** Human-readable relation name for the inspector/selection rail. */
export const edgeDisplayName = (edge: SceneEdge): string => {
  switch (edge.semantic.family) {
    case "er":
      return edge.semantic.name ?? edge.id;
    case "uml":
      return edge.semantic.relationship ?? edge.id;
    case "sequence":
      return edge.semantic.signature ?? edge.semantic.messageKind;
    case "communication":
      return edge.semantic.signature ?? edge.semantic.sequence;
    case "state":
      return edge.semantic.trigger ?? edge.id;
    case "generic":
      return edge.id;
  }
};

/** Stable, readable port key used by the layout cache and CeTZ anchor names. */
export const portKey = (nodeId: NodeId, port: NodePortRef): string => {
  switch (port.kind) {
    case "row":
      return `${nodeId}:row:${port.rowId}:${port.side}`;
    case "perimeter":
      return `${nodeId}:perimeter:${port.side}`;
    case "angle":
      return `${nodeId}:angle:${port.angle}`;
    case "spine":
      return `${nodeId}:spine:${port.t}`;
  }
};
