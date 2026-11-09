import type { Point, Rect } from "../model/geometry.ts";

export interface Camera {
  readonly x: number;
  readonly y: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 4;

export const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** Centers content in the viewport and leaves a screen-space pad. */
export const fitBounds = (
  bounds: Rect,
  viewport: ViewportSize,
  padding = 56,
): { readonly camera: Camera; readonly zoom: number } => {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const fitted = Math.min(
    availableWidth / Math.max(1, bounds.width),
    availableHeight / Math.max(1, bounds.height),
  );
  // A small diagram should not be blown up to 300% just because the viewport
  // is empty. Fit is a ceiling; the user can still zoom in manually.
  const zoom = clampZoom(Math.min(1.5, fitted));
  return {
    zoom,
    camera: {
      x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    },
  };
};

/** Zoom about a screen-space cursor, preserving the world point under it. */
export const zoomAtScreenPoint = (
  cursor: Point,
  camera: Camera,
  zoom: number,
  factor: number,
): { readonly camera: Camera; readonly zoom: number } => {
  const nextZoom = clampZoom(zoom * factor);
  const world = {
    x: (cursor.x - camera.x) / zoom,
    y: (cursor.y - camera.y) / zoom,
  };
  return {
    zoom: nextZoom,
    camera: {
      x: cursor.x - world.x * nextZoom,
      y: cursor.y - world.y * nextZoom,
    },
  };
};
