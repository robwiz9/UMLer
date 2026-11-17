/**
 * Circuit-only draw guards.
 *
 * Dropping a wire on empty canvas creates a junction node automatically. That
 * is useful after a deliberate drag, but a click or a tiny jitter must not
 * leave an unexpected node behind. Both a screen-space pointer travel and a
 * world-space distance from the source handle are required.
 */

import type { Point } from "../model/geometry.ts";

export const MIN_EXTEND_SCREEN_PX = 8;

export const minExtendWorld = (gridSize: number): number =>
  Math.max(Math.max(1, gridSize), 8);

export interface ExtendGuardInput {
  /** Total pointer travel since pointer-down, in screen pixels. */
  readonly pointerTravelPx: number;
  readonly source: Point;
  readonly candidate: Point;
  readonly gridSize: number;
}

export const canExtendToEmpty = ({
  pointerTravelPx,
  source,
  candidate,
  gridSize,
}: ExtendGuardInput): boolean => {
  if (pointerTravelPx < MIN_EXTEND_SCREEN_PX) return false;
  const distance = Math.hypot(candidate.x - source.x, candidate.y - source.y);
  return distance >= minExtendWorld(gridSize);
};
