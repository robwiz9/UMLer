/**
 * Scene nodes.
 *
 * `frame` is the persisted, grid-snapped layout box. Text measurement, row
 * bands, compartment separators and ports are *derived* (see `layout.ts`) so a
 * node never carries stale geometry after a rename or resize.
 */

import type { NodeId, RowId, SectionId, AssetId, ActivationId } from "./ids.ts";
import type { Rect } from "./geometry.ts";
import type { Color, ShapeNodeStyle, TableNodeStyle, TextStyleOverride } from "./styles.ts";

export type Visibility = "+" | "-" | "#" | "~";
export type ErConstraint = "PK" | "FK" | "NN" | "UQ";
export type RowKind = "attribute" | "method";
export type SectionRole = "attributes" | "methods" | "custom";

export interface Parameter {
  readonly name: string;
  readonly type?: string;
  readonly defaultValue?: string;
  readonly direction?: "in" | "out" | "inout";
}

export interface TableRow {
  readonly id: RowId;
  readonly kind: RowKind;
  /** UML visibility prefix. Omit or leave empty for ER rows. */
  readonly visibility?: Visibility;
  /** Custom literal prefix; takes precedence over `visibility`. */
  readonly prefix?: string;
  readonly textStyle?: TextStyleOverride;
  readonly name: string;
  readonly type?: string;
  /** Operation parameters; ignored for attributes. */
  readonly parameters?: readonly Parameter[];
  readonly returnType?: string;
  readonly constraints?: readonly ErConstraint[];
  readonly static?: boolean;
  readonly abstract?: boolean;
  readonly defaultValue?: string;
  readonly note?: string;
}

export interface TableSection {
  readonly id: SectionId;
  readonly role: SectionRole;
  readonly title?: string;
  readonly textStyle?: TextStyleOverride;
  /** `undefined` inherits the table body; `null` is transparent. */
  readonly backgroundColor?: Color | null;
  readonly rows: readonly TableRow[];
  readonly collapsed?: boolean;
}

export interface TableHeader {
  readonly stereotype?: string;
  readonly keywords?: readonly string[];
  readonly abstract?: boolean;
  readonly isInterface?: boolean;
  readonly textStyle?: TextStyleOverride;
  /** `undefined` inherits the theme tint; `null` is transparent. */
  readonly backgroundColor?: Color | null;
}

export interface NodeBase {
  readonly id: NodeId;
  readonly kind: string;
  /** Canonical label used by selection lists, a11y and table headers. */
  readonly name: string;
  readonly frame: Rect;
  readonly z: number;
  /**
   * Fixed at the current frame during auto-layout. Locked nodes preserve the
   * user's spatial arrangement (e.g. two entities kept next to each other);
   * they are not merely excluded and re-placed elsewhere.
   */
  readonly locked: boolean;
  readonly visible: boolean;
  /** Object-level text override (name, caption, comment body, lifeline head). */
  readonly textStyle?: TextStyleOverride;
  /** Object-level fill override; used by comments. `null` is transparent. */
  readonly backgroundColor?: Color | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface TableNode extends NodeBase {
  readonly kind: "table";
  /** ER table, UML class, or an associative/join table. */
  readonly tableKind: "entity" | "class" | "associative";
  readonly header: TableHeader;
  readonly sections: readonly TableSection[];
  readonly style: TableNodeStyle;
}

/** ER relationship attribute (a compact table tethered to a relationship line). */
export interface RelationAttributeNode extends NodeBase {
  readonly kind: "relationAttribute";
  readonly rows: readonly TableRow[];
  readonly style: TableNodeStyle;
}

/**
 * Chen-style relationship diamond. Optional for n-ary relationships; the
 * default ER mode uses crow's-foot lines and relation-attribute nodes.
 */
export interface RelationshipNode extends NodeBase {
  readonly kind: "relationship";
  readonly identifying: boolean;
  readonly weak: boolean;
  readonly style: ShapeNodeStyle;
}

export interface ActorNode extends NodeBase {
  readonly kind: "actor";
  readonly labelPlacement: "below" | "above";
  readonly style: ShapeNodeStyle;
}

export interface UseCaseNode extends NodeBase {
  readonly kind: "useCase";
  readonly style: ShapeNodeStyle;
}

/** Communication-diagram object box (name underlined by convention). */
export interface ObjectNode extends NodeBase {
  readonly kind: "object";
  readonly classifier?: string;
  readonly stereotype?: string;
  readonly underlineName?: boolean;
  readonly style: ShapeNodeStyle;
}

export type StateKind = "simple" | "composite" | "submachine";

export interface StateNode extends NodeBase {
  readonly kind: "state";
  readonly stateKind: StateKind;
  /** Internal activities rendered as `entry / ...`, `do / ...`, `exit / ...`. */
  readonly internalActivities?: readonly string[];
  readonly style: ShapeNodeStyle;
}

export type PseudostateKind =
  | "initial"
  | "final"
  | "choice"
  | "fork"
  | "join"
  | "entryPoint"
  | "exitPoint"
  | "terminate"
  | "historyShallow"
  | "historyDeep";

export interface PseudostateNode extends NodeBase {
  readonly kind: "pseudostate";
  readonly pseudostateKind: PseudostateKind;
  readonly style: ShapeNodeStyle;
}

export type LifelineHeadKind =
  | "object"
  | "class"
  | "actor"
  | "component"
  | "boundary"
  | "control"
  | "entity";

export interface LifelineHead {
  readonly headKind: LifelineHeadKind;
  readonly stereotype?: string;
  /** `:Type`-style labels are kept verbatim. */
  readonly label?: string;
}

export interface ActivationBar {
  readonly id: ActivationId;
  /** Offset from the lifeline frame's top edge, in scene units. */
  readonly top: number;
  /** Activation height, in scene units. */
  readonly height: number;
  /** Nesting depth; 0 is the base activation. */
  readonly level: number;
}

export interface LifelineNode extends NodeBase {
  readonly kind: "lifeline";
  readonly head: LifelineHead;
  readonly headHeight: number;
  readonly activationBars: readonly ActivationBar[];
  /** Optional destruction marker measured from the frame top. */
  readonly destroyAt?: number;
  readonly style: ShapeNodeStyle;
}

export type FrameKind = "system-boundary" | "interaction-frame" | "package";

export interface FrameNode extends NodeBase {
  readonly kind: "frame";
  readonly frameKind: FrameKind;
  /** e.g. `alt`, `opt`, `loop`, `par` for an interaction frame. */
  readonly operator?: string;
  readonly guard?: string;
  readonly tabHeight?: number;
  readonly style: ShapeNodeStyle;
}

export type ImageFit = "contain" | "cover" | "fill";

export interface ImageNode extends NodeBase {
  readonly kind: "image";
  /** Empty image frames are valid until a file or existing asset is assigned. */
  readonly assetId?: AssetId;
  readonly caption?: string;
  readonly fit: ImageFit;
  readonly alt: string;
  /** Border drawn by CeTZ; the browser uses the same frame. */
  readonly showBorder: boolean;
  readonly style: ShapeNodeStyle;
}

/** Free-standing UML note. The body is user text, not derived geometry. */
export interface CommentNode extends NodeBase {
  readonly kind: "comment";
  readonly body: string;
  readonly style: ShapeNodeStyle;
}

export type SceneNode =
  | TableNode
  | RelationAttributeNode
  | RelationshipNode
  | ActorNode
  | UseCaseNode
  | ObjectNode
  | StateNode
  | PseudostateNode
  | LifelineNode
  | FrameNode
  | ImageNode
  | CommentNode;

export type TableLikeNode = TableNode | RelationAttributeNode;

export const isTableNode = (node: SceneNode): node is TableNode => node.kind === "table";

export const isTableLikeNode = (node: SceneNode): node is TableLikeNode =>
  node.kind === "table" || node.kind === "relationAttribute";

/** Rows in render order, including future collapsed-state filtering. */
export const visibleSections = (node: TableNode): readonly TableSection[] =>
  node.sections.filter((section) => section.collapsed !== true);

export const allRows = (node: TableLikeNode): readonly TableRow[] =>
  node.kind === "table"
    ? visibleSections(node).flatMap((section) => section.rows)
    : node.rows;

/** Finds a row without assuming a specific section. */
export const findRow = (node: TableLikeNode, rowId: RowId): TableRow | undefined =>
  allRows(node).find((row) => row.id === rowId);

/** Display text for a row; the exact formatter can evolve without a schema change. */
export const formatRow = (row: TableRow, includeConstraints = true): string => {
  const rawPrefix = row.prefix ?? row.visibility ?? "";
  const prefix = rawPrefix.length > 0 ? `${rawPrefix} ` : "";
  const constraints =
    includeConstraints && row.constraints && row.constraints.length > 0
      ? ` {${row.constraints.join(", ")}}`
      : "";

  if (row.kind === "method") {
    const params = (row.parameters ?? [])
      .map((param) => {
        const dir = param.direction && param.direction !== "in" ? `${param.direction} ` : "";
        const type = param.type ? `: ${param.type}` : "";
        const fallback = param.defaultValue ? ` = ${param.defaultValue}` : "";
        return `${dir}${param.name}${type}${fallback}`;
      })
      .join(", ");
    const returns = row.returnType ? `: ${row.returnType}` : "";
    return `${prefix}${row.name}(${params})${returns}${constraints}`;
  }

  const type = row.type ? `: ${row.type}` : "";
  const fallback = row.defaultValue ? ` = ${row.defaultValue}` : "";
  return `${prefix}${row.name}${type}${fallback}${constraints}`;
};

export interface ImageAsset {
  readonly id: AssetId;
  readonly kind: "raster" | "vector";
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  readonly checksum: string;
  /**
   * Scene asset records are references; project-level records carry the bytes
   * as a data URL so they are stored once and can be referenced by several
   * image nodes or scenes. The exporter materialises the bytes in Typst's VFS.
   */
  readonly storage: "indexeddb" | "data-url" | "project-file";
  readonly dataUrl?: string;
  readonly exportPath?: string;
}
