/**
 * Derived Phase 1 geometry.
 *
 * Nothing in this file is persisted with the scene. It is the output of the
 * skeleton/measurement pass and is the *single* input to both the DOM overlay
 * and the CeTZ serializer. A `revision` guard makes stale async routes safe to
 * discard.
 */

import type { ActivationId, EdgeId, LabelId, NodeId, PortId, RowId, SectionId } from "./ids.ts";
import type { EdgeLabelZone } from "./edges.ts";
import type { NodePortRef } from "./edges.ts";
import type { Point, Rect } from "./geometry.ts";
import type { TextStyle } from "./styles.ts";

export interface TextMeasurement {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  /** Number of wrapped lines; 1 for the deterministic single-line policy. */
  readonly lines: number;
  readonly truncated: boolean;
  readonly style: TextStyle;
}

export interface PortGeometry {
  readonly id: PortId;
  readonly nodeId: NodeId;
  readonly ref: NodePortRef;
  readonly point: Point;
  /** Unit normal pointing out of the node. */
  readonly normal: Point;
  /** Unit tangent along the attachment border. */
  readonly tangent: Point;
  readonly label: string;
  readonly rowId?: RowId;
  readonly side?: "west" | "east" | "north" | "south";
}

export interface HeaderBand {
  readonly frame: Rect;
  readonly textFrame: Rect;
  readonly text: TextMeasurement;
  readonly stereotype?: TextMeasurement;
  /** Explicit frame for the stereotype, so title + stereotype stay a centred stack. */
  readonly stereotypeFrame?: Rect;
}

export interface RowBand {
  readonly rowId: RowId;
  readonly frame: Rect;
  readonly textFrame: Rect;
  readonly text: TextMeasurement;
  /** Sub-frame of the displayed row text representing the name. */
  readonly nameFrame: Rect;
  /** Sub-frame of the displayed row text representing the type/return type, when present. */
  readonly typeFrame?: Rect;
  readonly leftPortId: PortId;
  readonly rightPortId: PortId;
  readonly badgeFrames: readonly { readonly label: string; readonly frame: Rect }[];
}

export interface SectionBand {
  readonly sectionId: SectionId;
  readonly frame: Rect;
  readonly header?: {
    readonly frame: Rect;
    readonly textFrame: Rect;
    readonly text: TextMeasurement;
  };
  readonly rows: readonly RowBand[];
}

export interface NodeLayoutBase {
  readonly nodeId: NodeId;
  readonly kind: string;
  readonly frame: Rect;
  /** Frame plus any external label/caption, used for selection and culling. */
  readonly bounds: Rect;
  readonly ports: readonly PortGeometry[];
  readonly selectedPortIds?: readonly PortId[];
}

export interface TableNodeLayout extends NodeLayoutBase {
  readonly kind: "table" | "relationAttribute";
  readonly header: HeaderBand;
  readonly sections: readonly SectionBand[];
}

export interface LifelineNodeLayout extends NodeLayoutBase {
  readonly kind: "lifeline";
  readonly headFrame: Rect;
  readonly headText: TextMeasurement;
  readonly spine: {
    readonly from: Point;
    readonly to: Point;
  };
  readonly activations: readonly {
    readonly id: ActivationId;
    readonly frame: Rect;
    readonly topPortId: PortId;
    readonly bottomPortId: PortId;
  }[];
  readonly destroyPoint?: Point;
}

export interface ShapeNodeLayout extends NodeLayoutBase {
  readonly kind: "relationship" | "actor" | "useCase" | "object" | "state" | "pseudostate" | "frame";
  readonly textFrame: Rect;
  readonly text: TextMeasurement;
  readonly labelFrame?: Rect;
}

export interface ImageNodeLayout extends NodeLayoutBase {
  readonly kind: "image";
  readonly imageFrame: Rect;
  readonly captionFrame?: Rect;
  readonly caption?: TextMeasurement;
}

export interface CommentNodeLayout extends NodeLayoutBase {
  readonly kind: "comment";
  /** One measurement per explicit source line; long lines are truncated. */
  readonly lines: readonly TextMeasurement[];
  readonly textFrame: Rect;
}

export type NodeLayout =
  | TableNodeLayout
  | LifelineNodeLayout
  | ShapeNodeLayout
  | ImageNodeLayout
  | CommentNodeLayout;

export interface EdgeLabelLayout {
  readonly labelId: LabelId;
  readonly zone: EdgeLabelZone;
  readonly frame: Rect;
  readonly textFrame: Rect;
  readonly text: TextMeasurement;
  readonly anchorPoint: Point;
  /** Tether is drawn only when the label's frame no longer touches the line. */
  readonly tether: readonly [Point, Point] | null;
}

export interface EdgeLayout {
  readonly edgeId: EdgeId;
  /** Orthogonal/polyline points in scene coordinates, source to target. */
  readonly points: readonly Point[];
  readonly sourcePortId?: PortId;
  readonly targetPortId?: PortId;
  readonly labels: readonly EdgeLabelLayout[];
  readonly bounds: Rect;
  readonly routedBy: "straight" | "orthogonal" | "polyline" | "bezier" | "astar" | "auto-layout";
  readonly bendCount: number;
  readonly crossings: number;
}

export interface LayoutDiagnostics {
  readonly routeCollisions: number;
  readonly edgeCrossings: number;
  readonly overlappingNodes: number;
  readonly unplacedLabels: number;
}

/**
 * Phase 1 snapshot. `sceneRevision` is monotonic per document change; Phase 2
 * rejects a Typst result whose revision no longer matches the editor.
 */
export interface LayoutSnapshot {
  readonly sceneRevision: number;
  readonly measuredAt: string;
  readonly nodes: Readonly<Record<string, NodeLayout>>;
  readonly ports: Readonly<Record<string, PortGeometry>>;
  readonly edges: Readonly<Record<string, EdgeLayout>>;
  /** Full drawable bounds, including the decorative tails of lifelines. */
  readonly contentBounds: Rect;
  /** Camera-fit target; excludes lifeline tails that carry no sequence content. */
  readonly fitBounds: Rect;
  /** Content bounds plus export padding, origin-normalized for CeTZ. */
  readonly exportBounds: Rect;
  readonly diagnostics: LayoutDiagnostics;
}

export interface TextMeasurer {
  measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement;
}

export interface SkeletonRenderer {
  render(snapshot: LayoutSnapshot): void;
}
