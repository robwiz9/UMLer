/**
 * Typst + CeTZ serializer (Step 4).
 *
 * The serializer is a pure function of the committed scene, the Phase 1 layout
 * snapshot and the export settings. It never re-routes, re-measures or invents
 * geometry: every coordinate comes from `LayoutSnapshot`, the same data the
 * SVG skeleton draws. The only transformations are:
 *
 *   1. selection filtering (nodes/edges + one common bounding box),
 *   2. origin normalisation,
 *   3. a single page-fit scale applied to coordinates, font sizes and stroke
 *      widths, and
 *   4. the model's y-down -> CeTZ y-up flip.
 *
 * Applying the scale to geometry instead of wrapping the canvas in CeTZ
 * `scale` keeps stroke widths and font sizes proportional, and makes the
 * generated canvas size exactly the size reserved by Typst's page layout.
 */

import type {
  EdgeLabelLayout,
  EdgeLayout,
  LayoutSnapshot,
  NodeLayout,
  ShapeNodeLayout,
  TableNodeLayout,
  TextMeasurement,
} from "../model/layout.ts";
import type { FillStyle, ShapeNodeStyle, StrokeStyle, TextStyle, Theme } from "../model/styles.ts";
import { MONO_FONT } from "../model/styles.ts";
import type { EndpointMarker } from "../model/markers.ts";
import type {
  CommentNode,
  ImageAsset,
  ImageNode,
  LifelineNode,
  RelationAttributeNode,
  SceneNode,
  TableNode,
} from "../model/nodes.ts";
import type { SceneEdge } from "../model/edges.ts";
import type { SceneDocument } from "../model/scene.ts";
import type { Point, Rect } from "../model/geometry.ts";
import { toCetzAnchorName, toCetzName } from "../model/cetz-map.ts";
import type { PageSize } from "./page.ts";
import {
  defaultDiagramId,
  fitDiagramToPage,
  normalizeResourceFolder,
  pageMarginsPt,
  pageSize,
  toDiagramLabel,
  type ExportSettings,
  type FitResult,
} from "./page.ts";
import {
  resolveExportSelection,
  type ExportSelection,
} from "./selection.ts";

export const CETZ_EXPORT_VERSION = "0.5.3";
/**
 * typst.ts 0.7.0 embeds Typst 0.14.2. CeTZ 0.5.3 declares compiler 0.15.0, so
 * the live preview compiles against 0.5.2 (same drawing API). Only the import
 * line is swapped; every generated call is shared by both versions.
 */
export const CETZ_PREVIEW_VERSION = "0.5.2";

export interface ImageReference {
  readonly nodeId: string;
  readonly fileName: string;
  readonly path: string;
  readonly assetId?: string;
  readonly missing: boolean;
}

export interface CetzExportStats {
  readonly nodes: number;
  readonly edges: number;
  readonly labels: number;
  readonly marks: number;
  readonly lines: number;
}

export interface CetzExportResult {
  readonly code: string;
  /** Same document with the preview-compatible CeTZ import. */
  readonly previewCode: string;
  readonly selection: ExportSelection;
  readonly fit: FitResult;
  readonly page: PageSize;
  readonly label: string;
  readonly caption: string;
  readonly warnings: readonly string[];
  readonly images: readonly ImageReference[];
  readonly stats: CetzExportStats;
}

export interface SerializeCetzOptions {
  readonly scene: SceneDocument;
  readonly layout: LayoutSnapshot;
  readonly settings: ExportSettings;
  readonly selectedNodeIds: readonly string[];
  readonly selectedEdgeId?: string | null;
  /** Project-level asset records, including bytes for the live preview. */
  readonly assets?: Readonly<Record<string, ImageAsset>>;
}

const INDENT = "  ";

class Writer {
  readonly lines: string[] = [];

  push(level: number, text = ""): void {
    this.lines.push(level === 0 ? text : `${INDENT.repeat(level)}${text}`);
  }

  blank(): void {
    this.lines.push("");
  }

  toString(): string {
    return this.lines.join("\n");
  }
}

const round = (value: number, decimals = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Compact, deterministic number formatting for Typst lengths. */
const num = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  const rounded = round(value, 3);
  if (Math.abs(rounded) < 0.0005) return "0";
  return String(rounded);
};

const quote = (value: string): string =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;

const colorExpr = (color: string | null | undefined, opacity?: number): string => {
  if (color === null || color === undefined || color === "none" || color === "transparent") {
    return "none";
  }
  const trimmed = color.trim();
  const hex = trimmed.startsWith("#") ? trimmed : null;
  if (hex === null) {
    // Theme colours are hex, but a project file may contain a Typst named
    // colour. Emitting it verbatim is safer than silently substituting black.
    return trimmed;
  }
  let digits = hex.slice(1);
  if (digits.length === 3) {
    digits = digits.split("").map((digit) => `${digit}${digit}`).join("");
  }
  if (digits.length === 4) {
    digits = digits
      .split("")
      .map((digit) => `${digit}${digit}`)
      .join("");
  }
  if (digits.length === 8) {
    return `rgb("${hex.toLowerCase()}")`;
  }
  if (digits.length !== 6) {
    // Not a valid Typst hex colour; emit the original token untouched rather
    // than constructing an invalid rgb() call.
    return trimmed;
  }
  if (opacity !== undefined && opacity < 0.999) {
    const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
      .toString(16)
      .padStart(2, "0");
    digits = `${digits}${alpha}`;
  }
  return `rgb("#${digits.toLowerCase()}")`;
};

const fillExpr = (fill: FillStyle | undefined): string =>
  fill === undefined ? "none" : colorExpr(fill.color, fill.opacity);

/**
 * The bundled OTF files expose the `LMRoman10` / `LMMono10` family names, while
 * the editor's CSS aliases them to the friendlier Latin Modern names. Emit a
 * fallback list so both a system-installed Latin Modern and the typst.ts
 * preview resolve to the same face.
 */
const fontFamilyExpr = (family: string): string => {
  if (family === "Latin Modern Roman") {
    return '("Latin Modern Roman", "LMRoman10")';
  }
  if (family === "Latin Modern Mono") {
    // The bold mono OTF uses the "LMMonoLt10" family; list both so bold and
    // regular monospaced rows resolve to real faces in the preview.
    return '("Latin Modern Mono", "LMMono10", "LMMonoLt10")';
  }
  return quote(family);
};

const weightName = (weight: TextStyle["weight"]): string => {
  switch (weight) {
    case 500:
      return "medium";
    case 600:
      return "semibold";
    case 700:
      return "bold";
    default:
      return "regular";
  }
};

const strokeExpr = (stroke: StrokeStyle, scale: number): string => {
  if (stroke.width <= 0) return "none";
  const parts = [
    `paint: ${colorExpr(stroke.color, stroke.opacity)}`,
    `thickness: ${num(stroke.width * scale)}pt`,
  ];
  if (stroke.dashPattern !== undefined && stroke.dashPattern.length > 0) {
    parts.push(`dash: (${stroke.dashPattern.map((value) => `${num(value * scale)}pt`).join(", ")})`);
  } else if (stroke.pattern === "dashed") {
    parts.push(`dash: "dashed"`);
  } else if (stroke.pattern === "dotted") {
    parts.push(`dash: "dotted"`);
  }
  if (stroke.lineCap !== undefined) parts.push(`cap: "${stroke.lineCap}"`);
  if (stroke.lineJoin !== undefined) parts.push(`join: "${stroke.lineJoin}"`);
  return `(${parts.join(", ")})`;
};

const textExpr = (measurement: TextMeasurement, scale: number): string => {
  const style = measurement.style;
  const parts = [`size: ${num(style.fontSize * scale)}pt`];
  // Body text inherits the host document's font. Only an explicit monospace
  // override names a family, because there is no generic "monospace" family in
  // Typst and silently dropping that semantic would be worse than naming it.
  if (style.fontFamily === MONO_FONT) {
    parts.push(`font: ${fontFamilyExpr(style.fontFamily)}`);
  }
  if (style.weight !== 400) parts.push(`weight: "${weightName(style.weight)}"`);
  if (style.italic === true) parts.push(`style: "italic"`);
  parts.push(`fill: ${colorExpr(style.color)}`);
  return `text(${parts.join(", ")})[#(${quote(measurement.text)})]`;
};

interface Projector {
  readonly x: (value: number) => number;
  readonly y: (value: number) => number;
  readonly point: (point: Point) => string;
  readonly center: (rect: Rect) => string;
  readonly rect: (rect: Rect) => { readonly a: string; readonly b: string };
  readonly size: (value: number) => number;
}

const projectorFor = (bounds: Rect, scale: number): Projector => {
  const x = (value: number): number => round((value - bounds.x) * scale, 3);
  const y = (value: number): number =>
    round((bounds.y + bounds.height - value) * scale, 3);
  return {
    x,
    y,
    point: (p) => `(${num(x(p.x))}, ${num(y(p.y))})`,
    center: (r) => `(${num(x(r.x + r.width / 2))}, ${num(y(r.y + r.height / 2))})`,
    rect: (r) => ({
      a: `(${num(x(r.x))}, ${num(y(r.y + r.height))})`,
      b: `(${num(x(r.x + r.width))}, ${num(y(r.y))})`,
    }),
    size: (value) => round(value * scale, 3),
  };
};

const contentAt = (
  at: string,
  body: string,
  anchor: "center" | "west" | "east" | "north-west",
): string => `draw.content(${at}, ${body}, anchor: "${anchor}", padding: 0pt)`;

const shapedRect = (
  p: Projector,
  scale: number,
  rect: Rect,
  fill: FillStyle | null | undefined,
  stroke: StrokeStyle | null | undefined,
  radius?: number,
): string => {
  const corners = p.rect(rect);
  const props = [
    `fill: ${fill === null ? "none" : fillExpr(fill)}`,
    `stroke: ${stroke === null || stroke === undefined ? "none" : strokeExpr(stroke, scale)}`,
  ];
  if (radius !== undefined && radius > 0) props.push(`radius: ${num(radius * scale)}pt`);
  return `draw.rect(${corners.a}, ${corners.b}, ${props.join(", ")})`;
};

const lineCall = (
  p: Projector,
  points: readonly Point[],
  stroke: StrokeStyle | null,
  scale: number,
  options: { readonly close?: boolean; readonly fill?: FillStyle | null } = {},
): string | null => {
  if (points.length < 2) return null;
  const args = points.map((point) => p.point(point)).join(", ");
  const props: string[] = [];
  if (options.fill !== undefined) {
    props.push(`fill: ${options.fill === null ? "none" : fillExpr(options.fill)}`);
  }
  props.push(`stroke: ${stroke === null ? "none" : strokeExpr(stroke, scale)}`);
  if (options.close === true) props.push("close: true");
  return `draw.line(${args}, ${props.join(", ")})`;
};

const circleCall = (
  p: Projector,
  center: Point,
  radius: number | readonly [number, number],
  fill: FillStyle | null,
  stroke: StrokeStyle | null,
  scale: number,
): string => {
  const props = [
    `fill: ${fill === null ? "none" : fillExpr(fill)}`,
    `stroke: ${stroke === null ? "none" : strokeExpr(stroke, scale)}`,
  ];
  const radiusExpr = typeof radius === "number"
    ? `${num(radius * scale)}pt`
    : `(${num(radius[0] * scale)}pt, ${num(radius[1] * scale)}pt)`;
  return `draw.circle(${p.point(center)}, radius: ${radiusExpr}, ${props.join(", ")})`;
};

type ShapeSceneNode = Exclude<
  SceneNode,
  TableNode | RelationAttributeNode | ImageNode | LifelineNode | CommentNode
>;

/** Text placement helper shared by all node kinds. */
const textAt = (
  _p: Projector,
  scale: number,
  measurement: TextMeasurement | undefined,
  at: string,
  anchor: "center" | "west" | "east" | "north-west",
): string | null => {
  if (measurement === undefined || measurement.text.length === 0) return null;
  return contentAt(at, textExpr(measurement, scale), anchor);
};

const flattenRows = (layout: TableNodeLayout) =>
  layout.sections.flatMap((section) => section.rows);

const drawTable = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  node: TableNode | Extract<SceneNode, { kind: "relationAttribute" }>,
  layout: TableNodeLayout,
): void => {
  const style = node.style;
  const headerBackground =
    node.kind === "table" ? node.header.backgroundColor : node.backgroundColor;
  const headerFill: FillStyle | null =
    headerBackground === null
      ? null
      : headerBackground === undefined
        ? style.headerFill
        : { color: headerBackground };
  const sectionBackgrounds = new Map<string, string | null | undefined>(
    node.kind === "table"
      ? node.sections.map((section) => [section.id, section.backgroundColor])
      : [],
  );

  writer.push(level, shapedRect(p, scale, layout.frame, style.fill, null));
  writer.push(
    level,
    shapedRect(p, scale, layout.header.frame, headerFill, null),
  );
  for (const section of layout.sections) {
    const background = sectionBackgrounds.get(section.sectionId);
    if (background === null) continue;
    if (background !== undefined) {
      writer.push(level, shapedRect(p, scale, section.frame, { color: background }, null));
    }
  }

  // Header divider and compartment dividers.
  writer.push(
    level,
    `draw.line(${p.point({ x: layout.frame.x, y: layout.header.frame.y + layout.header.frame.height })}, ${p.point({ x: layout.frame.x + layout.frame.width, y: layout.header.frame.y + layout.header.frame.height })}, stroke: ${strokeExpr(style.divider, scale)})`,
  );
  for (const section of layout.sections) {
    if (section.frame.y + section.frame.height >= layout.frame.y + layout.frame.height - 0.001) {
      continue;
    }
    const divider: StrokeStyle = { ...style.divider, opacity: 0.55 };
    writer.push(
      level,
      `draw.line(${p.point({ x: layout.frame.x, y: section.frame.y + section.frame.height })}, ${p.point({ x: layout.frame.x + layout.frame.width, y: section.frame.y + section.frame.height })}, stroke: ${strokeExpr(divider, scale)})`,
    );
  }

  const headerText = textAt(
    p,
    scale,
    layout.header.text,
    p.center(layout.header.textFrame),
    "center",
  );
  if (headerText !== null) writer.push(level, headerText);
  if (layout.header.stereotype !== undefined && layout.header.stereotypeFrame !== undefined) {
    const stereotype = textAt(
      p,
      scale,
      layout.header.stereotype,
      p.center(layout.header.stereotypeFrame),
      "center",
    );
    if (stereotype !== null) writer.push(level, stereotype);
  }

  for (const section of layout.sections) {
    if (section.header !== undefined) {
      const sectionText = textAt(
        p,
        scale,
        section.header.text,
        p.point({
          x: section.header.textFrame.x,
          y: section.header.textFrame.y + section.header.textFrame.height / 2,
        }),
        "west",
      );
      if (sectionText !== null) writer.push(level, sectionText);
    }
    for (const row of section.rows) {
      const rowText = textAt(
        p,
        scale,
        row.text,
        p.point({
          x: row.textFrame.x,
          y: row.textFrame.y + row.textFrame.height / 2,
        }),
        "west",
      );
      if (rowText !== null) writer.push(level, rowText);
      for (const badge of row.badgeFrames) {
        const badgeFill: FillStyle | null =
          style.headerFill.color === null ? null : style.headerFill;
        writer.push(
          level,
          shapedRect(p, scale, badge.frame, badgeFill, { ...style.divider, width: 0.45 }, 2),
        );
        const badgeStyle: TextStyle = {
          ...style.text,
          fontSize: Math.max(7, style.text.fontSize - 3.3),
          weight: 600,
        };
        const measurement: TextMeasurement = {
          text: badge.label,
          width: badge.frame.width,
          height: badge.frame.height,
          lines: 1,
          truncated: false,
          style: badgeStyle,
        };
        const badgeText = textAt(p, scale, measurement, p.center(badge.frame), "center");
        if (badgeText !== null) writer.push(level, badgeText);
      }
    }
  }

  // Border last so header/section fills cannot cover half the stroke.
  writer.push(level, shapedRect(p, scale, layout.frame, null, style.stroke, style.cornerRadius));
};

const drawActor = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  layout: ShapeNodeLayout,
  style: ShapeNodeStyle,
): void => {
  const frame = layout.frame;
  const text = layout.text;
  const labelHeight = text.height;
  const bodyBottom = frame.y + frame.height - labelHeight - 4;
  const centerX = frame.x + frame.width / 2;
  const headRadius = Math.min(frame.width * 0.16, Math.max(5, (bodyBottom - frame.y) * 0.15));
  const headCenterY = frame.y + headRadius + 3;
  const shoulderY = headCenterY + headRadius;
  const hipY = frame.y + (bodyBottom - frame.y) * 0.68;
  const armY = shoulderY + (hipY - shoulderY) * 0.28;
  const armHalf = frame.width * 0.28;
  const legHalf = frame.width * 0.2;
  const stroke = style.stroke;
  writer.push(
    level,
    circleCall(
      p,
      { x: centerX, y: headCenterY },
      headRadius,
      { color: "#ffffff" },
      stroke,
      scale,
    ),
  );
  const lines: [Point, Point][] = [
    [{ x: centerX, y: shoulderY }, { x: centerX, y: hipY }],
    [{ x: centerX - armHalf, y: armY }, { x: centerX + armHalf, y: armY }],
    [{ x: centerX, y: hipY }, { x: centerX - legHalf, y: bodyBottom }],
    [{ x: centerX, y: hipY }, { x: centerX + legHalf, y: bodyBottom }],
  ];
  for (const [from, to] of lines) {
    const call = lineCall(p, [from, to], stroke, scale);
    if (call !== null) writer.push(level, call);
  }
  const label = textAt(
    p,
    scale,
    layout.text,
    p.center(layout.textFrame),
    "center",
  );
  if (label !== null) writer.push(level, label);
};

const drawLifeline = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  layout: Extract<NodeLayout, { kind: "lifeline" }>,
  style: ShapeNodeStyle,
): void => {
  const head = layout.headFrame;
  const headFill: FillStyle = { color: "#ffffff" };
  writer.push(level, shapedRect(p, scale, head, headFill, style.stroke));
  const label = textAt(p, scale, layout.headText, p.center(head), "center");
  if (label !== null) writer.push(level, label);
  const spineStroke: StrokeStyle = {
    color: style.stroke.color,
    width: 0.7,
    pattern: "dashed",
    dashPattern: [4, 4],
  };
  const spine = lineCall(p, [layout.spine.from, layout.spine.to], spineStroke, scale);
  if (spine !== null) writer.push(level, spine);
  for (const activation of layout.activations) {
    writer.push(level, shapedRect(p, scale, activation.frame, headFill, { ...style.stroke, width: 0.7 }));
  }
  if (layout.destroyPoint !== undefined) {
    const center = layout.destroyPoint;
    const destroyStroke: StrokeStyle = { color: style.stroke.color, width: 1, pattern: "solid" };
    for (const [a, b] of [
      [
        { x: center.x - 5, y: center.y - 5 },
        { x: center.x + 5, y: center.y + 5 },
      ],
      [
        { x: center.x - 5, y: center.y + 5 },
        { x: center.x + 5, y: center.y - 5 },
      ],
    ] as const) {
      const call = lineCall(p, [a, b], destroyStroke, scale);
      if (call !== null) writer.push(level, call);
    }
  }
};

const drawShape = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  node: ShapeSceneNode,
  layout: ShapeNodeLayout,
): void => {
  const style = node.style;
  const frame = layout.frame;
  const centerPoint = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const commonFill = node.kind === "frame" ? null : style.fill;

  if (node.kind === "actor") {
    drawActor(writer, level, p, scale, layout, style);
    return;
  }

  if (node.kind === "useCase") {
    writer.push(
      level,
      circleCall(
        p,
        centerPoint,
        [frame.width / 2, frame.height / 2],
        commonFill,
        style.stroke,
        scale,
      ),
    );
    const label = textAt(p, scale, layout.text, p.center(layout.textFrame), "center");
    if (label !== null) writer.push(level, label);
    return;
  }

  if (node.kind === "pseudostate") {
    const radius = Math.min(frame.width, frame.height) / 2;
    const ink: FillStyle = { color: "#111111" };
    const inkStroke: StrokeStyle = { color: "#111111", width: 1, pattern: "solid" };
    switch (node.pseudostateKind) {
      case "initial":
        writer.push(
          level,
          circleCall(p, centerPoint, Math.max(3, radius * 0.55), ink, null, scale),
        );
        return;
      case "final":
        writer.push(
          level,
          circleCall(p, centerPoint, radius, { color: "#ffffff" }, inkStroke, scale),
        );
        writer.push(
          level,
          circleCall(p, centerPoint, Math.max(2, radius * 0.58), ink, null, scale),
        );
        return;
      case "choice": {
        const points: Point[] = [
          { x: centerPoint.x, y: frame.y },
          { x: frame.x + frame.width, y: centerPoint.y },
          { x: centerPoint.x, y: frame.y + frame.height },
          { x: frame.x, y: centerPoint.y },
        ];
        const call = lineCall(p, points, style.stroke, scale, {
          close: true,
          fill: { color: "#ffffff" },
        });
        if (call !== null) writer.push(level, call);
        return;
      }
      case "fork":
      case "join": {
        const bar: Rect = {
          x: frame.x,
          y: frame.y + frame.height * 0.4,
          width: frame.width,
          height: frame.height * 0.2,
        };
        writer.push(level, shapedRect(p, scale, bar, ink, null));
        return;
      }
      case "terminate": {
        const stroke: StrokeStyle = { color: "#111111", width: 1.4, pattern: "solid" };
        for (const [a, b] of [
          [
            { x: frame.x + 3, y: frame.y + 3 },
            { x: frame.x + frame.width - 3, y: frame.y + frame.height - 3 },
          ],
          [
            { x: frame.x + 3, y: frame.y + frame.height - 3 },
            { x: frame.x + frame.width - 3, y: frame.y + 3 },
          ],
        ] as const) {
          const call = lineCall(p, [a, b], stroke, scale);
          if (call !== null) writer.push(level, call);
        }
        return;
      }
      default:
        writer.push(
          level,
          circleCall(p, centerPoint, Math.max(3, radius * 0.5), { color: "#ffffff" }, inkStroke, scale),
        );
        return;
    }
  }

  if (node.kind === "relationship") {
    const points: Point[] = [
      { x: centerPoint.x, y: frame.y },
      { x: frame.x + frame.width, y: centerPoint.y },
      { x: centerPoint.x, y: frame.y + frame.height },
      { x: frame.x, y: centerPoint.y },
    ];
    const call = lineCall(p, points, style.stroke, scale, {
      close: true,
      fill: { color: "#ffffff" },
    });
    if (call !== null) writer.push(level, call);
    const label = textAt(p, scale, layout.text, p.center(layout.textFrame), "center");
    if (label !== null) writer.push(level, label);
    return;
  }

  if (node.kind === "state") {
    writer.push(
      level,
      shapedRect(p, scale, frame, commonFill, style.stroke, Math.min(12, frame.height / 4)),
    );
    const label = textAt(p, scale, layout.text, p.center(layout.textFrame), "center");
    if (label !== null) writer.push(level, label);
    return;
  }

  if (node.kind === "frame") {
    writer.push(level, shapedRect(p, scale, frame, null, style.stroke));
    const label = textAt(
      p,
      scale,
      layout.text,
      p.point({
        x: layout.textFrame.x,
        y: layout.textFrame.y + layout.textFrame.height / 2,
      }),
      "west",
    );
    if (label !== null) writer.push(level, label);
    return;
  }

  if (node.kind === "object") {
    writer.push(level, shapedRect(p, scale, frame, commonFill, style.stroke));
    const label = textAt(p, scale, layout.text, p.center(layout.textFrame), "center");
    if (label !== null) writer.push(level, label);
    const half = Math.min(frame.width * 0.3, layout.text.width / 2 + 4);
    const underline: StrokeStyle = { color: "#111111", width: 0.6, pattern: "solid" };
    const call = lineCall(
      p,
      [
        { x: centerPoint.x - half, y: centerPoint.y + layout.text.height / 2 + 2 },
        { x: centerPoint.x + half, y: centerPoint.y + layout.text.height / 2 + 2 },
      ],
      underline,
      scale,
    );
    if (call !== null) writer.push(level, call);
    return;
  }

  // Remaining rectangle shapes (generic/custom future nodes).
  writer.push(level, shapedRect(p, scale, frame, commonFill, style.stroke, style.cornerRadius));
  const label = textAt(p, scale, layout.text, p.center(layout.textFrame), "center");
  if (label !== null) writer.push(level, label);
};

const drawImage = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  node: ImageNode,
  layout: Extract<NodeLayout, { kind: "image" }>,
  reference: ImageReference,
  theme: Theme,
): void => {
  const frame = layout.imageFrame;
  const placeholderFill: FillStyle = { color: "#f0ede5" };
  if (reference.missing) {
    writer.push(level, shapedRect(p, scale, frame, placeholderFill, null));
    const cross: StrokeStyle = { color: theme.colors.gridMajor, width: 0.6, pattern: "solid" };
    for (const [a, b] of [
      [
        { x: frame.x, y: frame.y },
        { x: frame.x + frame.width, y: frame.y + frame.height },
      ],
      [
        { x: frame.x + frame.width, y: frame.y },
        { x: frame.x, y: frame.y + frame.height },
      ],
    ] as const) {
      const call = lineCall(p, [a, b], cross, scale);
      if (call !== null) writer.push(level, call);
    }
    const placeholder: TextMeasurement = {
      text: "IMAGE",
      width: frame.width,
      height: frame.height,
      lines: 1,
      truncated: false,
      style: { ...node.style.text, fontSize: 8, color: theme.colors.muted },
    };
    const label = textAt(p, scale, placeholder, p.center(frame), "center");
    if (label !== null) writer.push(level, label);
  } else {
    const fit = node.fit === "fill" ? "stretch" : node.fit;
    const imageExpr = `image(${quote(reference.path)}, width: ${num(p.size(frame.width))}pt, height: ${num(p.size(frame.height))}pt, fit: ${quote(fit)})`;
    writer.push(
      level,
      contentAt(
        `(${num(p.x(frame.x))}, ${num(p.y(frame.y))})`,
        imageExpr,
        "north-west",
      ),
    );
  }
  if (layout.caption !== undefined && layout.captionFrame !== undefined) {
    const caption = textAt(
      p,
      scale,
      layout.caption,
      p.center(layout.captionFrame),
      "center",
    );
    if (caption !== null) writer.push(level, caption);
  }
};

const drawComment = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  node: Extract<SceneNode, { kind: "comment" }>,
  layout: Extract<NodeLayout, { kind: "comment" }>,
): void => {
  const frame = layout.frame;
  const fold = Math.min(18, frame.width / 4, frame.height / 4);
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const fill: FillStyle | null =
    node.backgroundColor === null
      ? null
      : node.backgroundColor === undefined
        ? { color: "#fffdf2" }
        : { color: node.backgroundColor };
  const points: Point[] = [
    { x: frame.x, y: frame.y },
    { x: right - fold, y: frame.y },
    { x: right, y: frame.y + fold },
    { x: right, y: bottom },
    { x: frame.x, y: bottom },
  ];
  const outline = lineCall(p, points, node.style.stroke, scale, {
    close: true,
    fill,
  });
  if (outline !== null) writer.push(level, outline);
  const foldLine = lineCall(
    p,
    [
      { x: right - fold, y: frame.y },
      { x: right - fold, y: frame.y + fold },
      { x: right, y: frame.y + fold },
    ],
    node.style.stroke,
    scale,
  );
  if (foldLine !== null) writer.push(level, foldLine);
  const lineHeight = node.style.text.fontSize * 1.35;
  layout.lines.forEach((line, index) => {
    const text = textAt(
      p,
      scale,
      line,
      p.point({
        x: layout.textFrame.x,
        y: layout.textFrame.y + lineHeight * (index + 0.8),
      }),
      "west",
    );
    if (text !== null) writer.push(level, text);
  });
};

/* ------------------------------------------------------------------------- */
/* Marks                                                                     */
/* ------------------------------------------------------------------------- */

interface MarkDefinition {
  readonly body: readonly string[];
}

const MARK_DEFINITIONS: Record<string, MarkDefinition> = {
  "uml-hollow-triangle": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((0, 0), (l, -w / 2), (l, w / 2), close: true, fill: white, stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l, 0))',
    ],
  },
  "uml-hollow-diamond": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((0, 0), (l / 2, w / 2), (l, 0), (l / 2, -w / 2), close: true, fill: white, stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l, 0))',
    ],
  },
  "uml-filled-diamond": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((0, 0), (l / 2, w / 2), (l, 0), (l / 2, -w / 2), close: true, fill: style.stroke.paint, stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l, 0))',
    ],
  },
  "uml-open-arrow": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((0, 0), (l, w / 2), stroke: style.stroke)",
      "draw.line((0, 0), (l, -w / 2), stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (0, 0))',
    ],
  },
  "generic-filled-arrow": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((0, 0), (l, -w / 2), (l, w / 2), close: true, fill: style.stroke.paint, stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l, 0))',
    ],
  },
  "er-one": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((0, -w / 2), (0, w / 2), stroke: style.stroke)",
      "draw.line((l / 3, -w / 2), (l / 3, w / 2), stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (0, 0))',
    ],
  },
  "er-many": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((l, 0), (0, w / 2), stroke: style.stroke)",
      "draw.line((l, 0), (0, 0), stroke: style.stroke)",
      "draw.line((l, 0), (0, -w / 2), stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l, 0))',
    ],
  },
  "er-zero-one": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "line((0, -w / 2), (0, w / 2), stroke: style.stroke)",
      "draw.circle((l * 5 / 12, 0), radius: w * 0.34, fill: white, stroke: style.stroke)",
      "line((l * 13 / 12, -w / 2), (l * 13 / 12, w / 2), stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l * 0.5, 0))',
    ],
  },
  "er-one-many": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((l, 0), (0, w / 2), stroke: style.stroke)",
      "draw.line((l, 0), (0, 0), stroke: style.stroke)",
      "draw.line((l, 0), (0, -w / 2), stroke: style.stroke)",
      "line((l * 4 / 3, -w / 2), (l * 4 / 3, w / 2), stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l * 4 / 3, 0))',
    ],
  },
  "er-zero-many": {
    body: [
      "let (l, w) = (style.length, style.width)",
      "draw.line((l, 0), (0, w / 2), stroke: style.stroke)",
      "draw.line((l, 0), (0, 0), stroke: style.stroke)",
      "draw.line((l, 0), (0, -w / 2), stroke: style.stroke)",
      "draw.circle((l * 4 / 3, 0), radius: w * 0.34, fill: white, stroke: style.stroke)",
      'draw.anchor("tip", (0, 0))',
      'draw.anchor("base", (l * 4 / 3 + w * 0.34, 0))',
    ],
  },
};

const markSymbolFor = (marker: EndpointMarker): string | null => {
  if (marker.family === "none") return null;
  if (marker.family === "uml") {
    switch (marker.kind) {
      case "inheritance":
      case "realization":
        return "uml-hollow-triangle";
      case "aggregation":
        return "uml-hollow-diamond";
      case "composition":
        return "uml-filled-diamond";
      case "directedAssociation":
      case "dependency":
        return "uml-open-arrow";
    }
  }
  if (marker.family === "er") {
    switch (marker.kind) {
      case "one":
        return "er-one";
      case "many":
        return "er-many";
      case "zeroOrOne":
        return "er-zero-one";
      case "oneOrMany":
        return "er-one-many";
      case "zeroOrMany":
        return "er-zero-many";
    }
  }
  return marker.kind === "filledArrow" ? "generic-filled-arrow" : "uml-open-arrow";
};

const markSize = (symbol: string): readonly [number, number] => {
  switch (symbol) {
    case "uml-hollow-triangle":
      return [10, 9];
    case "uml-hollow-diamond":
    case "uml-filled-diamond":
      return [12, 7];
    case "uml-open-arrow":
    case "generic-filled-arrow":
      return [12, 10];
    default:
      return [12, 10];
  }
};

const markerExpr = (marker: EndpointMarker, scale: number): string | null => {
  const symbol = markSymbolFor(marker);
  if (symbol === null) return null;
  const markerScale = "scale" in marker && marker.scale !== undefined ? marker.scale : 1;
  const [length, width] = markSize(symbol);
  return `(symbol: "${symbol}", length: ${num(length * markerScale * scale)}pt, width: ${num(width * markerScale * scale)}pt)`;
};

const effectiveMarkers = (edge: SceneEdge): { source: EndpointMarker; target: EndpointMarker } => {
  if (
    edge.semantic.family === "sequence" &&
    edge.markers.source.family === "none" &&
    edge.markers.target.family === "none"
  ) {
    return {
      source: { family: "none", kind: "none" },
      target:
        edge.semantic.messageKind === "reply"
          ? { family: "generic", kind: "arrow" }
          : { family: "generic", kind: "filledArrow" },
    };
  }
  return edge.markers;
};

/* ------------------------------------------------------------------------- */
/* Edges and labels                                                          */
/* ------------------------------------------------------------------------- */

const drawEdge = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  edge: SceneEdge,
  layout: EdgeLayout,
  usedMarks: Set<string>,
): void => {
  if (layout.points.length < 2) return;
  const markers = effectiveMarkers(edge);
  const start = markerExpr(markers.source, scale);
  const end = markerExpr(markers.target, scale);
  for (const marker of [markers.source, markers.target]) {
    const symbol = markSymbolFor(marker);
    if (symbol !== null) usedMarks.add(symbol);
  }
  const args = layout.points.map((point) => p.point(point)).join(", ");
  const props = [`stroke: ${strokeExpr(edge.style.stroke, scale)}`];
  if (start !== null || end !== null) {
    const markProps: string[] = [];
    if (start !== null) markProps.push(`start: ${start}`);
    if (end !== null) markProps.push(`end: ${end}`);
    props.push(`mark: (${markProps.join(", ")})`);
  }
  writer.push(level, `draw.line(${args}, ${props.join(", ")})`);
};

const drawEdgeLabel = (
  writer: Writer,
  level: number,
  p: Projector,
  scale: number,
  label: EdgeLabelLayout,
  theme: Theme,
): void => {
  if (label.text.text.length === 0) return;
  if (theme.edge.labelFill.color !== null) {
    writer.push(
      level,
      shapedRect(p, scale, label.frame, theme.edge.labelFill, null, 2),
    );
  }
  const text = textAt(p, scale, label.text, p.center(label.textFrame), "center");
  if (text !== null) writer.push(level, text);
};

/* ------------------------------------------------------------------------- */
/* Image references                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Keep the user's file name; only strip path components and characters that
 * are invalid in a Windows or Typst path. Renaming "brand logo.png" to
 * "brand-logo.png" would break the promise that the resources folder contains
 * the asset under its original name.
 */
const safeFileName = (value: string): string => {
  const base = value.replace(/\\/g, "/").split("/").pop() ?? "image.png";
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "image.png";
};

const imageReferences = (
  selection: ExportSelection,
  assets: Readonly<Record<string, ImageAsset>>,
  folder: string,
): { readonly refs: readonly ImageReference[]; readonly warnings: readonly string[] } => {
  const used = new Map<string, string>();
  const refs: ImageReference[] = [];
  const warnings: string[] = [];
  for (const { node, assetId } of selection.imageAssets) {
    const asset = assetId === undefined ? undefined : assets[assetId];
    const fileName = safeFileName(asset?.fileName ?? `${node.id}.png`);
    let uniqueName = fileName;
    let suffix = 2;
    while (used.has(uniqueName.toLowerCase()) && used.get(uniqueName.toLowerCase()) !== assetId) {
      const dot = fileName.lastIndexOf(".");
      uniqueName = dot > 0 ? `${fileName.slice(0, dot)}-${suffix}${fileName.slice(dot)}` : `${fileName}-${suffix}`;
      suffix += 1;
    }
    used.set(uniqueName.toLowerCase(), assetId ?? node.id);
    const path = folder.length > 0 ? `${folder}/${uniqueName}` : uniqueName;
    const missing = asset === undefined;
    if (missing) {
      warnings.push(`Image “${fileName}” has no asset; a placeholder is exported.`);
    }
    refs.push({ nodeId: node.id, fileName: uniqueName, path, assetId, missing });
  }
  return { refs, warnings };
};

/* ------------------------------------------------------------------------- */
/* Entry point                                                               */
/* ------------------------------------------------------------------------- */

const textExprForCaption = (text: string, size: number, color: string): string =>
  `text(size: ${num(size)}pt, fill: ${colorExpr(color)})[#(${quote(text)})]`;

export const serializeSceneToCetz = (options: SerializeCetzOptions): CetzExportResult => {
  const { scene, layout, settings, selectedNodeIds } = options;
  const selectedEdgeId = options.selectedEdgeId ?? null;
  const selection = resolveExportSelection(
    scene,
    layout,
    settings.scope,
    selectedNodeIds,
    selectedEdgeId,
  );
  const page = pageSize(settings.page);
  const margins = pageMarginsPt(settings.page);
  const caption = settings.label === undefined ? scene.meta.title : settings.label;
  const hasCaption = caption.trim().length > 0;
  const fit = fitDiagramToPage(
    selection.naturalWidth,
    selection.naturalHeight,
    page,
    settings.zoom,
    hasCaption,
    margins,
  );
  const folder = normalizeResourceFolder(settings.resourceFolder);
  const assets = options.assets ?? scene.assets;
  const imageResult = imageReferences(selection, assets, folder);
  const imageByNode = new Map(imageResult.refs.map((ref) => [ref.nodeId, ref]));
  const warnings = [...selection.warnings, ...imageResult.warnings];

  const p = projectorFor(selection.bounds, fit.scale);
  const writer = new Writer();
  const label = toDiagramLabel(settings.diagramId.trim().length > 0 ? settings.diagramId : defaultDiagramId(scene.meta.title));
  const usedMarks = new Set<string>();

  const drawBody = (target: Writer, level: number): void => {
    const sequence = scene.meta.diagramKind === "uml-sequence";
    const drawNodes = (): void => {
      if (selection.nodes.length === 0) return;
      target.push(level, "// nodes");
      for (const node of selection.nodes) {
        const nodeLayout = layout.nodes[node.id];
        if (nodeLayout === undefined) continue;
        target.push(level, `draw.group(name: "${toCetzName("n", node.id)}", {`);
        const inner = level + 1;
        switch (nodeLayout.kind) {
          case "table":
          case "relationAttribute":
            drawTable(target, inner, p, fit.scale, node as TableNode, nodeLayout);
            break;
          case "lifeline":
            if (node.kind === "lifeline") {
              drawLifeline(target, inner, p, fit.scale, nodeLayout, node.style);
            }
            break;
          case "image":
            drawImage(
              target,
              inner,
              p,
              fit.scale,
              node as ImageNode,
              nodeLayout,
              imageByNode.get(node.id) ?? {
                nodeId: node.id,
                fileName: "image.png",
                path: "image.png",
                missing: true,
              },
              scene.theme,
            );
            break;
          case "comment":
            drawComment(target, inner, p, fit.scale, node as CommentNode, nodeLayout);
            break;
          default:
            drawShape(target, inner, p, fit.scale, node as ShapeSceneNode, nodeLayout);
            break;
        }
        // Addressable anchors: row ports and the four main borders. These are
        // export API, not editor overlays, and cost one line each.
        if (nodeLayout.kind === "table" || nodeLayout.kind === "relationAttribute") {
          const rows = flattenRows(nodeLayout);
          rows.forEach((row, index) => {
            const y = row.frame.y + row.frame.height / 2;
            target.push(
              inner,
              `draw.anchor("${toCetzAnchorName(`row_${index}_west`)}", ${p.point({ x: nodeLayout.frame.x, y })})`,
            );
            target.push(
              inner,
              `draw.anchor("${toCetzAnchorName(`row_${index}_east`)}", ${p.point({ x: nodeLayout.frame.x + nodeLayout.frame.width, y })})`,
            );
          });
        }
        const baseFrame = nodeLayout.kind === "lifeline" ? nodeLayout.headFrame : nodeLayout.frame;
        const center = { x: baseFrame.x + baseFrame.width / 2, y: baseFrame.y + baseFrame.height / 2 };
        target.push(inner, `draw.anchor("north", ${p.point({ x: center.x, y: baseFrame.y })})`);
        target.push(inner, `draw.anchor("east", ${p.point({ x: baseFrame.x + baseFrame.width, y: center.y })})`);
        target.push(inner, `draw.anchor("south", ${p.point({ x: center.x, y: baseFrame.y + baseFrame.height })})`);
        target.push(inner, `draw.anchor("west", ${p.point({ x: baseFrame.x, y: center.y })})`);
        target.push(level, "})");
        target.blank();
      }
    };

    const drawEdges = (labels: boolean): void => {
      if (selection.edges.length === 0) return;
      target.push(level, labels ? "// edge labels" : "// connectors");
      for (const edge of selection.edges) {
        const edgeLayout = layout.edges[edge.id];
        if (edgeLayout === undefined) continue;
        if (labels) {
          for (const labelLayout of edgeLayout.labels) {
            drawEdgeLabel(target, level, p, fit.scale, labelLayout, scene.theme);
          }
        } else {
          drawEdge(target, level, p, fit.scale, edge, edgeLayout, usedMarks);
        }
      }
      target.blank();
    };

    if (sequence) {
      drawNodes();
      drawEdges(false);
      drawEdges(true);
    } else {
      drawEdges(false);
      drawNodes();
      drawEdges(true);
    }
  };

  writer.push(0, "#figure(");
  writer.push(1, "placement: none,");
  // writer.push(1, "numbering: none,");
  if (hasCaption) {
    writer.push(1, "gap: 6pt,");
    writer.push(1, `caption: ${textExprForCaption(caption, 9.5, scene.theme.colors.muted)},`);
  }
  writer.push(0, ")[");
  writer.push(1, `#align(${settings.align})[`);
  writer.push(2, "#canvas(length: 1pt, padding: 0pt, {");

  // The draw pass populates `usedMarks`, so emit the body first and prepend
  // mark registrations afterwards by assembling in a fixed order.
  const bodyWriter = new Writer();
  drawBody(bodyWriter, 0);
  while (bodyWriter.lines.length > 0 && bodyWriter.lines[bodyWriter.lines.length - 1] === "") {
    bodyWriter.lines.pop();
  }
  if (usedMarks.size > 0) {
    const markOrder = [
      "uml-hollow-triangle",
      "uml-hollow-diamond",
      "uml-filled-diamond",
      "uml-open-arrow",
      "generic-filled-arrow",
      "er-one",
      "er-many",
      "er-zero-one",
      "er-one-many",
      "er-zero-many",
    ];
    for (const name of markOrder) {
      if (!usedMarks.has(name)) continue;
      const definition = MARK_DEFINITIONS[name];
      if (definition === undefined) continue;
      writer.push(3, `draw.register-mark("${name}", style => {`);
      for (const line of definition.body) writer.push(4, line);
      writer.push(3, "})");
    }
    writer.blank();
  }
  for (const line of bodyWriter.lines) {
    if (line.length === 0) {
      writer.blank();
    } else {
      writer.push(3, line);
    }
  }
  writer.blank();
  writer.push(2, "})");
  writer.push(1, "]");
  writer.push(0, `] <${label}>`);

  const code = `${writer.toString()}\n`;
  // The exported block is deliberately import-free and setter-free: it is
  // pasted into an existing project. The preview is a disposable host document
  // that supplies the package import and the page the user is targeting; those
  // two lines never appear in the copied code.
  const previewCode = [
    `#import "@preview/cetz:${CETZ_PREVIEW_VERSION}": canvas, draw`,
    `#set page(width: ${num(page.widthPt)}pt, height: ${num(page.heightPt)}pt, margin: (top: ${num(margins.top)}pt, right: ${num(margins.right)}pt, bottom: ${num(margins.bottom)}pt, left: ${num(margins.left)}pt))`,
    `#set text(font: ${fontFamilyExpr("Latin Modern Roman")}, size: ${num(10.5 * fit.scale)}pt, fill: rgb("#111111"))`,
    "",
    code,
  ].join("\n");

  return {
    code,
    previewCode,
    selection,
    fit,
    page,
    label,
    caption,
    warnings,
    images: imageResult.refs,
    stats: {
      nodes: selection.nodes.length,
      edges: selection.edges.length,
      labels: selection.edges.reduce((count, edge) => count + (layout.edges[edge.id]?.labels.length ?? 0), 0),
      marks: usedMarks.size,
      lines: writer.lines.length,
    },
  };
};

/** Re-exported for the tests and future PDF export. */
export { imageReferences };
