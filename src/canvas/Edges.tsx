import type { EdgeLayout, EdgeLabelLayout } from "../model/layout.ts";
import type { EndpointMarker } from "../model/markers.ts";
import { markerLineInset } from "../model/markers.ts";
import type { Point } from "../model/geometry.ts";
import { normalize, point, sub, scale, add } from "../model/geometry.ts";
import type { Theme } from "../model/styles.ts";

interface EdgeLayerProps {
  readonly edges: readonly { readonly layout: EdgeLayout; readonly markers: { readonly source: EndpointMarker; readonly target: EndpointMarker }; readonly stroke: Theme["edge"]["stroke"] }[];
  readonly theme: Theme;
  readonly renderLines?: boolean;
  readonly renderLabels?: boolean;
  readonly hiddenLabelId?: string;
}

const dashArray = (pattern: "solid" | "dashed" | "dotted"): string | undefined => {
  if (pattern === "dashed") return "6 4";
  if (pattern === "dotted") return "2 3";
  return undefined;
};

export const EdgeLabelView = ({
  label,
  theme,
}: {
  readonly label: EdgeLabelLayout;
  readonly theme: Theme;
}) => (
  <g pointerEvents="none">
    <rect
      x={label.frame.x}
      y={label.frame.y}
      width={label.frame.width}
      height={label.frame.height}
      rx={2}
      fill={theme.edge.labelFill.color ?? "none"}
      stroke="none"
    />
    <text
      x={label.textFrame.x + label.textFrame.width / 2}
      y={label.textFrame.y + label.textFrame.height / 2}
      textAnchor="middle"
      dominantBaseline="middle"
      fontFamily={label.text.style.fontFamily}
      fontSize={label.text.style.fontSize}
      fontWeight={label.text.style.weight}
      fontStyle={label.text.style.italic === true ? "italic" : "normal"}
      fill={label.text.style.color}
    >
      {label.text.text}
    </text>
  </g>
);

const markerGeometry = (
  tip: Point,
  forward: Point,
  lengthValue: number,
  width: number,
): { readonly base: Point; readonly baseLeft: Point; readonly baseRight: Point; readonly mid: Point; readonly half: Point; readonly back: Point } => {
  const unit = normalize(forward);
  const perp = point(-unit.y, unit.x);
  const half = scale(perp, width / 2);
  const base = add(tip, scale(unit, lengthValue));
  return {
    base,
    baseLeft: add(base, half),
    baseRight: add(base, scale(half, -1)),
    mid: add(tip, scale(unit, lengthValue / 2)),
    half,
    back: unit,
  };
};

const polygonPoints = (points: readonly Point[]): string =>
  points.map((p) => `${p.x},${p.y}`).join(" ");

const shiftToward = (from: Point, toward: Point, distance: number): Point => {
  const delta = sub(toward, from);
  const total = Math.hypot(delta.x, delta.y);
  if (total <= 0.0001 || distance <= 0) return from;
  const ratio = Math.min(0.9, distance / total);
  return point(from.x + delta.x * ratio, from.y + delta.y * ratio);
};

/**
 * Shortens the visible connector at terminal glyphs. Crow's-foot forks and
 * open arrows must not have the line continue through the glyph to the entity
 * border.
 */
export const edgeLinePoints = (
  layout: EdgeLayout,
  markers: { readonly source: EndpointMarker; readonly target: EndpointMarker },
): readonly Point[] => {
  const points = [...layout.points];
  if (points.length < 2) return points;
  const markerScale = (marker: EndpointMarker): number =>
    "scale" in marker && marker.scale !== undefined ? marker.scale : 1;
  const sourceInset = markerLineInset(markers.source) * markerScale(markers.source);
  const targetInset = markerLineInset(markers.target) * markerScale(markers.target);
  if (sourceInset > 0) {
    points[0] = shiftToward(points[0] as Point, points[1] as Point, sourceInset);
  }
  if (targetInset > 0) {
    const last = points.length - 1;
    points[last] = shiftToward(points[last] as Point, points[last - 1] as Point, targetInset);
  }
  return points;
};

const ArrowGlyph = ({
  marker,
  tip,
  forward,
  color,
}: {
  readonly marker: EndpointMarker;
  readonly tip: Point;
  readonly forward: Point;
  readonly color: string;
}) => {
  if (marker.family === "none") return null;
  if (marker.family === "uml") {
    if (marker.kind === "inheritance" || marker.kind === "realization") {
      const shape = markerGeometry(tip, forward, 10, 9);
      return <polygon points={polygonPoints([tip, shape.baseLeft, shape.baseRight])} fill="white" stroke={color} strokeWidth={0.9} />;
    }
    if (marker.kind === "aggregation" || marker.kind === "composition") {
      const shape = markerGeometry(tip, forward, 12, 7);
      return (
        <polygon
          points={polygonPoints([
            tip,
            add(shape.mid, shape.half),
            shape.base,
            add(shape.mid, scale(shape.half, -1)),
          ])}
          fill={marker.kind === "composition" ? color : "white"}
          stroke={color}
          strokeWidth={0.9}
        />
      );
    }
    const shape = markerGeometry(tip, forward, 12, 10);
    return (
      <path
        d={`M ${shape.baseLeft.x} ${shape.baseLeft.y} L ${tip.x} ${tip.y} L ${shape.baseRight.x} ${shape.baseRight.y}`}
        fill="none"
        stroke={color}
        strokeWidth={0.9}
      />
    );
  }
  if (marker.family === "generic") {
    const shape = markerGeometry(tip, forward, 12, 10);
    if (marker.kind === "filledArrow") {
      return <polygon points={polygonPoints([tip, shape.baseLeft, shape.baseRight])} fill={color} stroke={color} strokeWidth={0.6} />;
    }
    return (
      <path
        d={`M ${shape.baseLeft.x} ${shape.baseLeft.y} L ${tip.x} ${tip.y} L ${shape.baseRight.x} ${shape.baseRight.y}`}
        fill="none"
        stroke={color}
        strokeWidth={0.9}
      />
    );
  }

  // ER terminals. The feet sit at the entity/tip; the body extends back along
  // the line. This is the same convention as the CeTZ proof sheet.
  const shape = markerGeometry(tip, forward, 12, 10);
  const apex = shape.base;
  const footLeft = add(tip, shape.half);
  const footRight = add(tip, scale(shape.half, -1));

  if (marker.kind === "one") {
    const bar = add(tip, scale(shape.back, 4));
    return (
      <line
        x1={bar.x + shape.half.x}
        y1={bar.y + shape.half.y}
        x2={bar.x - shape.half.x}
        y2={bar.y - shape.half.y}
        stroke={color}
        strokeWidth={1}
      />
    );
  }
  if (marker.kind === "many") {
    return (
      <g stroke={color} strokeWidth={0.9} fill="none">
        <line x1={apex.x} y1={apex.y} x2={footLeft.x} y2={footLeft.y} />
        <line x1={apex.x} y1={apex.y} x2={tip.x} y2={tip.y} />
        <line x1={apex.x} y1={apex.y} x2={footRight.x} y2={footRight.y} />
      </g>
    );
  }

  const hasCrow = marker.kind === "oneOrMany" || marker.kind === "zeroOrMany";
  const hasCircle = marker.kind === "zeroOrOne" || marker.kind === "zeroOrMany";
  const barCenter = marker.kind === "oneOrMany"
    ? add(tip, scale(shape.back, 16))
    : marker.kind === "zeroOrOne"
      ? add(tip, scale(shape.back, 13))
      : tip;
  const circleCenter = add(tip, scale(shape.back, marker.kind === "zeroOrOne" ? 5 : 16));

  return (
    <g stroke={color} strokeWidth={0.9} fill="none">
      {hasCrow ? (
        <>
          <line x1={apex.x} y1={apex.y} x2={footLeft.x} y2={footLeft.y} />
          <line x1={apex.x} y1={apex.y} x2={tip.x} y2={tip.y} />
          <line x1={apex.x} y1={apex.y} x2={footRight.x} y2={footRight.y} />
        </>
      ) : null}
      {marker.kind === "zeroOrOne" || marker.kind === "oneOrMany" ? (
        <line
          x1={barCenter.x + shape.half.x}
          y1={barCenter.y + shape.half.y}
          x2={barCenter.x - shape.half.x}
          y2={barCenter.y - shape.half.y}
        />
      ) : null}
      {hasCircle ? <circle cx={circleCenter.x} cy={circleCenter.y} r={3.4} fill="white" /> : null}
    </g>
  );
};

const EdgeGlyphs = ({
  layout,
  markers,
  color,
}: {
  readonly layout: EdgeLayout;
  readonly markers: EdgeLayerProps["edges"][number]["markers"];
  readonly color: string;
}) => {
  const points = layout.points;
  if (points.length < 2) return null;
  const first = points[0] as Point;
  const second = points[1] as Point;
  const last = points[points.length - 1] as Point;
  const previous = points[points.length - 2] as Point;
  const sourceForward = normalize(sub(second, first));
  const targetForward = normalize(sub(last, previous));

  return (
    <>
      <ArrowGlyph marker={markers.source} tip={first} forward={sourceForward} color={color} />
      <ArrowGlyph marker={markers.target} tip={last} forward={scale(targetForward, -1)} color={color} />
    </>
  );
};

export const EdgeLayer = ({
  edges,
  theme,
  renderLines = true,
  renderLabels = true,
  hiddenLabelId,
}: EdgeLayerProps) => (
  <g pointerEvents="none">
    {edges.map(({ layout, markers, stroke }) => {
      const points = edgeLinePoints(layout, markers).map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <g key={layout.edgeId} data-edge-id={layout.edgeId}>
          {renderLines ? (
            <>
              <polyline
                points={points}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeDasharray={dashArray(stroke.pattern)}
                strokeLinecap="butt"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <EdgeGlyphs layout={layout} markers={markers} color={stroke.color} />
            </>
          ) : null}
          {renderLabels
            ? layout.labels
                .filter((label) => label.labelId !== hiddenLabelId)
                .map((label) => (
                  <EdgeLabelView key={label.labelId} label={label} theme={theme} />
                ))
            : null}
        </g>
      );
    })}
  </g>
);

export const edgeLayerItem = (layout: EdgeLayout, markers: EdgeLayerProps["edges"][number]["markers"], stroke: Theme["edge"]["stroke"]) => ({
  layout,
  markers,
  stroke,
});

