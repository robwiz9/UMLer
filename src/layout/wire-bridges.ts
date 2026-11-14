/**
 * Circuit wire crossing bridges.
 *
 * A bridge is a small semicircular hop on the wire that "owns" a crossing. It
 * is derived geometry: the wire's routed points stay untouched, and the DOM and
 * CeTZ exporter consume the same from/to/control-point data.
 */

import type { CircuitSettings } from "../model/circuit.ts";
import type { EdgeId } from "../model/ids.ts";
import type { WireBridge } from "../model/layout.ts";
import type { Point } from "../model/geometry.ts";
import {
  add,
  length,
  normalize,
  point,
  scale,
  sub,
} from "../model/geometry.ts";

export interface BridgeEdge {
  readonly edgeId: EdgeId;
  readonly points: readonly Point[];
  readonly z: number;
}

interface SegmentHit {
  readonly t: number;
  readonly u: number;
  readonly point: Point;
}

const EPSILON = 1e-6;

export const segmentIntersection = (
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
): SegmentHit | null => {
  const r = sub(a1, a0);
  const s = sub(b1, b0);
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < EPSILON) return null;
  const q = sub(b0, a0);
  const t = (q.x * s.y - q.y * s.x) / denominator;
  const u = (q.x * r.y - q.y * r.x) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return {
    t,
    u,
    point: point(a0.x + r.x * t, a0.y + r.y * t),
  };
};

const isHorizontalish = (a: Point, b: Point): boolean => {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx >= dy;
};

/** Canonical bump direction, independent of wire direction. */
const bridgeNormal = (from: Point, to: Point): Point => {
  const dir = normalize(sub(to, from));
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  if (ax >= ay * 1.05) return point(0, -1);
  if (ay >= ax * 1.05) return point(1, 0);
  const canonical = dir.x < 0 || (Math.abs(dir.x) < EPSILON && dir.y < 0) ? scale(dir, -1) : dir;
  return point(-canonical.y, canonical.x);
};

const ownerIsFirst = (
  first: BridgeEdge,
  second: BridgeEdge,
  firstHorizontal: boolean,
  secondHorizontal: boolean,
): boolean => {
  if (firstHorizontal !== secondHorizontal) return firstHorizontal;
  if (first.z !== second.z) return first.z < second.z;
  return first.edgeId < second.edgeId;
};

/**
 * Compute all bridges for a set of circuit edges. Only the owner edge receives
 * a bridge; the other wire is drawn straight through.
 */
export const computeWireBridges = (
  edges: readonly BridgeEdge[],
  junctionPoints: readonly Point[],
  settings: CircuitSettings,
): ReadonlyMap<string, readonly WireBridge[]> => {
  const result = new Map<string, WireBridge[]>();
  if (settings.crossings === "plain") return result;

  const append = (bridge: WireBridge): void => {
    const list = result.get(bridge.ownerEdgeId);
    if (list === undefined) result.set(bridge.ownerEdgeId, [bridge]);
    else list.push(bridge);
  };

  for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
    const first = edges[firstIndex];
    if (first === undefined) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
      const second = edges[secondIndex];
      if (second === undefined) continue;
      for (let aIndex = 1; aIndex < first.points.length; aIndex += 1) {
        const a0 = first.points[aIndex - 1];
        const a1 = first.points[aIndex];
        if (a0 === undefined || a1 === undefined) continue;
        for (let bIndex = 1; bIndex < second.points.length; bIndex += 1) {
          const b0 = second.points[bIndex - 1];
          const b1 = second.points[bIndex];
          if (b0 === undefined || b1 === undefined) continue;
          const hit = segmentIntersection(a0, a1, b0, b1);
          if (hit === null) continue;

          const aLength = length(sub(a1, a0));
          const bLength = length(sub(b1, b0));
          if (aLength < 4 || bLength < 4) continue;
          if (hit.t < 0.001 || hit.t > 0.999 || hit.u < 0.001 || hit.u > 0.999) continue;
          if (junctionPoints.some((junction) => length(sub(junction, hit.point)) < 1.5)) continue;

          const firstHorizontal = isHorizontalish(a0, a1);
          const secondHorizontal = isHorizontalish(b0, b1);
          const firstOwns = ownerIsFirst(first, second, firstHorizontal, secondHorizontal);
          const owner = firstOwns ? first : second;
          const ownerStart = firstOwns ? a0 : b0;
          const ownerEnd = firstOwns ? a1 : b1;
          const ownerLength = firstOwns ? aLength : bLength;
          const ownerT = firstOwns ? hit.t : hit.u;
          const startDistance = ownerLength * Math.min(ownerT, 1 - ownerT);
          const maxRadius = Math.min(12, ownerLength / 4);
          if (maxRadius < 2 || startDistance < maxRadius + 1) continue;

          const radius = Math.max(2, Math.min(settings.bridgeRadius, maxRadius));
          const dir = normalize(sub(ownerEnd, ownerStart));
          const normal = bridgeNormal(ownerStart, ownerEnd);
          const from = sub(hit.point, scale(dir, radius));
          const to = add(hit.point, scale(dir, radius));
          append({
            at: hit.point,
            from,
            to,
            c1: add(from, scale(normal, (4 / 3) * radius)),
            c2: add(to, scale(normal, (4 / 3) * radius)),
            radius,
            ownerEdgeId: owner.edgeId,
          });
        }
      }
    }
  }

  // Stable order along each owner polyline.
  for (const [edgeId, bridges] of result) {
    const edge = edges.find((candidate) => candidate.edgeId === edgeId);
    if (edge === undefined) continue;
    const position = (bridge: WireBridge): number => {
      let travelled = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let index = 1; index < edge.points.length; index += 1) {
        const a = edge.points[index - 1];
        const b = edge.points[index];
        if (a === undefined || b === undefined) continue;
        const segmentLength = length(sub(b, a));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const denominator = dx * dx + dy * dy;
        const t = denominator === 0
          ? 0
          : ((bridge.at.x - a.x) * dx + (bridge.at.y - a.y) * dy) / denominator;
        if (t >= 0 && t <= 1) {
          best = Math.min(best, travelled + segmentLength * t);
        }
        travelled += segmentLength;
      }
      return Number.isFinite(best) ? best : 0;
    };
    bridges.sort((a, b) => position(a) - position(b));
  }

  return result;
};
