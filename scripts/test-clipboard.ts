import assert from "node:assert/strict";
import { ER_COMMERCE, UML_USE_CASE_SHOP } from "../src/fixtures/index.ts";
import { copySceneNodes, pasteSceneClipboard } from "../src/model/clipboard.ts";
import { deleteNodes } from "../src/model/edits.ts";
import { asNodeId } from "../src/model/ids.ts";

let checked = 0;
const check = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  checked += 1;
};

const pair = copySceneNodes(ER_COMMERCE, ["customers", "orders"]);
assert.ok(pair !== null, "connected pair should copy");
check(pair.nodes.length === 2, "pair copies two nodes");
check(pair.edges.length === 1, "pair copies only its internal connector");
check(pair.edges[0]?.id === "edge_places", "internal connector is preserved");

const tetherOnly = copySceneNodes(ER_COMMERCE, ["order_line"]);
assert.ok(tetherOnly !== null, "relation-attribute node should copy");
check(tetherOnly.nodes.length === 1, "relation-attribute copy has one node");
check(tetherOnly.edges.length === 0, "a connector tethered to another edge is not copied alone");

const full = copySceneNodes(ER_COMMERCE, ["customers", "orders", "order_line"]);
assert.ok(full !== null, "full connected selection should copy");
check(full.edges.length === 2, "full selection includes the relation-attribute tether");

check(copySceneNodes(ER_COMMERCE, []) === null, "empty selection has no clipboard payload");
check(copySceneNodes(ER_COMMERCE, ["missing"]) === null, "unknown node has no clipboard payload");

const pasted = pasteSceneClipboard(ER_COMMERCE, full, { x: 18, y: 18 });
assert.ok(pasted !== null, "full selection should paste");
check(Object.keys(pasted.scene.nodes).length === Object.keys(ER_COMMERCE.nodes).length + 3, "paste adds three nodes");
check(Object.keys(pasted.scene.edges).length === Object.keys(ER_COMMERCE.edges).length + 2, "paste adds two edges");
check(pasted.nodeIds.length === 3, "paste reports three new nodes");
check(pasted.edgeIds.length === 2, "paste reports two new edges");
check(
  pasted.nodeIds.every((id) => ER_COMMERCE.nodes[id] === undefined),
  "pasted node IDs are fresh",
);
check(
  pasted.edgeIds.every((id) => ER_COMMERCE.edges[id] === undefined),
  "pasted edge IDs are fresh",
);

const pastedCustomer = pasted.scene.nodes[pasted.nodeIds[0] ?? asNodeId("missing")];
const sourceCustomer = ER_COMMERCE.nodes["customers"];
assert.ok(pastedCustomer !== undefined && sourceCustomer !== undefined, "pasted customer exists");
check(
  pastedCustomer.frame.x === sourceCustomer.frame.x + 18 &&
    pastedCustomer.frame.y === sourceCustomer.frame.y + 18,
  "pasted frames are offset",
);

const pastedEdges = pasted.edgeIds.map((id) => pasted.scene.edges[id]);
const pastedTether = pastedEdges.find((edge) => edge?.target.target === "edge");
if (pastedTether === undefined || pastedTether.target.target !== "edge") {
  throw new Error("expected a pasted relation-attribute tether");
}
const parentEdgeId = pastedTether.target.edgeId;
check(
  pastedEdges.some((edge) => edge?.id === parentEdgeId),
  "pasted tether targets the pasted parent edge",
);
check(
  pastedEdges.every((edge) =>
    edge !== undefined &&
    (edge.source.target !== "node" || !Object.hasOwn(ER_COMMERCE.nodes, edge.source.nodeId)) &&
    (edge.target.target !== "node" || !Object.hasOwn(ER_COMMERCE.nodes, edge.target.nodeId))),
  "pasted edges target only pasted nodes",
);
check(
  pastedEdges.every((edge) =>
    edge !== undefined &&
    (edge.source.target !== "edge" || !Object.hasOwn(ER_COMMERCE.edges, edge.source.edgeId)) &&
    (edge.target.target !== "edge" || !Object.hasOwn(ER_COMMERCE.edges, edge.target.edgeId))),
  "pasted edge attachments target only pasted edges",
);

const removed = deleteNodes(ER_COMMERCE, [asNodeId("customers"), asNodeId("orders")]);
check(removed.nodes["customers"] === undefined, "batch delete removes the first node");
check(removed.nodes["orders"] === undefined, "batch delete removes the second node");
check(removed.edges["edge_places"] === undefined, "batch delete removes the connectors of removed nodes");
check(removed.edges["edge_order_line"] === undefined, "batch delete removes tethers to removed connectors");

const imageCopy = copySceneNodes(UML_USE_CASE_SHOP, ["brand_image"]);
assert.ok(imageCopy !== null, "image node should copy");
check(Object.keys(imageCopy.assets).length === 1, "image clipboard retains its asset");
const withoutImage = deleteNodes(UML_USE_CASE_SHOP, [asNodeId("brand_image")]);
check(Object.keys(withoutImage.assets).length === 0, "cutting an image prunes its asset from the scene");
const pastedImage = pasteSceneClipboard(withoutImage, imageCopy, { x: 18, y: 18 });
assert.ok(pastedImage !== null, "image node should paste");
check(
  Object.keys(pastedImage.scene.assets).length === 1,
  "pasting an image restores its asset",
);
check(
  pastedImage.nodeIds.every((id) => pastedImage.scene.nodes[id]?.kind === "image"),
  "pasted image node is present",
);

console.log(`Clipboard checks passed (${checked} assertions).`);
