import type React from "react";
import type { TextMeasurement } from "../model/layout.ts";
import type { Rect } from "../model/geometry.ts";

interface RichLabelTextProps {
  readonly measurement: TextMeasurement;
  readonly frame: Rect;
  readonly onDoubleClick?: (event: React.MouseEvent<SVGTextElement>) => void;
  readonly pointerEvents?: "none" | "auto";
}

/**
 * Draws a measured label, including circuit-style sub/superscript segments.
 * Normal labels keep the original single-text-node rendering.
 */
export const RichLabelText = ({
  measurement,
  frame,
  onDoubleClick,
  pointerEvents,
}: RichLabelTextProps) => {
  const style = measurement.style;
  const y = frame.y + frame.height / 2;
  if (measurement.segments !== undefined && measurement.segments.length > 0) {
    let cursor = frame.x;
    let previousOffset = 0;
    return (
      <text
        x={frame.x}
        y={y}
        textAnchor="start"
        dominantBaseline="middle"
        fontFamily={style.fontFamily}
        fontSize={style.fontSize}
        fontWeight={style.weight}
        fontStyle={style.italic === true ? "italic" : "normal"}
        fill={style.color}
        pointerEvents={pointerEvents}
        onDoubleClick={onDoubleClick}
      >
        {measurement.segments.map((segment, index) => {
          const x = cursor;
          cursor += segment.width;
          const offset = segment.script === "sub"
            ? style.fontSize * 0.3 * segment.depth
            : segment.script === "super"
              ? -style.fontSize * 0.4 * segment.depth
              : 0;
          const dy = offset - previousOffset;
          previousOffset = offset;
          return (
            <tspan
              key={index}
              x={x}
              dy={dy}
              fontSize={segment.fontSize}
              fontStyle={
                segment.italic === undefined
                  ? undefined
                  : segment.italic
                    ? "italic"
                    : "normal"
              }
            >
              {segment.text}
            </tspan>
          );
        })}
      </text>
    );
  }
  return (
    <text
      x={frame.x + frame.width / 2}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontFamily={style.fontFamily}
      fontSize={style.fontSize}
      fontWeight={style.weight}
      fontStyle={style.italic === true ? "italic" : "normal"}
      fill={style.color}
      pointerEvents={pointerEvents}
      onDoubleClick={onDoubleClick}
    >
      {measurement.text}
    </text>
  );
};
