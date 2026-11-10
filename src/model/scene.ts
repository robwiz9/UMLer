/**
 * Document root.
 *
 * The scene graph is a plain JSON document: no class instances, no DOM
 * references, no derived geometry. This keeps import/export, undo/redo and the
 * WASM Typst worker boundary simple.
 */

import { newId, type SceneId } from "./ids.ts";
import type { SceneNode, ImageAsset } from "./nodes.ts";
import type { SceneEdge } from "./edges.ts";
import type { LayoutSnapshot } from "./layout.ts";
import { DEFAULT_THEME, type Theme } from "./styles.ts";
import { rect, type Rect } from "./geometry.ts";

export type DiagramKind =
  | "er"
  | "uml-use-case"
  | "uml-class"
  | "uml-sequence"
  | "uml-communication"
  | "uml-state-machine";

export const DIAGRAM_KIND_LABELS: Record<DiagramKind, string> = {
  er: "Entity–Relationship",
  "uml-use-case": "UML Use Case",
  "uml-class": "UML Class",
  "uml-sequence": "UML Sequence",
  "uml-communication": "UML Communication",
  "uml-state-machine": "UML State Machine",
};

export interface SceneMeta {
  readonly title: string;
  readonly diagramKind: DiagramKind;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appVersion: string;
  readonly tags?: readonly string[];
}

export interface GridSettings {
  /** Scene units (points). Default 9pt = 12 CSS px at 96dpi. */
  readonly size: number;
  readonly visible: boolean;
  readonly majorEvery: number;
  readonly snapNodes: boolean;
  readonly snapPorts: boolean;
  readonly snapWaypoints: boolean;
  readonly snapLabels: boolean;
  /** Sub-grid precision for label dragging; independent of node snapping. */
  readonly labelStep: number;
}

export interface CanvasSettings {
  readonly grid: GridSettings;
  readonly background: string;
  /** Extra space around content when compiling/exporting. */
  readonly exportPadding: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly initialZoom: number;
}

export type LayoutDirection = "TB" | "LR";
export type LayoutEngine = "manual" | "sugiyama" | "force-orthogonal";
export type LayoutSpacing = "tight" | "normal" | "wide";

export interface LayoutSettings {
  readonly engine: LayoutEngine;
  readonly direction: LayoutDirection;
  readonly spacing?: LayoutSpacing;
  readonly rankGap: number;
  readonly nodeGap: number;
  readonly edgeGap: number;
  /**
   * When true, locked nodes remain at their current frames and act as fixed
   * constraints for the layout; unlocked nodes lay out around them.
   */
  readonly respectLocks: boolean;
  /** Run a crossing-reduction pass after layering. */
  readonly reduceCrossings: boolean;
  readonly maxIterations: number;
}

export const LAYOUT_SPACING_PRESETS: Record<
  LayoutSpacing,
  Pick<LayoutSettings, "rankGap" | "nodeGap" | "edgeGap">
> = {
  tight: { rankGap: 63, nodeGap: 36, edgeGap: 24 },
  normal: { rankGap: 90, nodeGap: 54, edgeGap: 36 },
  wide: { rankGap: 126, nodeGap: 72, edgeGap: 48 },
};

export interface SceneDocument {
  readonly schemaVersion: "umler.scene/1";
  readonly id: SceneId;
  readonly revision: number;
  readonly meta: SceneMeta;
  readonly canvas: CanvasSettings;
  readonly layout: LayoutSettings;
  readonly theme: Theme;
  readonly nodes: Readonly<Record<string, SceneNode>>;
  readonly edges: Readonly<Record<string, SceneEdge>>;
  readonly assets: Readonly<Record<string, ImageAsset>>;
}

export interface EditorSession {
  readonly sceneId: SceneId;
  readonly selectedNodeIds: readonly string[];
  readonly selectedEdgeIds: readonly string[];
  readonly selectedLabelIds: readonly string[];
  readonly hoveredPortId?: string;
  readonly interaction:
    | { readonly kind: "idle" }
    | { readonly kind: "panning"; readonly start: { x: number; y: number } }
    | { readonly kind: "dragging-node"; readonly nodeIds: readonly string[] }
    | { readonly kind: "drawing-edge"; readonly sourcePortId: string }
    | { readonly kind: "dragging-waypoint"; readonly edgeId: string; readonly waypointId: string };
  readonly zoom: number;
  readonly camera: { readonly x: number; readonly y: number };
  /** Transient geometry shown while dragging, before commit. */
  readonly previewLayout?: LayoutSnapshot;
}

export const DEFAULT_CANVAS: CanvasSettings = {
  grid: {
    size: 9,
    visible: true,
    majorEvery: 4,
    snapNodes: true,
    snapPorts: true,
    snapWaypoints: true,
    snapLabels: false,
    labelStep: 1,
  },
  background: "#ffffff",
  exportPadding: 18,
  minZoom: 0.2,
  maxZoom: 4,
  initialZoom: 1,
};

export const DEFAULT_LAYOUT: LayoutSettings = {
  engine: "manual",
  direction: "TB",
  spacing: "normal",
  rankGap: LAYOUT_SPACING_PRESETS.normal.rankGap,
  nodeGap: LAYOUT_SPACING_PRESETS.normal.nodeGap,
  edgeGap: LAYOUT_SPACING_PRESETS.normal.edgeGap,
  respectLocks: true,
  reduceCrossings: true,
  maxIterations: 12,
};

export const createEmptyScene = (
  diagramKind: DiagramKind,
  title = "Untitled diagram",
): SceneDocument => {
  const now = new Date().toISOString();
  return {
    schemaVersion: "umler.scene/1",
    id: newId<SceneId>("scene"),
    revision: 1,
    meta: {
      title,
      diagramKind,
      createdAt: now,
      updatedAt: now,
      appVersion: "0.1.0-step1",
    },
    canvas: DEFAULT_CANVAS,
    layout: DEFAULT_LAYOUT,
    theme: DEFAULT_THEME,
    nodes: {},
    edges: {},
    assets: {},
  };
};

export const sceneBounds = (layout: LayoutSnapshot): Rect => layout.contentBounds;

/** Empty scene bounds are still valid; this keeps camera math total. */
export const EMPTY_BOUNDS: Rect = rect(0, 0, 1, 1);
