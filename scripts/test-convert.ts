import assert from "node:assert/strict";
import {
  ER_COMMERCE,
  UML_CLASS_PAYMENTS,
  UML_STATE_ORDER,
  UML_USE_CASE_SHOP,
} from "../src/fixtures/index.ts";
import { convertNodeForDiagram } from "../src/model/convert.ts";
import type {
  ImageNode,
  LifelineNode,
  ObjectNode,
  SceneNode,
  TableNode,
} from "../src/model/nodes.ts";
import { createObjectFromTemplate } from "../src/model/object-catalog.ts";
import { createEmptyScene } from "../src/model/scene.ts";

let checked = 0;
const check = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  checked += 1;
};

const requiredTable = (node: SceneNode | null, message: string): TableNode => {
  if (node === null || node.kind !== "table") throw new Error(message);
  return node;
};
const requiredObject = (node: SceneNode | null, message: string): ObjectNode => {
  if (node === null || node.kind !== "object") throw new Error(message);
  return node;
};
const requiredLifeline = (node: SceneNode | null, message: string): LifelineNode => {
  if (node === null || node.kind !== "lifeline") throw new Error(message);
  return node;
};
const requiredImage = (node: SceneNode | null, message: string): ImageNode => {
  if (node === null || node.kind !== "image") throw new Error(message);
  return node;
};

const classScene = createEmptyScene("uml-class", "Class target");
const erScene = createEmptyScene("er", "ER target");
const objectScene = createEmptyScene("uml-object", "Object target");
const sequenceScene = createEmptyScene("uml-sequence", "Sequence target");
const communicationScene = createEmptyScene("uml-communication", "Communication target");

const erEntity = ER_COMMERCE.nodes["orders"];
const classTable = UML_CLASS_PAYMENTS.nodes["card_payment"];
const relationAttribute = ER_COMMERCE.nodes["order_line"];
if (
  erEntity?.kind !== "table" ||
  classTable?.kind !== "table" ||
  relationAttribute?.kind !== "relationAttribute"
) {
  throw new Error("fixture nodes are missing");
}

const erToClass = requiredTable(
  convertNodeForDiagram(erEntity, "uml-class", classScene),
  "ER table should become a class table",
);
check(erToClass.tableKind === "class", "entity table converts to a class table");
check(erToClass.name === erEntity.name, "class conversion keeps the table name");
check(erToClass.sections.length === erEntity.sections.length, "class conversion keeps sections");
check(
  erToClass.sections[0]?.rows.map((row) => row.name).join(",") ===
    erEntity.sections[0]?.rows.map((row) => row.name).join(","),
  "class conversion keeps attribute names",
);
check(
  erToClass.sections[0]?.rows.every((row) => row.constraints === undefined) === true,
  "ER key constraints are dropped for classes",
);
check(erToClass.id !== erEntity.id, "conversion allocates a fresh node id");

const classToEr = requiredTable(
  convertNodeForDiagram(classTable, "er", erScene),
  "class table should become an ER table",
);
check(classToEr.tableKind === "entity", "class table converts to an entity table");
check(classToEr.name === classTable.name, "ER conversion keeps the class name");
check(classToEr.sections.length === classTable.sections.length, "ER conversion keeps sections");
check(
  classToEr.sections.flatMap((section) => section.rows).every((row) => row.kind === "attribute"),
  "method rows become ER attribute rows",
);
check(
  classToEr.sections.flatMap((section) => section.rows).every((row) => row.visibility === undefined),
  "class visibility prefixes are dropped for ER",
);

const relationToClass = requiredTable(
  convertNodeForDiagram(relationAttribute, "uml-class", classScene),
  "relation attribute should become a class table",
);
check(relationToClass.tableKind === "class", "relation attribute converts to a class");
check(relationToClass.sections.length === 1, "relation attribute becomes one class section");
check(
  relationToClass.sections[0]?.rows.length === relationAttribute.rows.length,
  "relation-attribute rows survive class conversion",
);

const classToObject = requiredObject(
  convertNodeForDiagram(classTable, "uml-object", objectScene),
  "class table should become an object",
);
check(classToObject.name === `:${classTable.name}`, "class instance name is colon-prefixed");
check(classToObject.underlineName === true, "class instance is underlined");
const classToCommunication = requiredObject(
  convertNodeForDiagram(classTable, "uml-communication", communicationScene),
  "class table should become a communication object",
);
check(classToCommunication.name === `:${classTable.name}`, "communication object keeps the class name");

const objectToClass = requiredTable(
  convertNodeForDiagram(classToObject, "uml-class", classScene),
  "object should become a class table",
);
check(objectToClass.name === classTable.name, "object-to-class strips the colon prefix");
check(objectToClass.sections.length === 0, "object-to-class is lossy and starts without rows");

const classToLifeline = requiredLifeline(
  convertNodeForDiagram(classTable, "uml-sequence", sequenceScene),
  "class table should become a lifeline",
);
check(classToLifeline.head.label === `:${classTable.name}`, "lifeline head is colon-prefixed");
check(classToLifeline.name === classTable.name, "lifeline keeps the class name");
check(classToLifeline.activationBars.length === 0, "converted lifeline has no activation bars");

const objectToLifeline = requiredLifeline(
  convertNodeForDiagram(classToObject, "uml-sequence", sequenceScene),
  "object should become a lifeline",
);
check(objectToLifeline.head.label === `:${classTable.name}`, "object label survives lifeline conversion");

const lifelineToClass = requiredTable(
  convertNodeForDiagram(classToLifeline, "uml-class", classScene),
  "lifeline should become a class table",
);
check(lifelineToClass.name === classTable.name, "lifeline-to-class strips the colon prefix");

const image = UML_USE_CASE_SHOP.nodes["brand_image"];
if (image?.kind !== "image") throw new Error("image fixture is missing");
const imageToClass = requiredImage(
  convertNodeForDiagram(image, "uml-class", classScene),
  "images are common across diagrams",
);
check(imageToClass.assetId === image.assetId, "image conversion keeps its asset reference");

const state = Object.values(UML_STATE_ORDER.nodes).find((node) => node.kind === "state");
assert.ok(state !== undefined, "state fixture exists");
check(convertNodeForDiagram(state, "uml-class", classScene) === null, "unrelated shapes are not converted");
check(convertNodeForDiagram(classTable, "uml-state-machine", createEmptyScene("uml-state-machine", "State target")) === null, "tables cannot enter state diagrams");

const createdInstance = createObjectFromTemplate(
  "uml-object",
  "class-instance",
  createEmptyScene("uml-object", "Empty object scene"),
  { x: 90, y: 90 },
);
if (createdInstance === null || createdInstance.node.kind !== "object") {
  throw new Error("object diagram did not create a class instance");
}
const createdNode = createdInstance.node;
check(createdNode.name === ":Class", "class-instance template is colon-prefixed");
check(createdNode.underlineName === true, "class-instance template is underlined");

console.log(`Conversion checks passed (${checked} assertions).`);
