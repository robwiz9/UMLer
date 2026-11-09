import type React from "react";
import type { CommentNodeLayout, NodeLayout, RowBand, SectionBand, ShapeNodeLayout, TableNodeLayout } from "../model/layout.ts";
import type { SceneNode } from "../model/nodes.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { CanvasTextTarget } from "../model/text-targets.ts";
import { rectBottom, rectCenter, rectRight, type Point, type Rect } from "../model/geometry.ts";
import type { Theme } from "../model/styles.ts";

interface NodeSkeletonProps {
  readonly node: SceneNode;
  readonly layout: NodeLayout;
  readonly theme: Theme;
  readonly selected: boolean;
  readonly skeleton: boolean;
  readonly onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
  readonly activationDraft?: { readonly id: string; readonly top: number; readonly height: number } | null;
  readonly onActivationPointerDown?: (
    nodeId: string,
    activationId: string,
    event: React.PointerEvent<SVGRectElement>,
    edge: "top" | "bottom" | "body",
  ) => void;
}

const localX = (event: React.MouseEvent<SVGTextElement>): number => {
  const ctm = event.currentTarget.getScreenCTM();
  const svg = event.currentTarget.ownerSVGElement;
  if (ctm === null || svg === null) return 0;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(ctm.inverse()).x;
};

/** Scene-space pointer position for a hit shape inside the transformed canvas. */
const localPoint = (event: React.MouseEvent<SVGGraphicsElement>): Point => {
  const ctm = event.currentTarget.getScreenCTM();
  const svg = event.currentTarget.ownerSVGElement;
  if (ctm === null || svg === null) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
};

const dashArray = (pattern: "solid" | "dashed" | "dotted"): string | undefined => {
  if (pattern === "dashed") return "6 4";
  if (pattern === "dotted") return "2 3";
  return undefined;
};

const textStyle = (measurement: { readonly style: { readonly fontSize: number; readonly fontFamily: string; readonly weight: number; readonly italic?: boolean; readonly color: string } }) => ({
  fontFamily: measurement.style.fontFamily,
  fontSize: measurement.style.fontSize,
  fontWeight: measurement.style.weight,
  fontStyle: measurement.style.italic === true ? "italic" : "normal",
  fill: measurement.style.color,
});

const TableBody = ({
  layout,
  theme,
  skeleton,
  nodeId,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly layout: TableNodeLayout;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly nodeId: SceneNode["id"];
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => {
  const style = theme.table;
  const headerText = layout.header.text;
  const headerTextY = layout.header.textFrame.y + layout.header.textFrame.height / 2;
  const stereotype = layout.header.stereotype;
  const stereotypeFrame = layout.header.stereotypeFrame;
  const stereotypeY = stereotypeFrame === undefined
    ? headerTextY
    : stereotypeFrame.y + stereotypeFrame.height / 2;

  return (
    <>
      <rect
        x={layout.frame.x}
        y={layout.frame.y}
        width={layout.frame.width}
        height={layout.frame.height}
        fill={style.fill.color ?? "none"}
      />
      <rect
        data-table-header={nodeId}
        x={layout.frame.x}
        y={layout.frame.y}
        width={layout.frame.width}
        height={layout.header.frame.height}
        fill={style.headerFill.color ?? "none"}
        onClick={(event) => {
          event.stopPropagation();
          onPartClick?.({ kind: "table", nodeId });
        }}
      />
      {/* Stroke after the header fill so the fill cannot cover half the border. */}
      <rect
        x={layout.frame.x}
        y={layout.frame.y}
        width={layout.frame.width}
        height={layout.frame.height}
        fill="none"
        stroke={style.stroke.color}
        strokeWidth={style.stroke.width}
        strokeDasharray={dashArray(style.stroke.pattern)}
      />
      <text
        x={layout.header.textFrame.x + layout.header.textFrame.width / 2}
        y={headerTextY}
        textAnchor="middle"
        dominantBaseline="middle"
        {...textStyle(headerText)}
        onClick={(event) => {
          event.stopPropagation();
          onPartClick?.({ kind: "table", nodeId });
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTextDoubleClick?.({ kind: "nodeName" });
        }}
      >
        {headerText.text}
      </text>
      {stereotype !== undefined && stereotypeFrame !== undefined ? (
        <text
          x={stereotypeFrame.x + stereotypeFrame.width / 2}
          y={stereotypeY}
          textAnchor="middle"
          dominantBaseline="middle"
          {...textStyle(stereotype)}
          onClick={(event) => {
            event.stopPropagation();
            onPartClick?.({ kind: "table", nodeId });
          }}
          onDoubleClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            onTextDoubleClick?.({ kind: "stereotype" });
          }}
        >
          {stereotype.text}
        </text>
      ) : null}
      <line
        x1={layout.frame.x}
        y1={rectBottom(layout.header.frame)}
        x2={rectRight(layout.frame)}
        y2={rectBottom(layout.header.frame)}
        stroke={style.divider.color}
        strokeWidth={style.divider.width}
        strokeDasharray={dashArray(style.divider.pattern)}
      />
      {layout.sections.map((section) => (
        <SectionBody
          key={section.sectionId}
          section={section}
          frame={layout.frame}
          theme={theme}
          skeleton={skeleton}
          nodeId={nodeId}
          onTextDoubleClick={onTextDoubleClick}
          onPartClick={onPartClick}
        />
      ))}
    </>
  );
};

const SectionBody = ({
  section,
  frame,
  theme,
  skeleton,
  nodeId,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly section: SectionBand;
  readonly frame: Rect;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly nodeId: SceneNode["id"];
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => (
  <>
    <rect
      data-section-hit={section.sectionId}
      x={section.frame.x}
      y={section.frame.y}
      width={section.frame.width}
      height={section.frame.height}
      fill="transparent"
      pointerEvents="all"
      onClick={(event) => {
        event.stopPropagation();
        onPartClick?.({ kind: "section", nodeId, sectionId: section.sectionId });
      }}
    />
    {section.header !== undefined ? (
      <text
        x={section.header.textFrame.x}
        y={section.header.textFrame.y + section.header.textFrame.height / 2}
        dominantBaseline="middle"
        {...textStyle(section.header.text)}
        onClick={(event) => {
          event.stopPropagation();
          onPartClick?.({ kind: "section", nodeId, sectionId: section.sectionId });
        }}
        onDoubleClick={(event) => {
          event.preventDefault(); event.stopPropagation();
          onTextDoubleClick?.({ kind: "sectionTitle", sectionId: section.sectionId });
        }}
      >
        {section.header.text.text}
      </text>
    ) : null}
    {section.rows.map((row) => (
      <RowBody
        key={row.rowId}
        row={row}
        theme={theme}
        skeleton={skeleton}
        nodeId={nodeId}
        onTextDoubleClick={onTextDoubleClick}
        onPartClick={onPartClick}
      />
    ))}
    <rect
      data-section-top-hit={section.sectionId}
      x={section.frame.x}
      y={section.frame.y - 2}
      width={section.frame.width}
      height={8}
      fill="transparent"
      pointerEvents="all"
      onClick={(event) => {
        event.stopPropagation();
        onPartClick?.({ kind: "section", nodeId, sectionId: section.sectionId });
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (section.header !== undefined) {
          onTextDoubleClick?.({ kind: "sectionTitle", sectionId: section.sectionId });
        }
      }}
    />
    {section !== undefined && rectBottom(section.frame) < rectBottom({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }) ? (
      <line
        x1={frame.x}
        y1={rectBottom(section.frame)}
        x2={rectRight(frame)}
        y2={rectBottom(section.frame)}
        stroke={theme.table.divider.color}
        strokeWidth={theme.table.divider.width}
        opacity={0.55}
      />
    ) : null}
  </>
);

const RowBody = ({
  row,
  theme,
  skeleton,
  nodeId,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly row: RowBand;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly nodeId: SceneNode["id"];
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => {
  if (skeleton) return null;
  return (
    <>
      <rect
        data-row-hit={row.rowId}
        x={row.frame.x}
        y={row.frame.y}
        width={row.frame.width}
        height={row.frame.height}
        fill="transparent"
        pointerEvents="all"
        onClick={(event) => {
          event.stopPropagation();
          onPartClick?.({ kind: "row", nodeId, rowId: row.rowId });
        }}
      />
      <text
        x={row.textFrame.x}
        y={row.textFrame.y + row.textFrame.height / 2}
        dominantBaseline="middle"
        {...textStyle(row.text)}
        onClick={(event) => {
          event.stopPropagation();
          onPartClick?.({ kind: "row", nodeId, rowId: row.rowId });
        }}
        onDoubleClick={(event) => {
          event.preventDefault(); event.stopPropagation();
          const x = localX(event);
          const target = row.typeFrame !== undefined && x >= row.typeFrame.x - 2
            ? { kind: "rowType" as const, rowId: row.rowId }
            : { kind: "rowName" as const, rowId: row.rowId };
          onTextDoubleClick?.(target);
        }}
      >
        {row.text.text}
      </text>
      {row.badgeFrames.map((badge) => (
        <g
          key={`${row.rowId}-${badge.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onPartClick?.({ kind: "row", nodeId, rowId: row.rowId });
          }}
          onDoubleClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            onTextDoubleClick?.({ kind: "rowName", rowId: row.rowId });
          }}
        >
          <rect
            x={badge.frame.x}
            y={badge.frame.y}
            width={badge.frame.width}
            height={badge.frame.height}
            rx={2}
            fill="#efece4"
            stroke="#d8d2c4"
            strokeWidth={0.4}
          />
          <text
            x={badge.frame.x + badge.frame.width / 2}
            y={badge.frame.y + badge.frame.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily={theme.table.text.fontFamily}
            fontSize={6.5}
            fontWeight={600}
            fill={theme.colors.muted}
          >
            {badge.label}
          </text>
        </g>
      ))}
    </>
  );
};

const ActorBody = ({
  layout,
  theme,
  skeleton,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly layout: ShapeNodeLayout;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => {
  const { frame, text, textFrame } = layout;
  const labelHeight = text.height;
  const bodyBottom = rectBottom(frame) - labelHeight - 4;
  const centerX = frame.x + frame.width / 2;
  const headRadius = Math.min(frame.width * 0.16, Math.max(5, (bodyBottom - frame.y) * 0.15));
  const headCenterY = frame.y + headRadius + 3;
  const shoulderY = headCenterY + headRadius;
  const hipY = frame.y + (bodyBottom - frame.y) * 0.68;
  const armY = shoulderY + (hipY - shoulderY) * 0.28;
  const armHalf = frame.width * 0.28;
  const legHalf = frame.width * 0.2;
  const stroke = theme.shape.stroke;

  return (
    <>
      <circle
        cx={centerX}
        cy={headCenterY}
        r={headRadius}
        fill="white"
        stroke={stroke.color}
        strokeWidth={stroke.width}
      />
      <line x1={centerX} y1={shoulderY} x2={centerX} y2={hipY} stroke={stroke.color} strokeWidth={stroke.width} />
      <line x1={centerX - armHalf} y1={armY} x2={centerX + armHalf} y2={armY} stroke={stroke.color} strokeWidth={stroke.width} />
      <line x1={centerX} y1={hipY} x2={centerX - legHalf} y2={bodyBottom} stroke={stroke.color} strokeWidth={stroke.width} />
      <line x1={centerX} y1={hipY} x2={centerX + legHalf} y2={bodyBottom} stroke={stroke.color} strokeWidth={stroke.width} />
      {skeleton ? null : (
        <text
          x={textFrame.x + textFrame.width / 2}
          y={textFrame.y + textFrame.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          {...textStyle(text)}
          onClick={(event) => {
            event.stopPropagation();
            onPartClick?.({ kind: "object", nodeId: layout.nodeId });
          }}
          onDoubleClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            onTextDoubleClick?.({ kind: "nodeName" });
          }}
        >
          {text.text}
        </text>
      )}
    </>
  );
};

const LifelineBody = ({
  layout,
  theme,
  skeleton,
  onTextDoubleClick,
  onPartClick,
  activationDraft,
  onActivationPointerDown,
}: {
  readonly layout: Extract<NodeLayout, { kind: "lifeline" }>;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
  readonly activationDraft?: { readonly id: string; readonly top: number; readonly height: number } | null;
  readonly onActivationPointerDown?: (
    nodeId: string,
    activationId: string,
    event: React.PointerEvent<SVGRectElement>,
    edge: "top" | "bottom" | "body",
  ) => void;
}) => {
  const style = theme.shape;
  const head = layout.headFrame;
  const centerX = head.x + head.width / 2;
  return (
    <>
      <rect
        x={head.x}
        y={head.y}
        width={head.width}
        height={head.height}
        fill="white"
        stroke={style.stroke.color}
        strokeWidth={style.stroke.width}
      />
      {skeleton ? null : (
        <text
          x={centerX}
          y={head.y + head.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          {...textStyle(layout.headText)}
          onClick={(event) => {
            event.stopPropagation();
            onPartClick?.({ kind: "object", nodeId: layout.nodeId });
          }}
          onDoubleClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            onTextDoubleClick?.({ kind: "lifelineLabel" });
          }}
        >
          {layout.headText.text}
        </text>
      )}
      <line
        x1={layout.spine.from.x}
        y1={layout.spine.from.y}
        x2={layout.spine.to.x}
        y2={layout.spine.to.y}
        stroke={style.stroke.color}
        strokeWidth={0.7}
        strokeDasharray="4 4"
      />
      {/* Only the head and the thin time axis are interactive. A full-frame
          lifeline hit area would swallow arrows, frames and notes underneath. */}
      <rect
        data-lifeline-spine-hit={layout.nodeId}
        x={centerX - 9}
        y={layout.spine.from.y}
        width={18}
        height={Math.max(1, layout.spine.to.y - layout.spine.from.y)}
        fill="transparent"
        pointerEvents="all"
        style={{ cursor: "pointer" }}
        onClick={(event) => {
          event.stopPropagation();
          const world = localPoint(event);
          const y = Math.min(
            layout.spine.to.y,
            Math.max(layout.spine.from.y, world.y),
          );
          onPartClick?.({ kind: "lifelineSpine", nodeId: layout.nodeId, y });
        }}
      />
      {layout.activations.map((activation) => {
        const draft = activationDraft?.id === activation.id ? activationDraft : null;
        const top = draft === null ? activation.frame.y : layout.frame.y + draft.top;
        const height = draft === null ? activation.frame.height : draft.height;
        const edgeZone = Math.min(10, height / 3);
        return (
          <g key={activation.id}>
            <rect
              data-activation-bar={activation.id}
              x={activation.frame.x}
              y={top}
              width={activation.frame.width}
              height={height}
              fill="white"
              stroke={style.stroke.color}
              strokeWidth={0.7}
              style={{ cursor: "move" }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                onActivationPointerDown?.(layout.nodeId, activation.id, event, "body");
              }}
              onClick={(event) => event.stopPropagation()}
            />
            {(["top", "bottom"] as const).map((edge) => (
              <rect
                key={`${activation.id}-${edge}`}
                data-activation-edge={edge}
                x={activation.frame.x}
                y={edge === "top" ? top : top + height - edgeZone}
                width={activation.frame.width}
                height={edgeZone}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: "ns-resize" }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  onActivationPointerDown?.(layout.nodeId, activation.id, event, edge);
                }}
                onClick={(event) => event.stopPropagation()}
              />
            ))}
          </g>
        );
      })}
      {layout.destroyPoint !== undefined ? (
        <g stroke={style.stroke.color} strokeWidth={1}>
          <line x1={layout.destroyPoint.x - 5} y1={layout.destroyPoint.y - 5} x2={layout.destroyPoint.x + 5} y2={layout.destroyPoint.y + 5} />
          <line x1={layout.destroyPoint.x - 5} y1={layout.destroyPoint.y + 5} x2={layout.destroyPoint.x + 5} y2={layout.destroyPoint.y - 5} />
        </g>
      ) : null}
    </>
  );
};

const ShapeBody = ({
  layout,
  node,
  theme,
  skeleton,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly layout: ShapeNodeLayout;
  readonly node: SceneNode;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => {
  const style = theme.shape;
  const { frame, text } = layout;
  const center = rectCenter(frame);
  const common = {
    fill: node.kind === "frame" ? "none" : style.fill.color ?? "none",
    stroke: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeDasharray: dashArray(style.stroke.pattern),
  };

  if (node.kind === "actor") return <ActorBody layout={layout} theme={theme} skeleton={skeleton} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />;

  if (node.kind === "useCase") {
    return (
      <>
        <ellipse cx={center.x} cy={center.y} rx={frame.width / 2} ry={frame.height / 2} {...common} />
        {skeleton ? null : <ShapeText layout={layout} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />}
      </>
    );
  }

  if (node.kind === "pseudostate") {
    const radius = Math.min(frame.width, frame.height) / 2;
    switch (node.pseudostateKind) {
      case "initial":
        return <circle cx={center.x} cy={center.y} r={Math.max(3, radius * 0.55)} fill={theme.colors.ink} />;
      case "final":
        return (
          <>
            <circle cx={center.x} cy={center.y} r={radius} fill="white" stroke={theme.colors.ink} strokeWidth={1} />
            <circle cx={center.x} cy={center.y} r={Math.max(2, radius * 0.58)} fill={theme.colors.ink} />
          </>
        );
      case "choice":
        return <polygon points={`${center.x},${frame.y} ${rectRight(frame)},${center.y} ${center.x},${rectBottom(frame)} ${frame.x},${center.y}`} {...common} />;
      case "fork":
      case "join":
        return <rect x={frame.x} y={frame.y + frame.height * 0.4} width={frame.width} height={frame.height * 0.2} fill={theme.colors.ink} />;
      case "terminate":
        return (
          <g stroke={theme.colors.ink} strokeWidth={1.4}>
            <line x1={frame.x + 3} y1={frame.y + 3} x2={rectRight(frame) - 3} y2={rectBottom(frame) - 3} />
            <line x1={frame.x + 3} y1={rectBottom(frame) - 3} x2={rectRight(frame) - 3} y2={frame.y + 3} />
          </g>
        );
      default:
        return <circle cx={center.x} cy={center.y} r={Math.max(3, radius * 0.5)} fill="white" stroke={theme.colors.ink} />;
    }
  }

  if (node.kind === "relationship") {
    const points = `${center.x},${frame.y} ${rectRight(frame)},${center.y} ${center.x},${rectBottom(frame)} ${frame.x},${center.y}`;
    return (
      <>
        <polygon points={points} {...common} fill="white" />
        {skeleton ? null : <ShapeText layout={layout} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />}
      </>
    );
  }

  if (node.kind === "state") {
    return (
      <>
        <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} rx={Math.min(12, frame.height / 4)} {...common} />
        {skeleton ? null : <ShapeText layout={layout} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />}
      </>
    );
  }

  if (node.kind === "frame") {
    const edge = 9;
    return (
      <>
        <rect
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          fill="none"
          stroke={style.stroke.color}
          strokeWidth={style.stroke.width}
          pointerEvents="none"
        />
        {/* Containers select/drag from their border and title, not from the
            whole interior; otherwise a frame would swallow every message or
            arrow drawn inside it. */}
        <g fill="transparent" pointerEvents="all">
          <rect x={frame.x} y={frame.y} width={frame.width} height={edge} data-frame-border-hit="north" />
          <rect x={frame.x} y={rectBottom(frame) - edge} width={frame.width} height={edge} data-frame-border-hit="south" />
          <rect x={frame.x} y={frame.y} width={edge} height={frame.height} data-frame-border-hit="west" />
          <rect x={rectRight(frame) - edge} y={frame.y} width={edge} height={frame.height} data-frame-border-hit="east" />
        </g>
        {skeleton ? null : <ShapeText layout={layout} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />}
      </>
    );
  }

  if (node.kind === "object") {
    return (
      <>
        <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} {...common} />
        {skeleton ? null : (
          <>
            <ShapeText layout={layout} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />
            <line
              x1={center.x - Math.min(frame.width * 0.3, text.width / 2 + 4)}
              y1={center.y + text.height / 2 + 2}
              x2={center.x + Math.min(frame.width * 0.3, text.width / 2 + 4)}
              y2={center.y + text.height / 2 + 2}
              stroke={theme.colors.ink}
              strokeWidth={0.6}
            />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} {...common} />
      {skeleton ? null : <ShapeText layout={layout} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />}
    </>
  );
};

const ShapeText = ({
  layout,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly layout: ShapeNodeLayout;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => (
  <text
    x={layout.kind === "frame" ? layout.textFrame.x : layout.textFrame.x + layout.textFrame.width / 2}
    y={layout.textFrame.y + layout.textFrame.height / 2}
    textAnchor={layout.kind === "frame" ? "start" : "middle"}
    dominantBaseline="middle"
    {...textStyle(layout.text)}
    onClick={(event) => {
      event.stopPropagation();
      onPartClick?.({ kind: "object", nodeId: layout.nodeId });
    }}
    onDoubleClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onTextDoubleClick?.({ kind: "nodeName" });
    }}
  >
    {layout.text.text}
  </text>
);

const CommentBody = ({
  layout,
  theme,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly layout: CommentNodeLayout;
  readonly theme: Theme;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => {
  const { frame } = layout;
  const fold = Math.min(18, frame.width / 4, frame.height / 4);
  const right = rectRight(frame);
  const bottom = rectBottom(frame);
  const lineHeight = theme.shape.text.fontSize * 1.35;
  return (
    <>
      <polygon
        points={`${frame.x},${frame.y} ${right - fold},${frame.y} ${right},${frame.y + fold} ${right},${bottom} ${frame.x},${bottom}`}
        fill="#fffdf2"
        stroke={theme.shape.stroke.color}
        strokeWidth={theme.shape.stroke.width}
      />
      <polyline
        points={`${right - fold},${frame.y} ${right - fold},${frame.y + fold} ${right},${frame.y + fold}`}
        fill="none"
        stroke={theme.shape.stroke.color}
        strokeWidth={theme.shape.stroke.width}
      />
      {layout.lines.map((line, index) => (
        <text
          key={`comment-line-${index}`}
          x={layout.textFrame.x}
          y={layout.textFrame.y + lineHeight * (index + 0.8)}
          dominantBaseline="middle"
          {...textStyle(line)}
          onClick={(event) => {
            event.stopPropagation();
            onPartClick?.({ kind: "object", nodeId: layout.nodeId });
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onTextDoubleClick?.({ kind: "commentBody" });
          }}
        >
          {line.text}
        </text>
      ))}
    </>
  );
};

const ImageBody = ({
  layout,
  theme,
  skeleton,
  onTextDoubleClick,
  onPartClick,
}: {
  readonly layout: Extract<NodeLayout, { kind: "image" }>;
  readonly theme: Theme;
  readonly skeleton: boolean;
  readonly onTextDoubleClick?: (target: CanvasTextTarget) => void;
  readonly onPartClick?: (focus: NodeFocus) => void;
}) => {
  const { imageFrame } = layout;
  return (
    <>
      <rect x={imageFrame.x} y={imageFrame.y} width={imageFrame.width} height={imageFrame.height} fill="#f0ede5" stroke={theme.shape.stroke.color} strokeWidth={theme.shape.stroke.width} />
      <line x1={imageFrame.x} y1={imageFrame.y} x2={rectRight(imageFrame)} y2={rectBottom(imageFrame)} stroke={theme.colors.gridMajor} strokeWidth={0.6} />
      <line x1={rectRight(imageFrame)} y1={imageFrame.y} x2={imageFrame.x} y2={rectBottom(imageFrame)} stroke={theme.colors.gridMajor} strokeWidth={0.6} />
      <text x={imageFrame.x + imageFrame.width / 2} y={imageFrame.y + imageFrame.height / 2} textAnchor="middle" dominantBaseline="middle" fontFamily={theme.shape.text.fontFamily} fontSize={8} fill={theme.colors.muted} onClick={(event) => { event.stopPropagation(); onPartClick?.({ kind: "object", nodeId: layout.nodeId }); }} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onTextDoubleClick?.({ kind: "caption" }); }}>
        IMAGE
      </text>
      {!skeleton && layout.caption !== undefined && layout.captionFrame !== undefined ? (
        <text
          x={layout.captionFrame.x + layout.captionFrame.width / 2}
          y={layout.captionFrame.y + layout.captionFrame.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          {...textStyle(layout.caption)}
          onClick={(event) => {
            event.stopPropagation();
            onPartClick?.({ kind: "object", nodeId: layout.nodeId });
          }}
          onDoubleClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            onTextDoubleClick?.({ kind: "caption" });
          }}
        >
          {layout.caption.text}
        </text>
      ) : null}
    </>
  );
};

export const NodeSkeleton = ({
  node,
  layout,
  theme,
  selected,
  skeleton,
  onPointerDown,
  onTextDoubleClick,
  onPartClick,
  activationDraft,
  onActivationPointerDown,
}: NodeSkeletonProps) => {
  let body: React.ReactNode;
  switch (layout.kind) {
    case "table":
    case "relationAttribute":
      body = <TableBody layout={layout} theme={theme} skeleton={skeleton} nodeId={node.id} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />;
      break;
    case "lifeline":
      body = (
        <LifelineBody
          layout={layout}
          theme={theme}
          skeleton={skeleton}
          onTextDoubleClick={onTextDoubleClick}
          onPartClick={onPartClick}
          activationDraft={activationDraft}
          onActivationPointerDown={onActivationPointerDown}
        />
      );
      break;
    case "image":
      body = <ImageBody layout={layout} theme={theme} skeleton={skeleton} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />;
      break;
    case "comment":
      body = <CommentBody layout={layout} theme={theme} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />;
      break;
    default:
      body = <ShapeBody layout={layout} node={node} theme={theme} skeleton={skeleton} onTextDoubleClick={onTextDoubleClick} onPartClick={onPartClick} />;
  }

  return (
    <g
      data-node-id={node.id}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.stopPropagation();
        onPartClick?.(layout.kind === "table" || layout.kind === "relationAttribute"
          ? { kind: "table", nodeId: node.id }
          : { kind: "object", nodeId: node.id });
      }}
      style={{ cursor: node.locked ? "grab" : "move" }}
      opacity={node.visible ? 1 : 0.3}
    >
      <title>{`${node.name}${node.locked ? " (locked)" : ""}`}</title>
      {layout.kind === "lifeline" || layout.kind === "frame" ? null : (
        <rect
          x={layout.frame.x}
          y={layout.frame.y}
          width={layout.frame.width}
          height={layout.frame.height}
          fill="transparent"
          stroke="transparent"
          pointerEvents="all"
          rx={layout.kind === "table" || layout.kind === "relationAttribute" ? 0 : 3}
        />
      )}
      {body}
      {selected ? (
        layout.kind === "lifeline" ? (
          <g pointerEvents="none">
            <rect
              x={layout.headFrame.x}
              y={layout.headFrame.y}
              width={layout.headFrame.width}
              height={layout.headFrame.height}
              fill="none"
              stroke={theme.colors.selection}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            {(() => {
              const ranges = layout.activations
                .map((activation) => {
                  const draft = activationDraft?.id === activation.id ? activationDraft : null;
                  const top = draft === null ? activation.frame.y : layout.frame.y + draft.top;
                  const height = draft === null ? activation.frame.height : draft.height;
                  return {
                    top: Math.max(layout.spine.from.y, top),
                    bottom: Math.min(layout.spine.to.y, top + height),
                  };
                })
                .filter((range) => range.bottom > range.top)
                .sort((a, b) => a.top - b.top);
              const segments: { top: number; bottom: number }[] = [];
              let cursor = layout.spine.from.y;
              for (const range of ranges) {
                if (range.top > cursor + 0.001) {
                  segments.push({ top: cursor, bottom: Math.min(range.top, layout.spine.to.y) });
                }
                cursor = Math.max(cursor, range.bottom);
              }
              if (cursor < layout.spine.to.y - 0.001) {
                segments.push({ top: cursor, bottom: layout.spine.to.y });
              }
              return segments.map((segment, index) => (
                <line
                  key={`selected-spine-${index}`}
                  x1={layout.spine.from.x}
                  y1={segment.top}
                  x2={layout.spine.from.x}
                  y2={segment.bottom}
                  stroke={theme.colors.selection}
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                />
              ));
            })()}
          </g>
        ) : (
          <rect
            x={layout.frame.x}
            y={layout.frame.y}
            width={layout.frame.width}
            height={layout.frame.height}
            fill="none"
            stroke={theme.colors.selection}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            rx={layout.kind === "table" || layout.kind === "relationAttribute" ? 0 : 3}
          />
        )
      ) : null}
      {node.locked ? (
        <g pointerEvents="none">
          <rect x={rectRight(layout.frame) - 16} y={layout.frame.y + 5} width={11} height={8} rx={1.5} fill="white" stroke={theme.colors.muted} strokeWidth={0.6} />
          <path d={`M ${rectRight(layout.frame) - 13.5} ${layout.frame.y + 8} v -1.5 a 2 2 0 0 1 4 0 v 1.5`} fill="none" stroke={theme.colors.muted} strokeWidth={0.7} />
        </g>
      ) : null}
    </g>
  );
};

export const nodeFrameFromLayout = (layout: NodeLayout): Rect => layout.frame;
