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

/**
 * Per-text overrides. Undefined fields inherit the current scene theme, while
 * explicit `false` values let the user force normal weight/roman/upright text
 * even when the base style is bold or italic.
 */
export interface TextStyleOverride {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly monospace?: boolean;
  readonly fontSize?: number;
  readonly color?: Color;
}

export const DIAGRAM_FONT = "Latin Modern Roman";
export const MONO_FONT = "Latin Modern Mono";
export const DEFAULT_DIAGRAM_FONT_SIZE = 10.5;

export const resolveTextStyle = (
  base: TextStyle,
  override?: TextStyleOverride,
): TextStyle => {
  if (override === undefined) return base;
  return {
    ...base,
    fontFamily:
      override.monospace === true
        ? MONO_FONT
        : override.monospace === false
          ? DIAGRAM_FONT
          : base.fontFamily,
    fontSize: override.fontSize ?? base.fontSize,
    color: override.color ?? base.color,
    weight: override.bold === undefined ? base.weight : override.bold ? 700 : 400,
    italic: override.italic === undefined ? base.italic : override.italic,
  };
};

export const hasTextStyleOverride = (override: TextStyleOverride | undefined): boolean =>
  override !== undefined &&
  (override.bold !== undefined ||
    override.italic !== undefined ||
    override.monospace !== undefined ||
    override.fontSize !== undefined ||
    override.color !== undefined);


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

const INK = "#111111";
const MUTED = "#555555";
const CANVAS = "#ffffff";
const GRID = "#e8e5df";
const GRID_MAJOR = "#d7d2c8";
const SELECTION = "#2563eb";
const PORT = "#0f766e";
const PORT_ACTIVE = "#0d9488";
const WARNING = "#b45309";
const FONT = DIAGRAM_FONT;

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
    text: { fontFamily: FONT, fontSize: 10.5, color: INK, weight: 400 },
    headerFill: { color: "#f3f1eb" },
    headerText: { fontFamily: FONT, fontSize: 11.5, color: INK, weight: 700 },
    divider: { color: INK, width: 0.5, pattern: "solid" },
    cornerRadius: 0,
    paddingX: 7,
    headerHeight: 29,
    rowHeight: 20,
    rowPaddingY: 2,
    sectionGap: 2,
  },
  shape: {
    fill: { color: "#ffffff" },
    stroke: { color: INK, width: 0.75, pattern: "solid" },
    text: { fontFamily: FONT, fontSize: 10.5, color: INK, weight: 400 },
    cornerRadius: 0,
    padding: 6,
  },
  edge: {
    stroke: { color: INK, width: 0.75, pattern: "solid" },
    labelText: { fontFamily: FONT, fontSize: 9.5, color: INK, weight: 400 },
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
