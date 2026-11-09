import { useId } from "react";
import type { Theme } from "../model/styles.ts";

interface GridProps {
  width: number;
  height: number;
  camera: { readonly x: number; readonly y: number };
  zoom: number;
  step: number;
  majorEvery: number;
  visible: boolean;
  theme: Theme;
}

const modulo = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * Screen-space SVG grid. Keeping the pattern in screen space means the line
 * weight stays constant at every zoom level while the spacing follows camera
 * and zoom.
 */
export const Grid = ({
  width,
  height,
  camera,
  zoom,
  step,
  majorEvery,
  visible,
  theme,
}: GridProps) => {
  const rawId = useId().replace(/:/g, "");
  const minorId = `grid-minor-${rawId}`;
  const majorId = `grid-major-${rawId}`;

  if (!visible || step <= 0) return null;

  const minorSize = step * zoom;
  const majorSize = step * majorEvery * zoom;
  const showMinor = minorSize >= 4;
  const minorOffsetX = modulo(camera.x, minorSize);
  const minorOffsetY = modulo(camera.y, minorSize);
  const majorOffsetX = modulo(camera.x, majorSize);
  const majorOffsetY = modulo(camera.y, majorSize);

  return (
    <g aria-hidden="true" pointerEvents="none">
      <defs>
        <pattern
          id={minorId}
          width={minorSize}
          height={minorSize}
          patternUnits="userSpaceOnUse"
          x={minorOffsetX}
          y={minorOffsetY}
        >
          <path
            d={`M ${minorSize} 0 L 0 0 0 ${minorSize}`}
            fill="none"
            stroke={theme.colors.grid}
            strokeWidth={0.7}
          />
        </pattern>
        <pattern
          id={majorId}
          width={majorSize}
          height={majorSize}
          patternUnits="userSpaceOnUse"
          x={majorOffsetX}
          y={majorOffsetY}
        >
          <path
            d={`M ${majorSize} 0 L 0 0 0 ${majorSize}`}
            fill="none"
            stroke={theme.colors.gridMajor}
            strokeWidth={1}
          />
        </pattern>
      </defs>
      {showMinor ? <rect width={width} height={height} fill={`url(#${minorId})`} /> : null}
      <rect width={width} height={height} fill={`url(#${majorId})`} />
    </g>
  );
};
