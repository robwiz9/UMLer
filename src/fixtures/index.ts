/**
 * Step 1 fixtures.
 *
 * These are intentionally small but exercise every node family and every edge
 * attachment kind: node perimeter, row port, spine port, and edge-to-edge.
 * They are validated by `scripts/validate-fixtures.ts`.
 */

import {
  asActivationId,
  asAssetId,
  asEdgeId,
  asLabelId,
  asNodeId,
  asRowId,
  asSceneId,
  asSectionId,
} from "../model/ids.ts";
import type { SceneDocument } from "../model/scene.ts";
import { createEmptyScene, type DiagramKind } from "../model/scene.ts";
import { DEFAULT_THEME } from "../model/styles.ts";
import { rect, type Rect } from "../model/geometry.ts";
import type {
  ActivationBar,
  ActorNode,
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
  UseCaseNode,
} from "../model/nodes.ts";
import type {
  EdgeAttachment,
  EdgeLabel,
  EdgeRouting,
  EdgeSemantic,
  NodePortRef,
  SceneEdge,
} from "../model/edges.ts";
import { NO_MARKER } from "../model/edges.ts";
import type {
  ErEndpointMarker,
  GenericMarkerKind,
  UmlEndpointMarker,
  EndpointMarker,
} from "../model/markers.ts";

const FRAME = (x: number, y: number, width: number, height: number): Rect =>
  rect(x, y, width, height);

const uml = (kind: UmlEndpointMarker["kind"]): EndpointMarker => ({ family: "uml", kind });
const er = (kind: ErEndpointMarker["kind"]): EndpointMarker => ({ family: "er", kind });
const generic = (kind: GenericMarkerKind): EndpointMarker => ({ family: "generic", kind });

const row = (
  id: string,
  name: string,
  kind: TableRow["kind"] = "attribute",
  extra: Partial<TableRow> = {},
): TableRow => ({
  id: asRowId(id),
  kind,
  name,
  ...extra,
});

const section = (id: string, role: "attributes" | "methods", rows: readonly TableRow[]) => ({
  id: asSectionId(id),
  role,
  rows,
});

const table = (
  id: string,
  name: string,
  frame: Rect,
  tableKind: TableNode["tableKind"],
  sections: TableNode["sections"],
  header: TableNode["header"] = {},
): TableNode => ({
  id: asNodeId(id),
  kind: "table",
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  tableKind,
  header,
  sections,
  style: DEFAULT_THEME.table,
});

const relationAttribute = (
  id: string,
  name: string,
  frame: Rect,
  rows: readonly TableRow[],
): RelationAttributeNode => ({
  id: asNodeId(id),
  kind: "relationAttribute",
  name,
  frame,
  z: 3,
  locked: false,
  visible: true,
  rows,
  style: DEFAULT_THEME.table,
});

const actor = (id: string, name: string, frame: Rect): ActorNode => ({
  id: asNodeId(id),
  kind: "actor",
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  labelPlacement: "below",
  style: DEFAULT_THEME.shape,
});

const useCase = (id: string, name: string, frame: Rect): UseCaseNode => ({
  id: asNodeId(id),
  kind: "useCase",
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  style: DEFAULT_THEME.shape,
});

const objectNode = (id: string, name: string, frame: Rect, classifier?: string): ObjectNode => ({
  id: asNodeId(id),
  kind: "object",
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  classifier,
  underlineName: true,
  style: DEFAULT_THEME.shape,
});

const state = (id: string, name: string, frame: Rect): StateNode => ({
  id: asNodeId(id),
  kind: "state",
  name,
  frame,
  z: 2,
  locked: false,
  visible: true,
  stateKind: "simple",
  style: DEFAULT_THEME.shape,
});

const pseudostate = (
  id: string,
  kind: PseudostateNode["pseudostateKind"],
  frame: Rect,
): PseudostateNode => ({
  id: asNodeId(id),
  kind: "pseudostate",
  name: kind,
  frame,
  z: 2,
  locked: false,
  visible: true,
  pseudostateKind: kind,
  style: DEFAULT_THEME.shape,
});

const frame = (
  id: string,
  name: string,
  rectValue: Rect,
  frameKind: FrameNode["frameKind"],
  extra: Partial<FrameNode> = {},
): FrameNode => ({
  id: asNodeId(id),
  kind: "frame",
  name,
  frame: rectValue,
  z: 0,
  locked: false,
  visible: true,
  frameKind,
  style: DEFAULT_THEME.shape,
  ...extra,
});

const lifeline = (
  id: string,
  name: string,
  frameValue: Rect,
  head: LifelineNode["head"],
  activationBars: readonly ActivationBar[] = [],
): LifelineNode => ({
  id: asNodeId(id),
  kind: "lifeline",
  name,
  frame: frameValue,
  z: 2,
  locked: false,
  visible: true,
  head,
  headHeight: 36,
  activationBars,
  style: DEFAULT_THEME.shape,
});

const activation = (id: string, top: number, height: number, level = 0): ActivationBar => ({
  id: asActivationId(id),
  top,
  height,
  level,
});

const label = (
  id: string,
  zone: EdgeLabel["zone"],
  text: string,
  anchorT: number,
  offset = { x: 0, y: -12 },
): EdgeLabel => ({
  id: asLabelId(id),
  zone,
  text,
  anchor: { kind: "edgePoint", t: anchorT },
  offset,
  locked: false,
  visible: true,
});

const nodeAttachment = (nodeId: string, port: NodePortRef): EdgeAttachment => ({
  target: "node",
  nodeId: asNodeId(nodeId),
  port,
});

const edgeToEdge = (edgeId: string, t: number): EdgeAttachment => ({
  target: "edge",
  edgeId: asEdgeId(edgeId),
  t,
});

const routing = (mode: EdgeRouting["mode"] = "orthogonal"): EdgeRouting => ({
  mode,
  avoidObstacles: true,
  obstaclePadding: 9,
  stubLength: 9,
  waypoints: [],
});

const edge = (
  id: string,
  source: EdgeAttachment,
  target: EdgeAttachment,
  semantic: EdgeSemantic,
  options: {
    readonly markers?: { readonly source: EndpointMarker; readonly target: EndpointMarker };
    readonly labels?: readonly EdgeLabel[];
    readonly strokePattern?: "solid" | "dashed" | "dotted";
    readonly z?: number;
  } = {},
): SceneEdge => ({
  id: asEdgeId(id),
  source,
  target,
  routing: routing(semantic.family === "sequence" ? "straight" : "orthogonal"),
  markers: options.markers ?? { source: NO_MARKER, target: NO_MARKER },
  labels: options.labels ?? [],
  semantic,
  style: {
    ...DEFAULT_THEME.edge,
    stroke: {
      ...DEFAULT_THEME.edge.stroke,
      pattern: options.strokePattern ?? DEFAULT_THEME.edge.stroke.pattern,
    },
  },
  locked: false,
  visible: true,
  z: options.z ?? 10,
});

const scene = (
  id: string,
  diagramKind: DiagramKind,
  title: string,
  nodes: readonly SceneNode[],
  edges: readonly SceneEdge[],
  assets: readonly ImageAsset[] = [],
): SceneDocument => {
  const base = createEmptyScene(diagramKind, title);
  return {
    ...base,
    id: asSceneId(id),
    meta: {
      ...base.meta,
      title,
      description: "Step 1 schema fixture",
      createdAt: "2026-11-09T12:00:00.000Z",
      updatedAt: "2026-11-09T12:00:00.000Z",
    },
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    edges: Object.fromEntries(edges.map((edgeValue) => [edgeValue.id, edgeValue])),
    assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
  };
};

const brandAsset: ImageAsset = {
  id: asAssetId("asset_brand"),
  kind: "vector",
  fileName: "brand.svg",
  mimeType: "image/svg+xml",
  byteLength: 2048,
  intrinsicWidth: 320,
  intrinsicHeight: 180,
  checksum: "sha256:step1-fixture-brand",
  storage: "project-file",
  exportPath: "assets/brand.svg",
};

const imageNode: ImageNode = {
  id: asNodeId("brand_image"),
  kind: "image",
  name: "Brand reference",
  frame: FRAME(684, 72, 144, 90),
  z: 2,
  locked: false,
  visible: true,
  assetId: brandAsset.id,
  caption: "Figure 1 — imported reference",
  fit: "contain",
  alt: "Placeholder brand image",
  showBorder: false,
  style: DEFAULT_THEME.shape,
};

export const ER_COMMERCE: SceneDocument = scene(
  "scene_er_commerce",
  "er",
  "ER — commerce",
  [
    table(
      "customers",
      "customers",
      FRAME(36, 72, 225, 90),
      "entity",
      [
        section("customers_attrs", "attributes", [
          row("customers_id", "id", "attribute", {
            type: "uuid",
            constraints: ["PK", "NN"],
          }),
          row("customers_email", "email", "attribute", {
            type: "citext",
            constraints: ["UQ", "NN"],
          }),
          row("customers_name", "name", "attribute", { type: "text" }),
        ]),
      ],
    ),
    table(
      "orders",
      "orders",
      FRAME(396, 72, 225, 108),
      "entity",
      [
        section("orders_attrs", "attributes", [
          row("orders_id", "id", "attribute", {
            type: "uuid",
            constraints: ["PK", "NN"],
          }),
          row("orders_customer_id", "customer_id", "attribute", {
            type: "uuid",
            constraints: ["FK", "NN"],
          }),
          row("orders_total", "total", "attribute", {
            type: "numeric(12,2)",
            constraints: ["NN"],
          }),
          row("orders_placed_at", "placed_at", "attribute", {
            type: "timestamptz",
            constraints: ["NN"],
          }),
        ]),
      ],
    ),
    relationAttribute(
      "order_line",
      "order_line",
      FRAME(225, 207, 198, 72),
      [
        row("order_line_quantity", "quantity", "attribute", {
          type: "int",
          constraints: ["NN"],
        }),
        row("order_line_unit_price", "unit_price", "attribute", {
          type: "numeric(12,2)",
          constraints: ["NN"],
        }),
      ],
    ),
  ],
  [
    edge(
      "edge_places",
      nodeAttachment("customers", { kind: "perimeter", side: "east" }),
      nodeAttachment("orders", { kind: "perimeter", side: "west" }),
      { family: "er", name: "places" },
      {
        markers: { source: er("one"), target: er("zeroOrMany") },
        labels: [
          label("label_places_source", "source", "1", 0.12),
          label("label_places_center", "center", "places", 0.5),
          label("label_places_target", "target", "0..*", 0.88),
        ],
      },
    ),
    edge(
      "edge_order_line",
      nodeAttachment("order_line", { kind: "perimeter", side: "east" }),
      edgeToEdge("edge_places", 0.5),
      { family: "er", name: "has" },
      {
        strokePattern: "dashed",
        labels: [label("label_order_line_center", "center", "line items", 0.5)],
      },
    ),
  ],
);

export const UML_CLASS_PAYMENTS: SceneDocument = scene(
  "scene_uml_class_payments",
  "uml-class",
  "UML Class — payments",
  [
    table(
      "payment_method",
      "PaymentMethod",
      FRAME(36, 72, 225, 72),
      "class",
      [
        section("payment_method_ops", "methods", [
          row("payment_method_authorize", "authorize", "method", {
            visibility: "+",
            parameters: [{ name: "amount", type: "Money" }],
            returnType: "Authorization",
            abstract: true,
          }),
          row("payment_method_capture", "capture", "method", {
            visibility: "+",
            parameters: [{ name: "auth", type: "Authorization" }],
            returnType: "Receipt",
            abstract: true,
          }),
        ]),
      ],
      { stereotype: "interface", isInterface: true },
    ),
    table(
      "card_payment",
      "CardPayment",
      FRAME(36, 216, 225, 108),
      "class",
      [
        section("card_payment_attrs", "attributes", [
          row("card_payment_last4", "last4", "attribute", {
            visibility: "-",
            type: "string",
          }),
          row("card_payment_brand", "brand", "attribute", {
            visibility: "-",
            type: "CardBrand",
          }),
          row("card_payment_expiry", "expiry", "attribute", {
            visibility: "-",
            type: "YearMonth",
          }),
        ]),
        section("card_payment_ops", "methods", [
          row("card_payment_authorize", "authorize", "method", {
            visibility: "+",
            parameters: [{ name: "amount", type: "Money" }],
            returnType: "Authorization",
          }),
          row("card_payment_capture", "capture", "method", {
            visibility: "+",
            parameters: [{ name: "auth", type: "Authorization" }],
            returnType: "Receipt",
          }),
        ]),
      ],
    ),
    table(
      "order",
      "Order",
      FRAME(396, 72, 225, 126),
      "class",
      [
        section("order_attrs", "attributes", [
          row("order_id", "id", "attribute", { visibility: "-", type: "UUID" }),
          row("order_total", "total", "attribute", { visibility: "-", type: "Money" }),
          row("order_status", "status", "attribute", { visibility: "-", type: "OrderStatus" }),
        ]),
        section("order_ops", "methods", [
          row("order_submit", "submit", "method", {
            visibility: "+",
            returnType: "Receipt",
          }),
          row("order_cancel", "cancel", "method", {
            visibility: "+",
            returnType: "void",
          }),
        ]),
      ],
    ),
    table(
      "order_line",
      "OrderLine",
      FRAME(396, 270, 225, 90),
      "class",
      [
        section("order_line_attrs", "attributes", [
          row("order_line_quantity", "quantity", "attribute", {
            visibility: "-",
            type: "int",
          }),
          row("order_line_price", "unitPrice", "attribute", {
            visibility: "-",
            type: "Money",
          }),
          row("order_line_discount", "discount", "attribute", {
            visibility: "-",
            type: "Percentage",
          }),
        ]),
      ],
    ),
  ],
  [
    edge(
      "edge_realizes",
      nodeAttachment("card_payment", { kind: "perimeter", side: "north" }),
      nodeAttachment("payment_method", { kind: "perimeter", side: "south" }),
      { family: "uml", relationship: "realization" },
      {
        markers: { source: NO_MARKER, target: uml("realization") },
        strokePattern: "dashed",
      },
    ),
    edge(
      "edge_composition",
      nodeAttachment("order", { kind: "perimeter", side: "south" }),
      nodeAttachment("order_line", { kind: "perimeter", side: "north" }),
      { family: "uml", relationship: "composition" },
      {
        markers: { source: uml("composition"), target: NO_MARKER },
        labels: [label("label_composition_target", "target", "1..*", 0.88)],
      },
    ),
    edge(
      "edge_uses_payment",
      nodeAttachment("order", { kind: "perimeter", side: "west" }),
      nodeAttachment("payment_method", { kind: "perimeter", side: "east" }),
      { family: "uml", relationship: "directedAssociation" },
      {
        markers: { source: NO_MARKER, target: uml("directedAssociation") },
        labels: [
          label("label_uses_source", "source", "1", 0.12),
          label("label_uses_center", "center", "authorizes", 0.5),
          label("label_uses_target", "target", "1", 0.88),
        ],
      },
    ),
  ],
);

export const UML_SEQUENCE_CHECKOUT: SceneDocument = scene(
  "scene_uml_sequence_checkout",
  "uml-sequence",
  "UML Sequence — checkout",
  [
    lifeline(
      "seq_customer",
      "Customer",
      FRAME(36, 72, 108, 630),
      { headKind: "actor", label: "Customer" },
    ),
    lifeline(
      "seq_order_service",
      ":OrderService",
      FRAME(216, 72, 108, 630),
      { headKind: "object", label: ":OrderService" },
      [activation("act_order_service", 108, 234, 0)],
    ),
    lifeline(
      "seq_gateway",
      ":PaymentGateway",
      FRAME(396, 72, 108, 630),
      { headKind: "boundary", label: ":PaymentGateway" },
      [activation("act_gateway", 198, 90, 0)],
    ),
  ],
  [
    edge(
      "msg_submit",
      nodeAttachment("seq_customer", { kind: "spine", t: 0.18 }),
      nodeAttachment("seq_order_service", { kind: "spine", t: 0.18 }),
      { family: "sequence", messageKind: "sync", signature: "submit()" },
      { labels: [label("label_msg_submit", "center", "submit()", 0.5, { x: 0, y: -18 })] },
    ),
    edge(
      "msg_charge",
      nodeAttachment("seq_order_service", { kind: "spine", t: 0.32 }),
      nodeAttachment("seq_gateway", { kind: "spine", t: 0.32 }),
      { family: "sequence", messageKind: "sync", signature: "charge(total)" },
      { labels: [label("label_msg_charge", "center", "charge(total)", 0.5, { x: 0, y: -18 })] },
    ),
    edge(
      "msg_approved",
      nodeAttachment("seq_gateway", { kind: "spine", t: 0.44 }),
      nodeAttachment("seq_order_service", { kind: "spine", t: 0.44 }),
      { family: "sequence", messageKind: "reply", signature: "approved" },
      {
        strokePattern: "dashed",
        labels: [label("label_msg_approved", "center", "approved", 0.5, { x: 0, y: -18 })],
      },
    ),
    edge(
      "msg_receipt",
      nodeAttachment("seq_order_service", { kind: "spine", t: 0.58 }),
      nodeAttachment("seq_customer", { kind: "spine", t: 0.58 }),
      { family: "sequence", messageKind: "reply", signature: "receipt" },
      {
        strokePattern: "dashed",
        labels: [label("label_msg_receipt", "center", "receipt", 0.5, { x: 0, y: -18 })],
      },
    ),
  ],
);

export const UML_USE_CASE_SHOP: SceneDocument = scene(
  "scene_uml_use_case_shop",
  "uml-use-case",
  "UML Use Case — shop",
  [
    frame("shop_boundary", "Shop", FRAME(180, 72, 450, 270), "system-boundary", {
      tabHeight: 27,
    }),
    actor("shop_customer", "Customer", FRAME(36, 126, 72, 126)),
    useCase("uc_checkout", "Checkout", FRAME(225, 117, 162, 54)),
    useCase("uc_pay", "Pay", FRAME(432, 117, 144, 54)),
    useCase("uc_receipt", "Email receipt", FRAME(225, 225, 162, 54)),
    imageNode,
  ],
  [
    edge(
      "use_case_assoc",
      nodeAttachment("shop_customer", { kind: "perimeter", side: "east" }),
      nodeAttachment("uc_checkout", { kind: "perimeter", side: "west" }),
      { family: "uml", relationship: "association" },
      { labels: [label("label_use_case_assoc", "center", "starts", 0.5)] },
    ),
    edge(
      "use_case_include",
      nodeAttachment("uc_checkout", { kind: "perimeter", side: "east" }),
      nodeAttachment("uc_pay", { kind: "perimeter", side: "west" }),
      { family: "uml", relationship: "dependency" },
      {
        markers: { source: NO_MARKER, target: uml("dependency") },
        strokePattern: "dashed",
        labels: [label("label_use_case_include", "center", "«include»", 0.5)],
      },
    ),
    edge(
      "use_case_extend",
      nodeAttachment("uc_receipt", { kind: "perimeter", side: "north" }),
      nodeAttachment("uc_checkout", { kind: "perimeter", side: "south" }),
      { family: "uml", relationship: "dependency" },
      {
        markers: { source: NO_MARKER, target: uml("dependency") },
        strokePattern: "dashed",
        labels: [label("label_use_case_extend", "center", "«extend»", 0.5)],
      },
    ),
  ],
  [brandAsset],
);

export const UML_STATE_ORDER: SceneDocument = scene(
  "scene_uml_state_order",
  "uml-state-machine",
  "UML State Machine — order",
  [
    pseudostate("state_initial", "initial", FRAME(72, 90, 18, 18)),
    state("state_idle", "Idle", FRAME(144, 72, 180, 54)),
    state("state_awaiting", "Awaiting payment", FRAME(378, 72, 216, 54)),
    state("state_fulfilled", "Fulfilled", FRAME(378, 216, 216, 54)),
    pseudostate("state_final", "final", FRAME(684, 90, 18, 18)),
  ],
  [
    edge(
      "transition_start",
      nodeAttachment("state_initial", { kind: "perimeter", side: "east" }),
      nodeAttachment("state_idle", { kind: "perimeter", side: "west" }),
      { family: "state" },
      { markers: { source: NO_MARKER, target: generic("arrow") } },
    ),
    edge(
      "transition_submit",
      nodeAttachment("state_idle", { kind: "perimeter", side: "east" }),
      nodeAttachment("state_awaiting", { kind: "perimeter", side: "west" }),
      { family: "state", trigger: "submit", guard: "total > 0", effect: "reserve stock" },
      {
        markers: { source: NO_MARKER, target: generic("arrow") },
        labels: [
          label("label_transition_submit", "center", "submit [total > 0] / reserve stock", 0.5),
        ],
      },
    ),
    edge(
      "transition_paid",
      nodeAttachment("state_awaiting", { kind: "perimeter", side: "south" }),
      nodeAttachment("state_fulfilled", { kind: "perimeter", side: "north" }),
      { family: "state", trigger: "paymentApproved" },
      {
        markers: { source: NO_MARKER, target: generic("arrow") },
        labels: [label("label_transition_paid", "center", "paymentApproved", 0.5)],
      },
    ),
    edge(
      "transition_finish",
      nodeAttachment("state_fulfilled", { kind: "perimeter", side: "east" }),
      nodeAttachment("state_final", { kind: "perimeter", side: "west" }),
      { family: "state" },
      { markers: { source: NO_MARKER, target: generic("arrow") } },
    ),
  ],
);

export const UML_COMMUNICATION_CHECKOUT: SceneDocument = scene(
  "scene_uml_communication_checkout",
  "uml-communication",
  "UML Communication — checkout",
  [
    objectNode("comm_ui", ":CheckoutUI", FRAME(72, 90, 162, 45)),
    objectNode("comm_service", ":OrderService", FRAME(360, 90, 180, 45)),
    objectNode("comm_inventory", ":Inventory", FRAME(360, 225, 180, 45)),
  ],
  [
    edge(
      "comm_create",
      nodeAttachment("comm_ui", { kind: "perimeter", side: "east" }),
      nodeAttachment("comm_service", { kind: "perimeter", side: "west" }),
      { family: "communication", sequence: "1", signature: "create()", direction: "forward" },
      {
        markers: { source: NO_MARKER, target: generic("arrow") },
        labels: [label("label_comm_create", "center", "1: create()", 0.5, { x: 0, y: -12 })],
      },
    ),
    edge(
      "comm_reserve",
      nodeAttachment("comm_service", { kind: "perimeter", side: "south" }),
      nodeAttachment("comm_inventory", { kind: "perimeter", side: "north" }),
      { family: "communication", sequence: "1.1", signature: "reserve()", direction: "forward" },
      {
        markers: { source: NO_MARKER, target: generic("arrow") },
        labels: [label("label_comm_reserve", "center", "1.1: reserve()", 0.5, { x: 0, y: -12 })],
      },
    ),
    edge(
      "comm_confirm",
      nodeAttachment("comm_inventory", { kind: "perimeter", side: "east" }),
      nodeAttachment("comm_service", { kind: "perimeter", side: "east" }),
      { family: "communication", sequence: "1.2", signature: "confirmed", direction: "reverse" },
      {
        markers: { source: NO_MARKER, target: generic("arrow") },
        strokePattern: "dashed",
        labels: [label("label_comm_confirm", "center", "1.2: confirmed", 0.5, { x: 0, y: -12 })],
      },
    ),
  ],
);

export const STEP1_FIXTURES: readonly { readonly name: string; readonly scene: SceneDocument }[] = [
  { name: "ER commerce", scene: ER_COMMERCE },
  { name: "UML class payments", scene: UML_CLASS_PAYMENTS },
  { name: "UML sequence checkout", scene: UML_SEQUENCE_CHECKOUT },
  { name: "UML use case shop", scene: UML_USE_CASE_SHOP },
  { name: "UML state order", scene: UML_STATE_ORDER },
  { name: "UML communication checkout", scene: UML_COMMUNICATION_CHECKOUT },
];

