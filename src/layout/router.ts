/**
 * Sparse orthogonal A* router.
 *
 * The graph is built on a Hanan grid: the start/end coordinates plus every
 * obstacle edge. Node states include the arrival direction so bend cost is
 * explicit. This is deliberately small and dependency-free; scenes in the
 * editor are currently tens of nodes, not thousands.
 *
 * The caller passes the *escape stub* points (already pushed out of the
 * endpoint nodes). The router avoids every other obstacle frame, inflated by
 * the routing padding, and returns a fallback signal instead of throwing.
 */

import type { Point, Rect } from "../model/geometry.ts";
import { rectBottom, rectRight } from "../model/geometry.ts";

export interface OrthogonalRouterInput {
  readonly source: Point;
  readonly sourceNormal: Point;
  readonly target: Point;
  readonly targetNormal: Point;
  readonly obstacles: readonly Rect[];
  readonly padding: number;
  readonly stubLength: number;
  /** Extra cost for every 90° turn. */
  readonly bendPenalty?: number;
}

export interface OrthogonalRouterResult {
  readonly points: readonly Point[];
  readonly found: boolean;
  readonly bends: number;
  readonly visited: number;
}

interface QueueEntry {
  readonly key: string;
  readonly node: number;
  readonly direction: 1 | 2;
  readonly cost: number;
  readonly estimate: number;
}

const EPSILON = 0.001;
const DIRECTION_HORIZONTAL = 1 as const;
const DIRECTION_VERTICAL = 2 as const;

const uniqueSorted = (values: readonly number[]): number[] => {
  const sorted = [...values].sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    const last = result[result.length - 1];
    if (last === undefined || Math.abs(last - value) > EPSILON) result.push(value);
  }
  return result;
};

const inflate = (r: Rect, padding: number): Rect => ({
  x: r.x - padding,
  y: r.y - padding,
  width: r.width + padding * 2,
  height: r.height + padding * 2,
});

const pointInside = (p: Point, r: Rect): boolean =>
  p.x > r.x + EPSILON &&
  p.x < rectRight(r) - EPSILON &&
  p.y > r.y + EPSILON &&
  p.y < rectBottom(r) - EPSILON;

const segmentCrosses = (a: Point, b: Point, r: Rect): boolean => {
  if (Math.abs(a.y - b.y) <= EPSILON) {
    if (a.y <= r.y + EPSILON || a.y >= rectBottom(r) - EPSILON) return false;
    return Math.max(a.x, b.x) > r.x + EPSILON && Math.min(a.x, b.x) < rectRight(r) - EPSILON;
  }
  if (Math.abs(a.x - b.x) <= EPSILON) {
    if (a.x <= r.x + EPSILON || a.x >= rectRight(r) - EPSILON) return false;
    return Math.max(a.y, b.y) > r.y + EPSILON && Math.min(a.y, b.y) < rectBottom(r) - EPSILON;
  }
  return false;
};

class MinHeap {
  private readonly items: QueueEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: QueueEntry): void {
    this.items.push(entry);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[parent] as QueueEntry, entry) <= 0) break;
      this.items[index] = this.items[parent] as QueueEntry;
      index = parent;
    }
    this.items[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (first === undefined || last === undefined) return first;
    if (this.items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      let child = left;
      if (
        right < this.items.length &&
        this.compare(this.items[right] as QueueEntry, this.items[left] as QueueEntry) < 0
      ) {
        child = right;
      }
      if (this.compare(last, this.items[child] as QueueEntry) <= 0) break;
      this.items[index] = this.items[child] as QueueEntry;
      index = child;
    }
    this.items[index] = last;
    return first;
  }

  private compare(a: QueueEntry, b: QueueEntry): number {
    if (a.estimate !== b.estimate) return a.estimate - b.estimate;
    return a.key < b.key ? -1 : 1;
  }
}

const normalDirection = (normal: Point): 1 | 2 =>
  Math.abs(normal.x) >= Math.abs(normal.y) ? DIRECTION_HORIZONTAL : DIRECTION_VERTICAL;

const simplify = (points: readonly Point[]): Point[] => {
  const deduped: Point[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || Math.abs(last.x - p.x) > EPSILON || Math.abs(last.y - p.y) > EPSILON) {
      deduped.push(p);
    }
  }
  if (deduped.length < 3) return deduped;
  const result: Point[] = [deduped[0] as Point];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const a = result[result.length - 1] as Point;
    const b = deduped[index] as Point;
    const c = deduped[index + 1] as Point;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > EPSILON) result.push(b);
  }
  result.push(deduped[deduped.length - 1] as Point);
  return result;
};

/**
 * Finds an orthogonal path. Obstacles are expanded by `padding`; the escape
 * stubs are included in the returned polyline.
 */
export const routeOrthogonalAStar = (input: OrthogonalRouterInput): OrthogonalRouterResult => {
  const padding = Math.max(0, input.padding);
  const stub = Math.max(Math.max(0, input.stubLength), padding + 1);
  const start: Point = {
    x: input.source.x + input.sourceNormal.x * stub,
    y: input.source.y + input.sourceNormal.y * stub,
  };
  const end: Point = {
    x: input.target.x + input.targetNormal.x * stub,
    y: input.target.y + input.targetNormal.y * stub,
  };
  const obstacles = input.obstacles.map((rect) => inflate(rect, padding));
  const bendPenalty = input.bendPenalty ?? 18;

  const xs = uniqueSorted([
    start.x,
    end.x,
    ...obstacles.flatMap((rect) => [rect.x, rectRight(rect)]),
  ]);
  const ys = uniqueSorted([
    start.y,
    end.y,
    ...obstacles.flatMap((rect) => [rect.y, rectBottom(rect)]),
  ]);
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const yIndex = new Map(ys.map((value, index) => [value, index]));
  const startIndex = (yIndex.get(start.y) as number) * xs.length + (xIndex.get(start.x) as number);
  const endIndex = (yIndex.get(end.y) as number) * xs.length + (xIndex.get(end.x) as number);
  const pointAt = (index: number): Point => ({
    x: xs[index % xs.length] as number,
    y: ys[Math.floor(index / xs.length)] as number,
  });
  const valid = (p: Point): boolean => !obstacles.some((rect) => pointInside(p, rect));
  const blocked = (a: Point, b: Point): boolean =>
    obstacles.some((rect) => segmentCrosses(a, b, rect));
  const heuristic = (p: Point): number => Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
  const sourceDirection = normalDirection(input.sourceNormal);
  const targetArrivalDirection = normalDirection(input.targetNormal);
  const startHeuristic = heuristic(start);

  const queue = new MinHeap();
  const best = new Map<string, number>();
  const previous = new Map<string, string>();
  const stateKey = (node: number, direction: 1 | 2): string => `${node}:${direction}`;
  const startKey = stateKey(startIndex, sourceDirection);
  best.set(startKey, stub);
  queue.push({
    key: startKey,
    node: startIndex,
    direction: sourceDirection,
    cost: stub,
    estimate: stub + startHeuristic,
  });

  let goalKey: string | null = null;
  let visited = 0;

  while (queue.size > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    if (current.cost > (best.get(current.key) ?? Number.POSITIVE_INFINITY)) continue;
    visited += 1;
    if (current.node === endIndex) {
      const turn = current.direction === targetArrivalDirection ? 0 : bendPenalty;
      const total = current.cost + turn + stub;
      const candidateKey = `${current.key}:goal`;
      if (!best.has(candidateKey) || total < (best.get(candidateKey) ?? Number.POSITIVE_INFINITY)) {
        best.set(candidateKey, total);
        previous.set(candidateKey, current.key);
        goalKey = candidateKey;
      }
    }

    const x = current.node % xs.length;
    const y = Math.floor(current.node / xs.length);
    const here = pointAt(current.node);
    const moves: { next: number; direction: 1 | 2; point: Point }[] = [];
    if (x > 0) {
      const next = current.node - 1;
      moves.push({ next, direction: DIRECTION_HORIZONTAL, point: pointAt(next) });
    }
    if (x < xs.length - 1) {
      const next = current.node + 1;
      moves.push({ next, direction: DIRECTION_HORIZONTAL, point: pointAt(next) });
    }
    if (y > 0) {
      const next = current.node - xs.length;
      moves.push({ next, direction: DIRECTION_VERTICAL, point: pointAt(next) });
    }
    if (y < ys.length - 1) {
      const next = current.node + xs.length;
      moves.push({ next, direction: DIRECTION_VERTICAL, point: pointAt(next) });
    }

    for (const move of moves) {
      if (!valid(move.point) || blocked(here, move.point)) continue;
      const distance = Math.abs(move.point.x - here.x) + Math.abs(move.point.y - here.y);
      if (distance <= EPSILON) continue;
      const turn = current.direction === move.direction ? 0 : bendPenalty;
      const cost = current.cost + distance + turn;
      const key = stateKey(move.next, move.direction);
      if (cost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(key, cost);
      previous.set(key, current.key);
      queue.push({
        key,
        node: move.next,
        direction: move.direction,
        cost,
        estimate: cost + heuristic(move.point),
      });
    }
  }

  if (goalKey === null) {
    return { points: [], found: false, bends: 0, visited };
  }

  const states: string[] = [goalKey];
  let cursor = goalKey;
  while (previous.has(cursor)) {
    const parent = previous.get(cursor) as string;
    states.push(parent);
    cursor = parent;
    if (states.length > 10_000) break;
  }
  states.reverse();
  const pathPoints: Point[] = [input.source, start];
  for (const key of states) {
    if (key.endsWith(":goal")) continue;
    const node = Number(key.split(":")[0]);
    pathPoints.push(pointAt(node));
  }
  pathPoints.push(end, input.target);
  const points = simplify(pathPoints);
  return { points, found: true, bends: Math.max(0, points.length - 2), visited };
};
