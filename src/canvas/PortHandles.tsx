import type React from "react";
import type { PortGeometry } from "../model/layout.ts";
import type { Theme } from "../model/styles.ts";

interface PortHandlesProps {
  readonly ports: readonly PortGeometry[];
  readonly zoom: number;
  readonly hoveredPortId?: string;
  readonly theme: Theme;
  readonly onHover: (port: PortGeometry | null) => void;
  readonly onStartEdge: (port: PortGeometry, event: React.PointerEvent<SVGCircleElement>) => void;
}

const portColor = (port: PortGeometry, theme: Theme): string => {
  if (port.ref.kind === "row") return theme.colors.port;
  if (port.ref.kind === "spine") return theme.colors.warning;
  return theme.colors.portActive;
};

/**
 * Handles are drawn with a screen-constant radius by dividing by zoom. Row
 * ports are filled; perimeter ports are rings; spine ports are amber.
 */
export const PortHandles = ({ ports, zoom, hoveredPortId, theme, onHover, onStartEdge }: PortHandlesProps) => (
  <g>
    {ports.map((port) => {
      const active = hoveredPortId === port.id;
      const radius = (active ? 5 : 3.4) / zoom;
      const filled = port.ref.kind === "row";
      const color = portColor(port, theme);
      return (
        <g key={port.id} data-port-handle={port.id}>
          <circle
            cx={port.point.x}
            cy={port.point.y}
            r={Math.max(radius, 8 / zoom)}
            fill="transparent"
            pointerEvents="all"
            onPointerEnter={() => onHover(port)}
            onPointerLeave={() => onHover(null)}
            onPointerDown={(event) => onStartEdge(port, event)}
            style={{ cursor: "crosshair" }}
          >
            <title>{`${port.label} · ${port.ref.kind} · drag to connect`}</title>
          </circle>
          <circle
            cx={port.point.x}
            cy={port.point.y}
            r={radius}
            fill={filled ? color : "white"}
            stroke={color}
            strokeWidth={active ? 2 / zoom : 1.3 / zoom}
            pointerEvents="none"
          />
          {active ? (
            <g pointerEvents="none" transform={`translate(${port.point.x + 8 / zoom} ${port.point.y - 8 / zoom})`}>
              <rect
                x={0}
                y={-10 / zoom}
                width={Math.max(48, port.label.length * 5.2) / zoom}
                height={13 / zoom}
                rx={2 / zoom}
                fill="rgba(17, 24, 39, 0.9)"
              />
              <text
                x={4 / zoom}
                y={-3.6 / zoom}
                fontSize={7.5 / zoom}
                fontFamily="Segoe UI, sans-serif"
                fill="white"
              >
                {port.label}
              </text>
            </g>
          ) : null}
        </g>
      );
    })}
  </g>
);
