/**
 * Visual tokens shared by the DOM skeleton and the CeTZ export.
 *
 * These are deliberately not CSS classes: the same resolved values must be
 * available to the serializer. The editor theme maps tokens to CSS custom
 * properties, but the document stores concrete values so an exported scene is
 * reproducible.
 */

export type Color = string;
export type FontFamily = string;
export type StrokePattern = "solid" | "dashed" | "dotted";

export interface StrokeStyle {
  readonly color: Color;
  readonly width: number;
  readonly pattern: StrokePattern;
  /** Explicit dash array in scene units. Overrides `pattern` in CeTZ. */
  readonly dashPattern?: readonly number[];
  readonly opacity?: number;
  readonly lineCap?: "butt" | "round" | "square";
  readonly lineJoin?: "miter" | "round" | "bevel";
}

export interface FillStyle {
  readonly color: Color | null;
  readonly opacity?: number;
}

export interface TextStyle {
  readonly fontFamily: FontFamily;
  readonly fontSize: number;
  readonly color: Color;
  readonly weight: 400 | 500 | 600 | 700;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly align?: "start" | "center" | "end";
  readonly lineHeight?: number;
}

export interface TableNodeStyle {
  readonly fill: FillStyle;
  readonly stroke: StrokeStyle;
  readonly text: TextStyle;
  readonly headerFill: FillStyle;
  readonly headerText: TextStyle;
  readonly divider: StrokeStyle;
  readonly cornerRadius: number;
  /** Horizontal inner padding for rows, in scene units. */
  readonly paddingX: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  /** Extra top/bottom padding within each row. */
  readonly rowPaddingY: number;
  readonly sectionGap: number;
}

export interface ShapeNodeStyle {
  readonly fill: FillStyle;
  readonly stroke: StrokeStyle;
  readonly text: TextStyle;
  readonly cornerRadius: number;
  readonly padding: number;
}

export interface EdgeStyle {
  readonly stroke: StrokeStyle;
  readonly labelText: TextStyle;
  readonly labelFill: FillStyle;
  readonly labelPadding: number;
  /** Distance from the endpoint at which an auto label is placed. */
  readonly labelInset: number;
  readonly arrowScale: number;
}

export interface Theme {
  readonly colors: {
    readonly ink: Color;
    readonly muted: Color;
    readonly canvas: Color;
    readonly grid: Color;
    readonly gridMajor: Color;
    readonly selection: Color;
    readonly port: Color;
    readonly portActive: Color;
    readonly warning: Color;
  };
  readonly table: TableNodeStyle;
  readonly shape: ShapeNodeStyle;
  readonly edge: EdgeStyle;
}

const INK = "#1f2933";
const MUTED = "#6b7280";
const CANVAS = "#fbfaf7";
const GRID = "#e6e2d9";
const GRID_MAJOR = "#d4cec1";
const SELECTION = "#2563eb";
const PORT = "#0f766e";
const PORT_ACTIVE = "#0d9488";
const WARNING = "#b45309";
const FONT = "Arial";

export const DEFAULT_THEME: Theme = {
  colors: {
    ink: INK,
    muted: MUTED,
    canvas: CANVAS,
    grid: GRID,
    gridMajor: GRID_MAJOR,
    selection: SELECTION,
    port: PORT,
    portActive: PORT_ACTIVE,
    warning: WARNING,
  },
  table: {
    fill: { color: "#ffffff" },
    stroke: { color: INK, width: 0.75, pattern: "solid" },
    text: { fontFamily: FONT, fontSize: 9, color: INK, weight: 400 },
    headerFill: { color: "#f3f1eb" },
    headerText: { fontFamily: FONT, fontSize: 10, color: INK, weight: 600 },
    divider: { color: INK, width: 0.5, pattern: "solid" },
    cornerRadius: 0,
    paddingX: 7,
    headerHeight: 28,
    rowHeight: 18,
    rowPaddingY: 2,
    sectionGap: 2,
  },
  shape: {
    fill: { color: "#ffffff" },
    stroke: { color: INK, width: 0.75, pattern: "solid" },
    text: { fontFamily: FONT, fontSize: 9, color: INK, weight: 400 },
    cornerRadius: 0,
    padding: 8,
  },
  edge: {
    stroke: { color: INK, width: 0.75, pattern: "solid" },
    labelText: { fontFamily: FONT, fontSize: 8, color: INK, weight: 400 },
    labelFill: { color: CANVAS },
    labelPadding: 2,
    labelInset: 18,
    arrowScale: 1,
  },
};

export const stroke = (
  patch: Partial<StrokeStyle> = {},
): StrokeStyle => ({ ...DEFAULT_THEME.edge.stroke, ...patch });

export const fill = (color: Color | null, opacity?: number): FillStyle =>
  opacity === undefined ? { color } : { color, opacity };

/** CeTZ accepts Typst's dash names plus explicit arrays. */
export const cetzDash = (s: StrokeStyle): string | null => {
  if (s.pattern === "solid" && s.dashPattern === undefined) return null;
  if (s.dashPattern !== undefined) return `(${s.dashPattern.map((n) => `${n}pt`).join(", ")})`;
  return s.pattern === "dotted" ? `"dotted"` : `"dashed"`;
};
