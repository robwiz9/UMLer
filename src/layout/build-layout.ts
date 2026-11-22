/**
 * Phase 1 geometry pass.
 *
 * Builds the measured skeleton for a scene: text bands, compartment dividers,
 * row ports, perimeter/spine ports, simple connector routes and label frames.
 * It is pure and synchronous apart from the injected text measurer, so the same
 * function runs in the browser UI and in Node-based layout tests.
 *
 * Global obstacle-avoiding A* routing is intentionally not here; Step 3 replaces
 * the simple orthogonal route with the A* result, while keeping this snapshot
 * contract. The preview does detour around its own endpoint nodes and keeps
 * labels out of table/class/shape frames.
 */

import {
  findRow,
  formatRow,
  isTableLikeNode,
  visibleSections,
  type CircuitComponentNode,
  type CircuitJunctionNode,
  type CommentNode,
  type ImageNode,
  type LifelineNode,
  type RelationAttributeNode,
  type SceneNode,
  type TableNode,
  type TableRow,
  type TableSection,
} from "../model/nodes.ts";
import type { SceneDocument } from "../model/scene.ts";
import { resolveCircuitSettings } from "../model/circuit.ts";
import type {
  EdgeAttachment,
  EdgeLabel,
  EdgeRouting,
  SceneEdge,
} from "../model/edges.ts";
import { portKey } from "../model/edges.ts";
import { markerExtent } from "../model/markers.ts";
import { resolveTextStyle } from "../model/styles.ts";
import { measureRichText } from "../model/rich-text.ts";
import { imageCaptionBlockHeight } from "../model/image-geometry.ts";
import type {
  CircuitComponentLayout,
  CircuitJunctionLayout,
  CircuitPinGeometry,
  EdgeLabelLayout,
  EdgeLayout,
  CommentNodeLayout,
  HeaderBand,
  LayoutSnapshot,
  LifelineNodeLayout,
  NodeLayout,
  PortGeometry,
  RowBand,
  SectionBand,
  TextMeasurement,
  TextMeasurer,
} from "../model/layout.ts";
import {
  resolveCircuitComponent,
  resolveCircuitJunction,
  unionCircuitBounds,
} from "./circuit.ts";
import { computeWireBridges } from "./wire-bridges.ts";
import type {
  Point,
  Rect,
} from "../model/geometry.ts";
import {
  add,
  compassNormal,
  compassPoint,
  expandRect,
  length,
  normalize,
  point,
  rect,
  rectBottom,
  rectCenter,
  rectRight,
  rectsIntersect,
  scale,
  sub,
  unionRects,
} from "../model/geometry.ts";
import {
  asActivationId,
  asPortId,
  asSectionId,
  type NodeId,
  type PortId,
  type RowId,
} from "../model/ids.ts";
import { routeOrthogonalAStar } from "./router.ts";

const EPSILON = 0.001;

/** Fixed band reserved for a table section title when sections are visible. */
export const TABLE_SECTION_TITLE_HEIGHT = 14;

const rectOfPoints = (points: readonly Point[]): Rect => {
  if (points.length === 0) return rect(0, 0, 0, 0);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return rect(minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY);
};

const samePoint = (a: Point, b: Point): boolean =>
  Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Deterministic port IDs are shared with the serializer and hit-testing. */
const makePort = (
  nodeId: NodeId,
  ref: PortGeometry["ref"],
  pointValue: Point,
  normal: Point,
  label: string,
  rowId?: RowId,
  side?: PortGeometry["side"],
): PortGeometry => ({
  id: asPortId(portKey(nodeId, ref)),
  nodeId,
  ref,
  point: pointValue,
  normal: normalize(normal),
  tangent: normalize(point(-normal.y, normal.x)),
  label,
  rowId,
  side,
});

const addPort = (
  ports: Map<PortId, PortGeometry>,
  nodeId: NodeId,
  ref: PortGeometry["ref"],
  pointValue: Point,
  normal: Point,
  label: string,
  rowId?: RowId,
  side?: PortGeometry["side"],
): PortGeometry => {
  const port = makePort(nodeId, ref, pointValue, normal, label, rowId, side);
  ports.set(port.id, port);
  return port;
};

const PERIMETER: readonly {
  side: "north" | "north-east" | "east" | "south-east" | "south" | "south-west" | "west" | "north-west";
}[] = [
  { side: "north" },
  { side: "north-east" },
  { side: "east" },
  { side: "south-east" },
  { side: "south" },
  { side: "south-west" },
  { side: "west" },
  { side: "north-west" },
];

const RECT_SIDES: readonly {
  side: "north" | "east" | "south" | "west";
}[] = [
  { side: "north" },
  { side: "east" },
  { side: "south" },
  { side: "west" },
];

/**
 * Corner ports are deliberately omitted: the four corners are reserved for
 * resize handles. On table-like nodes the side handles sit at the middle of the
 * header so they do not collide with the per-row connector handles.
 */
const addRectPerimeterPorts = (
  ports: Map<PortId, PortGeometry>,
  nodeId: NodeId,
  frame: Rect,
  options: { readonly sideY?: number } = {},
): readonly PortGeometry[] =>
  RECT_SIDES.map(({ side }) => {
    const p =
      options.sideY !== undefined && (side === "east" || side === "west")
        ? point(side === "west" ? frame.x : rectRight(frame), options.sideY)
        : compassPoint(frame, side);
    return addPort(ports, nodeId, { kind: "perimeter", side }, p, compassNormal(side), side);
  });

const addEllipsePerimeterPorts = (
  ports: Map<PortId, PortGeometry>,
  nodeId: NodeId,
  frame: Rect,
): readonly PortGeometry[] => {
  const center = rectCenter(frame);
  const rx = Math.max(1, frame.width / 2);
  const ry = Math.max(1, frame.height / 2);
  const angleToSide: readonly (typeof PERIMETER)[number]["side"][] = [
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
    "north",
    "north-east",
  ];
  return angleToSide.map((side, index) => {
    const angle = (index * Math.PI) / 4;
    const p = point(center.x + rx * Math.cos(angle), center.y + ry * Math.sin(angle));
    const normal = normalize(point(Math.cos(angle) / (rx * rx), Math.sin(angle) / (ry * ry)));
    return addPort(ports, nodeId, { kind: "perimeter", side }, p, normal, side);
  });
};

const headerText = (
  measurer: TextMeasurer,
  node: TableNode | RelationAttributeNode,
): { text: TextMeasurement; stereotype?: TextMeasurement } => {
  const override = node.kind === "table"
    ? node.header.textStyle ?? node.textStyle
    : node.textStyle;
  const style = resolveTextStyle(node.style.headerText, override);
  const maxWidth = node.frame.width - node.style.paddingX * 2;
  const stereotype =
    node.kind === "table" && node.tableKind === "entity" && node.header.weak === true
      ? "weak"
      : node.kind === "table"
        ? node.header.stereotype
        : undefined;
  return {
    text: measurer.measure(node.name, style, maxWidth),
    stereotype:
      stereotype === undefined
        ? undefined
        : measurer.measure(`«${stereotype}»`, resolveTextStyle({
            ...style,
            fontSize: Math.max(7, style.fontSize - 2),
            weight: 400,
            italic: true,
          }, override), maxWidth),
  };
};

const measureTable = (
  node: TableNode | RelationAttributeNode,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
  gridSize: number,
): NodeLayout => {
  const frame = node.frame;
  const style = node.style;
  const sectionsInput: readonly TableSection[] =
    node.kind === "table"
      ? visibleSections(node)
      : [
          {
            id: asSectionId(`${node.id}_attributes`),
            role: "attributes",
            rows: node.rows,
          },
        ];

  const totalRows = sectionsInput.reduce((count, section) => count + section.rows.length, 0);
  const titleCount = sectionsInput.filter((section) => section.title !== undefined).length;
  const grid = Math.max(1, gridSize);
  const naturalHeaderHeight = Math.max(
    grid,
    Math.round(style.headerHeight / grid) * grid,
  );
  // With no rows there is no body to share the height with: keep the natural
  // header height and let vertical resizing collapse the body to zero instead
  // of scaling the header down as a percentage of the frame. The natural
  // height is grid-aligned; the frame only limits it on very short tables.
  const headerHeight = totalRows === 0
    ? Math.min(naturalHeaderHeight, frame.height)
    : Math.min(naturalHeaderHeight, Math.max(12, frame.height * 0.4));
  const titleHeight = TABLE_SECTION_TITLE_HEIGHT;
  const availableRows = Math.max(0, frame.height - headerHeight - titleCount * titleHeight);
  const rowHeight = totalRows === 0 ? 0 : Math.max(8, availableRows / totalRows);

  const headerFrame = rect(frame.x, frame.y, frame.width, headerHeight);
  const header = headerText(measurer, node);
  const stereotypeGap = header.stereotype === undefined ? 0 : 1;
  const headerContentHeight =
    header.text.height + stereotypeGap + (header.stereotype?.height ?? 0);
  const headerTop = frame.y + Math.max(0, (headerHeight - headerContentHeight) / 2);
  const headerTextFrame = rect(
    frame.x + style.paddingX,
    headerTop,
    frame.width - style.paddingX * 2,
    header.text.height,
  );
  const stereotypeFrame =
    header.stereotype === undefined
      ? undefined
      : rect(
          frame.x + style.paddingX,
          headerTop + header.text.height + stereotypeGap,
          frame.width - style.paddingX * 2,
          header.stereotype.height,
        );

  const sections: SectionBand[] = [];
  let cursor = frame.y + headerHeight;

  for (const section of sectionsInput) {
    const sectionStart = cursor;
    let sectionHeader: SectionBand["header"];
    if (section.title !== undefined) {
      const sectionText = measurer.measure(
        section.title,
        resolveTextStyle({ ...style.text, weight: 600 }, section.textStyle),
        frame.width - style.paddingX * 2,
      );
      const titleFrame = rect(frame.x, cursor, frame.width, titleHeight);
      sectionHeader = {
        frame: titleFrame,
        textFrame: rect(frame.x + style.paddingX, cursor + (titleHeight - sectionText.height) / 2, frame.width - style.paddingX * 2, sectionText.height),
        text: sectionText,
      };
      cursor += titleHeight;
    }

    const rows: RowBand[] = [];
    for (const row of section.rows) {
      const rowFrame = rect(frame.x, cursor, frame.width, rowHeight);
      const badges = badgeLayout(
        row,
        style,
        frame,
        cursor,
        rowHeight,
        measurer,
        node.kind === "table" && node.tableKind === "entity" && node.header.weak === true,
      );
      const badgeWidth = badges.reduce((sum, badge) => sum + badge.frame.width + 3, 0);
      const displayText = formatRow(row, false);
      const rowStyle = resolveTextStyle(style.text, row.textStyle);
      const rowText = measurer.measure(
        displayText,
        rowStyle,
        Math.max(8, frame.width - style.paddingX * 2 - badgeWidth - 4),
      );
      const textFrame = rect(
        frame.x + style.paddingX,
        cursor + (rowHeight - rowText.height) / 2,
        Math.max(0, frame.width - style.paddingX * 2 - badgeWidth - 4),
        rowText.height,
      );
      const rawPrefix = row.prefix ?? row.visibility ?? "";
      const prefix = rawPrefix.length > 0 ? `${rawPrefix} ` : "";
      const typeLabel = row.kind === "method" ? row.returnType : row.type;
      const typeStart = typeLabel === undefined
        ? -1
        : displayText.lastIndexOf(`: ${typeLabel}`, displayText.length);
      const prefixWidth = measurer.measure(prefix, rowStyle).width;
      const nameText = displayText.slice(
        prefix.length,
        typeStart > prefix.length ? typeStart : displayText.length,
      );
      const nameWidth = measurer.measure(nameText, rowStyle).width;
      const nameFrame = rect(textFrame.x + prefixWidth, textFrame.y, nameWidth, textFrame.height);
      const typeFrame = typeLabel === undefined || typeStart < 0
        ? undefined
        : rect(
            textFrame.x + prefixWidth + nameWidth + measurer.measure(": ", rowStyle).width,
            textFrame.y,
            measurer.measure(typeLabel, rowStyle).width,
            textFrame.height,
          );
      const left = addPort(
        ports,
        node.id,
        { kind: "row", rowId: row.id, side: "west" },
        point(frame.x, cursor + rowHeight / 2),
        point(-1, 0),
        row.name,
        row.id,
        "west",
      );
      const right = addPort(
        ports,
        node.id,
        { kind: "row", rowId: row.id, side: "east" },
        point(rectRight(frame), cursor + rowHeight / 2),
        point(1, 0),
        row.name,
        row.id,
        "east",
      );
      rows.push({
        rowId: row.id,
        frame: rowFrame,
        textFrame,
        text: rowText,
        nameFrame,
        typeFrame,
        leftPortId: left.id,
        rightPortId: right.id,
        badgeFrames: badges,
      });
      cursor += rowHeight;
    }

    sections.push({
      sectionId: section.id,
      frame: rect(frame.x, sectionStart, frame.width, cursor - sectionStart),
      header: sectionHeader,
      rows,
    });
  }

  addRectPerimeterPorts(ports, node.id, frame, {
    sideY: headerFrame.y + headerFrame.height / 2,
  });

  const layout: NodeLayout = {
    nodeId: node.id,
    kind: node.kind,
    frame,
    bounds: frame,
    ports: [...ports.values()].filter((port) => port.nodeId === node.id),
    header: {
      frame: headerFrame,
      textFrame: headerTextFrame,
      text: header.text,
      stereotype: header.stereotype,
      stereotypeFrame,
    } satisfies HeaderBand,
    sections,
  };
  return layout;
};

const badgeLayout = (
  row: TableRow,
  style: TableNode["style"],
  frame: Rect,
  top: number,
  rowHeight: number,
  measurer: TextMeasurer,
  weakEntity: boolean,
): RowBand["badgeFrames"] => {
  const constraints = row.constraints ?? [];
  if (constraints.length === 0) return [];
  const badgeStyle = {
    ...style.text,
    fontSize: Math.max(7, style.text.fontSize - 3.3),
    weight: 600 as const,
  };
  const badgeHeight = 11;
  const reversed = [...constraints].reverse();
  const result: { label: string; frame: Rect }[] = [];
  let right = rectRight(frame) - style.paddingX;
  for (const constraint of reversed) {
    // A weak entity has a partial key, not a primary key; the ER convention
    // marks it as D while the stored constraint remains PK.
    const label = weakEntity && constraint === "PK" ? "D" : constraint;
    const measurement = measurer.measure(label, badgeStyle);
    const width = measurement.width + 5;
    const badgeFrame = rect(right - width, top + (rowHeight - badgeHeight) / 2, width, badgeHeight);
    result.unshift({ label, frame: badgeFrame });
    right -= width + 3;
  }
  return result;
};

const measureShape = (
  node: Exclude<
    SceneNode,
    | TableNode
    | RelationAttributeNode
    | LifelineNode
    | ImageNode
    | CommentNode
    | CircuitComponentNode
    | CircuitJunctionNode
  >,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
): NodeLayout => {
  const frame = node.frame;
  const style = node.style;
  const padding = style.padding;
  const maxWidth = Math.max(8, frame.width - padding * 2);

  const baseTextStyle = node.kind === "frame"
    ? { ...style.text, weight: 600 as const }
    : style.text;
  let textStyle = resolveTextStyle(baseTextStyle, node.textStyle);
  let textFrame: Rect;
  let text: TextMeasurement;

  if (node.kind === "actor") {
    text = measurer.measure(node.name, textStyle, maxWidth);
    textFrame = rect(frame.x, rectBottom(frame) - text.height - 4, frame.width, text.height);
  } else if (node.kind === "frame") {
    text = measurer.measure(node.name, textStyle, maxWidth);
    textFrame = rect(frame.x + padding, frame.y + padding, maxWidth, text.height);
  } else if (node.kind === "referencePoint") {
    textStyle = {
      ...textStyle,
      fontSize: Math.max(
        4,
        Math.min(32, node.textStyle?.fontSize ?? node.labelSize),
      ),
    };
    text = measurer.measure(
      node.referenceVariant === "dt"
        ? "Ref"
        : `1.${Math.max(1, node.referenceIndex)}`,
      textStyle,
      Math.max(20, frame.width - padding * 2),
    );
    const center = rectCenter(frame);
    textFrame = rect(
      center.x - text.width / 2,
      center.y - text.height / 2,
      text.width,
      text.height,
    );
  } else if (node.kind === "pseudostate") {
    // Pseudostate names are free labels around the symbol, so they need a
    // wider measure than the tiny 18pt symbol frame.
    text = measurer.measure(node.name, textStyle, Math.max(40, frame.width * 8));
    const center = rectCenter(frame);
    const labelCenter = {
      x: center.x + (node.labelOffset?.x ?? 0),
      y: center.y + (node.labelOffset?.y ?? frame.height / 2 + text.height / 2 + 4),
    };
    textFrame = rect(
      labelCenter.x - text.width / 2,
      labelCenter.y - text.height / 2,
      text.width,
      text.height,
    );
  } else {
    text = measurer.measure(node.name, textStyle, maxWidth);
    textFrame = rect(
      frame.x + padding,
      frame.y + (frame.height - text.height) / 2,
      maxWidth,
      text.height,
    );
  }

  if (node.kind === "useCase") {
    addEllipsePerimeterPorts(ports, node.id, frame);
  } else if (node.kind === "pseudostate") {
    addRectPerimeterPorts(ports, node.id, frame);
  } else {
    addRectPerimeterPorts(ports, node.id, frame);
  }

  const labelFrame =
    node.kind === "actor" || (node.kind === "pseudostate" && node.name.length > 0)
      ? textFrame
      : undefined;
  return {
    nodeId: node.id,
    kind: node.kind,
    frame,
    bounds: node.kind === "pseudostate" && labelFrame !== undefined
      ? unionRects([frame, labelFrame]) ?? frame
      : frame,
    ports: [...ports.values()].filter((port) => port.nodeId === node.id),
    textFrame,
    text,
    labelFrame,
  };
};

const measureLifeline = (
  node: LifelineNode,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
): LifelineNodeLayout => {
  const frame = node.frame;
  const headFrame = rect(frame.x, frame.y, frame.width, Math.min(node.headHeight, frame.height));
  const headText = measurer.measure(node.head.label ?? node.name, resolveTextStyle({
    ...node.style.text,
    weight: 600,
  }, node.textStyle), frame.width - 12);

  const centerX = frame.x + frame.width / 2;
  const spineFrom = point(centerX, rectBottom(headFrame));
  const spineTo = point(centerX, rectBottom(frame));

  addRectPerimeterPorts(ports, node.id, headFrame, {
    sideY: headFrame.y + headFrame.height / 2,
  });
  addPort(ports, node.id, { kind: "spine", t: 0 }, spineFrom, point(1, 0), "spine top");
  addPort(ports, node.id, { kind: "spine", t: 1 }, spineTo, point(1, 0), "spine bottom");

  const spineT = (y: number): number =>
    Math.max(0, Math.min(1, (y - spineFrom.y) / Math.max(1, spineTo.y - spineFrom.y)));

  // When an activation exists, its own evenly spaced handles replace the
  // generic mid-spine handles. The number of segments follows the bar height
  // (roughly one handle every 54pt, minimum 3 and maximum 7 handles), so short
  // bars stay usable and long bars do not become a dotted line.
  if (node.activationBars.length === 0) {
    for (const t of [0.25, 0.5, 0.75]) {
      addPort(
        ports,
        node.id,
        { kind: "spine", t },
        point(centerX, spineFrom.y + (spineTo.y - spineFrom.y) * t),
        point(1, 0),
        `spine ${Math.round(t * 100)}%`,
      );
    }
  }

  const activations = node.activationBars.map((bar) => {
    const top = frame.y + bar.top;
    const activationFrame = rect(centerX - 5, top, 10, bar.height);
    const segments = Math.min(6, Math.max(2, Math.round(bar.height / 54)));
    const barPorts: PortGeometry[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const fraction = index / segments;
      const y = top + bar.height * fraction;
      const label = index === 0
        ? "activation top"
        : index === segments
          ? "activation bottom"
          : `activation ${Math.round(fraction * 100)}%`;
      barPorts.push(
        addPort(
          ports,
          node.id,
          { kind: "spine", t: spineT(y) },
          point(centerX, y),
          point(1, 0),
          label,
        ),
      );
    }
    const topPort = barPorts[0];
    const bottomPort = barPorts[barPorts.length - 1];
    if (topPort === undefined || bottomPort === undefined) {
      throw new Error("activation bar must expose at least two handles");
    }
    return {
      id: asActivationId(bar.id),
      frame: activationFrame,
      topPortId: topPort.id,
      bottomPortId: bottomPort.id,
    };
  });

  return {
    nodeId: node.id,
    kind: "lifeline",
    frame,
    bounds: frame,
    ports: [...ports.values()].filter((port) => port.nodeId === node.id),
    headFrame,
    headText,
    spine: { from: spineFrom, to: spineTo },
    activations,
    destroyPoint:
      node.destroyAt === undefined ? undefined : point(centerX, frame.y + node.destroyAt),
  };
};

const measureImage = (
  node: ImageNode,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
): NodeLayout => {
  const frame = node.frame;
  const captionBlockHeight = imageCaptionBlockHeight(node);
  const imageFrame = rect(
    frame.x,
    frame.y,
    frame.width,
    Math.max(1, frame.height - captionBlockHeight),
  );
  const caption = node.caption
    ? measurer.measure(
        node.caption,
        resolveTextStyle(node.style.text, node.textStyle),
        frame.width - node.style.padding * 2,
      )
    : undefined;
  const captionFrame = caption
    ? rect(frame.x + node.style.padding, rectBottom(frame) - caption.height, frame.width - node.style.padding * 2, caption.height)
    : undefined;

  addRectPerimeterPorts(ports, node.id, frame);

  return {
    nodeId: node.id,
    kind: "image",
    frame,
    bounds: frame,
    ports: [...ports.values()].filter((port) => port.nodeId === node.id),
    imageFrame,
    captionFrame,
    caption,
  };
};

const measureComment = (
  node: CommentNode,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
): CommentNodeLayout => {
  const frame = node.frame;
  const style = node.style;
  const padding = Math.max(6, style.padding);
  const maxWidth = Math.max(8, frame.width - padding * 2);
  const commentStyle = resolveTextStyle(style.text, node.textStyle);
  const lineHeight = commentStyle.fontSize * 1.35;
  const availableLines = Math.max(1, Math.floor((frame.height - padding * 2) / lineHeight));
  const sourceLines = (node.body.length > 0 ? node.body : "Comment").split(/\r?\n/);
  const visibleLines = sourceLines.slice(0, availableLines);
  if (sourceLines.length > availableLines && visibleLines.length > 0) {
    visibleLines[visibleLines.length - 1] = `${visibleLines[visibleLines.length - 1]}…`;
  }
  const lines = visibleLines.map((line) =>
    measurer.measure(line.length > 0 ? line : " ", commentStyle, maxWidth),
  );

  addRectPerimeterPorts(ports, node.id, frame);

  return {
    nodeId: node.id,
    kind: "comment",
    frame,
    bounds: frame,
    ports: [...ports.values()].filter((port) => port.nodeId === node.id),
    lines,
    textFrame: rect(
      frame.x + padding,
      frame.y + padding,
      maxWidth,
      Math.max(lineHeight, lines.length * lineHeight),
    ),
  };
};

const measureCircuitComponent = (
  node: CircuitComponentNode,
  scene: SceneDocument,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
): CircuitComponentLayout => {
  const resolved = resolveCircuitComponent(
    node,
    measurer,
    resolveCircuitSettings(scene).standard,
    scene.canvas.grid.size,
  );
  const pins: CircuitPinGeometry[] = resolved.pins.map((pin) => {
    const port = addPort(
      ports,
      node.id,
      { kind: "pin", pinId: pin.pinId },
      pin.point,
      pin.normal,
      pin.label,
    );
    return {
      ...port,
      ref: { kind: "pin", pinId: pin.pinId },
      pinId: pin.pinId,
    };
  });
  return {
    nodeId: node.id,
    kind: "circuitComponent",
    frame: resolved.frame,
    bounds: unionCircuitBounds(resolved.frame, resolved.labelFrame),
    ports: pins,
    component: node.component,
    rotation: node.rotation,
    localFrame: node.frame,
    center: resolved.center,
    outline: resolved.outline,
    focusOutline: resolved.focusOutline,
    pins,
    primitives: resolved.primitives,
    labelFrame: resolved.labelFrame,
    label: resolved.label,
  };
};

const measureCircuitJunction = (
  node: CircuitJunctionNode,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
  connected: boolean,
): CircuitJunctionLayout => {
  const resolved = resolveCircuitJunction(node, measurer);
  const port = addPort(
    ports,
    node.id,
    { kind: "center" },
    resolved.center,
    point(1, 0),
    "center",
  );
  const rotation = node.rotation ?? 0;
  const measurementFrame = (() => {
    if (node.measurement === undefined) return undefined;
    const angle = (rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const width = Math.abs(node.frame.width * cos) + Math.abs(node.frame.height * sin);
    const height = Math.abs(node.frame.width * sin) + Math.abs(node.frame.height * cos);
    return rect(
      resolved.center.x - width / 2,
      resolved.center.y - height / 2,
      width,
      height,
    );
  })();
  return {
    nodeId: node.id,
    kind: "circuitJunction",
    frame: node.frame,
    bounds: unionCircuitBounds(measurementFrame ?? node.frame, resolved.labelFrame),
    ports: [port],
    junctionStyle: node.junctionStyle,
    center: resolved.center,
    radius: resolved.radius,
    measurement: node.measurement,
    rotation,
    hitFrame: measurementFrame,
    connected: node.measurement !== undefined ? true : connected,
    labelFrame: resolved.labelFrame,
    label: resolved.label,
  };
};

const measureNode = (
  node: SceneNode,
  scene: SceneDocument,
  measurer: TextMeasurer,
  ports: Map<PortId, PortGeometry>,
): NodeLayout => {
  if (node.kind === "table" || node.kind === "relationAttribute") {
    return measureTable(node, measurer, ports, scene.canvas.grid.size);
  }
  if (node.kind === "lifeline") {
    return measureLifeline(node, measurer, ports);
  }
  if (node.kind === "image") {
    return measureImage(node, measurer, ports);
  }
  if (node.kind === "comment") {
    return measureComment(node, measurer, ports);
  }
  if (node.kind === "circuitComponent") {
    return measureCircuitComponent(node, scene, measurer, ports);
  }
  if (node.kind === "circuitJunction") {
    const connected = Object.values(scene.edges).some(
      (edge) =>
        edge.semantic.family === "circuit" &&
        ((edge.source.target === "node" &&
          edge.source.nodeId === node.id &&
          edge.source.port.kind === "center") ||
          (edge.target.target === "node" &&
            edge.target.nodeId === node.id &&
            edge.target.port.kind === "center")),
    );
    return measureCircuitJunction(node, measurer, ports, connected);
  }
  return measureShape(node, measurer, ports);
};

export const pointOnPolyline = (
  points: readonly Point[],
  t: number,
): { point: Point; tangent: Point } => {
  if (points.length === 0) return { point: point(0, 0), tangent: point(1, 0) };
  if (points.length === 1) return { point: points[0] ?? point(0, 0), tangent: point(1, 0) };

  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const segmentLength = length(sub(points[i] as Point, points[i - 1] as Point));
    lengths.push(segmentLength);
    total += segmentLength;
  }
  if (total <= EPSILON) return { point: points[0] as Point, tangent: point(1, 0) };

  const target = clamp(t, 0, 1) * total;
  let travelled = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const segmentLength = lengths[i] ?? 0;
    if (travelled + segmentLength >= target) {
      const ratio = segmentLength === 0 ? 0 : (target - travelled) / segmentLength;
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      return {
        point: point(a.x + (b.x - a.x) * ratio, a.y + (b.y - a.y) * ratio),
        tangent: normalize(sub(b, a)),
      };
    }
    travelled += segmentLength;
  }
  return { point: points[points.length - 1] as Point, tangent: point(-1, 0) };
};

interface AttachmentResolution {
  point: Point;
  normal: Point;
  portId?: PortId;
}

type PerimeterSide = "north" | "east" | "south" | "west";

interface PerimeterAnchor {
  readonly side: PerimeterSide;
  readonly point: Point;
}

const usedAnchorsByNode = (used: Map<string, PerimeterAnchor[]>, nodeId: string): PerimeterAnchor[] => {
  const found = used.get(nodeId);
  if (found !== undefined) return found;
  const created: PerimeterAnchor[] = [];
  used.set(nodeId, created);
  return created;
};

const perimeterCandidates = (
  frame: Rect,
  other: Point,
  gridSize: number,
  side: PerimeterSide,
  used: readonly PerimeterAnchor[],
): readonly { readonly point: Point; readonly normal: Point; readonly side: PerimeterSide }[] => {
  const inset = Math.min(
    Math.max(6, gridSize),
    Math.max(0, Math.min(frame.width, frame.height) / 2 - 0.5),
  );
  const lowX = frame.x + inset;
  const highX = rectRight(frame) - inset;
  const lowY = frame.y + inset;
  const highY = rectBottom(frame) - inset;
  const horizontalSide = side === "north" || side === "south";
  const center = horizontalSide
    ? Math.min(highX, Math.max(lowX, other.x))
    : Math.min(highY, Math.max(lowY, other.y));
  const low = horizontalSide ? lowX : lowY;
  const high = horizontalSide ? highX : highY;
  const offsets = [0, gridSize, -gridSize, gridSize * 2, -gridSize * 2, gridSize * 3, -gridSize * 3];
  const candidates: { point: Point; normal: Point; side: PerimeterSide }[] = [];
  for (const offset of offsets) {
    const along = Math.min(high, Math.max(low, center + offset));
    const candidatePoint = horizontalSide
      ? side === "north"
        ? point(along, frame.y)
        : point(along, rectBottom(frame))
      : side === "west"
        ? point(frame.x, along)
        : point(rectRight(frame), along);
    if (candidates.some((candidate) => samePoint(candidate.point, candidatePoint))) continue;
    const conflict = used.some(
      (anchor) => anchor.side === side && Math.abs(anchor.point.x - candidatePoint.x) + Math.abs(anchor.point.y - candidatePoint.y) < gridSize,
    );
    if (conflict) continue;
    candidates.push({ point: candidatePoint, normal: compassNormal(side), side });
  }
  return candidates;
};

const adjustPerimeterAttachments = (
  edge: SceneEdge,
  source: AttachmentResolution,
  target: AttachmentResolution,
  nodes: Readonly<Record<string, NodeLayout>>,
  used: Map<string, PerimeterAnchor[]>,
  gridSize: number,
): { readonly source: AttachmentResolution; readonly target: AttachmentResolution } => {
  const sourceNodeId = edge.source.target === "node" ? edge.source.nodeId : undefined;
  const targetNodeId = edge.target.target === "node" ? edge.target.nodeId : undefined;
  const sourceFrame = sourceNodeId === undefined ? undefined : nodes[sourceNodeId]?.frame;
  const targetFrame = targetNodeId === undefined ? undefined : nodes[targetNodeId]?.frame;
  // Ellipses keep their true elliptical anchor. The dynamic rectangle slide is
  // only valid for rectangular shapes; applying it to a use case would pull a
  // perfectly valid ellipse point out onto the bounding rectangle.
  const sourceEllipse = sourceNodeId !== undefined && nodes[sourceNodeId]?.kind === "useCase";
  const targetEllipse = targetNodeId !== undefined && nodes[targetNodeId]?.kind === "useCase";
  const sourceDynamic =
    !sourceEllipse &&
    edge.source.target === "node" &&
    edge.source.port.kind === "perimeter" &&
    sourceFrame !== undefined;
  const targetDynamic =
    !targetEllipse &&
    edge.target.target === "node" &&
    edge.target.port.kind === "perimeter" &&
    targetFrame !== undefined;
  if (!sourceDynamic && !targetDynamic) return { source, target };
  // A unary connector deliberately owns both ends. The waypoint route below
  // decides whether its ends need to re-anchor to another border.
  if (sourceNodeId !== undefined && sourceNodeId === targetNodeId) return { source, target };

  const sourceSide =
    sourceDynamic && edge.source.target === "node" && edge.source.port.kind === "perimeter"
      ? edge.source.port.side
      : null;
  const targetSide =
    targetDynamic && edge.target.target === "node" && edge.target.port.kind === "perimeter"
      ? edge.target.port.side
      : null;
  const waypoints = edge.routing.waypoints;
  const closestWaypoint = (reference: Point): Point | undefined =>
    waypoints.reduce<Point | undefined>((best, waypoint) => {
      if (best === undefined) return waypoint.point;
      const bestDistance = Math.hypot(best.x - reference.x, best.y - reference.y);
      const nextDistance = Math.hypot(
        waypoint.point.x - reference.x,
        waypoint.point.y - reference.y,
      );
      return nextDistance < bestDistance ? waypoint.point : best;
    }, undefined);
  const sourceWaypoint = closestWaypoint(source.point);
  const targetWaypoint = closestWaypoint(target.point);
  const sourceReference = sourceWaypoint ?? target.point;
  const targetReference = targetWaypoint ?? source.point;
  const horizontalFacing =
    (sourceSide === "east" && targetSide === "west") ||
    (sourceSide === "west" && targetSide === "east");
  const verticalFacing =
    (sourceSide === "south" && targetSide === "north") ||
    (sourceSide === "north" && targetSide === "south");
  if (
    waypoints.length === 0 &&
    sourceFrame !== undefined &&
    targetFrame !== undefined &&
    (horizontalFacing || verticalFacing)
  ) {
    const horizontal = horizontalFacing;
    const gapFacing = horizontal
      ? sourceSide === "east"
        ? targetFrame.x >= rectRight(sourceFrame) - EPSILON
        : rectRight(targetFrame) <= sourceFrame.x + EPSILON
      : sourceSide === "south"
        ? targetFrame.y >= rectBottom(sourceFrame) - EPSILON
        : rectBottom(targetFrame) <= sourceFrame.y + EPSILON;
    if (gapFacing) {
      const insetFor = (frame: Rect): number =>
        Math.min(
          Math.max(6, gridSize),
          Math.max(0, Math.min(frame.width, frame.height) / 2 - 0.5),
        );
      const sourceInset = insetFor(sourceFrame);
      const targetInset = insetFor(targetFrame);
      const sourceLow = horizontal ? sourceFrame.y + sourceInset : sourceFrame.x + sourceInset;
      const sourceHigh = horizontal
        ? rectBottom(sourceFrame) - sourceInset
        : rectRight(sourceFrame) - sourceInset;
      const targetLow = horizontal ? targetFrame.y + targetInset : targetFrame.x + targetInset;
      const targetHigh = horizontal
        ? rectBottom(targetFrame) - targetInset
        : rectRight(targetFrame) - targetInset;
      const low = Math.max(sourceLow, targetLow);
      const high = Math.min(sourceHigh, targetHigh);
      if (low <= high + EPSILON) {
        const grid = Math.max(1, gridSize);
        const preferred = edge.routing.preferredPosition;
        const base = typeof preferred === "number" && Number.isFinite(preferred)
          ? Math.min(high, Math.max(low, preferred))
          : (low + high) / 2;
        const sourceUsed = usedAnchorsByNode(used, sourceNodeId as string);
        const targetUsed = usedAnchorsByNode(used, targetNodeId as string);
        const conflicts = (anchors: readonly PerimeterAnchor[], side: string, value: number): boolean =>
          anchors.some(
            (anchor) =>
              anchor.side === side &&
              Math.abs((horizontal ? anchor.point.y : anchor.point.x) - value) < grid,
          );
        const candidates = [0, grid, -grid, grid * 2, -grid * 2, grid * 3, -grid * 3]
          .map((offset) => Math.min(high, Math.max(low, base + offset)))
          .filter((value, index, values) =>
            values.findIndex((other) => Math.abs(other - value) <= EPSILON) === index);
        const coordinate = candidates.find(
          (value) =>
            !conflicts(sourceUsed, sourceSide as string, value) &&
            !conflicts(targetUsed, targetSide as string, value),
        ) ?? base;
        const sourcePoint = horizontal
          ? point(
              sourceSide === "east" ? rectRight(sourceFrame) : sourceFrame.x,
              coordinate,
            )
          : point(
              coordinate,
              sourceSide === "south" ? rectBottom(sourceFrame) : sourceFrame.y,
            );
        const targetPoint = horizontal
          ? point(
              targetSide === "west" ? targetFrame.x : rectRight(targetFrame),
              coordinate,
            )
          : point(
              coordinate,
              targetSide === "north" ? targetFrame.y : rectBottom(targetFrame),
            );
        sourceUsed.push({ side: sourceSide as PerimeterSide, point: sourcePoint });
        targetUsed.push({ side: targetSide as PerimeterSide, point: targetPoint });
        return {
          source: {
            ...source,
            point: sourcePoint,
            normal: compassNormal(sourceSide as PerimeterSide),
          },
          target: {
            ...target,
            point: targetPoint,
            normal: compassNormal(targetSide as PerimeterSide),
          },
        };
      }
    }
  }

  const sourceCandidates = sourceDynamic && sourceFrame !== undefined
    ? (["north", "east", "south", "west"] as const).flatMap((side) =>
        perimeterCandidates(
          sourceFrame,
          sourceReference,
          gridSize,
          side,
          usedAnchorsByNode(used, sourceNodeId as string),
        ),
      )
    : [{ point: source.point, normal: source.normal, side: "east" as const }];
  const targetCandidates = targetDynamic && targetFrame !== undefined
    ? (["north", "east", "south", "west"] as const).flatMap((side) =>
        perimeterCandidates(
          targetFrame,
          targetReference,
          gridSize,
          side,
          usedAnchorsByNode(used, targetNodeId as string),
        ),
      )
    : [{ point: target.point, normal: target.normal, side: "west" as const }];
  if (sourceCandidates.length === 0 || targetCandidates.length === 0) {
    return { source, target };
  }

  const stubLength = Math.max(0, edge.routing.stubLength);
  let best: {
    readonly source: AttachmentResolution;
    readonly target: AttachmentResolution;
    readonly score: number;
  } | null = null;
  for (const sourceCandidate of sourceCandidates) {
    const sourceStub = add(sourceCandidate.point, scale(sourceCandidate.normal, stubLength));
    for (const targetCandidate of targetCandidates) {
      const targetStub = add(targetCandidate.point, scale(targetCandidate.normal, stubLength));
      const distance = waypoints.length === 0
        ? Math.abs(sourceStub.x - targetStub.x) + Math.abs(sourceStub.y - targetStub.y)
        : Math.abs(sourceStub.x - sourceReference.x) +
          Math.abs(sourceStub.y - sourceReference.y) +
          Math.abs(targetReference.x - targetStub.x) +
          Math.abs(targetReference.y - targetStub.y);
      const sourceToward =
        (sourceReference.x - sourceCandidate.point.x) * sourceCandidate.normal.x +
        (sourceReference.y - sourceCandidate.point.y) * sourceCandidate.normal.y;
      const targetToward =
        (targetReference.x - targetCandidate.point.x) * targetCandidate.normal.x +
        (targetReference.y - targetCandidate.point.y) * targetCandidate.normal.y;
      const sourceHorizontal = directionIsHorizontal(sourceCandidate.normal);
      const targetHorizontal = directionIsHorizontal(targetCandidate.normal);
      const bendCost =
        (sourceToward < 0 ? 42 : 0) +
        (targetToward < 0 ? 42 : 0) +
        (sourceHorizontal === targetHorizontal ? 0 : 18);
      const score = distance + bendCost;
      if (best === null || score < best.score) {
        best = {
          source: { ...source, point: sourceCandidate.point, normal: sourceCandidate.normal },
          target: { ...target, point: targetCandidate.point, normal: targetCandidate.normal },
          score,
        };
      }
    }
  }
  if (best === null) return { source, target };
  if (sourceDynamic && sourceNodeId !== undefined) {
    usedAnchorsByNode(used, sourceNodeId as string).push({
      side: sourceCandidates.find((candidate) => samePoint(candidate.point, best.source.point))?.side ?? "east",
      point: best.source.point,
    });
  }
  if (targetDynamic && targetNodeId !== undefined) {
    usedAnchorsByNode(used, targetNodeId as string).push({
      side: targetCandidates.find((candidate) => samePoint(candidate.point, best.target.point))?.side ?? "west",
      point: best.target.point,
    });
  }
  return { source: best.source, target: best.target };
};

const pointOnShapeAtAngle = (node: SceneNode, angleDeg: number): { point: Point; normal: Point } => {
  const frame = node.frame;
  const center = rectCenter(frame);
  const angle = (angleDeg * Math.PI) / 180;
  if (node.kind === "useCase") {
    const rx = Math.max(1, frame.width / 2);
    const ry = Math.max(1, frame.height / 2);
    return {
      point: point(center.x + rx * Math.cos(angle), center.y + ry * Math.sin(angle)),
      normal: normalize(point(Math.cos(angle) / rx, Math.sin(angle) / ry)),
    };
  }
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = Math.abs(dx) < EPSILON ? Number.POSITIVE_INFINITY : frame.width / 2 / Math.abs(dx);
  const ty = Math.abs(dy) < EPSILON ? Number.POSITIVE_INFINITY : frame.height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return {
    point: point(center.x + dx * t, center.y + dy * t),
    normal: normalize(point(dx, dy)),
  };
};

const resolveAttachment = (
  scene: SceneDocument,
  nodes: Readonly<Record<string, NodeLayout>>,
  ports: Readonly<Record<string, PortGeometry>>,
  computed: ReadonlyMap<string, EdgeLayout>,
  attachment: EdgeAttachment,
): AttachmentResolution | null => {
  if (attachment.target === "free") {
    return { point: attachment.point, normal: point(0, -1) };
  }

  if (attachment.target === "edge") {
    const parent = computed.get(attachment.edgeId);
    if (parent === undefined) return null;
    const hit = pointOnPolyline(parent.points, attachment.t);
    return {
      point: hit.point,
      normal: point(-hit.tangent.y, hit.tangent.x),
    };
  }

  const node = scene.nodes[attachment.nodeId];
  const nodeLayout = nodes[attachment.nodeId];
  if (node === undefined || nodeLayout === undefined) return null;

  const portRef = attachment.port;
  if (portRef.kind === "spine") {
    if (nodeLayout.kind !== "lifeline") {
      return { point: rectCenter(nodeLayout.frame), normal: point(1, 0) };
    }
    const from = nodeLayout.spine.from;
    const to = nodeLayout.spine.to;
    return {
      point: point(from.x, from.y + (to.y - from.y) * clamp(portRef.t, 0, 1)),
      normal: point(1, 0),
    };
  }

  if (portRef.kind === "angle") {
    const hit = pointOnShapeAtAngle(node, portRef.angle);
    return {
      ...hit,
      portId: asPortId(portKey(attachment.nodeId, portRef)),
    };
  }

  const key = portKey(attachment.nodeId, portRef);
  const found = ports[key];
  if (found !== undefined) {
    return { point: found.point, normal: found.normal, portId: found.id };
  }

  if (portRef.kind === "pin" || portRef.kind === "center") {
    return null;
  }

  if (portRef.kind === "row") {
    if (!isTableLikeNode(node)) return null;
    const row = findRow(node, portRef.rowId);
    if (row === undefined) return null;
    const rowLayout = nodeLayout.kind === "table" || nodeLayout.kind === "relationAttribute"
      ? nodeLayout.sections.flatMap((section) => section.rows).find((band) => band.rowId === portRef.rowId)
      : undefined;
    if (rowLayout === undefined) return null;
    return {
      point: point(portRef.side === "west" ? nodeLayout.frame.x : rectRight(nodeLayout.frame), rectCenter(rowLayout.frame).y),
      normal: point(portRef.side === "west" ? -1 : 1, 0),
    };
  }

  return {
    point: compassPoint(nodeLayout.frame, portRef.side),
    normal: compassNormal(portRef.side),
  };
};

const directionIsHorizontal = (normal: Point): boolean => Math.abs(normal.x) >= Math.abs(normal.y);

const simplifyPoints = (input: readonly Point[]): readonly Point[] => {
  const deduped: Point[] = [];
  for (const p of input) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || !samePoint(last, p)) deduped.push(p);
  }
  if (deduped.length < 3) return deduped;
  const result: Point[] = [deduped[0] as Point];
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const a = result[result.length - 1] as Point;
    const b = deduped[i] as Point;
    const c = deduped[i + 1] as Point;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    // A collinear point is removable only when the path keeps going forward.
    // A reversal (U-turn) must stay, otherwise a manual waypoint could be
    // simplified out of existence.
    if (Math.abs(cross) > EPSILON || dot < -EPSILON) result.push(b);
  }
  result.push(deduped[deduped.length - 1] as Point);
  return result;
};

const segmentEntersRect = (a: Point, b: Point, r: Rect): boolean => {
  const right = rectRight(r);
  const bottom = rectBottom(r);
  if (Math.abs(a.y - b.y) <= EPSILON) {
    if (a.y <= r.y + EPSILON || a.y >= bottom - EPSILON) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return maxX > r.x + EPSILON && minX < right - EPSILON;
  }
  if (Math.abs(a.x - b.x) <= EPSILON) {
    if (a.x <= r.x + EPSILON || a.x >= right - EPSILON) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxY > r.y + EPSILON && minY < bottom - EPSILON;
  }
  return false;
};

const polylineEntersObstacles = (
  points: readonly Point[],
  obstacles: readonly Rect[],
): boolean => {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    if (obstacles.some((obstacle) => segmentEntersRect(a, b, obstacle))) return true;
  }
  return false;
};

const polylineLength = (points: readonly Point[]): number => {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += length(sub(points[index] as Point, points[index - 1] as Point));
  }
  return total;
};

/**
 * Endpoint-node escape route.
 *
 * The basic orthogonal preview is allowed to double back across its own
 * source/target node (for example an east-facing relation-attribute port when
 * the partner line sits to the west). That draws a segment under the table.
 * When that happens, route through a corridor outside the endpoint frames
 * instead. Global obstacle avoidance is still Step 3; this only protects the
 * two nodes that own the ports.
 */
const detourAroundObstacles = (
  source: AttachmentResolution,
  target: AttachmentResolution,
  routing: EdgeRouting,
  endpointObstacles: readonly Rect[],
  collisionObstacles: readonly Rect[],
): readonly Point[] | null => {
  const union = unionRects(endpointObstacles);
  if (union === null) return null;
  const stub = Math.max(0, routing.stubLength);
  const s = add(source.point, scale(source.normal, stub));
  const t = add(target.point, scale(target.normal, stub));
  const margin = Math.max(3, routing.obstaclePadding, stub);
  const corridors = [
    { axis: "y" as const, value: union.y - margin },
    { axis: "y" as const, value: rectBottom(union) + margin },
    { axis: "x" as const, value: union.x - margin },
    { axis: "x" as const, value: rectRight(union) + margin },
  ];
  let best: readonly Point[] | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (const corridor of corridors) {
    const points = corridor.axis === "y"
      ? simplifyPoints([
          source.point,
          s,
          point(s.x, corridor.value),
          point(t.x, corridor.value),
          t,
          target.point,
        ])
      : simplifyPoints([
          source.point,
          s,
          point(corridor.value, s.y),
          point(corridor.value, t.y),
          t,
          target.point,
        ]);
    if (polylineEntersObstacles(points, collisionObstacles)) continue;
    const candidateLength = polylineLength(points);
    if (candidateLength < bestLength) {
      best = points;
      bestLength = candidateLength;
    }
  }
  return best;
};

const orthogonalRoute = (
  source: AttachmentResolution,
  target: AttachmentResolution,
  routing: EdgeRouting,
  endpointObstacles: readonly Rect[] = [],
  collisionObstacles: readonly Rect[] = endpointObstacles,
): readonly Point[] => {
  const stub = Math.max(0, routing.stubLength);
  const s = add(source.point, scale(source.normal, stub));
  const t = add(target.point, scale(target.normal, stub));
  const points: Point[] = [source.point, s];
  const sourceHorizontal = directionIsHorizontal(source.normal);
  const targetHorizontal = directionIsHorizontal(target.normal);

  if (sourceHorizontal && targetHorizontal) {
    const midX = (s.x + t.x) / 2;
    if (!samePoint(point(midX, s.y), s)) points.push(point(midX, s.y));
    if (!samePoint(point(midX, t.y), point(midX, s.y))) points.push(point(midX, t.y));
  } else if (!sourceHorizontal && !targetHorizontal) {
    const midY = (s.y + t.y) / 2;
    if (!samePoint(point(s.x, midY), s)) points.push(point(s.x, midY));
    if (!samePoint(point(t.x, midY), point(s.x, midY))) points.push(point(t.x, midY));
  } else {
    const corner = sourceHorizontal ? point(t.x, s.y) : point(s.x, t.y);
    if (!samePoint(corner, s)) points.push(corner);
  }

  points.push(t, target.point);
  const simplified = simplifyPoints(points);
  if (endpointObstacles.length === 0 || !polylineEntersObstacles(simplified, endpointObstacles)) {
    return simplified;
  }
  return detourAroundObstacles(
    source,
    target,
    routing,
    endpointObstacles,
    collisionObstacles,
  ) ?? simplified;
};

/* ------------------------------------------------------------------------- */
/* Unary / self connectors                                                    */
/* ------------------------------------------------------------------------- */

type LoopSide = "north" | "east" | "south" | "west";

/** Clockwise ring order; screen coordinates grow down, so N → E → S → W. */
const LOOP_SIDES: readonly LoopSide[] = ["north", "east", "south", "west"];

const loopSideOf = (normal: Point): LoopSide =>
  Math.abs(normal.x) >= Math.abs(normal.y)
    ? normal.x >= 0 ? "east" : "west"
    : normal.y >= 0 ? "south" : "north";

const ringAlong = (side: LoopSide, p: Point): number =>
  side === "north" || side === "south" ? p.x : p.y;

/** Point on the outward offset ring, level with `along` on the given side. */
const ringPointAt = (
  frame: Rect,
  side: LoopSide,
  along: number,
  margin: number,
): Point => {
  if (side === "north") return point(along, frame.y - margin);
  if (side === "south") return point(along, rectBottom(frame) + margin);
  if (side === "east") return point(rectRight(frame) + margin, along);
  return point(frame.x - margin, along);
};

/** Ring corner at the clockwise start or end of a side. */
const ringCorner = (
  frame: Rect,
  side: LoopSide,
  end: boolean,
  margin: number,
): Point => {
  const left = frame.x - margin;
  const right = rectRight(frame) + margin;
  const top = frame.y - margin;
  const bottom = rectBottom(frame) + margin;
  if (side === "north") return end ? point(right, top) : point(left, top);
  if (side === "east") return end ? point(right, bottom) : point(right, top);
  if (side === "south") return end ? point(left, bottom) : point(right, bottom);
  return end ? point(left, top) : point(left, bottom);
};

/** Is the target coordinate ahead of the source coordinate in ring order? */
const ringAhead = (side: LoopSide, from: number, to: number): boolean =>
  side === "north" || side === "east" ? to >= from : to <= from;

/** Points travelling clockwise along the outside ring between two side points. */
const cwRingPath = (
  frame: Rect,
  fromSide: LoopSide,
  fromAlong: number,
  toSide: LoopSide,
  toAlong: number,
  margin: number,
): readonly Point[] => {
  const start = ringPointAt(frame, fromSide, fromAlong, margin);
  const end = ringPointAt(frame, toSide, toAlong, margin);
  if (
    fromSide === toSide &&
    Math.abs(toAlong - fromAlong) > EPSILON &&
    ringAhead(fromSide, fromAlong, toAlong)
  ) {
    return [start, end];
  }
  const points: Point[] = [start, ringCorner(frame, fromSide, true, margin)];
  let index = (LOOP_SIDES.indexOf(fromSide) + 1) % LOOP_SIDES.length;
  const targetIndex = LOOP_SIDES.indexOf(toSide);
  for (let guard = 0; guard < LOOP_SIDES.length && index !== targetIndex; guard += 1) {
    points.push(ringCorner(frame, LOOP_SIDES[index] as LoopSide, false, margin));
    index = (index + 1) % LOOP_SIDES.length;
  }
  points.push(ringCorner(frame, toSide, false, margin), end);
  return points;
};

/** An attachment replacement used only while routing a unary waypoint path. */
interface SelfAnchor {
  readonly point: Point;
  readonly normal: Point;
  readonly side?: LoopSide;
  /** Parameter angle for an elliptical (use-case) anchor. */
  readonly angle?: number;
}

const borderInset = (frame: Rect, gridSize: number): number =>
  Math.min(
    Math.max(6, gridSize),
    Math.max(0, Math.min(frame.width, frame.height) / 2 - 0.5),
  );

const ellipseSelfAnchor = (frame: Rect, toward: Point): SelfAnchor => {
  const center = rectCenter(frame);
  const rx = Math.max(1, frame.width / 2);
  const ry = Math.max(1, frame.height / 2);
  const theta = Math.atan2((toward.y - center.y) / ry, (toward.x - center.x) / rx);
  return {
    point: point(center.x + rx * Math.cos(theta), center.y + ry * Math.sin(theta)),
    normal: normalize(point(Math.cos(theta) / rx, Math.sin(theta) / ry)),
    angle: theta,
  };
};

/** Nearest border point to a waypoint, mirroring binary connector snapping. */
const nearestSelfAnchor = (
  node: NodeLayout,
  toward: Point,
  gridSize: number,
): SelfAnchor => {
  const frame = node.frame;
  if (node.kind === "useCase") return ellipseSelfAnchor(frame, toward);
  const inset = borderInset(frame, gridSize);
  const left = frame.x + inset;
  const right = rectRight(frame) - inset;
  const top = frame.y + inset;
  const bottom = rectBottom(frame) - inset;
  const candidates: readonly SelfAnchor[] = [
    { side: "north", point: point(clamp(toward.x, left, right), frame.y), normal: compassNormal("north") },
    { side: "east", point: point(rectRight(frame), clamp(toward.y, top, bottom)), normal: compassNormal("east") },
    { side: "south", point: point(clamp(toward.x, left, right), rectBottom(frame)), normal: compassNormal("south") },
    { side: "west", point: point(frame.x, clamp(toward.y, top, bottom)), normal: compassNormal("west") },
  ];
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.hypot(best.point.x - toward.x, best.point.y - toward.y);
    const candidateDistance = Math.hypot(candidate.point.x - toward.x, candidate.point.y - toward.y);
    return candidateDistance < bestDistance ? candidate : best;
  });
};

const shiftSelfAnchor = (
  node: NodeLayout,
  anchor: SelfAnchor,
  awayFrom: Point,
  gridSize: number,
): SelfAnchor => {
  if (anchor.side === undefined) {
    if (anchor.angle === undefined) return anchor;
    const frame = node.frame;
    const center = rectCenter(frame);
    const rx = Math.max(1, frame.width / 2);
    const ry = Math.max(1, frame.height / 2);
    const awayAngle = Math.atan2(
      (awayFrom.y - center.y) / ry,
      (awayFrom.x - center.x) / rx,
    );
    const difference = Math.atan2(
      Math.sin(anchor.angle - awayAngle),
      Math.cos(anchor.angle - awayAngle),
    );
    const delta = Math.min(
      Math.PI / 2,
      Math.max(0.12, gridSize / Math.max(1, Math.min(rx, ry))),
    );
    const angle = anchor.angle + (difference >= 0 ? 1 : -1) * delta;
    return {
      point: point(center.x + rx * Math.cos(angle), center.y + ry * Math.sin(angle)),
      normal: normalize(point(Math.cos(angle) / rx, Math.sin(angle) / ry)),
      angle,
    };
  }
  const frame = node.frame;
  const inset = borderInset(frame, gridSize);
  const horizontal = anchor.side === "north" || anchor.side === "south";
  const low = horizontal ? frame.x + inset : frame.y + inset;
  const high = horizontal ? rectRight(frame) - inset : rectBottom(frame) - inset;
  const along = horizontal ? anchor.point.x : anchor.point.y;
  const reference = horizontal ? awayFrom.x : awayFrom.y;
  const direction = along >= reference ? 1 : -1;
  let next = clamp(along + direction * Math.max(1, gridSize), low, high);
  if (Math.abs(next - along) <= EPSILON) {
    next = clamp(along - direction * Math.max(1, gridSize), low, high);
  }
  return {
    ...anchor,
    point: horizontal
      ? point(next, anchor.point.y)
      : point(anchor.point.x, next),
  };
};

const distinctSelfAnchors = (
  node: NodeLayout,
  source: SelfAnchor,
  target: SelfAnchor,
  gridSize: number,
): { readonly source: SelfAnchor; readonly target: SelfAnchor } => {
  const separated = (a: SelfAnchor, b: SelfAnchor): boolean =>
    Math.abs(a.point.x - b.point.x) + Math.abs(a.point.y - b.point.y) >= Math.max(1, gridSize);
  if (separated(source, target)) return { source, target };
  const shiftedTarget = shiftSelfAnchor(node, target, source.point, gridSize);
  if (separated(source, shiftedTarget)) return { source, target: shiftedTarget };
  return { source: shiftSelfAnchor(node, source, target.point, gridSize), target };
};

const polylineCrossingCount = (points: readonly Point[], obstacle: Rect): number => {
  let count = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    if (segmentEntersRect(a, b, obstacle)) count += 1;
  }
  return count;
};

/** Total length travelled backwards over the previous segment (U-turns). */
const polylineBacktrackLength = (points: readonly Point[]): number => {
  let total = 0;
  for (let index = 2; index < points.length; index += 1) {
    const a = points[index - 2] as Point;
    const b = points[index - 1] as Point;
    const c = points[index] as Point;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    if (abx * bcx + aby * bcy < -EPSILON) {
      total += Math.hypot(bcx, bcy);
    }
  }
  return total;
};

/**
 * Manual waypoint route for a unary connector. Normally the chosen ports are
 * kept, but once a routing point pulls the line across its own node, that end
 * re-anchors to the border nearest the waypoint, exactly like the dynamic
 * perimeter snapping of a binary connector.
 */
const selfWaypointRoute = (
  source: AttachmentResolution,
  target: AttachmentResolution,
  node: NodeLayout,
  routing: EdgeRouting,
  waypoints: readonly Point[],
  gridSize: number,
): { readonly points: readonly Point[]; readonly routedBy: EdgeLayout["routedBy"] } => {
  if (node.kind === "lifeline") {
    return {
      points: routeThroughWaypoints(source, target, routing, waypoints),
      routedBy: "polyline",
    };
  }
  const frame = node.frame;
  const original = routeThroughWaypoints(source, target, routing, waypoints, frame);
  const originalCrossings = polylineCrossingCount(original, frame);
  // Keep the chosen ports while a single routing point nudges the automatic
  // loop. Two or more routing points define a manual shape, so evaluate the
  // nearest-border anchors even when the direct route is already clean;
  // backtracking or a crossing always forces that comparison.
  const forceAnchors = waypoints.length >= 2;
  const originalBacktrack = polylineBacktrackLength(original);
  if (!forceAnchors && originalCrossings === 0 && originalBacktrack <= EPSILON) {
    return { points: original, routedBy: "polyline" };
  }

  const first = waypoints[0] ?? rectCenter(frame);
  const last = waypoints[waypoints.length - 1] ?? rectCenter(frame);
  const anchors = distinctSelfAnchors(
    node,
    nearestSelfAnchor(node, first, gridSize),
    nearestSelfAnchor(node, last, gridSize),
    gridSize,
  );
  const candidates: readonly {
    readonly source: AttachmentResolution;
    readonly target: AttachmentResolution;
  }[] = [
    { source: anchors.source, target: anchors.target },
    { source: anchors.source, target },
    { source, target: anchors.target },
  ];
  let best = original;
  let bestScore = originalCrossings * 100_000 +
    polylineBacktrackLength(original) * 4 +
    polylineLength(original);
  for (const candidate of candidates) {
    const route = routeThroughWaypoints(
      candidate.source,
      candidate.target,
      routing,
      waypoints,
      frame,
    );
    const score = polylineCrossingCount(route, frame) * 100_000 +
      polylineBacktrackLength(route) * 4 +
      polylineLength(route);
    if (score < bestScore) {
      best = route;
      bestScore = score;
    }
  }
  return { points: best, routedBy: "polyline" };
};

/**
 * Both ends of a unary connector live on the same node. The generic router
 * would have to cut through that node, so draw an outside loop instead: leave
 * each port along its normal, travel around a rectangular ring offset from the
 * node, and re-enter at the other port. The shorter clockwise/counter-clockwise
 * direction wins, which produces the usual bracket for two ports on one side
 * and a corner-wrapping loop for neighbouring sides.
 */
const selfLoopRoute = (
  source: AttachmentResolution,
  target: AttachmentResolution,
  node: NodeLayout,
  routing: EdgeRouting,
  scene: SceneDocument,
  obstacles: readonly Rect[],
): { readonly points: readonly Point[]; readonly routedBy: EdgeLayout["routedBy"] } => {
  const grid = Math.max(1, scene.canvas.grid.size);
  const base = Math.max(
    2 * grid,
    Math.max(0, routing.stubLength) + Math.max(0, routing.obstaclePadding),
  );

  // Manual routing points win over the automatic outside ring. This mirrors a
  // normal connector: the endpoints keep their normal stubs and the line is
  // built orthogonally through each waypoint; crossing the node re-anchors the
  // affected end to the nearest border.
  if (routing.waypoints.length > 0) {
    return selfWaypointRoute(
      source,
      target,
      node,
      routing,
      routing.waypoints.map((waypoint) => waypoint.point),
      grid,
    );
  }

  if (node.kind === "lifeline") {
    // Sequence self message: leave the spine, run parallel to it and return.
    const x = node.spine.from.x + base;
    const y1 = source.point.y;
    const y2 = target.point.y;
    const points = Math.abs(y1 - y2) <= EPSILON
      ? simplifyPoints([
          source.point,
          point(x, y1),
          point(x, y1 - base),
          point(node.spine.from.x, y1 - base),
          target.point,
        ])
      : simplifyPoints([source.point, point(x, y1), point(x, y2), target.point]);
    return { points, routedBy: "orthogonal" };
  }

  const build = (margin: number): readonly Point[] => {
    const fromSide = loopSideOf(source.normal);
    const toSide = loopSideOf(target.normal);
    const fromAlong = ringAlong(fromSide, source.point);
    const toAlong = ringAlong(toSide, target.point);

    if (fromSide === toSide && Math.abs(toAlong - fromAlong) <= EPSILON) {
      // The two ends coincide (for example after a manual reattachment). A
      // small bracket leaves along the port normal, steps sideways and comes
      // straight back; using the port's own axes keeps even an ellipse end
      // orthogonal.
      const normal = source.normal;
      const tangent = point(-normal.y, normal.x);
      const center = rectCenter(node.frame);
      const away =
        tangent.x * (source.point.x - center.x) +
          tangent.y * (source.point.y - center.y) >=
        0
          ? 1
          : -1;
      const out = add(source.point, scale(normal, margin));
      const beside = add(out, scale(tangent, margin * away));
      const back = add(source.point, scale(tangent, margin * away));
      return simplifyPoints([source.point, out, beside, back, target.point]);
    }

    const clockwise = cwRingPath(
      node.frame,
      fromSide,
      fromAlong,
      toSide,
      toAlong,
      margin,
    );
    const counter = [...cwRingPath(
      node.frame,
      toSide,
      toAlong,
      fromSide,
      fromAlong,
      margin,
    )].reverse();
    const chosen = polylineLength(clockwise) <= polylineLength(counter)
      ? clockwise
      : counter;
    return simplifyPoints([source.point, ...chosen, target.point]);
  };

  // Grow the loop when another object sits immediately beside the node; the
  // first collision-free ring keeps the connector readable.
  let fallback: readonly Point[] | null = null;
  for (const factor of [1, 2, 3]) {
    const candidate = build(base * factor);
    if (fallback === null) fallback = candidate;
    if (!polylineEntersObstacles(candidate, obstacles)) {
      return { points: candidate, routedBy: "orthogonal" };
    }
  }
  return { points: fallback ?? build(base), routedBy: "orthogonal" };
};


const routeThroughWaypoints = (
  source: AttachmentResolution,
  target: AttachmentResolution,
  routing: SceneEdge["routing"],
  waypoints: readonly Point[],
  /** Rect the route should stay out of (the unary connector's own node). */
  avoid?: Rect,
): readonly Point[] => {
  const stub = Math.max(0, routing.stubLength);
  const s = add(source.point, scale(source.normal, stub));
  const t = add(target.point, scale(target.normal, stub));
  const points: Point[] = [source.point, s];
  let cursor = s;

  const lastDirection = (): { readonly axis: "x" | "y"; readonly sign: number } | null => {
    for (let index = points.length - 1; index > 0; index -= 1) {
      const b = points[index] as Point;
      const a = points[index - 1] as Point;
      if (samePoint(a, b)) continue;
      if (Math.abs(a.y - b.y) <= EPSILON) {
        return { axis: "x", sign: Math.sign(b.x - a.x) };
      }
      if (Math.abs(a.x - b.x) <= EPSILON) {
        return { axis: "y", sign: Math.sign(b.y - a.y) };
      }
      return null;
    }
    return null;
  };

  /**
   * Prefer the elbow that stays outside the node and does not immediately
   * reverse the previous segment. Both L-shaped elbows have the same length,
   * so this choice is what keeps a unary route tidy around the object.
   */
  const elbowScore = (
    from: Point,
    elbow: Point,
    next: Point,
  ): number => {
    let score = 0;
    const segments: [Point, Point][] = [];
    if (!samePoint(from, elbow)) segments.push([from, elbow]);
    if (!samePoint(elbow, next)) segments.push([elbow, next]);
    if (avoid !== undefined) {
      for (const [a, b] of segments) {
        if (segmentEntersRect(a, b, avoid)) score += 10_000;
      }
    }
    const direction = lastDirection();
    if (direction !== null) {
      const firstDirection = (() => {
        for (const [a, b] of segments) {
          if (Math.abs(a.y - b.y) <= EPSILON) {
            return { axis: "x" as const, sign: Math.sign(b.x - a.x) };
          }
          if (Math.abs(a.x - b.x) <= EPSILON) {
            return { axis: "y" as const, sign: Math.sign(b.y - a.y) };
          }
        }
        return null;
      })();
      if (firstDirection !== null) {
        if (firstDirection.sign !== 0 && firstDirection.sign === -direction.sign && firstDirection.axis === direction.axis) {
          score += 200;
        } else if (firstDirection.axis !== direction.axis) {
          // Prefer continuing the current run before turning; it keeps the
          // manual route close to the automatic corner loop.
          score += 4;
        }
      }
    }
    return score;
  };

  const chooseElbow = (from: Point, next: Point, preferred: Point, alternate: Point): Point => {
    if (avoid === undefined) return preferred;
    const preferredScore = elbowScore(from, preferred, next);
    const alternateScore = elbowScore(from, alternate, next);
    return alternateScore + EPSILON < preferredScore ? alternate : preferred;
  };

  for (const waypoint of waypoints) {
    // Keep manual points as orthogonal constraints: if the point is not
    // already on the current row/column, insert one elbow before it.
    if (
      Math.abs(cursor.x - waypoint.x) > EPSILON &&
      Math.abs(cursor.y - waypoint.y) > EPSILON
    ) {
      const elbow = chooseElbow(
        cursor,
        waypoint,
        point(waypoint.x, cursor.y),
        point(cursor.x, waypoint.y),
      );
      points.push(elbow);
    }
    points.push(waypoint);
    cursor = waypoint;
  }
  if (Math.abs(cursor.x - t.x) > EPSILON && Math.abs(cursor.y - t.y) > EPSILON) {
    const horizontalNormal = directionIsHorizontal(target.normal);
    points.push(
      chooseElbow(
        cursor,
        t,
        horizontalNormal ? point(t.x, cursor.y) : point(cursor.x, t.y),
        horizontalNormal ? point(cursor.x, t.y) : point(t.x, cursor.y),
      ),
    );
  }
  points.push(t, target.point);
  return simplifyPoints(points);
};

const routeEdge = (
  edge: SceneEdge,
  source: AttachmentResolution,
  target: AttachmentResolution,
  endpointObstacles: readonly Rect[],
  collisionObstacles: readonly Rect[],
): { readonly points: readonly Point[]; readonly routedBy: EdgeLayout["routedBy"] } => {
  // Sequence messages are time-axis geometry, not a routed graph edge. Ignore
  // any legacy/edited routing flag so an A* detour can never replace the
  // straight message line.
  if (edge.semantic.family === "sequence") {
    return {
      points: simplifyPoints([source.point, target.point]),
      routedBy: "straight",
    };
  }
  if (edge.routing.waypoints.length > 0) {
    return {
      points: routeThroughWaypoints(
        source,
        target,
        edge.routing,
        edge.routing.waypoints.map((waypoint) => waypoint.point),
      ),
      routedBy: "polyline",
    };
  }
  if (edge.routing.mode === "straight" || edge.routing.mode === "bezier") {
    return {
      points: simplifyPoints([source.point, target.point]),
      routedBy: edge.routing.mode,
    };
  }
  if (edge.routing.mode === "polyline") {
    const waypoints = edge.routing.waypoints.map((waypoint) => waypoint.point);
    return {
      points: simplifyPoints([source.point, ...waypoints, target.point]),
      routedBy: "polyline",
    };
  }

  if (edge.routing.avoidObstacles) {
    const result = routeOrthogonalAStar({
      source: source.point,
      sourceNormal: source.normal,
      target: target.point,
      targetNormal: target.normal,
      obstacles: collisionObstacles,
      padding: Math.max(0, edge.routing.obstaclePadding),
      stubLength: Math.max(0, edge.routing.stubLength),
    });
    if (result.found) {
      const astarPoints = simplifyPoints(result.points);
      if (!polylineEntersObstacles(astarPoints, collisionObstacles)) {
        // A* can return an equal-length route with more corners (equal-cost
        // states are common when start/end align with obstacle edges). Prefer
        // the simpler preview route when it is collision-free and no longer.
        const preview = orthogonalRoute(source, target, edge.routing, endpointObstacles, collisionObstacles);
        const previewValid = !polylineEntersObstacles(preview, collisionObstacles);
        const astarBends = Math.max(0, astarPoints.length - 2);
        const previewBends = Math.max(0, preview.length - 2);
        if (
          previewValid &&
          previewBends < astarBends
        ) {
          return { points: preview, routedBy: "orthogonal" };
        }
        return { points: astarPoints, routedBy: "astar" };
      }
    }
  }

  return {
    points: orthogonalRoute(source, target, edge.routing, endpointObstacles, collisionObstacles),
    routedBy: "orthogonal",
  };
};

const closestPointOnRect = (frame: Rect, p: Point): Point =>
  point(
    clamp(p.x, frame.x, rectRight(frame)),
    clamp(p.y, frame.y, rectBottom(frame)),
  );

const markerLabelObstacles = (edge: SceneEdge, points: readonly Point[]): readonly Rect[] => {
  if (points.length < 2) return [];
  const result: Rect[] = [];
  const specs = [
    { marker: edge.markers.source, tip: points[0], toward: points[1] },
    { marker: edge.markers.target, tip: points[points.length - 1], toward: points[points.length - 2] },
  ] as const;
  for (const spec of specs) {
    const extent = markerExtent(spec.marker);
    if (extent <= 0 || spec.tip === undefined || spec.toward === undefined) continue;
    const direction = normalize(sub(spec.toward, spec.tip));
    const far = point(spec.tip.x + direction.x * (extent + 5), spec.tip.y + direction.y * (extent + 5));
    const padding = 8;
    result.push(rect(
      Math.min(spec.tip.x, far.x) - padding,
      Math.min(spec.tip.y, far.y) - padding,
      Math.abs(far.x - spec.tip.x) + padding * 2,
      Math.abs(far.y - spec.tip.y) + padding * 2,
    ));
  }
  return result;
};

const lineLabelObstacles = (points: readonly Point[]): readonly Rect[] => {
  const result: Rect[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    if (Math.abs(a.y - b.y) <= EPSILON) {
      const left = Math.min(a.x, b.x);
      result.push(rect(left - 1.5, a.y - 1.5, Math.abs(a.x - b.x) + 3, 3));
    } else if (Math.abs(a.x - b.x) <= EPSILON) {
      const top = Math.min(a.y, b.y);
      result.push(rect(a.x - 1.5, top - 1.5, 3, Math.abs(a.y - b.y) + 3));
    }
  }
  return result;
};

const labelOverlapsNode = (frame: Rect, obstacles: readonly Rect[]): boolean =>
  obstacles.some((obstacle) => rectsIntersect(frame, obstacle));

const labelDirections = (
  offset: Point,
): readonly ("above" | "below" | "left" | "right")[] => {
  if (Math.abs(offset.y) >= Math.abs(offset.x)) {
    return offset.y <= 0
      ? ["above", "left", "right", "below"]
      : ["below", "left", "right", "above"];
  }
  return offset.x <= 0
    ? ["left", "above", "below", "right"]
    : ["right", "above", "below", "left"];
};

const placeLabelFrame = (
  anchor: Point,
  offset: Point,
  width: number,
  height: number,
  obstacles: readonly Rect[],
): Rect => {
  const frameAt = (centerX: number, centerY: number): Rect =>
    rect(centerX - width / 2, centerY - height / 2, width, height);
  const preferredCenter = { x: anchor.x + offset.x, y: anchor.y + offset.y };
  const preferred = frameAt(preferredCenter.x, preferredCenter.y);
  if (!labelOverlapsNode(preferred, obstacles)) return preferred;

  // Keep the requested side when possible, then step away from the edge until
  // the label clears every table/class/shape frame, terminal glyph and the
  // edge line itself. No leader/tether line is rendered for normal labels.
  const directions = labelDirections(offset);
  for (let distance = 4; distance <= 240; distance += 8) {
    for (const direction of directions) {
      const candidate = direction === "above"
        ? frameAt(preferredCenter.x, preferredCenter.y - distance - height / 2)
        : direction === "below"
          ? frameAt(preferredCenter.x, preferredCenter.y + distance + height / 2)
          : direction === "left"
            ? frameAt(preferredCenter.x - distance - width / 2, preferredCenter.y)
            : frameAt(preferredCenter.x + distance + width / 2, preferredCenter.y);
      if (!labelOverlapsNode(candidate, obstacles)) return candidate;
    }
  }
  return preferred;
};

const measureLabel = (
  label: EdgeLabel,
  edgePoints: readonly Point[],
  scene: SceneDocument,
  measurer: TextMeasurer,
  obstacles: readonly Rect[],
): EdgeLabelLayout => {
  const anchorHit = label.anchor.kind === "endpoint"
    ? pointOnPolyline(edgePoints, label.anchor.end === "source" ? 0 : 1)
    : pointOnPolyline(edgePoints, label.anchor.t);
  const anchor = anchorHit.point;
  const style = resolveTextStyle(scene.theme.edge.labelText, label.textStyle);
  // Imported/older projects can contain a label record without `text` (for
  // example after a style-only label edit). Treat it as an empty label instead
  // of crashing the whole scene render.
  const labelText = typeof label.text === "string" ? label.text : "";
  const text = scene.meta.diagramKind === "circuit"
    ? measureRichText(labelText, style, measurer, label.maxWidth)
    : measurer.measure(labelText, style, label.maxWidth);
  const padding = scene.theme.edge.labelPadding;
  const width = text.width + padding * 2;
  const height = text.height + padding * 2;
  let frame: Rect;
  if (label.locked) {
    // A manually dragged label uses its stored offset verbatim; automatic
    // endpoint conventions and collision nudging no longer move it.
    frame = rect(
      anchor.x + label.offset.x - width / 2,
      anchor.y + label.offset.y - height / 2,
      width,
      height,
    );
  } else {
    let offset = label.offset;
    if (label.anchor.kind === "endpoint") {
      const outward = label.anchor.end === "source"
        ? anchorHit.tangent
        : scale(anchorHit.tangent, -1);
      if (Math.abs(anchorHit.tangent.x) >= Math.abs(anchorHit.tangent.y)) {
        // Keep endpoint labels outside the entity border and above/below the line.
        offset = { x: outward.x * (width / 2 + 4), y: label.offset.y };
      } else {
        // A vertical connector places its cardinality beside the line.
        const side = label.offset.x === 0 ? -1 : Math.sign(label.offset.x);
        offset = { x: side * (width / 2 + 4), y: outward.y * (height / 2 + 4) };
      }
    }
    frame = placeLabelFrame(
      anchor,
      offset,
      width,
      height,
      obstacles,
    );
  }
  const textFrame = rect(frame.x + padding, frame.y + padding, text.width, text.height);
  const tetherTarget = closestPointOnRect(frame, anchor);
  const tether = length(sub(anchor, tetherTarget)) > 2 ? [anchor, tetherTarget] as const : null;

  return {
    labelId: label.id,
    zone: label.zone,
    frame,
    textFrame,
    text,
    anchorPoint: anchor,
    tether,
  };
};

/** Re-evaluates an auto ellipse anchor against the partner's current centre. */
const autoEllipseAttachment = (
  attachment: EdgeAttachment,
  partner: EdgeAttachment,
  nodes: Readonly<Record<string, NodeLayout>>,
): EdgeAttachment => {
  if (attachment.target !== "node" || attachment.port.kind !== "angle") return attachment;
  if (attachment.port.auto !== true) return attachment;
  // A unary connector has no partner direction to follow; keep both explicit
  // angles so the two ends never collapse onto the same ellipse point.
  if (partner.target === "node" && partner.nodeId === attachment.nodeId) return attachment;
  const useCase = nodes[attachment.nodeId];
  if (useCase === undefined || useCase.kind !== "useCase") return attachment;
  let other: Point | undefined;
  if (partner.target === "node") {
    const partnerLayout = nodes[partner.nodeId];
    if (partnerLayout !== undefined) other = rectCenter(partnerLayout.frame);
  } else if (partner.target === "free") {
    other = partner.point;
  }
  if (other === undefined) return attachment;
  const center = rectCenter(useCase.frame);
  const rx = Math.max(1, useCase.frame.width / 2);
  const ry = Math.max(1, useCase.frame.height / 2);
  const theta = Math.atan2((other.y - center.y) / ry, (other.x - center.x) / rx);
  const angle = ((theta * 180) / Math.PI + 360) % 360;
  return {
    ...attachment,
    port: { ...attachment.port, angle },
  };
};

/** Snap an ellipse normal to the dominant axis for orthogonal approach stubs. */
const axisAlignedNormal = (normal: Point): Point => {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) {
    return point(normal.x >= 0 ? 1 : -1, 0);
  }
  return point(0, normal.y >= 0 ? 1 : -1);
};

const computeEdge = (
  scene: SceneDocument,
  edge: SceneEdge,
  nodes: Readonly<Record<string, NodeLayout>>,
  ports: Readonly<Record<string, PortGeometry>>,
  computed: ReadonlyMap<string, EdgeLayout>,
  measurer: TextMeasurer,
  labelObstacles: readonly Rect[],
  placedLabelFrames: Rect[],
  usedPerimeterAnchors: Map<string, PerimeterAnchor[]>,
): EdgeLayout | null => {
  const sourceAttachment = autoEllipseAttachment(edge.source, edge.target, nodes);
  const targetAttachment = autoEllipseAttachment(edge.target, edge.source, nodes);
  const resolvedSource = resolveAttachment(scene, nodes, ports, computed, sourceAttachment);
  const resolvedTarget = resolveAttachment(scene, nodes, ports, computed, targetAttachment);
  if (resolvedSource === null || resolvedTarget === null) return null;
  const adjusted = adjustPerimeterAttachments(
    edge,
    resolvedSource,
    resolvedTarget,
    nodes,
    usedPerimeterAnchors,
    Math.max(1, scene.canvas.grid.size),
  );
  const source = adjusted.source;
  const target = adjusted.target;
  const sourceNodeId = edge.source.target === "node" ? edge.source.nodeId : undefined;
  const targetNodeId = edge.target.target === "node" ? edge.target.nodeId : undefined;
  const sourceFrame = sourceNodeId === undefined ? undefined : nodes[sourceNodeId]?.frame;
  const targetFrame = targetNodeId === undefined ? undefined : nodes[targetNodeId]?.frame;
  // An elliptical endpoint lives inside its rectangular bounds. Treating that
  // rectangle as a routing obstacle makes the target unreachable, so exclude
  // ellipse endpoint frames from routing (the label pass still uses them).
  const ellipseFrames = [
    sourceNodeId !== undefined && nodes[sourceNodeId]?.kind === "useCase" ? sourceFrame : undefined,
    targetNodeId !== undefined && nodes[targetNodeId]?.kind === "useCase" ? targetFrame : undefined,
  ].filter((frame): frame is Rect => frame !== undefined);
  const endpointObstacles = [sourceFrame, targetFrame].filter(
    (frame): frame is Rect =>
      frame !== undefined && !ellipseFrames.some((ellipse) => ellipse === frame),
  );
  let routingObstacles = labelObstacles.filter(
    (obstacle) => !ellipseFrames.some((ellipse) => ellipse === obstacle),
  );
  if (edge.routing.avoidWireOverlap === true) {
    const wireObstacles: Rect[] = [];
    const nearPoint = (point: Point, a: Point, b: Point): boolean => {
      if (Math.abs(a.y - b.y) < 0.001) {
        return Math.abs(point.y - a.y) <= 1 &&
          point.x >= Math.min(a.x, b.x) - 1 &&
          point.x <= Math.max(a.x, b.x) + 1;
      }
      if (Math.abs(a.x - b.x) < 0.001) {
        return Math.abs(point.x - a.x) <= 1 &&
          point.y >= Math.min(a.y, b.y) - 1 &&
          point.y <= Math.max(a.y, b.y) + 1;
      }
      return false;
    };
    for (const other of computed.values()) {
      if (other.edgeId === edge.id) continue;
      for (let index = 1; index < other.points.length; index += 1) {
        const a = other.points[index - 1];
        const b = other.points[index];
        if (a === undefined || b === undefined) continue;
        if (nearPoint(source.point, a, b) || nearPoint(target.point, a, b)) continue;
        if (Math.abs(a.y - b.y) < 0.001) {
          wireObstacles.push(
            rect(
              Math.min(a.x, b.x) - 2,
              a.y - 2,
              Math.max(1, Math.abs(a.x - b.x) + 4),
              4,
            ),
          );
        } else if (Math.abs(a.x - b.x) < 0.001) {
          wireObstacles.push(
            rect(
              a.x - 2,
              Math.min(a.y, b.y) - 2,
              4,
              Math.max(1, Math.abs(a.y - b.y) + 4),
            ),
          );
        }
      }
    }
    routingObstacles = [...routingObstacles, ...wireObstacles];
  }
  // A diagonal ellipse normal produced a diagonal final stub, which looked
  // like a spike when the orthogonal route met it. Use the dominant axis for
  // routing stubs; the visible endpoint stays exactly on the ellipse.
  const routingSource =
    sourceNodeId !== undefined && nodes[sourceNodeId]?.kind === "useCase"
      ? { ...source, normal: axisAlignedNormal(source.normal) }
      : source;
  const routingTarget =
    targetNodeId !== undefined && nodes[targetNodeId]?.kind === "useCase"
      ? { ...target, normal: axisAlignedNormal(target.normal) }
      : target;
  const selfNode =
    sourceNodeId !== undefined && sourceNodeId === targetNodeId
      ? nodes[sourceNodeId]
      : undefined;
  const routed = selfNode !== undefined && scene.meta.diagramKind !== "circuit"
    ? selfLoopRoute(
        routingSource,
        routingTarget,
        selfNode,
        edge.routing,
        scene,
        routingObstacles,
      )
    : routeEdge(edge, routingSource, routingTarget, endpointObstacles, routingObstacles);
  const points = routed.points;
  const markerObstacles = markerLabelObstacles(edge, points);
  const lineObstacles = lineLabelObstacles(points);
  const labels = edge.labels.flatMap((label) => {
    // Older/imported files may contain a label record without text; omit it
    // from the rendered layout rather than creating an invisible label box.
    if (typeof label.text !== "string") return [];
    const measured = measureLabel(
      label,
      points,
      scene,
      measurer,
      [...labelObstacles, ...lineObstacles, ...markerObstacles, ...placedLabelFrames],
    );
    placedLabelFrames.push(measured.frame);
    return [measured];
  });
  const edgeBounds = unionRects([
    rectOfPoints(points),
    ...labels.map((label) => label.frame),
  ]) ?? rectOfPoints(points);

  return {
    edgeId: edge.id,
    points,
    sourcePortId: source.portId,
    targetPortId: target.portId,
    labels,
    bounds: edgeBounds,
    routedBy: routed.routedBy,
    bendCount: Math.max(0, points.length - 2),
    crossings: 0,
  };
};

const computeEdges = (
  scene: SceneDocument,
  nodes: Readonly<Record<string, NodeLayout>>,
  ports: Readonly<Record<string, PortGeometry>>,
  measurer: TextMeasurer,
  labelObstacles: readonly Rect[],
  placedLabelFrames: Rect[],
  seedEdges?: Readonly<Record<string, EdgeLayout>>,
  rerouteEdges?: ReadonlySet<string>,
): Readonly<Record<string, EdgeLayout>> => {
  const result = new Map<string, EdgeLayout>();
  const usedPerimeterAnchors = new Map<string, PerimeterAnchor[]>();
  if (seedEdges !== undefined) {
    for (const [edgeId, layout] of Object.entries(seedEdges)) {
      if (rerouteEdges?.has(edgeId) === true) continue;
      result.set(edgeId, layout);
      const edge = scene.edges[edgeId];
      if (edge === undefined) continue;
      const seedAnchor = (
        end: "source" | "target",
        pointAtEnd: Point | undefined,
      ): void => {
        const attachment = edge[end];
        if (
          attachment.target !== "node" ||
          attachment.port.kind !== "perimeter" ||
          pointAtEnd === undefined
        ) {
          return;
        }
        const side = attachment.port.side;
        if (side !== "north" && side !== "east" && side !== "south" && side !== "west") {
          return;
        }
        usedAnchorsByNode(usedPerimeterAnchors, attachment.nodeId).push({
          side,
          point: pointAtEnd,
        });
      };
      seedAnchor("source", layout.points[0]);
      seedAnchor("target", layout.points[layout.points.length - 1]);
    }
  }
  const pending = Object.values(scene.edges).filter(
    (edge) => rerouteEdges === undefined || rerouteEdges.has(edge.id),
  );
  // Bound by the initial count: edge-to-edge attachments can form a chain and
  // each pass only resolves one more link, while `pending` shrinks every pass.
  const maxPasses = pending.length + 1;

  for (let pass = 0; pass < maxPasses && pending.length > 0; pass += 1) {
    let progress = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const edge = pending[index];
      if (edge === undefined) continue;
      const layout = computeEdge(
        scene,
        edge,
        nodes,
        ports,
        result,
        measurer,
        labelObstacles,
        placedLabelFrames,
        usedPerimeterAnchors,
      );
      if (layout !== null) {
        result.set(edge.id, layout);
        pending.splice(index, 1);
        progress = true;
      }
    }
    if (!progress) break;
  }

  return Object.fromEntries(result) as Readonly<Record<string, EdgeLayout>>;
};

const countRouteCollisions = (
  nodes: Readonly<Record<string, NodeLayout>>,
  edges: Readonly<Record<string, EdgeLayout>>,
): number => {
  let collisions = 0;
  for (const edge of Object.values(edges)) {
    for (const node of Object.values(nodes)) {
      // Frames are containers and lifelines are structural axes, not routing
      // obstacles in the skeleton pass.
      if (node.kind === "frame" || node.kind === "lifeline") continue;
      const sourceNode = edge.sourcePortId?.split(":")[0];
      const targetNode = edge.targetPortId?.split(":")[0];
      if (node.nodeId === sourceNode || node.nodeId === targetNode) {
        continue;
      }
      if (
        edge.points.some(
          (p) =>
            p.x > node.frame.x &&
            p.x < rectRight(node.frame) &&
            p.y > node.frame.y &&
            p.y < rectBottom(node.frame),
        )
      ) {
        collisions += 1;
      }
    }
  }
  return collisions;
};

export interface BuildLayoutOptions {
  /**
   * Reuse connector geometry from a previous snapshot. With `rerouteEdges` this
   * is a partial preview: only those edge ids are routed again. Without it the
   * whole edge map is reused (low-performance drag).
   */
  readonly reuseEdges?: Readonly<Record<string, EdgeLayout>>;
  /** Edge ids that must be recomputed even when `reuseEdges` is supplied. */
  readonly rerouteEdges?: ReadonlySet<string>;
}

export const buildLayoutSnapshot = (
  scene: SceneDocument,
  measurer: TextMeasurer,
  options: BuildLayoutOptions = {},
): LayoutSnapshot => {
  const ports = new Map<PortId, PortGeometry>();
  const nodeLayouts = Object.fromEntries(
    Object.values(scene.nodes).map((node) => [node.id, measureNode(node, scene, measurer, ports)]),
  ) as Readonly<Record<string, NodeLayout>>;
  const portRecord = Object.fromEntries(ports) as Readonly<Record<string, PortGeometry>>;
  const partialReroute =
    options.reuseEdges !== undefined && options.rerouteEdges !== undefined;
  const computesEdges = options.reuseEdges === undefined || partialReroute;
  const labelObstacles = computesEdges
    ? Object.values(nodeLayouts)
        .filter((node) => node.kind !== "frame" && node.kind !== "lifeline")
        .flatMap((node) => {
          const frames = [node.frame];
          if (
            (node.kind === "circuitComponent" || node.kind === "circuitJunction") &&
            node.labelFrame !== undefined
          ) {
            frames.push(node.labelFrame);
          }
          return frames;
        })
    : [];
  const placedLabelFrames: Rect[] = options.reuseEdges === undefined
    ? []
    : Object.values(options.reuseEdges)
        .filter((edge) => options.rerouteEdges?.has(edge.edgeId) !== true)
        .flatMap((edge) => edge.labels.map((label) => label.frame));
  const routedEdgeLayouts = options.reuseEdges !== undefined && !partialReroute
    ? options.reuseEdges
    : computeEdges(
        scene,
        nodeLayouts,
        portRecord,
        measurer,
        labelObstacles,
        placedLabelFrames,
        options.reuseEdges,
        options.rerouteEdges,
      );

  let edgeLayouts: Readonly<Record<string, EdgeLayout>>;
  let edgeCrossingCount = 0;
  if (options.reuseEdges !== undefined && !partialReroute) {
    edgeLayouts = options.reuseEdges;
    edgeCrossingCount = Object.values(edgeLayouts).reduce(
      (sum, edge) => sum + (edge.bridges?.length ?? 0),
      0,
    );
  } else {
    const circuitEdges = Object.values(routedEdgeLayouts).filter((edge) => {
      const sceneEdge = scene.edges[edge.edgeId];
      return sceneEdge?.visible !== false && sceneEdge?.semantic.family === "circuit";
    });
    const bridgeMap = computeWireBridges(
      circuitEdges.map((edge) => ({
        edgeId: edge.edgeId,
        points: edge.points,
        z: scene.edges[edge.edgeId]?.z ?? 10,
      })),
      Object.values(nodeLayouts).flatMap((node) =>
        node.kind === "circuitJunction" ? [node.center] : [],
      ),
      resolveCircuitSettings(scene),
    );
    edgeCrossingCount = [...bridgeMap.values()].reduce(
      (sum, bridges) => sum + bridges.length,
      0,
    );
    edgeLayouts = Object.fromEntries(
      Object.entries(routedEdgeLayouts).map(([edgeId, edge]) => {
        const bridges = bridgeMap.get(edgeId);
        if (bridges === undefined || bridges.length === 0) return [edgeId, edge];
        const radius = Math.max(...bridges.map((bridge) => bridge.radius));
        return [
          edgeId,
          {
            ...edge,
            bridges,
            bounds: expandRect(edge.bounds, radius),
          },
        ];
      }),
    ) as Readonly<Record<string, EdgeLayout>>;
  }

  const nodeRects = Object.values(nodeLayouts).map((node) => node.bounds);
  const edgeRects = Object.values(edgeLayouts).map((edge) => edge.bounds);
  const labelRects = Object.values(edgeLayouts).flatMap((edge) => edge.labels.map((label) => label.frame));
  const contentBounds = unionRects([...nodeRects, ...edgeRects, ...labelRects]) ?? rect(0, 0, 1, 1);
  const exportBounds = expandRect(contentBounds, scene.canvas.exportPadding);

  // Lifeline tails run to the bottom of an intentionally tall frame. They are
  // drawable content, but fitting the camera to those invisible tails leaves a
  // large empty band below the last sequence message. Fit to the meaningful
  // sequence content instead; export/culling still use the full bounds.
  const fitNodeRects = Object.values(nodeLayouts).flatMap((node) => {
    if (node.kind !== "lifeline") return [node.bounds];
    return [
      node.headFrame,
      ...node.activations.map((activation) => activation.frame),
      ...(node.destroyPoint === undefined
        ? []
        : [rect(node.destroyPoint.x - 5, node.destroyPoint.y - 5, 10, 10)]),
    ];
  });
  const fitContentBounds =
    unionRects([...fitNodeRects, ...edgeRects, ...labelRects]) ?? contentBounds;

  const overlappingNodes = Object.values(nodeLayouts).reduce((count, node, index, all) => {
    if (node.kind === "frame") return count;
    let overlaps = 0;
    for (let otherIndex = index + 1; otherIndex < all.length; otherIndex += 1) {
      const other = all[otherIndex];
      if (other === undefined || other.kind === "frame") continue;
      if (
        node.frame.x < rectRight(other.frame) &&
        rectRight(node.frame) > other.frame.x &&
        node.frame.y < rectBottom(other.frame) &&
        rectBottom(node.frame) > other.frame.y
      ) {
        overlaps += 1;
      }
    }
    return count + overlaps;
  }, 0);

  return {
    sceneRevision: scene.revision,
    measuredAt: new Date().toISOString(),
    nodes: nodeLayouts,
    ports: Object.fromEntries(ports) as Readonly<Record<string, PortGeometry>>,
    edges: edgeLayouts,
    contentBounds,
    fitBounds: fitContentBounds,
    exportBounds,
    diagnostics: {
      routeCollisions: countRouteCollisions(nodeLayouts, edgeLayouts),
      edgeCrossings: edgeCrossingCount,
      overlappingNodes,
      unplacedLabels: 0,
    },
  };
};

/**
 * Applies transient frames during a drag/resize without mutating the document.
 * The result is a normal scene, so the same layout pass runs for preview and
 * committed state.
 */
export const withNodeFrames = (
  scene: SceneDocument,
  frames: Readonly<Record<string, Rect>>,
): SceneDocument => {
  if (Object.keys(frames).length === 0) return scene;
  const bottomResizedLifelines = new Set(
    Object.entries(frames).flatMap(([id, frame]) => {
      const node = scene.nodes[id];
      if (
        node?.kind !== "lifeline" ||
        frame.y !== node.frame.y ||
        frame.height === node.frame.height
      ) {
        return [];
      }
      return [id];
    }),
  );
  const rebaseSpine = (
    attachment: SceneEdge["source"],
  ): SceneEdge["source"] => {
    if (
      attachment.target !== "node" ||
      attachment.port.kind !== "spine" ||
      !bottomResizedLifelines.has(attachment.nodeId)
    ) {
      return attachment;
    }
    const node = scene.nodes[attachment.nodeId];
    const frame = frames[attachment.nodeId];
    if (node?.kind !== "lifeline" || frame === undefined) return attachment;
    const oldSpan = Math.max(1, node.frame.height - node.headHeight);
    const newSpan = Math.max(1, frame.height - node.headHeight);
    const absoluteY =
      node.frame.y + node.headHeight + attachment.port.t * oldSpan;
    return {
      ...attachment,
      port: {
        kind: "spine",
        t: Math.min(
          1,
          Math.max(0, (absoluteY - (frame.y + node.headHeight)) / newSpan),
        ),
      },
    };
  };
  return {
    ...scene,
    nodes: Object.fromEntries(
      Object.entries(scene.nodes).map(([id, node]) => {
        const frame = frames[id];
        return [id, frame === undefined ? node : { ...node, frame }];
      }),
    ),
    edges:
      bottomResizedLifelines.size === 0
        ? scene.edges
        : Object.fromEntries(
            Object.entries(scene.edges).map(([id, edge]) => [
              id,
              {
                ...edge,
                source: rebaseSpine(edge.source),
                target: rebaseSpine(edge.target),
              },
            ]),
          ),
  };
};

/** Applies transient 45° rotation previews without mutating the document. */
export const withNodeRotations = (
  scene: SceneDocument,
  rotations: Readonly<Record<string, number>>,
): SceneDocument => {
  if (Object.keys(rotations).length === 0) return scene;
  return {
    ...scene,
    nodes: Object.fromEntries(
      Object.entries(scene.nodes).map(([id, node]) => {
        const rotation = rotations[id];
        if (rotation === undefined) {
          return [id, node];
        }
        if (node.kind === "circuitComponent") {
          return [id, { ...node, rotation: rotation as CircuitComponentNode["rotation"] }];
        }
        if (node.kind === "circuitJunction" && node.measurement !== undefined) {
          return [id, { ...node, rotation }];
        }
        return [id, node];
      }),
    ),
  };
};
