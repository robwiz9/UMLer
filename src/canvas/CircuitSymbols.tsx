/**
 * DOM renderer for circuit symbols and junctions.
 *
 * The layout pass owns all geometry; this file only maps the resolved
 * primitives to SVG. The same primitive list is consumed by the CeTZ exporter.
 */

import type {
  CircuitComponentLayout,
  CircuitJunctionLayout,
  TextMeasurement,
} from "../model/layout.ts";
import type {
  CircuitPrimitive,
  CircuitSymbolPrimitive,
  CircuitStandard,
} from "../model/circuit.ts";
import type { CircuitComponentDef } from "../model/circuit-catalog.ts";
import type { CircuitComponentNode, CircuitJunctionNode } from "../model/nodes.ts";
import type { CanvasTextTarget } from "../model/text-targets.ts";
import type { Point } from "../model/geometry.ts";
import { point } from "../model/geometry.ts";
import type { ShapeNodeStyle, StrokeStyle } from "../model/styles.ts";
import { RichLabelText } from "./RichText.tsx";

const dashArray = (stroke: StrokeStyle): string | undefined => {
  if (stroke.pattern === "dashed") return "6 4";
  if (stroke.pattern === "dotted") return "2 3";
  return undefined;
};

const strokeProps = (
  style: ShapeNodeStyle,
  role: "body" | "thin" | "none" | undefined,
): { readonly stroke: string; readonly strokeWidth: number; readonly strokeDasharray?: string } => {
  if (role === "none" || role === undefined) {
    if (role === "none") return { stroke: "none", strokeWidth: 0 };
    return {
      stroke: style.stroke.color,
      strokeWidth: style.stroke.width,
      strokeDasharray: dashArray(style.stroke),
    };
  }
  return {
    stroke: style.stroke.color,
    strokeWidth: role === "thin" ? style.stroke.width * 0.65 : style.stroke.width,
    strokeDasharray: dashArray(style.stroke),
  };
};

const fillColor = (
  style: ShapeNodeStyle,
  role: "none" | "paper" | "ink" | undefined,
): string => {
  if (role === "paper") return style.fill.color ?? "none";
  if (role === "ink") return style.stroke.color;
  return "none";
};

const PrimitiveView = ({
  primitive,
  style,
}: {
  readonly primitive: CircuitPrimitive;
  readonly style: ShapeNodeStyle;
}) => {
  switch (primitive.kind) {
    case "polyline": {
      const stroke = strokeProps(style, primitive.stroke);
      const points = primitive.points.map((p) => `${p.x},${p.y}`).join(" ");
      if (primitive.closed === true) {
        return (
          <polygon
            points={points}
            fill={fillColor(style, primitive.fill)}
            stroke={stroke.stroke}
            strokeWidth={stroke.strokeWidth}
            strokeDasharray={stroke.strokeDasharray}
            strokeLinejoin="miter"
            strokeLinecap="round"
          />
        );
      }
      return (
        <polyline
          points={points}
          fill={fillColor(style, primitive.fill)}
          stroke={stroke.stroke}
          strokeWidth={stroke.strokeWidth}
          strokeDasharray={stroke.strokeDasharray}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      );
    }
    case "circle": {
      const stroke = strokeProps(style, primitive.stroke);
      return (
        <circle
          cx={primitive.center.x}
          cy={primitive.center.y}
          r={primitive.radius}
          fill={fillColor(style, primitive.fill)}
          stroke={stroke.stroke}
          strokeWidth={stroke.strokeWidth}
          strokeDasharray={stroke.strokeDasharray}
        />
      );
    }
    case "rect": {
      const stroke = strokeProps(style, primitive.stroke);
      return (
        <rect
          x={primitive.frame.x}
          y={primitive.frame.y}
          width={primitive.frame.width}
          height={primitive.frame.height}
          rx={primitive.radius}
          fill={fillColor(style, primitive.fill)}
          stroke={stroke.stroke}
          strokeWidth={stroke.strokeWidth}
          strokeDasharray={stroke.strokeDasharray}
        />
      );
    }
    case "bezier": {
      const stroke = strokeProps(style, primitive.stroke);
      return (
        <path
          d={`M ${primitive.start.x},${primitive.start.y} C ${primitive.c1.x},${primitive.c1.y} ${primitive.c2.x},${primitive.c2.y} ${primitive.end.x},${primitive.end.y}`}
          fill={fillColor(style, primitive.fill)}
          stroke={stroke.stroke}
          strokeWidth={stroke.strokeWidth}
          strokeDasharray={stroke.strokeDasharray}
          strokeLinecap="round"
        />
      );
    }
    case "text":
      return (
        <text
          x={primitive.point.x}
          y={primitive.point.y}
          textAnchor={
            primitive.anchor === "start"
              ? "start"
              : primitive.anchor === "end"
                ? "end"
                : "middle"
          }
          dominantBaseline="middle"
          fontFamily={primitive.measurement.style.fontFamily}
          fontSize={primitive.measurement.style.fontSize}
          fontWeight={primitive.measurement.style.weight}
          fontStyle={primitive.measurement.style.italic === true ? "italic" : "normal"}
          fill={primitive.measurement.style.color}
          pointerEvents="none"
        >
          {primitive.text}
        </text>
      );
  }
};

const labelText = (
  measurement: TextMeasurement | undefined,
  frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined,
  delta: Point | undefined,
  onTextDoubleClick?: (target: CanvasTextTarget) => void,
) => {
  if (measurement === undefined || frame === undefined || measurement.text.length === 0) return null;
  const shifted = delta === undefined
    ? frame
    : { ...frame, x: frame.x + delta.x, y: frame.y + delta.y };
  return (
    <RichLabelText
      measurement={measurement}
      frame={shifted}
      onDoubleClick={(event) => {
        if (onTextDoubleClick === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        onTextDoubleClick({ kind: "nodeName" });
      }}
    />
  );
};

export const CircuitComponentBody = ({
  node,
  layout,
  labelDelta,
  onTextDoubleClick,
}: {
  readonly node: CircuitComponentNode;
  readonly layout: CircuitComponentLayout;
  readonly labelDelta?: Point;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
}) => (
  <>
    {layout.primitives.map((primitive, index) => (
      <PrimitiveView key={index} primitive={primitive} style={node.style} />
    ))}
    {labelText(layout.label, layout.labelFrame, labelDelta, onTextDoubleClick)}
  </>
);

export const CircuitJunctionBody = ({
  node,
  layout,
  labelDelta,
  onTextDoubleClick,
}: {
  readonly node: CircuitJunctionNode;
  readonly layout: CircuitJunctionLayout;
  readonly labelDelta?: Point;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
}) => (
  <>
    {node.measurement !== undefined ? (
      <MeasurementArrow node={node} layout={layout} />
    ) : node.junctionStyle === "none" && layout.connected ? null : (
      <circle
        cx={layout.center.x}
        cy={layout.center.y}
        r={layout.radius}
        fill={
          layout.connected === false
            ? "none"
            : node.junctionStyle === "filled" || node.junctionStyle === "solid"
              ? node.style.stroke.color
              : node.style.fill.color ?? "white"
        }
        stroke={layout.connected === false ? "#94a3b8" : node.style.stroke.color}
        strokeWidth={
          layout.connected === false
            ? 1
            : node.junctionStyle === "filled" || node.junctionStyle === "solid"
              ? 0
              : node.style.stroke.width
        }
        strokeDasharray={layout.connected === false ? "3 3" : undefined}
        pointerEvents="none"
      />
    )}
    {labelText(layout.label, layout.labelFrame, labelDelta, onTextDoubleClick)}
  </>
);

const MeasurementArrow = ({
  node,
  layout,
}: {
  readonly node: CircuitJunctionNode;
  readonly layout: CircuitJunctionLayout;
}) => {
  const measurement = node.measurement;
  if (measurement === undefined) return null;
  const radians = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = Math.max(6, layout.frame.width / 2);
  const halfHeight = Math.max(3, layout.frame.height / 2);
  const localToScene = (x: number, y: number): Point => ({
    x:
      layout.center.x +
      (measurement.mirrorX === true ? -x : x) * cos -
      (measurement.mirrorY === true ? -y : y) * sin,
    y:
      layout.center.y +
      (measurement.mirrorX === true ? -x : x) * sin +
      (measurement.mirrorY === true ? -y : y) * cos,
  });
  const localVectorToScene = (x: number, y: number): Point => ({
    x: (measurement.mirrorX === true ? -x : x) * cos -
      (measurement.mirrorY === true ? -y : y) * sin,
    y: (measurement.mirrorX === true ? -x : x) * sin +
      (measurement.mirrorY === true ? -y : y) * cos,
  });
  const ordered = measurement.kind === "current"
    ? [
        localToScene(-halfWidth, 0),
        localToScene(halfWidth, 0),
      ]
    : measurement.kind === "loop-current"
      ? (() => {
          const radius = Math.min(halfWidth, halfHeight);
          return Array.from({ length: 28 }, (_, index) => {
            const t = Math.PI / 2 + (Math.PI * 1.5 * index) / 27;
            return localToScene(radius * Math.cos(t), radius * Math.sin(t));
          });
        })()
      : Array.from({ length: 19 }, (_, index) => {
          const t = (Math.PI * (index + 1)) / 20;
          return localToScene(
            -halfWidth * Math.cos(t),
            -halfHeight * Math.sin(t),
          );
        });
  if (measurement.reverse) ordered.reverse();
  const tip = ordered[ordered.length - 1];
  if (tip === undefined) return null;
  let ux: number;
  let uy: number;
  if (measurement.kind === "loop-current") {
    const tangent = localVectorToScene(0, measurement.reverse ? -1 : 1);
    const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
    ux = tangent.x / tangentLength;
    uy = tangent.y / tangentLength;
  } else {
    const previous = ordered[Math.max(0, ordered.length - 4)];
    if (previous === undefined) return null;
    const length = Math.hypot(tip.x - previous.x, tip.y - previous.y) || 1;
    ux = (tip.x - previous.x) / length;
    uy = (tip.y - previous.y) / length;
  }
  const back = { x: tip.x - ux * 6, y: tip.y - uy * 6 };
  const normal = { x: -uy, y: ux };
  const head = [
    { x: back.x + normal.x * 2.8, y: back.y + normal.y * 2.8 },
    tip,
    { x: back.x - normal.x * 2.8, y: back.y - normal.y * 2.8 },
  ];
  return (
    <g pointerEvents="none">
      <polyline
        points={ordered.map((entry) => `${entry.x},${entry.y}`).join(" ")}
        fill="none"
        stroke={node.style.stroke.color}
        strokeWidth={node.style.stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={head.map((entry) => `${entry.x},${entry.y}`).join(" ")}
        fill="none"
        stroke={node.style.stroke.color}
        strokeWidth={node.style.stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
};

/** Tiny palette preview built from the same catalog symbol. */
export const CircuitSymbolPreview = ({
  component,
  standard,
  width = 46,
  height = 28,
}: {
  readonly component: CircuitComponentDef;
  readonly standard: CircuitStandard;
  readonly width?: number;
  readonly height?: number;
}) => {
  const margin = 4;
  const viewWidth = component.width + margin * 2;
  const viewHeight = component.height + margin * 2;
  const style: ShapeNodeStyle = {
    fill: { color: "var(--circuit-symbol-fill, #ffffff)" },
    stroke: {
      color: "var(--circuit-symbol-stroke, #334155)",
      width: 1.1,
      pattern: "solid",
    },
    text: {
      fontFamily: "sans-serif",
      fontSize: 9,
      color: "var(--circuit-symbol-stroke, #334155)",
      weight: 400,
    },
    cornerRadius: 0,
    padding: 0,
  };
  const resolve = (primitive: CircuitSymbolPrimitive): CircuitPrimitive => {
    if (primitive.kind !== "text") return primitive;
    return {
      kind: "text",
      point: primitive.point,
      text: primitive.text,
      anchor: primitive.anchor,
      measurement: {
        text: primitive.text,
        width: primitive.text.length * 5,
        height: 10,
        lines: 1,
        truncated: false,
        style: style.text,
      },
    };
  };
  const previewPrimitives: CircuitSymbolPrimitive[] = [
    ...component.symbol(standard),
    ...component.pins.map((pin) => ({
      kind: "polyline" as const,
      points: [point(pin.bx, pin.by), point(pin.x, pin.y)],
      stroke: "body" as const,
    })),
  ];
  return (
    <svg
      viewBox={`${-component.width / 2 - margin} ${-component.height / 2 - margin} ${viewWidth} ${viewHeight}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {previewPrimitives.map((primitive, index) => (
        <PrimitiveView key={index} primitive={resolve(primitive)} style={style} />
      ))}
    </svg>
  );
};
