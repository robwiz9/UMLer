/**
 * Geometry primitives.
 *
 * Scene units are Typst points (1pt). The model is y-down, matching the DOM,
 * SVG and pointer events. CeTZ is y-up; the serializer is the *only* place that
 * flips y. Keeping the flip in one place makes the skeleton and final preview
 * share a single geometry source.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type CompassSide =
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";

export type HorizontalSide = "west" | "east";
export type Direction = "north" | "east" | "south" | "west";

export const point = (x: number, y: number): Point => ({ x, y });

export const size = (width: number, height: number): Size => ({ width, height });

export const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

export const rectFromPoints = (a: Point, b: Point): Rect =>
  rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));

export const rectRight = (r: Rect): number => r.x + r.width;
export const rectBottom = (r: Rect): number => r.y + r.height;

export const rectCenter = (r: Rect): Point => point(r.x + r.width / 2, r.y + r.height / 2);

export const rectCorners = (r: Rect): readonly Point[] => [
  point(r.x, r.y),
  point(r.x + r.width, r.y),
  point(r.x + r.width, r.y + r.height),
  point(r.x, r.y + r.height),
];

export const insetRect = (r: Rect, dx: number, dy = dx): Rect =>
  rect(r.x + dx, r.y + dy, Math.max(0, r.width - dx * 2), Math.max(0, r.height - dy * 2));

export const expandRect = (r: Rect, dx: number, dy = dx): Rect =>
  rect(r.x - dx, r.y - dy, r.width + dx * 2, r.height + dy * 2);

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const rectContainsPoint = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export const unionRects = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return rect(left, top, right - left, bottom - top);
};

export const add = (a: Point, b: Point): Point => point(a.x + b.x, a.y + b.y);
export const sub = (a: Point, b: Point): Point => point(a.x - b.x, a.y - b.y);
export const scale = (a: Point, factor: number): Point => point(a.x * factor, a.y * factor);
export const length = (a: Point): number => Math.hypot(a.x, a.y);

export const normalize = (a: Point): Point => {
  const len = length(a);
  return len === 0 ? point(0, 0) : point(a.x / len, a.y / len);
};

export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const lerpPoint = (a: Point, b: Point, t: number): Point =>
  point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/** The normal of a CompassSide points out of a node. */
export const compassNormal = (side: CompassSide): Point => {
  switch (side) {
    case "north":
      return point(0, -1);
    case "north-east":
      return normalize(point(1, -1));
    case "east":
      return point(1, 0);
    case "south-east":
      return normalize(point(1, 1));
    case "south":
      return point(0, 1);
    case "south-west":
      return normalize(point(-1, 1));
    case "west":
      return point(-1, 0);
    case "north-west":
      return normalize(point(-1, -1));
  }
};

/** Perimeter point for a rectangle at a compass side. */
export const compassPoint = (r: Rect, side: CompassSide): Point => {
  switch (side) {
    case "north":
      return point(r.x + r.width / 2, r.y);
    case "north-east":
      return point(r.x + r.width, r.y);
    case "east":
      return point(r.x + r.width, r.y + r.height / 2);
    case "south-east":
      return point(r.x + r.width, r.y + r.height);
    case "south":
      return point(r.x + r.width / 2, r.y + r.height);
    case "south-west":
      return point(r.x, r.y + r.height);
    case "west":
      return point(r.x, r.y + r.height / 2);
    case "north-west":
      return point(r.x, r.y);
  }
};

/** Snap a scalar to a grid step. Half-steps round up, deterministically. */
export const snap = (value: number, step: number): number => {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
};

export const snapPoint = (p: Point, step: number): Point => point(snap(p.x, step), snap(p.y, step));

export const snapRect = (r: Rect, step: number): Rect => {
  const x = snap(r.x, step);
  const y = snap(r.y, step);
  const right = snap(r.x + r.width, step);
  const bottom = snap(r.y + r.height, step);
  return rect(x, y, Math.max(step, right - x), Math.max(step, bottom - y));
};

/** Rounds floating-point noise before serialization. */
export const roundTo = (value: number, decimals = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Compact point tuple used in the CeTZ emitter. */
export const toTuple = (p: Point): readonly [number, number] => [roundTo(p.x), roundTo(p.y)];
