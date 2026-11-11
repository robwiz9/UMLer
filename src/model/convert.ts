/**
 * Cross-diagram object conversion.
 *
 * Conversions are intentionally lossy: structure that has no meaning in the
 * target notation is dropped, while names, section titles and row names/types
 * are kept where possible. Converting again from the pasted object works, so
 * class → object → class or ER → class → lifeline chains are supported.
 */

import type { DiagramKind, SceneDocument } from "./scene.ts";
import type {
  LifelineNode,
  ObjectNode,
  SceneNode,
  TableNode,
  TableRow,
  TableSection,
} from "./nodes.ts";
import { asNodeId, asRowId, asSectionId, newId } from "./ids.ts";
import { placeObjectFrame } from "./object-catalog.ts";

const cleanName = (name: string): string => name.replace(/^:\s*/, "").trim();
const instanceName = (name: string): string => `:${cleanName(name) || "Object"}`;

const commonNode = (node: SceneNode, target: SceneDocument): SceneNode | null => {
  if (node.kind !== "image" && node.kind !== "comment") return null;
  const center = {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
  const frame = placeObjectFrame(target, center, node.frame.width, node.frame.height);
  return {
    ...node,
    id: asNodeId(newId(node.kind)),
    frame,
    style: target.theme.shape,
  };
};

const rowForClass = (row: TableRow): TableRow => ({
  ...row,
  id: asRowId(newId("row")),
  constraints: undefined,
});

const rowForEr = (row: TableRow): TableRow => ({
  ...row,
  id: asRowId(newId("row")),
  kind: "attribute",
  type: row.returnType ?? row.type,
  returnType: undefined,
  visibility: undefined,
  prefix: undefined,
  parameters: undefined,
});

const tableSections = (node: SceneNode): readonly TableSection[] => {
  if (node.kind === "table") return node.sections;
  if (node.kind === "relationAttribute") {
    return [{
      id: asSectionId(newId("section")),
      role: "attributes",
      rows: node.rows,
    }];
  }
  return [];
};

const tableNode = (
  node: SceneNode,
  targetDiagram: "er" | "uml-class",
  targetScene: SceneDocument,
): TableNode | null => {
  if (node.kind !== "table" && node.kind !== "relationAttribute" &&
      node.kind !== "object" && node.kind !== "lifeline") {
    return null;
  }
  const center = {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
  const sourceIsTable = node.kind === "table" || node.kind === "relationAttribute";
  const width = sourceIsTable ? Math.max(198, node.frame.width) : 225;
  const height = sourceIsTable
    ? Math.max(45, node.frame.height)
    : targetDiagram === "uml-class" ? 108 : 90;
  const frame = placeObjectFrame(targetScene, center, width, height);
  const targetClass = targetDiagram === "uml-class";
  const sections = tableSections(node).map((section) => ({
    ...section,
    id: asSectionId(newId("section")),
    rows: section.rows.map(targetClass ? rowForClass : rowForEr),
  }));
  const nameSource = node.kind === "object"
    ? node.name
    : node.kind === "lifeline"
      ? node.head.label ?? node.name
      : node.name;
  const name = cleanName(nameSource) || (targetClass ? "NewClass" : "new_entity");
  return {
    id: asNodeId(newId(targetClass ? "class" : "entity")),
    kind: "table",
    tableKind: targetClass
      ? "class"
      : node.kind === "table" && node.tableKind === "associative"
        ? "associative"
        : "entity",
    name,
    frame,
    z: 2,
    locked: node.locked,
    visible: node.visible,
    header: {},
    sections,
    style: targetScene.theme.table,
    textStyle: node.textStyle,
    metadata: node.metadata,
  };
};

const objectNode = (node: SceneNode, target: SceneDocument): ObjectNode | null => {
  if (node.kind !== "table" && node.kind !== "relationAttribute" &&
      node.kind !== "object" && node.kind !== "lifeline") {
    return null;
  }
  const label = node.kind === "object"
    ? node.name
    : node.kind === "lifeline"
      ? node.head.label ?? node.name
      : node.name;
  const center = {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
  const frame = placeObjectFrame(target, center, 180, 45);
  return {
    id: asNodeId(newId("object")),
    kind: "object",
    name: instanceName(label),
    frame,
    z: 2,
    locked: node.locked,
    visible: node.visible,
    underlineName: true,
    stereotype: node.kind === "object" ? node.stereotype : undefined,
    classifier: node.kind === "object" ? node.classifier : undefined,
    style: target.theme.shape,
    textStyle: node.textStyle,
    metadata: node.metadata,
  };
};

const lifelineNode = (node: SceneNode, target: SceneDocument): LifelineNode | null => {
  if (node.kind !== "table" && node.kind !== "relationAttribute" &&
      node.kind !== "object" && node.kind !== "lifeline") {
    return null;
  }
  const label = node.kind === "object"
    ? node.name
    : node.kind === "lifeline"
      ? node.head.label ?? node.name
      : node.name;
  const name = cleanName(label) || "Object";
  const lanes = Object.values(target.nodes).filter((candidate) => candidate.kind === "lifeline");
  const center = lanes.length === 0
    ? {
        x: node.frame.x + node.frame.width / 2,
        y: node.frame.y + node.frame.height / 2,
      }
    : {
        x: Math.max(...lanes.map((lane) => lane.frame.x + lane.frame.width)) + 27 + 54,
        y: Math.min(...lanes.map((lane) => lane.frame.y)) + 315,
      };
  const frame = placeObjectFrame(target, center, 108, 630);
  return {
    id: asNodeId(newId("lifeline")),
    kind: "lifeline",
    name,
    frame,
    z: 2,
    locked: node.locked,
    visible: node.visible,
    head: {
      headKind: "object",
      label: instanceName(label),
      stereotype: node.kind === "object" ? node.stereotype : undefined,
    },
    headHeight: 36,
    activationBars: [],
    style: target.theme.shape,
    textStyle: node.textStyle,
    metadata: node.metadata,
  };
};

export const convertNodeForDiagram = (
  node: SceneNode,
  targetDiagram: DiagramKind,
  target: SceneDocument,
): SceneNode | null => {
  const common = commonNode(node, target);
  if (common !== null) return common;

  switch (targetDiagram) {
    case "er":
      return tableNode(node, "er", target);
    case "uml-class":
      return tableNode(node, "uml-class", target);
    case "uml-object":
    case "uml-communication":
      return objectNode(node, target);
    case "uml-sequence":
      return lifelineNode(node, target);
    case "uml-use-case":
    case "uml-state-machine":
      return null;
  }
};
