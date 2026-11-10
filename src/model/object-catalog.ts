/**
 * Diagram-aware object palette.
 *
 * The same catalogue feeds the "Add object" button and the empty-canvas
 * context menu. Only objects that make sense for the active diagram family are
 * exposed; connectors are deliberately absent because they are drawn by
 * dragging from the perimeter/row/spine ports of placed objects.
 */

import type { SceneDocument, DiagramKind } from "./scene.ts";
import type {
  ActorNode,
  CommentNode,
  FrameNode,
  ImageAsset,
  ImageNode,
  LifelineNode,
  ObjectNode,
  PseudostateNode,
  RelationAttributeNode,
  SceneNode,
  StateNode,
  TableNode,
  TableRow,
  TableSection,
  UseCaseNode,
} from "./nodes.ts";
import { DEFAULT_THEME } from "./styles.ts";
import type { Point, Rect } from "./geometry.ts";
import { rect, rectBottom, rectRight, snap } from "./geometry.ts";
import {
  asNodeId,
  asRowId,
  asSectionId,
  newId,
  type NodeId,
} from "./ids.ts";

export type ObjectTemplateId =
  | "entity-table"
  | "associative-table"
  | "relation-attribute"
  | "class"
  | "state"
  | "initial-state"
  | "final-state"
  | "choice"
  | "communication-object"
  | "lifeline"
  | "actor"
  | "use-case"
  | "system-boundary"
  | "interaction-frame"
  | "comment"
  | "image";

export type ObjectTemplateGroup = "diagram" | "annotation";

export interface ObjectTemplate {
  readonly id: ObjectTemplateId;
  readonly label: string;
  readonly hint: string;
  readonly icon: string;
  readonly group: ObjectTemplateGroup;
}

const COMMON_TEMPLATES: readonly ObjectTemplate[] = [
  {
    id: "comment",
    label: "Comment",
    hint: "Free-standing note; double-click to edit",
    icon: "▧",
    group: "annotation",
  },
  {
    id: "image",
    label: "Image",
    hint: "Drop a PNG/JPG/SVG, or add a placeholder frame",
    icon: "▨",
    group: "annotation",
  },
];

const BY_DIAGRAM: Record<DiagramKind, readonly ObjectTemplate[]> = {
  er: [
    {
      id: "entity-table",
      label: "Entity table",
      hint: "Attributes with PK / FK / NN / UQ",
      icon: "▤",
      group: "diagram",
    },
    {
      id: "associative-table",
      label: "Associative table",
      hint: "Join table between two entities",
      icon: "▥",
      group: "diagram",
    },
    {
      id: "relation-attribute",
      label: "Relationship attribute",
      hint: "Compact attribute table for a relationship",
      icon: "▦",
      group: "diagram",
    },
    ...COMMON_TEMPLATES,
  ],
  "uml-class": [
    {
      id: "class",
      label: "Class",
      hint: "Name, attributes and operations",
      icon: "▥",
      group: "diagram",
    },
    ...COMMON_TEMPLATES,
  ],
  "uml-use-case": [
    {
      id: "actor",
      label: "Actor",
      hint: "Stick figure with a label below",
      icon: "☺",
      group: "diagram",
    },
    {
      id: "use-case",
      label: "Use case",
      hint: "Ellipse with centred text",
      icon: "◯",
      group: "diagram",
    },
    {
      id: "system-boundary",
      label: "System boundary",
      hint: "Framed subject that holds use cases",
      icon: "▣",
      group: "diagram",
    },
    ...COMMON_TEMPLATES,
  ],
  "uml-sequence": [
    {
      id: "lifeline",
      label: "Lifeline",
      hint: "Object head with a dashed time axis",
      icon: "┆",
      group: "diagram",
    },
    {
      id: "interaction-frame",
      label: "Interaction frame",
      hint: "alt / opt / loop fragment",
      icon: "▭",
      group: "diagram",
    },
    ...COMMON_TEMPLATES,
  ],
  "uml-communication": [
    {
      id: "communication-object",
      label: "Communication object",
      hint: "Underlined object box",
      icon: "▭",
      group: "diagram",
    },
    ...COMMON_TEMPLATES,
  ],
  "uml-state-machine": [
    {
      id: "state",
      label: "State",
      hint: "Rounded state bubble",
      icon: "▢",
      group: "diagram",
    },
    {
      id: "initial-state",
      label: "Initial state",
      hint: "Filled start pseudostate",
      icon: "●",
      group: "diagram",
    },
    {
      id: "final-state",
      label: "Final state",
      hint: "Bullseye end pseudostate",
      icon: "◉",
      group: "diagram",
    },
    {
      id: "choice",
      label: "Choice",
      hint: "Branching diamond pseudostate",
      icon: "◆",
      group: "diagram",
    },
    ...COMMON_TEMPLATES,
  ],
};

export const objectTemplatesFor = (diagramKind: DiagramKind): readonly ObjectTemplate[] =>
  BY_DIAGRAM[diagramKind];

export const objectTemplate = (
  diagramKind: DiagramKind,
  id: ObjectTemplateId,
): ObjectTemplate | undefined =>
  objectTemplatesFor(diagramKind).find((template) => template.id === id);

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < rectRight(b) - 0.001 &&
  rectRight(a) > b.x + 0.001 &&
  a.y < rectBottom(b) - 0.001 &&
  rectBottom(a) > b.y + 0.001;

/**
 * Places a new frame around a screen/world point, then cascades right/down
 * until it no longer covers an existing object. Frames are containers, so they
 * do not block placement inside a boundary.
 */
export const placeObjectFrame = (
  scene: SceneDocument,
  center: Point,
  width: number,
  height: number,
): Rect => {
  const grid = Math.max(1, scene.canvas.grid.size);
  const obstacles = Object.values(scene.nodes)
    .filter((node) => node.kind !== "frame" && node.visible)
    .map((node) => node.frame);
  const startX = snap(center.x - width / 2, grid);
  const startY = snap(center.y - height / 2, grid);
  const stepX = width + grid;
  const stepY = height + grid;

  // Search outward and choose the least displaced free slot. A tall object
  // therefore steps sideways to a new lane instead of leaping a whole height
  // downward (the sequence-lifeline case), while a short object still prefers
  // the next row.
  const offsets: { readonly x: number; readonly y: number }[] = [{ x: 0, y: 0 }];
  for (let dx = -6; dx <= 6; dx += 1) {
    for (let dy = -6; dy <= 6; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      offsets.push({ x: dx, y: dy });
    }
  }
  offsets.sort((a, b) => {
    const costA = Math.abs(a.x) * stepX + Math.abs(a.y) * stepY;
    const costB = Math.abs(b.x) * stepX + Math.abs(b.y) * stepY;
    return costA - costB || a.y - b.y || a.x - b.x;
  });

  for (const offset of offsets) {
    const frame = rect(startX + offset.x * stepX, startY + offset.y * stepY, width, height);
    if (!obstacles.some((obstacle) => intersects(frame, obstacle))) return frame;
  }
  return rect(startX, startY, width, height);
};

const row = (name: string, extra: Partial<TableRow> = {}): TableRow => ({
  id: asRowId(newId("row")),
  kind: "attribute",
  name,
  ...extra,
});

const section = (
  role: TableSection["role"],
  rows: readonly TableRow[],
  title?: string,
): TableSection => ({
  id: asSectionId(newId("section")),
  role,
  rows,
  title,
});

const tableBase = (id: NodeId, name: string, frame: Rect) => ({
  id,
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  style: DEFAULT_THEME.table,
});

const shapeBase = (id: NodeId, name: string, frame: Rect) => ({
  id,
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  style: DEFAULT_THEME.shape,
});

const entityTable = (frame: Rect): TableNode => ({
  ...tableBase(asNodeId(newId("entity")), "new_entity", frame),
  kind: "table",
  tableKind: "entity",
  header: {},
  sections: [
    section("attributes", [
      row("id", { type: "uuid", constraints: ["PK", "NN"] }),
      row("name", { type: "text" }),
    ]),
  ],
});

const associativeTable = (frame: Rect): TableNode => ({
  ...tableBase(asNodeId(newId("join")), "new_join", frame),
  kind: "table",
  tableKind: "associative",
  header: {},
  sections: [
    section("attributes", [
      row("left_id", { type: "uuid", constraints: ["FK", "NN"] }),
      row("right_id", { type: "uuid", constraints: ["FK", "NN"] }),
    ]),
  ],
});

const relationAttribute = (frame: Rect): RelationAttributeNode => ({
  ...tableBase(asNodeId(newId("relation_attribute")), "relation_attributes", frame),
  kind: "relationAttribute",
  z: 3,
  rows: [row("quantity", { type: "int", constraints: ["NN"] })],
});

const classTable = (frame: Rect): TableNode => ({
  ...tableBase(asNodeId(newId("class")), "NewClass", frame),
  kind: "table",
  tableKind: "class",
  header: {},
  sections: [
    section("attributes", [row("id", { visibility: "-", type: "UUID" })]),
    section("methods", [
      row("operation", {
        kind: "method",
        visibility: "+",
        returnType: "void",
      }),
    ]),
  ],
});

const stateNode = (frame: Rect): StateNode => ({
  ...shapeBase(asNodeId(newId("state")), "New state", frame),
  kind: "state",
  stateKind: "simple",
});

const pseudostateNode = (
  frame: Rect,
  pseudostateKind: PseudostateNode["pseudostateKind"],
): PseudostateNode => ({
  ...shapeBase(asNodeId(newId(pseudostateKind)), pseudostateKind, frame),
  kind: "pseudostate",
  pseudostateKind,
});

const communicationObject = (frame: Rect): ObjectNode => ({
  ...shapeBase(asNodeId(newId("object")), ":Object", frame),
  kind: "object",
  underlineName: true,
});

const actorNode = (frame: Rect): ActorNode => ({
  ...shapeBase(asNodeId(newId("actor")), "Actor", frame),
  kind: "actor",
  labelPlacement: "below",
});

const useCaseNode = (frame: Rect): UseCaseNode => ({
  ...shapeBase(asNodeId(newId("use_case")), "New use case", frame),
  kind: "useCase",
});

const lifelineNode = (frame: Rect): LifelineNode => ({
  ...shapeBase(asNodeId(newId("lifeline")), "Object", frame),
  kind: "lifeline",
  head: { headKind: "object", label: ":Object" },
  headHeight: 36,
  activationBars: [],
});

const boundaryFrame = (frame: Rect): FrameNode => ({
  ...shapeBase(asNodeId(newId("boundary")), "System", frame),
  kind: "frame",
  z: 0,
  frameKind: "system-boundary",
  tabHeight: 27,
});

const interactionFrame = (frame: Rect): FrameNode => ({
  ...shapeBase(asNodeId(newId("frame")), "alt", frame),
  kind: "frame",
  z: 0,
  frameKind: "interaction-frame",
  operator: "alt",
  guard: "[condition]",
  tabHeight: 22,
});

const commentNode = (frame: Rect): CommentNode => ({
  ...shapeBase(asNodeId(newId("comment")), "Comment", frame),
  kind: "comment",
  z: 4,
  body: "Comment",
});

const imageNode = (frame: Rect): ImageNode => ({
  ...shapeBase(asNodeId(newId("image")), "Image", frame),
  kind: "image",
  caption: "Image",
  fit: "contain",
  alt: "Empty image frame",
  showBorder: false,
});

export interface CreatedObject {
  readonly node: SceneNode;
  readonly asset?: ImageAsset;
}

/**
 * Creates an image object sized to the dropped asset's intrinsic ratio. The
 * frame is aspect-locked by the canvas resize path.
 */
export const createImageObject = (
  scene: SceneDocument,
  center: Point,
  asset: ImageAsset,
): CreatedObject => {
  const maxWidth = 240;
  const maxHeight = 180;
  const scale = Math.min(maxWidth / asset.intrinsicWidth, maxHeight / asset.intrinsicHeight);
  const width = Math.max(36, Math.round(asset.intrinsicWidth * scale));
  const height = Math.max(36, Math.round(asset.intrinsicHeight * scale));
  const frame = placeObjectFrame(scene, center, width, height);
  const node: ImageNode = {
    ...shapeBase(asNodeId(newId("image")), asset.fileName, frame),
    kind: "image",
    z: 3,
    assetId: asset.id,
    fit: "contain",
    alt: asset.fileName,
    showBorder: false,
    style: scene.theme.shape,
  };
  return { node, asset };
};



/**
 * Materialises one palette item at a world-space point. The returned node is
 * already grid-aligned and does not overlap an existing object.
 */
export const createObjectFromTemplate = (
  diagramKind: DiagramKind,
  templateId: ObjectTemplateId,
  scene: SceneDocument,
  center: Point,
): CreatedObject | null => {
  const template = objectTemplate(diagramKind, templateId);
  if (template === undefined) return null;

  const withSceneTheme = (node: SceneNode): SceneNode =>
    node.kind === "table" || node.kind === "relationAttribute"
      ? { ...node, style: scene.theme.table }
      : { ...node, style: scene.theme.shape };
  const created = (node: SceneNode, asset?: ImageAsset): CreatedObject =>
    asset === undefined
      ? { node: withSceneTheme(node) }
      : { node: withSceneTheme(node), asset };

  switch (templateId) {
    case "entity-table":
      return created(entityTable(placeObjectFrame(scene, center, 225, 90)));
    case "associative-table":
      return created(associativeTable(placeObjectFrame(scene, center, 225, 72)));
    case "relation-attribute":
      return created(relationAttribute(placeObjectFrame(scene, center, 198, 72)));
    case "class":
      return created(classTable(placeObjectFrame(scene, center, 225, 108)));
    case "state":
      return created(stateNode(placeObjectFrame(scene, center, 180, 54)));
    case "initial-state":
      return created(pseudostateNode(placeObjectFrame(scene, center, 18, 18), "initial"));
    case "final-state":
      return created(pseudostateNode(placeObjectFrame(scene, center, 18, 18), "final"));
    case "choice":
      return created(pseudostateNode(placeObjectFrame(scene, center, 18, 18), "choice"));
    case "communication-object":
      return created(communicationObject(placeObjectFrame(scene, center, 180, 45)));
    case "lifeline": {
      // A new lane belongs to the right of the existing lanes, aligned with
      // their heads. Dropping it at the cursor would make a 630pt lifeline
      // jump a whole height downward or land before the first lane.
      const lanes = Object.values(scene.nodes).filter((node) => node.kind === "lifeline");
      if (lanes.length === 0) {
        return created(lifelineNode(placeObjectFrame(scene, center, 108, 630)));
      }
      const right = Math.max(...lanes.map((lane) => rectRight(lane.frame)));
      const top = Math.min(...lanes.map((lane) => lane.frame.y));
      const laneCenter = { x: right + 27 + 54, y: top + 315 };
      return created(lifelineNode(placeObjectFrame(scene, laneCenter, 108, 630)));
    }
    case "actor":
      return created(actorNode(placeObjectFrame(scene, center, 72, 126)));
    case "use-case":
      return created(useCaseNode(placeObjectFrame(scene, center, 138, 45)));
    case "system-boundary":
      return created(boundaryFrame(placeObjectFrame(scene, center, 450, 270)));
    case "interaction-frame":
      return created(interactionFrame(placeObjectFrame(scene, center, 360, 180)));
    case "comment":
      return created(commentNode(placeObjectFrame(scene, center, 180, 72)));
    case "image":
      return created(imageNode(placeObjectFrame(scene, center, 144, 90)));
  }
};
