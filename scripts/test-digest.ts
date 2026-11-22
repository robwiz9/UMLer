/**
 * LLM digest contract checks across every diagram family.
 */

import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
import { buildLayoutSnapshot } from "../src/layout/build-layout.ts";
import { FixedTextMeasurer } from "../src/layout/text.ts";
import { serializeSceneToDigest } from "../src/export/diagram-digest.ts";
import type { SceneDocument } from "../src/model/scene.ts";
import type { SceneEdge } from "../src/model/edges.ts";
import type { TableNode } from "../src/model/nodes.ts";
import { createEdgeForDiagram } from "../src/model/edge-create.ts";
import { insertEdge } from "../src/model/edits.ts";
import { asEdgeId, asNodeId } from "../src/model/ids.ts";

let passed = 0;
const failures: string[] = [];

const check = (condition: boolean, message: string): void => {
  if (condition) passed += 1;
  else failures.push(message);
};

const digestOf = (scene: SceneDocument): string =>
  serializeSceneToDigest(
    scene,
    buildLayoutSnapshot(scene, new FixedTextMeasurer()),
  ).text;

const fixture = (kind: SceneDocument["meta"]["diagramKind"]): SceneDocument => {
  const found = STEP1_FIXTURES.find(
    (candidate) => candidate.scene.meta.diagramKind === kind,
  );
  if (found === undefined) throw new Error(`Missing ${kind} fixture`);
  return found.scene;
};

const er = fixture("er");
const erText = digestOf(er);
check(erText.startsWith("UMLER-DIGEST 1\nKIND er"), "ER digest has its header");
check(erText.includes("# HOW TO READ"), "digest includes reading instructions");
check(erText.includes("# E=entity"), "ER instructions explain record prefixes");
check(
  erText.includes("never by E1/R1/C1/etc."),
  "digest instructs reviewers not to use local IDs in prose",
);
check(erText.includes('E1 "customers"'), "ER entities use stable E ids");
check(erText.includes('RA1 "order_line" attached=R1'), "ER relation attributes attach to their relation");
check(erText.includes('R1 "places"'), "ER relationship keeps its semantic name");
check(erText.includes("E1 1 -> E2 0..*"), "ER relationship keeps cardinalities");
check(!erText.includes("RR1"), "ER relationship ids are not doubled");

const erClone = structuredClone(er);
const places = Object.values(erClone.edges)[0] as SceneEdge;
const erInheritance: SceneDocument = {
  ...erClone,
  edges: {
    ...erClone.edges,
    edge_er_inheritance: {
      ...places,
      id: asEdgeId("edge_er_inheritance"),
      semantic: { family: "er", name: "inherits" },
      markers: {
        source: { family: "none", kind: "none" },
        target: { family: "er", kind: "inheritance" },
      },
    },
  },
};
const erInheritanceText = digestOf(erInheritance);
check(
  erInheritanceText.includes("kind=inheritance | child=E1 parent=E2") ||
    erInheritanceText.includes("kind=inheritance | child=E2 parent=E1"),
  "ER inheritance records child and parent",
);

const classText = digestOf(fixture("uml-class"));
check(classText.includes("kind=composition whole=C2 part=C4"), "class composition names whole and part");
check(classText.includes("kind=realization"), "class realization is preserved");
check(classText.includes("interface=yes"), "class interfaces are marked");
check(
  !classText.includes('stereotype="interface"'),
  "an interface stereotype is represented by interface=yes, not free text",
);

const classWithHeader = (nodeId: string, header: TableNode["header"]): SceneDocument => {
  const base = fixture("uml-class");
  const node = base.nodes[nodeId];
  if (node === undefined || node.kind !== "table") throw new Error(`missing class ${nodeId}`);
  return { ...base, nodes: { ...base.nodes, [nodeId]: { ...node, header } } };
};
const cardClass = fixture("uml-class").nodes[asNodeId("card_payment")];
const orderClass = fixture("uml-class").nodes[asNodeId("order")];
if (cardClass === undefined || cardClass.kind !== "table") throw new Error("missing card class");
if (orderClass === undefined || orderClass.kind !== "table") throw new Error("missing order class");

const abstractText = digestOf(
  classWithHeader("card_payment", {
    ...cardClass.header,
    stereotype: "abstract",
    abstract: undefined,
    isInterface: undefined,
  }),
);
check(
  /C\d+ "CardPayment" table=class abstract=yes interface=no/.test(abstractText),
  "stereotype=abstract sets abstract=yes",
);
check(
  !abstractText.includes('stereotype="abstract"'),
  "an abstract stereotype is represented by abstract=yes, not free text",
);

const interfaceText = digestOf(
  classWithHeader("order", {
    ...orderClass.header,
    stereotype: "«Interface»",
    abstract: undefined,
    isInterface: undefined,
  }),
);
check(
  /C\d+ "Order" table=class abstract=no interface=yes/.test(interfaceText),
  "a decorated interface stereotype sets interface=yes",
);
check(
  !interfaceText.includes("stereotype="),
  "the interface stereotype is not repeated as free text",
);

const utilityText = digestOf(
  classWithHeader("order", {
    ...orderClass.header,
    stereotype: "utility",
    abstract: undefined,
    isInterface: undefined,
  }),
);
check(
  /C\d+ "Order" table=class abstract=no interface=no\s+stereotype="utility"/.test(utilityText),
  "a non-semantic stereotype remains free text",
);

const classClone = structuredClone(fixture("uml-class"));
const classEdge = Object.values(classClone.edges)[0] as SceneEdge;
const aggregationClass: SceneDocument = {
  ...classClone,
  edges: {
    ...classClone.edges,
    [classEdge.id]: {
      ...classEdge,
      semantic: { family: "uml", relationship: "aggregation" },
      markers: {
        source: { family: "uml", kind: "aggregation" },
        target: { family: "none", kind: "none" },
      },
    },
  },
};
check(
  digestOf(aggregationClass).includes("kind=aggregation whole="),
  "class aggregation names whole and part",
);

const useCaseText = digestOf(fixture("uml-use-case"));
check(useCaseText.includes("kind=include"), "use-case include is named");
check(useCaseText.includes("kind=extend"), "use-case extend is named");
check(useCaseText.includes("contains=U1,U2,U3"), "use-case boundary lists contained use cases");

const sequenceText = digestOf(fixture("uml-sequence"));
check(sequenceText.includes("M1 #1 P1 -> P2 kind=sync"), "sequence messages are ordered");
check(sequenceText.includes("ACT A1 owner=P2"), "sequence activations identify their participant");

const communicationClone = structuredClone(fixture("uml-communication"));
const firstCommunicationEdge = Object.values(communicationClone.edges)[0] as SceneEdge;
const communication: SceneDocument = {
  ...communicationClone,
  edges: {
    ...communicationClone.edges,
    [firstCommunicationEdge.id]: {
      ...firstCommunicationEdge,
      source: { target: "free", point: { x: 0, y: 0 } },
    },
  },
};
const communicationText = digestOf(communication);
check(
  communicationText.includes("external -> O2 signature=") ||
    communicationText.includes("external -> O1 signature="),
  "communication external calls use an explicit external source",
);

const stateText = digestOf(fixture("uml-state-machine"));
check(stateText.includes("P1 kind=initial"), "state initial pseudostates are explicit");
check(stateText.includes('trigger="submit"'), "state transition triggers are preserved");

const circuitText = digestOf(fixture("circuit"));
check(circuitText.includes("CIRCUIT standard=iec"), "circuit standard is exported");
check(circuitText.includes("NET N1:"), "circuit export includes netlists");
check(circuitText.includes("JUNCTION J1"), "circuit junctions are exported");

// Unary / self relations are first-class records: both ends name the same
// object, `self=yes` makes that explicit, and self messages expose both rows.
const erSelfEdge = createEdgeForDiagram(
  er,
  { nodeId: asNodeId("customers"), port: { kind: "perimeter", side: "east" } },
  { nodeId: asNodeId("customers"), port: { kind: "perimeter", side: "north" } },
);
if (erSelfEdge === null) throw new Error("ER self relation was rejected");
const erSelfText = digestOf(insertEdge(er, erSelfEdge));
check(
  erSelfText.includes('self=yes | E1 "1" -> E1 "1"'),
  "ER self relationship repeats E1 and is marked self",
);
check(erSelfText.includes("self_relations=1"), "digest counts the ER self relationship");
check(!/self=yes \|/.test(erText), "ordinary relations are not marked self");

const classFixture = fixture("uml-class");
const classSelfEdge = createEdgeForDiagram(
  classFixture,
  { nodeId: asNodeId("card_payment"), port: { kind: "perimeter", side: "east" } },
  { nodeId: asNodeId("card_payment"), port: { kind: "perimeter", side: "south" } },
);
if (classSelfEdge === null) throw new Error("Class self relation was rejected");
const classSelfText = digestOf(insertEdge(classFixture, classSelfEdge));
check(
  /R\d+ kind=association self=yes \| C\d+ -> C\d+/.test(classSelfText),
  "class self association is marked self",
);

const sequenceFixture = fixture("uml-sequence");
const sequenceSelfEdge = createEdgeForDiagram(
  sequenceFixture,
  { nodeId: asNodeId("seq_order_service"), port: { kind: "spine", t: 0.2 } },
  { nodeId: asNodeId("seq_order_service"), port: { kind: "spine", t: 0.4 } },
);
if (sequenceSelfEdge === null) throw new Error("Sequence self message was rejected");
const sequenceSelfText = digestOf(insertEdge(sequenceFixture, sequenceSelfEdge));
check(
  sequenceSelfText.includes("P2 -> P2 kind=sync self=yes"),
  "sequence self message repeats the participant and is marked self",
);
check(
  /P2 -> P2 kind=sync self=yes[^\n]*t=\d+\.\.\d+/.test(sequenceSelfText),
  "sequence self message exposes a start..end event range",
);
check(sequenceSelfText.includes("self_relations=1"), "digest counts the sequence self message");

// Every remaining family uses the same self flag. Reuse an existing endpoint
// as both ends so the test does not depend on per-family port names.
for (const kind of [
  "uml-use-case",
  "uml-communication",
  "uml-state-machine",
] as const) {
  const scene = fixture(kind);
  const baseEdge = Object.values(scene.edges)[0];
  if (baseEdge === undefined || baseEdge.source.target !== "node") {
    throw new Error(`${kind} fixture has no node endpoint`);
  }
  const selfEdge: SceneEdge = {
    ...baseEdge,
    id: asEdgeId(`edge_self_${kind}`),
    target: baseEdge.source,
  };
  check(
    digestOf(insertEdge(scene, selfEdge)).includes("self=yes"),
    `${kind} self relation is marked`,
  );
}

for (const entry of STEP1_FIXTURES) {
  const text = digestOf(entry.scene);
  check(text.includes("WARNINGS"), `${entry.scene.meta.diagramKind} includes warning summary`);
  check(!text.includes("undefined"), `${entry.scene.meta.diagramKind} has no undefined tokens`);
}

if (failures.length > 0) {
  console.error("Digest checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Digest checks passed (${passed} assertions).`);
}
