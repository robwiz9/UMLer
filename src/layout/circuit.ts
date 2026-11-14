/**
 * Circuit geometry resolution.
 *
 * The persisted component frame is its unrotated local box. Everything else
 * (AABB, pins, symbol primitives, label frame) is derived here so the DOM and
 * CeTZ exporter consume identical geometry.
 */

import type { CircuitComponentNode, CircuitJunctionNode } from "../model/nodes.ts";
import type {
  CircuitStandard,
  CircuitSymbolPrimitive,
  CircuitPrimitive,
} from "../model/circuit.ts";
import { junctionRadius } from "../model/circuit.ts";
import {
  circuitComponentOrFallback,
  switchSymbolForState,
  type CircuitComponentDef,
} from "../model/circuit-catalog.ts";
import type { Point, Rect } from "../model/geometry.ts";
import {
  add,
  point,
  rect,
  rectCenter,
  rectCorners,
  snap,
  unionRects,
} from "../model/geometry.ts";
import type { TextMeasurement, TextMeasurer } from "../model/layout.ts";
import type { TextStyle } from "../model/styles.ts";
import { resolveTextStyle } from "../model/styles.ts";
import { measureRichText } from "../model/rich-text.ts";

export interface ResolvedCircuitPin {
  readonly pinId: string;
  readonly label: string;
  readonly point: Point;
  readonly normal: Point;
}

export interface ResolvedCircuitComponent {
  readonly definition: CircuitComponentDef;
  readonly center: Point;
  /** Rotated AABB used by generic hit testing, marquee and obstacles. */
  readonly frame: Rect;
  readonly outline: readonly Point[];
  /** Rotated outline expanded to include every pinned ending. */
  readonly focusOutline: readonly Point[];
  readonly pins: readonly ResolvedCircuitPin[];
  readonly primitives: readonly CircuitPrimitive[];
  readonly labelFrame?: Rect;
  readonly label?: TextMeasurement;
}

const convexHull = (points: readonly Point[]): readonly Point[] => {
  const unique = [...new Map(
    points.map((entry) => [`${entry.x.toFixed(4)}:${entry.y.toFixed(4)}`, entry]),
  ).values()].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (unique.length <= 2) return unique;
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const entry of unique) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if (a !== undefined && b !== undefined && cross(a, b, entry) <= 0) lower.pop();
      else break;
    }
    lower.push(entry);
  }
  const upper: Point[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const entry = unique[index];
    if (entry === undefined) continue;
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if (a !== undefined && b !== undefined && cross(a, b, entry) <= 0) upper.pop();
      else break;
    }
    upper.push(entry);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
};

export const rotatePoint = (value: Point, degrees: number): Point => {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return point(value.x * cos - value.y * sin, value.x * sin + value.y * cos);
};

export const mirrorPointXY = (
  value: Point,
  mirrorX: boolean,
  mirrorY: boolean,
): Point =>
  point(mirrorX ? -value.x : value.x, mirrorY ? -value.y : value.y);

export const mirrorPoint = (
  value: Point,
  mirror: "none" | "horizontal" | "vertical" | undefined,
): Point =>
  mirror === "horizontal"
    ? point(-value.x, value.y)
    : mirror === "vertical"
      ? point(value.x, -value.y)
      : value;

export const rotateAround = (
  value: Point,
  center: Point,
  degrees: number,
): Point => add(center, rotatePoint(point(value.x - center.x, value.y - center.y), degrees));

const boundsOfPoints = (points: readonly Point[]): Rect => {
  if (points.length === 0) return rect(0, 0, 1, 1);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return rect(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
};

const resolvePrimitive = (
  primitive: CircuitSymbolPrimitive,
  center: Point,
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean,
  measurer: TextMeasurer,
  textStyle: TextStyle,
): CircuitPrimitive => {
  const local = (value: Point): Point =>
    add(center, rotatePoint(mirrorPointXY(value, mirrorX, mirrorY), rotation));
  switch (primitive.kind) {
    case "polyline":
      return {
        ...primitive,
        points: primitive.points.map(local),
      };
    case "circle":
      return { ...primitive, center: local(primitive.center) };
    case "rect": {
      // A rotated rectangle cannot stay a rect primitive; emit its four
      // rotated corners as a closed polyline instead.
      const corners = rectCorners(primitive.frame).map(local);
      return {
        kind: "polyline",
        points: corners,
        closed: true,
        stroke: primitive.stroke,
        fill: primitive.fill,
      };
    }
    case "bezier":
      return {
        ...primitive,
        start: local(primitive.start),
        c1: local(primitive.c1),
        c2: local(primitive.c2),
        end: local(primitive.end),
      };
    case "text": {
      const measurement = measurer.measure(primitive.text, textStyle);
      return {
        ...primitive,
        point: local(primitive.point),
        measurement,
      };
    }
  }
};

export const resolveCircuitComponent = (
  node: CircuitComponentNode,
  measurer: TextMeasurer,
  standard: CircuitStandard = "iec",
  gridSize = 9,
): ResolvedCircuitComponent => {
  const definition = circuitComponentOrFallback(node.component);
  const localFrame = node.frame;
  const center = rectCenter(localFrame);
  const rotation = node.rotation;
  const mirrorX = node.mirrorX === true;
  const mirrorY = node.mirrorY === true;
  const local = (value: Point): Point =>
    add(center, rotatePoint(mirrorPointXY(value, mirrorX, mirrorY), rotation));
  const localCorners = [
    point(-definition.width / 2, -definition.height / 2),
    point(definition.width / 2, -definition.height / 2),
    point(definition.width / 2, definition.height / 2),
    point(-definition.width / 2, definition.height / 2),
  ];
  const outline = localCorners.map(local);
  const frame = boundsOfPoints(outline);
  const rawPins = definition.pins.map((pin) => ({
    pinId: pin.id,
    label: pin.label,
    point: local(point(pin.x, pin.y)),
    bodyPoint: local(point(pin.bx, pin.by)),
    normal: rotatePoint(mirrorPointXY(point(pin.nx, pin.ny), mirrorX, mirrorY), rotation),
  }));
  // 45°+n*90° rotations move leads off the grid. Snap each connection point;
  // the lead itself is rendered from the body to that snapped endpoint.
  const snapPins = rotation % 90 !== 0;
  const pins = rawPins.map((pin) => ({
    ...pin,
    point: snapPins
      ? { x: snap(pin.point.x, gridSize), y: snap(pin.point.y, gridSize) }
      : pin.point,
  }));
  const textStyle = resolveTextStyle(node.style.text, node.textStyle);
  const symbol = node.component === "switch" && node.switchClosed === true
    ? switchSymbolForState(standard, true)
    : definition.symbol(standard);
  const primitives = symbol
    .map((primitive) => resolvePrimitive(primitive, center, rotation, mirrorX, mirrorY, measurer, textStyle));
  for (let index = 0; index < pins.length; index += 1) {
    const pin = pins[index];
    if (pin === undefined) continue;
    if (
      Math.abs(pin.bodyPoint.x - pin.point.x) < 1e-6 &&
      Math.abs(pin.bodyPoint.y - pin.point.y) < 1e-6
    ) {
      continue;
    }
    primitives.push({
      kind: "polyline",
      points: [pin.bodyPoint, pin.point],
      stroke: "body",
    });
  }

  let labelFrame: Rect | undefined;
  let label: TextMeasurement | undefined;
  if (node.name.length > 0) {
    label = measureRichText(node.name, textStyle, measurer);
    const rawOffset = node.labelOffset ?? definition.labelOffset;
    const anchor = local(rawOffset);
    labelFrame = rect(
      anchor.x - label.width / 2,
      anchor.y - label.height / 2,
      label.width,
      label.height,
    );
  }

  return {
    definition,
    center,
    frame,
    outline,
    focusOutline: convexHull([...outline, ...pins.map((pin) => pin.point)]),
    pins,
    primitives,
    labelFrame,
    label,
  };
};

export interface ResolvedCircuitJunction {
  readonly center: Point;
  readonly radius: number;
  readonly labelFrame?: Rect;
  readonly label?: TextMeasurement;
}

export const resolveCircuitJunction = (
  node: CircuitJunctionNode,
  measurer: TextMeasurer,
): ResolvedCircuitJunction => {
  const center = rectCenter(node.frame);
  const textStyle = resolveTextStyle(node.style.text, node.textStyle);
  let labelFrame: Rect | undefined;
  let label: TextMeasurement | undefined;
  if (node.name.length > 0) {
    label = measureRichText(node.name, textStyle, measurer);
    const rawOffset = node.labelOffset ?? point(10, -10);
    const anchor = add(center, rawOffset);
    labelFrame = rect(
      anchor.x - label.width / 2,
      anchor.y - label.height / 2,
      label.width,
      label.height,
    );
  }
  return { center, radius: junctionRadius(node.junctionStyle), labelFrame, label };
};

export const unionCircuitBounds = (
  frame: Rect,
  labelFrame: Rect | undefined,
): Rect => unionRects([frame, ...(labelFrame === undefined ? [] : [labelFrame])]) ?? frame;
