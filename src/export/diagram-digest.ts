/**
 * Compact semantic text digest for LLM-based diagram review.
 *
 * The digest is deliberately not round-trippable: geometry, styling and
 * editor-only state are omitted. What remains is the declaration graph in a
 * stable, line-oriented form that is cheaper to read than scene JSON and more
 * precise than an image.
 */

import type { SceneDocument } from "../model/scene.ts";
import type {
  ImageNode,
  LifelineNode,
  SceneNode,
  TableNode,
  TableRow,
  Visibility,
} from "../model/nodes.ts";
import { normalizeStereotypeName } from "../model/nodes.ts";
import type { SceneEdge } from "../model/edges.ts";
import { markerDefinition } from "../model/markers.ts";
import type { LayoutSnapshot } from "../model/layout.ts";
import { rectCenter, rectContainsPoint } from "../model/geometry.ts";
import { circuitComponent } from "../model/circuit-catalog.ts";
import { resolveCircuitSettings } from "../model/circuit.ts";

export interface DigestResult {
  readonly text: string;
  readonly warnings: readonly string[];
  readonly stats: Readonly<Record<string, number>>;
}

class ListWriter {
  readonly lines: string[] = [];

  push(line = ""): void {
    this.lines.push(line);
  }

  toString(): string {
    return this.lines.join("\n");
  }
}

const q = (value: string | undefined | null): string =>
  JSON.stringify(value ?? "");

const bool = (value: boolean | undefined): string => (value ? "yes" : "no");

const field = (name: string, value: string | number | undefined | null): string =>
  value === undefined || value === null || `${value}`.length === 0
    ? ""
    : ` ${name}=${typeof value === "number" ? value : q(value)}`;

const flag = (name: string, value: boolean | undefined, whenFalse = false): string =>
  value === true || (whenFalse && value === false) ? ` ${name}=${bool(value)}` : "";

const hiddenFlag = (node: SceneNode | SceneEdge): string =>
  flag("hidden", node.visible === false);

const nodeSort = (a: SceneNode, b: SceneNode): number =>
  a.frame.y - b.frame.y ||
  a.frame.x - b.frame.x ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

const edgeSort = (a: SceneEdge, b: SceneEdge): number =>
  edgeName(a).localeCompare(edgeName(b)) || a.id.localeCompare(b.id);

const edgeName = (edge: SceneEdge): string => {
  if (edge.semantic.family === "er") return edge.semantic.name ?? "";
  if (edge.semantic.family === "sequence") {
    return edge.semantic.signature ?? edge.semantic.messageKind;
  }
  if (edge.semantic.family === "communication") {
    return edge.semantic.signature ?? edge.semantic.sequence;
  }
  if (edge.semantic.family === "state") return edge.semantic.trigger ?? "";
  if (edge.semantic.family === "uml") return edge.semantic.relationship ?? "";
  return "";
};

const zoneLabel = (edge: SceneEdge, zone: "source" | "center" | "target"): string =>
  edge.labels.find((label) => label.zone === zone && label.visible)?.text.trim() ?? "";

const endpointMarker = (edge: SceneEdge, end: "source" | "target"): string => {
  const marker = edge.markers[end];
  if (marker.family === "none") return "";
  return markerDefinition(marker).shortLabel;
};

const umlRelationshipKind = (edge: SceneEdge): string => {
  if (edge.semantic.family === "uml" && edge.semantic.relationship !== undefined) {
    return edge.semantic.relationship;
  }
  for (const end of ["target", "source"] as const) {
    const marker = edge.markers[end];
    if (marker.family === "uml") return marker.kind;
    if (marker.family === "generic") return "directedAssociation";
  }
  return "association";
};

const markerWholeSide = (edge: SceneEdge): "source" | "target" | null => {
  for (const end of ["source", "target"] as const) {
    const marker = edge.markers[end];
    if (
      marker.family === "uml" &&
      (marker.kind === "aggregation" || marker.kind === "composition")
    ) {
      return end;
    }
  }
  return null;
};

const attachmentNodeId = (
  attachment: SceneEdge["source"],
): string | null => (attachment.target === "node" ? attachment.nodeId : null);

/** True when both connector ends attach to the same object (a unary relation). */
const isSelfEdge = (edge: SceneEdge): boolean =>
  edge.source.target === "node" &&
  edge.target.target === "node" &&
  edge.source.nodeId === edge.target.nodeId;

const selfFlag = (edge: SceneEdge): string => (isSelfEdge(edge) ? " self=yes" : "");

const tableRows = (node: TableNode): readonly TableRow[] =>
  node.sections.flatMap((section) => section.rows);

const rowPrefix = (row: TableRow): string => {
  if (row.prefix !== undefined && row.prefix.length > 0) return row.prefix;
  const visibility: Visibility | undefined = row.visibility;
  return visibility ?? "";
};

const parameterText = (row: TableRow): string => {
  if (row.parameters === undefined || row.parameters.length === 0) return "";
  return ` (${row.parameters
    .map((parameter) => {
      const direction = parameter.direction === undefined
        ? ""
        : `${parameter.direction}:`;
      const type = parameter.type === undefined ? "" : `:${parameter.type}`;
      const fallback = parameter.defaultValue === undefined
        ? ""
        : `=${parameter.defaultValue}`;
      return `${direction}${parameter.name}${type}${fallback}`;
    })
    .join(", ")})`;
};

const relationshipLine = (
  id: string,
  edge: SceneEdge,
  sourceId: string,
  targetId: string,
): string => {
  const kind = umlRelationshipKind(edge);
  const sourceLabel = zoneLabel(edge, "source");
  const targetLabel = zoneLabel(edge, "target");
  const center = zoneLabel(edge, "center");
  const whole = markerWholeSide(edge);
  const wholeRef = whole === "target" ? targetId : sourceId;
  const partRef = whole === "target" ? sourceId : targetId;
  return `R${id} kind=${kind}${selfFlag(edge)}` +
    field("name", center) +
    (kind === "aggregation" || kind === "composition"
      ? ` whole=${wholeRef} part=${partRef}`
      : "") +
    ` | ${sourceId}${sourceLabel.length > 0 ? ` ${q(sourceLabel)}` : ""} -> ${targetId}${
      targetLabel.length > 0 ? ` ${q(targetLabel)}` : ""
    }${hiddenFlag(edge)}`;
};

const erCardinality = (edge: SceneEdge, end: "source" | "target"): string => {
  const marker = endpointMarker(edge, end);
  if (marker.length > 0 && marker !== "inheritance") return marker;
  const label = zoneLabel(edge, end);
  return label.length > 0 ? q(label) : "?";
};

const erAttribute = (row: TableRow, weakEntity: boolean): string => {
  const constraints = (row.constraints ?? []).map((constraint) =>
    weakEntity && constraint === "PK" ? "D" : constraint,
  );
  return `${q(row.name)} ${row.type === undefined || row.type.length === 0 ? "-" : q(row.type)}${
    constraints.length > 0 ? ` ${constraints.join(",")}` : ""
  }`;
};

const classMember = (row: TableRow): string => {
  const prefix = rowPrefix(row);
  const prefixText = prefix.length > 0 ? `${prefix} ` : "";
  const flags = [
    row.static === true ? "static" : "",
    row.abstract === true ? "abstract" : "",
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` {${flags.join(",")}}` : "";
  if (row.kind === "method") {
    return `${prefixText}${q(row.name)}${parameterText(row)} -> ${
      row.returnType === undefined || row.returnType.length === 0 ? "void" : q(row.returnType)
    }${suffix}`;
  }
  return `${prefixText}${q(row.name)}${
    row.type === undefined || row.type.length === 0 ? "" : ` ${q(row.type)}`
  }${suffix}`;
};

const sequenceSignature = (edge: SceneEdge): string => {
  if (edge.semantic.family !== "sequence") return "";
  return edge.semantic.signature ?? zoneLabel(edge, "center");
};

interface SequenceSpan {
  readonly start: number;
  readonly end: number;
}

const sequenceSpan = (
  layout: LayoutSnapshot | undefined,
  edgeId: string,
): SequenceSpan | null => {
  const points = layout?.edges[edgeId]?.points;
  if (points === undefined || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  return { start: first.y, end: last.y };
};

/**
 * Visual event position. A self message spans two rows; use its top edge so
 * `#n` orders it by when it starts instead of by the middle of the loop.
 */
const sequenceTime = (layout: LayoutSnapshot | undefined, edgeId: string): number | null => {
  const span = sequenceSpan(layout, edgeId);
  return span === null ? null : Math.min(span.start, span.end);
};

const naturalSequence = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true });

const digestLine = (prefix: string, parts: readonly string[]): string =>
  `${prefix} ${parts.filter((part) => part.length > 0).join(" ")}`.trimEnd();

const readInstructions = (
  kind: SceneDocument["meta"]["diagramKind"],
): readonly string[] => {
  const common = [
    "# HOW TO READ",
    "# One record per line: TYPE id key=value ... | member; member; ...",
    "# IDs are local to this digest. References always use these IDs.",
    '# "..." is JSON-quoted text. yes/no are booleans. -> is source to target.',
    "# self=yes marks a unary relation/message whose two ends are the same object.",
    "# WARNINGS lists mechanical issues found by the exporter.",
    "# RESPONSE RULES: name labels/objects by their actual names, never by E1/R1/C1/etc.",
    "# Do not mention this format or quote its records; state findings and suggestions in prose.",
  ];
  const specific: Record<SceneDocument["meta"]["diagramKind"], readonly string[]> = {
    er: [
      "# E=entity, R=relationship, RA=relationship attribute.",
      '# E1 "name" weak=... | "attribute" type PK|D|FK|NN|UQ.',
      "# R1 ... | E1 cardinality -> E2 cardinality. Inheritance uses child/parent.",
      "# The name of RA Relation Attribute table substitutes its associated relation name, so having an unnamed Relation with a named RA associated is not considered a mistake."
    ],
    "uml-class": [
      "# C=class, R=relationship. Members use +/-/#/~ visibility.",
      "# method(...) -> return; {abstract,static}. Rows are separated by semicolons.",
      "# aggregation/composition include whole=C part=C; kind= gives the relation type.",
    ],
    "uml-object": [
      "# O=object, L=link. classifier= is the object type; L kind= is the relation type.",
    ],
    "uml-use-case": [
      "# A=actor, U=use case, R=relationship.",
      "# R kind=association|include|extend. FRAME ... contains= lists boundary members.",
    ],
    "uml-sequence": [
      "# P=participant, M=message, ACT=activation, DESTROY=destruction.",
      "# #n is visual message order; t is the vertical event rank.",
      "# A self message repeats the participant and uses t=start..end.",
      "# ACT owner= participant, level= nesting, t=start..end.",
    ],
    "uml-communication": [
      "# O=object, M=message, L=structural link.",
      "# M #sequence source -> target signature=... direction=...",
      "# external means the call source is outside the diagram scope.",
    ],
    "uml-state-machine": [
      "# S=state, P=pseudostate, T=transition.",
      "# contains= lists substates. T uses trigger=, guard=, effect=.",
    ],
    circuit: [
      "# X=component, NET=electrical net, J=junction, MEASURE=measurement.",
      "# NET terminals are component.pin. UNCONNECTED lists isolated pins.",
      "# Geometry is omitted; NET/UNCONNECTED records carry circuit connectivity.",
    ],
  };
  return [
    ...common,
    ...specific[kind],
    "# Common: NOTE text, IMG image, FRAME scope, REF TD/DT/both-ways reference label.",
  ];
};

const commonAnnotations = (
  scene: SceneDocument,
  writer: ListWriter,
  nodeIds: ReadonlyMap<string, string>,
  warnings: string[],
): void => {
  const comments = Object.values(scene.nodes)
    .filter((node) => node.kind === "comment")
    .sort(nodeSort);
  comments.forEach((node, index) => {
    if (node.kind !== "comment") return;
    writer.push(
      `NOTE N${index + 1} ${q(node.body)}${hiddenFlag(node)}`,
    );
  });

  const images = Object.values(scene.nodes)
    .filter((node) => node.kind === "image")
    .sort(nodeSort);
  images.forEach((node, index) => {
    if (node.kind !== "image") return;
    const image = node as ImageNode;
    writer.push(
      digestLine(`IMG I${index + 1}`, [
        `alt=${q(image.alt)}`,
        field("caption", image.caption),
        field("asset", image.assetId),
        hiddenFlag(image),
      ]),
    );
  });

  const frames = Object.values(scene.nodes)
    .filter((node) => node.kind === "frame")
    .sort(nodeSort);
  frames.forEach((node, index) => {
    if (node.kind !== "frame") return;
    const contained = Object.values(scene.nodes)
      .filter(
        (candidate) =>
          candidate.id !== node.id &&
          candidate.kind !== "frame" &&
          rectContainsPoint(node.frame, rectCenter(candidate.frame)),
      )
      .map((candidate) => nodeIds.get(candidate.id))
      .filter((id): id is string => id !== undefined);
    writer.push(
      digestLine(`FRAME F${index + 1}`, [
        q(node.name),
        `kind=${node.frameKind}`,
        field("operator", node.operator),
        field("guard", node.guard),
        contained.length > 0 ? `contains=${contained.join(",")}` : "",
        hiddenFlag(node),
      ]),
    );
  });

  const points = Object.values(scene.nodes)
    .filter((node) => node.kind === "referencePoint")
    .sort(nodeSort);
  points.forEach((node, index) => {
    if (node.kind !== "referencePoint") return;
    const variant = node.referenceVariant ?? "td";
    if (variant === "td") {
      writer.push(
        `REF R${index + 1} mode=TD id=${q(node.referenceId)} label=${q(
          `1.${Math.max(1, node.referenceIndex)}`,
        )}${hiddenFlag(node)}`,
      );
    } else if (variant === "dt") {
      writer.push(
        `REF R${index + 1} mode=DT target=${q(node.referenceId)}${hiddenFlag(node)}`,
      );
    } else {
      writer.push(
        `REF R${index + 1} mode=TDT id=${q(node.referenceId)} target=${q(
          node.referToId ?? "",
        )} label=${q(`1.${Math.max(1, node.referenceIndex)}`)}${hiddenFlag(node)}`,
      );
      if ((node.referToId ?? "").trim().length === 0) {
        warnings.push(`TDT reference ${node.name} has no target id.`);
      }
    }
  });
};

const serializeEr = (
  scene: SceneDocument,
  writer: ListWriter,
  warnings: string[],
): Record<string, number> => {
  const tables = Object.values(scene.nodes)
    .filter((node): node is TableNode => node.kind === "table")
    .sort(nodeSort);
  const relationAttributes = Object.values(scene.nodes)
    .filter((node) => node.kind === "relationAttribute")
    .sort(nodeSort);
  const allEdges = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "er")
    .sort(edgeSort);
  const tetherEdges = new Set<string>();
  const ownerByRelationAttribute = new Map<string, string>();
  for (const edge of allEdges) {
    const sourceNode =
      edge.source.target === "node" ? scene.nodes[edge.source.nodeId] : undefined;
    const targetNode =
      edge.target.target === "node" ? scene.nodes[edge.target.nodeId] : undefined;
    const sourceRa = sourceNode?.kind === "relationAttribute";
    const targetRa = targetNode?.kind === "relationAttribute";
    if (sourceRa && edge.target.target === "edge") {
      tetherEdges.add(edge.id);
      ownerByRelationAttribute.set(sourceNode.id, edge.target.edgeId);
    } else if (targetRa && edge.source.target === "edge") {
      tetherEdges.add(edge.id);
      ownerByRelationAttribute.set(targetNode.id, edge.source.edgeId);
    }
  }
  const edges = allEdges.filter((edge) => !tetherEdges.has(edge.id));

  const entityIds = new Map<string, string>();
  const relationIds = new Map<string, string>();
  tables.forEach((node, index) => entityIds.set(node.id, `E${index + 1}`));
  edges.forEach((edge, index) => relationIds.set(edge.id, `R${index + 1}`));

  tables.forEach((node) => {
    const id = entityIds.get(node.id) ?? "E?";
    const weak = node.header.weak === true;
    const kind = node.tableKind === "associative" ? "associative" : "entity";
    const members = tableRows(node).map((row) => erAttribute(row, weak)).join("; ");
    writer.push(
      digestLine(`${id} ${q(node.name)}`, [
        `kind=${kind}`,
        `weak=${bool(weak)}`,
        members.length > 0 ? `| ${members}` : "",
        hiddenFlag(node),
      ]),
    );
  });

  relationAttributes.forEach((node, index) => {
    if (node.kind !== "relationAttribute") return;
    const members = node.rows.map((row) => erAttribute(row, false)).join("; ");
    const ownerEdgeId = ownerByRelationAttribute.get(node.id);
    const owner = ownerEdgeId === undefined
      ? null
      : relationIds.get(ownerEdgeId) ?? null;
    writer.push(
      digestLine(`RA${index + 1} ${q(node.name)}`, [
        `attached=${owner ?? "unbound"}`,
        members.length > 0 ? `| ${members}` : "",
        hiddenFlag(node),
      ]),
    );
  });

  edges.forEach((edge) => {
    const id = relationIds.get(edge.id) ?? "R?";
    const sourceNode = attachmentNodeId(edge.source);
    const targetNode = attachmentNodeId(edge.target);
    const source = sourceNode === null ? "@free" : entityIds.get(sourceNode) ?? "@unknown";
    const target = targetNode === null ? "@free" : entityIds.get(targetNode) ?? "@unknown";
    const sourceInheritance = endpointMarker(edge, "source") === "inheritance";
    const targetInheritance = endpointMarker(edge, "target") === "inheritance";
    if (sourceInheritance || targetInheritance) {
      const child = sourceInheritance ? target : source;
      const parent = sourceInheritance ? source : target;
      writer.push(
        `${id} "inheritance" kind=inheritance | child=${child} parent=${parent}${selfFlag(
          edge,
        )}${hiddenFlag(edge)}`,
      );
      return;
    }
    const name = edge.semantic.family === "er"
      ? edge.semantic.name ?? zoneLabel(edge, "center")
      : zoneLabel(edge, "center");
    writer.push(
      `${id} ${q(name)} kind=relationship identifying=${bool(
        edge.semantic.family === "er" ? edge.semantic.identifying : false,
      )} weak=${bool(
        edge.semantic.family === "er" ? edge.semantic.weak : false,
      )}${selfFlag(edge)} | ${source} ${erCardinality(edge, "source")} -> ${target} ${erCardinality(
        edge,
        "target",
      )}${hiddenFlag(edge)}`,
    );
    if (
      erCardinality(edge, "source") === "?" ||
      erCardinality(edge, "target") === "?"
    ) {
      warnings.push(`ER relation ${name || id} has an unspecified cardinality.`);
    }
  });

  return {
    entities: tables.length,
    relationships: edges.length,
    relation_attributes: relationAttributes.length,
  };
};

const serializeClass = (
  scene: SceneDocument,
  writer: ListWriter,
  warnings: string[],
): Record<string, number> => {
  const tables = Object.values(scene.nodes)
    .filter((node): node is TableNode => node.kind === "table")
    .sort(nodeSort);
  const edges = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "uml" || edge.semantic.family === "generic")
    .sort(edgeSort);
  const classIds = new Map<string, string>();
  tables.forEach((node, index) => classIds.set(node.id, `C${index + 1}`));

  tables.forEach((node) => {
    const id = classIds.get(node.id) ?? "C?";
    const members = tableRows(node).map(classMember).join("; ");
    const stereotype = node.header.stereotype?.trim();
    const stereotypeKey = normalizeStereotypeName(stereotype);
    // Interface/abstract are semantic flags, not free-text annotations: the
    // digest reports them as booleans and does not repeat them as a stereotype.
    const isInterface = node.header.isInterface === true || stereotypeKey === "interface";
    const isAbstract = node.header.abstract === true || stereotypeKey === "abstract";
    const explicitStereotype =
      stereotypeKey === "interface" || stereotypeKey === "abstract"
        ? undefined
        : stereotype;
    writer.push(
      digestLine(`${id} ${q(node.name)}`, [
        `table=${node.tableKind}`,
        `abstract=${bool(isAbstract)}`,
        `interface=${bool(isInterface)}`,
        field("stereotype", explicitStereotype),
        members.length > 0 ? `| ${members}` : "",
        hiddenFlag(node),
      ]),
    );
  });

  edges.forEach((edge, index) => {
    const sourceNode = attachmentNodeId(edge.source);
    const targetNode = attachmentNodeId(edge.target);
    const source = sourceNode === null ? "@free" : classIds.get(sourceNode) ?? "@unknown";
    const target = targetNode === null ? "@free" : classIds.get(targetNode) ?? "@unknown";
    writer.push(relationshipLine(String(index + 1), edge, source, target));
    if (source === "@unknown" || target === "@unknown") {
      warnings.push(`Class relation ${edgeName(edge) || edge.id} has an unresolved endpoint.`);
    }
  });

  return { classes: tables.length, relationships: edges.length };
};

const serializeObject = (
  scene: SceneDocument,
  writer: ListWriter,
): Record<string, number> => {
  const objects = Object.values(scene.nodes)
    .filter((node) => node.kind === "object")
    .sort(nodeSort);
  const objectIds = new Map<string, string>();
  objects.forEach((node, index) => objectIds.set(node.id, `O${index + 1}`));

  objects.forEach((node) => {
    if (node.kind !== "object") return;
    writer.push(
      digestLine(`${objectIds.get(node.id) ?? "O?"} ${q(node.name)}`, [
        field("classifier", node.classifier),
        field("stereotype", node.stereotype),
        hiddenFlag(node),
      ]),
    );
  });

  const edges = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "uml" || edge.semantic.family === "generic")
    .sort(edgeSort);
  edges.forEach((edge, index) => {
    const sourceNode = attachmentNodeId(edge.source);
    const targetNode = attachmentNodeId(edge.target);
    const source = sourceNode === null ? "@free" : objectIds.get(sourceNode) ?? "@unknown";
    const target = targetNode === null ? "@free" : objectIds.get(targetNode) ?? "@unknown";
    writer.push(
      `L${index + 1} kind=${umlRelationshipKind(edge)}${selfFlag(edge)}${field(
        "name",
        zoneLabel(edge, "center") || zoneLabel(edge, "target"),
      )} | ${source} -> ${target}${hiddenFlag(edge)}`,
    );
  });

  return { objects: objects.length, links: edges.length };
};

const serializeUseCase = (
  scene: SceneDocument,
  writer: ListWriter,
): Record<string, number> => {
  const actors = Object.values(scene.nodes)
    .filter((node) => node.kind === "actor")
    .sort(nodeSort);
  const useCases = Object.values(scene.nodes)
    .filter((node) => node.kind === "useCase")
    .sort(nodeSort);
  const actorIds = new Map<string, string>();
  const useCaseIds = new Map<string, string>();
  actors.forEach((node, index) => actorIds.set(node.id, `A${index + 1}`));
  useCases.forEach((node, index) => useCaseIds.set(node.id, `U${index + 1}`));

  actors.forEach((node) => {
    writer.push(`A${actorIds.get(node.id)?.slice(1) ?? "?"} ${q(node.name)}${hiddenFlag(node)}`);
  });
  useCases.forEach((node) => {
    writer.push(`U${useCaseIds.get(node.id)?.slice(1) ?? "?"} ${q(node.name)}${hiddenFlag(node)}`);
  });

  const edges = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "uml" || edge.semantic.family === "generic")
    .sort(edgeSort);
  edges.forEach((edge, index) => {
    const sourceNode = attachmentNodeId(edge.source);
    const targetNode = attachmentNodeId(edge.target);
    const source = sourceNode === null
      ? "@free"
      : actorIds.get(sourceNode) ?? useCaseIds.get(sourceNode) ?? "@unknown";
    const target = targetNode === null
      ? "@free"
      : useCaseIds.get(targetNode) ?? actorIds.get(targetNode) ?? "@unknown";
    const center = zoneLabel(edge, "center").replace(/[«»]/g, "").trim();
    const kind =
      center === "include" || center === "extend"
        ? center
        : umlRelationshipKind(edge);
    const name =
      center.length > 0 && center !== "include" && center !== "extend"
        ? center
        : "";
    writer.push(
      `R${index + 1} kind=${kind}${selfFlag(edge)}${field("name", name)} | ${source} -> ${target}${hiddenFlag(edge)}`,
    );
  });

  return { actors: actors.length, use_cases: useCases.length, relationships: edges.length };
};

const serializeSequence = (
  scene: SceneDocument,
  layout: LayoutSnapshot | undefined,
  writer: ListWriter,
  warnings: string[],
): Record<string, number> => {
  const lifelines = Object.values(scene.nodes)
    .filter((node): node is LifelineNode => node.kind === "lifeline")
    .sort((a, b) => a.frame.x - b.frame.x || a.frame.y - b.frame.y || a.name.localeCompare(b.name));
  const participantIds = new Map<string, string>();
  lifelines.forEach((node, index) => participantIds.set(node.id, `P${index + 1}`));
  lifelines.forEach((node) => {
    writer.push(
      digestLine(`${participantIds.get(node.id) ?? "P?"} ${q(node.name)}`, [
        `head=${node.head.headKind}`,
        field("stereotype", node.head.stereotype),
        field("label", node.head.label),
        hiddenFlag(node),
      ]),
    );
  });

  const messages = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "sequence")
    .sort(
      (a, b) =>
        (sequenceTime(layout, a.id) ?? 0) - (sequenceTime(layout, b.id) ?? 0) ||
        a.id.localeCompare(b.id),
    );
  const messageIds = new Map<string, string>();
  messages.forEach((edge, index) => messageIds.set(edge.id, `M${index + 1}`));

  const timeValues = new Set<number>();
  const addTime = (value: number | null): void => {
    if (value !== null && Number.isFinite(value)) timeValues.add(Math.round(value * 100) / 100);
  };
  messages.forEach((edge) => {
    const span = sequenceSpan(layout, edge.id);
    if (span !== null) {
      addTime(span.start);
      addTime(span.end);
    }
  });
  lifelines.forEach((node) => {
    for (const activation of node.activationBars) {
      addTime(node.frame.y + activation.top);
      addTime(node.frame.y + activation.top + activation.height);
    }
    if (node.destroyAt !== undefined) addTime(node.frame.y + node.destroyAt);
  });
  const times = [...timeValues].sort((a, b) => a - b);
  const timeRank = (value: number | null): number | null => {
    if (value === null) return null;
    const rounded = Math.round(value * 100) / 100;
    const index = times.indexOf(rounded);
    return index < 0 ? null : index + 1;
  };
  const attachmentId = (attachment: SceneEdge["source"]): string => {
    if (attachment.target !== "node") return "external";
    return participantIds.get(attachment.nodeId) ?? "@unknown";
  };

  messages.forEach((edge) => {
    const id = messageIds.get(edge.id) ?? "M?";
    const semantic = edge.semantic.family === "sequence" ? edge.semantic : null;
    const source = attachmentId(edge.source);
    const target = attachmentId(edge.target);
    if (source === "@unknown" || target === "@unknown") {
      warnings.push(`Sequence message ${id} is attached to a non-lifeline object.`);
    }
    const span = sequenceSpan(layout, edge.id);
    const startRank = span === null
      ? null
      : timeRank(Math.min(span.start, span.end));
    const endRank = span === null
      ? null
      : timeRank(Math.max(span.start, span.end));
    const timeText = startRank === null
      ? ""
      : endRank !== null && endRank !== startRank
        ? `t=${startRank}..${endRank}`
        : `t=${startRank}`;
    writer.push(
      digestLine(`${id} #${messages.indexOf(edge) + 1}`, [
        `${source} -> ${target}`,
        `kind=${semantic?.messageKind ?? "sync"}${selfFlag(edge)}`,
        field("text", sequenceSignature(edge)),
        field("seq", semantic?.sequence),
        timeText,
        hiddenFlag(edge),
      ]),
    );
  });

  let activationIndex = 0;
  lifelines.forEach((node) => {
    for (const activation of node.activationBars) {
      activationIndex += 1;
      const start = timeRank(node.frame.y + activation.top);
      const end = timeRank(node.frame.y + activation.top + activation.height);
      writer.push(
        `ACT A${activationIndex} owner=${participantIds.get(node.id) ?? "?"} level=${
          activation.level
        } t=${start ?? "?"}..${end ?? "?"}`,
      );
    }
    if (node.destroyAt !== undefined) {
      writer.push(
        `DESTROY ${participantIds.get(node.id) ?? "?"} at t=${
          timeRank(node.frame.y + node.destroyAt) ?? "?"
        }`,
      );
    }
  });

  return {
    participants: lifelines.length,
    messages: messages.length,
    activations: activationIndex,
  };
};

const serializeCommunication = (
  scene: SceneDocument,
  writer: ListWriter,
  warnings: string[],
): Record<string, number> => {
  const objects = Object.values(scene.nodes)
    .filter((node) => node.kind === "object")
    .sort(nodeSort);
  const objectIds = new Map<string, string>();
  objects.forEach((node, index) => objectIds.set(node.id, `O${index + 1}`));
  objects.forEach((node) => {
    if (node.kind !== "object") return;
    writer.push(
      digestLine(`${objectIds.get(node.id) ?? "O?"} ${q(node.name)}`, [
        field("classifier", node.classifier),
        field("stereotype", node.stereotype),
        hiddenFlag(node),
      ]),
    );
  });

  const edges = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "communication")
    .sort((a, b) => {
      const sa = a.semantic.family === "communication" ? a.semantic.sequence : "";
      const sb = b.semantic.family === "communication" ? b.semantic.sequence : "";
      return naturalSequence(sa, sb) || a.id.localeCompare(b.id);
    });
  let messages = 0;
  let links = 0;
  edges.forEach((edge, index) => {
    const semantic = edge.semantic.family === "communication" ? edge.semantic : null;
    const sourceNode = attachmentNodeId(edge.source);
    const targetNode = attachmentNodeId(edge.target);
    const source = sourceNode === null ? "external" : objectIds.get(sourceNode) ?? "@unknown";
    const target = targetNode === null ? "external" : objectIds.get(targetNode) ?? "@unknown";
    if (semantic !== null && semantic.signature !== undefined && semantic.signature.length > 0) {
      messages += 1;
      if (source === "external") {
        writer.push(
          `M${index + 1} #${semantic.sequence} external -> ${target} signature=${q(
            semantic.signature,
          )} direction=${semantic.direction}${selfFlag(edge)}${hiddenFlag(edge)}`,
        );
      } else {
        writer.push(
          `M${index + 1} #${semantic.sequence} ${source} -> ${target} signature=${q(
            semantic.signature,
          )} direction=${semantic.direction}${selfFlag(edge)}${hiddenFlag(edge)}`,
        );
      }
    } else {
      links += 1;
      writer.push(
        `L${index + 1} kind=${umlRelationshipKind(edge)}${selfFlag(edge)} | ${source} -> ${target}${hiddenFlag(edge)}`,
      );
    }
    if (source === "@unknown" || target === "@unknown") {
      warnings.push(`Communication edge ${edge.id} has an unresolved endpoint.`);
    }
  });

  return { objects: objects.length, messages, links };
};

const serializeState = (
  scene: SceneDocument,
  writer: ListWriter,
): Record<string, number> => {
  const states = Object.values(scene.nodes)
    .filter((node) => node.kind === "state")
    .sort(nodeSort);
  const pseudostates = Object.values(scene.nodes)
    .filter((node) => node.kind === "pseudostate")
    .sort(nodeSort);
  const stateIds = new Map<string, string>();
  const pseudoIds = new Map<string, string>();
  states.forEach((node, index) => stateIds.set(node.id, `S${index + 1}`));
  pseudostates.forEach((node, index) => pseudoIds.set(node.id, `P${index + 1}`));

  states.forEach((node) => {
    if (node.kind !== "state") return;
    const contained = node.stateKind === "composite"
      ? states
          .filter(
            (candidate) =>
              candidate.id !== node.id &&
              rectContainsPoint(node.frame, rectCenter(candidate.frame)),
          )
          .map((candidate) => stateIds.get(candidate.id))
          .filter((id): id is string => id !== undefined)
      : [];
    writer.push(
      digestLine(`${stateIds.get(node.id) ?? "S?"} ${q(node.name)}`, [
        `kind=${node.stateKind}`,
        contained.length > 0 ? `contains=${contained.join(",")}` : "",
        field("activities", (node.internalActivities ?? []).join("; ")),
        hiddenFlag(node),
      ]),
    );
  });
  pseudostates.forEach((node) => {
    if (node.kind !== "pseudostate") return;
    writer.push(
      `P${pseudoIds.get(node.id)?.slice(1) ?? "?"} kind=${node.pseudostateKind} ${q(
        node.name,
      )}${hiddenFlag(node)}`,
    );
  });

  const transitions = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "state")
    .sort(edgeSort);
  transitions.forEach((edge, index) => {
    const sourceNode = attachmentNodeId(edge.source);
    const targetNode = attachmentNodeId(edge.target);
    const source = sourceNode === null
      ? "@free"
      : stateIds.get(sourceNode) ?? pseudoIds.get(sourceNode) ?? "@unknown";
    const target = targetNode === null
      ? "@free"
      : stateIds.get(targetNode) ?? pseudoIds.get(targetNode) ?? "@unknown";
    const semantic = edge.semantic.family === "state" ? edge.semantic : null;
    writer.push(
      digestLine(`T${index + 1} ${source} -> ${target}${selfFlag(edge)}`, [
        field("trigger", semantic?.trigger),
        field("guard", semantic?.guard),
        field("effect", semantic?.effect),
        hiddenFlag(edge),
      ]),
    );
  });

  return { states: states.length, pseudostates: pseudostates.length, transitions: transitions.length };
};

interface UnionFind {
  readonly find: (key: string) => string;
  readonly union: (a: string, b: string) => void;
}

const createUnionFind = (): UnionFind => {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    let current = key;
    while ((parent.get(current) ?? current) !== current) {
      const next = parent.get(current) ?? current;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  return {
    find,
    union: (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    },
  };
};

const serializeCircuit = (
  scene: SceneDocument,
  writer: ListWriter,
  warnings: string[],
): Record<string, number> => {
  const settings = resolveCircuitSettings(scene);
  writer.push(
    `CIRCUIT standard=${settings.standard.toLowerCase()} crossings=${settings.crossings}`,
  );
  const components = Object.values(scene.nodes)
    .filter((node) => node.kind === "circuitComponent")
    .sort(nodeSort);
  const componentIds = new Map<string, string>();
  components.forEach((node, index) => componentIds.set(node.id, `X${index + 1}`));
  components.forEach((node) => {
    if (node.kind !== "circuitComponent") return;
    const mirror = [
      node.mirrorX === true ? "x" : "",
      node.mirrorY === true ? "y" : "",
    ].filter(Boolean);
    writer.push(
      digestLine(`${componentIds.get(node.id) ?? "X?"} ${q(node.name)}`, [
        `kind=${node.component}`,
        field("value", node.value),
        `rot=${node.rotation}`,
        mirror.length > 0 ? `mirror=${mirror.join(",")}` : "",
        node.switchClosed === true ? "state=closed" : "",
        hiddenFlag(node),
      ]),
    );
  });

  const junctions = Object.values(scene.nodes)
    .filter((node) => node.kind === "circuitJunction")
    .sort(nodeSort);
  const junctionIds = new Map<string, string>();
  junctions.forEach((node, index) => junctionIds.set(node.id, `J${index + 1}`));

  const uf = createUnionFind();
  const terminalLabel = (attachment: SceneEdge["source"], edgeId: string, end: string): string | null => {
    if (attachment.target === "free") return `@free:${edgeId}:${end}`;
    if (attachment.target === "edge") return null;
    const node = scene.nodes[attachment.nodeId];
    if (node === undefined) return null;
    if (node.kind === "circuitComponent") {
      if (attachment.port.kind !== "pin") return null;
      return `${componentIds.get(node.id) ?? node.id}.${attachment.port.pinId}`;
    }
    if (node.kind === "circuitJunction") {
      return junctionIds.get(node.id) ?? node.id;
    }
    return null;
  };

  const edges = Object.values(scene.edges)
    .filter((edge) => edge.semantic.family === "circuit")
    .sort((a, b) => a.id.localeCompare(b.id));
  edges.forEach((edge) => {
    const source = terminalLabel(edge.source, edge.id, "source");
    const target = terminalLabel(edge.target, edge.id, "target");
    if (source !== null && target !== null) uf.union(source, target);
    if (source?.startsWith("@free") === true || target?.startsWith("@free") === true) {
      warnings.push(`Circuit wire ${edge.id} has a free endpoint.`);
    }
  });

  const groups = new Map<string, string[]>();
  const addTerminal = (terminal: string): void => {
    const root = uf.find(terminal);
    const group = groups.get(root) ?? [];
    group.push(terminal);
    groups.set(root, group);
  };
  components.forEach((node) => {
    if (node.kind !== "circuitComponent") return;
    const definition = circuitComponent(node.component);
    for (const pin of definition?.pins ?? []) {
      const terminal = `${componentIds.get(node.id) ?? node.id}.${pin.id}`;
      addTerminal(terminal);
    }
  });
  junctions.forEach((node) => {
    if (node.kind !== "circuitJunction") return;
    addTerminal(junctionIds.get(node.id) ?? node.id);
  });
  edges.forEach((edge) => {
    for (const [end, attachment] of [
      ["source", edge.source],
      ["target", edge.target],
    ] as const) {
      const terminal = terminalLabel(attachment, edge.id, end);
      if (terminal !== null) addTerminal(terminal);
    }
  });

  const sortedGroups = [...groups.entries()]
    .map(([root, terminals]) => ({
      root,
      terminals: [...new Set(terminals)].sort((a, b) => a.localeCompare(b)),
    }))
    .sort(
      (a, b) =>
        a.terminals.join(",").localeCompare(b.terminals.join(",")) ||
        a.root.localeCompare(b.root),
    );
  const netForTerminal = new Map<string, string>();
  let netIndex = 0;
  sortedGroups.forEach((group) => {
    const connected = group.terminals.filter(
      (terminal) => !terminal.startsWith("@free"),
    );
    if (connected.length < 2) return;
    netIndex += 1;
    const net = `N${netIndex}`;
    writer.push(`NET ${net}: ${group.terminals.join(", ")}`);
    for (const terminal of group.terminals) netForTerminal.set(terminal, net);
  });

  components.forEach((node) => {
    if (node.kind !== "circuitComponent") return;
    const definition = circuitComponent(node.component);
    for (const pin of definition?.pins ?? []) {
      const terminal = `${componentIds.get(node.id) ?? node.id}.${pin.id}`;
      if (!netForTerminal.has(terminal)) writer.push(`UNCONNECTED ${terminal}`);
    }
  });

  junctions.forEach((node) => {
    if (node.kind !== "circuitJunction") return;
    const id = junctionIds.get(node.id) ?? node.id;
    if (node.measurement !== undefined) {
      writer.push(
        digestLine(`MEASURE ${id}`, [
          `kind=${node.measurement.kind}`,
          `label=${q(node.measurement.firstLabel)}`,
          field("second", node.measurement.secondLabel),
          netForTerminal.has(id) ? `net=${netForTerminal.get(id)}` : "",
          `reverse=${bool(node.measurement.reverse)}`,
        ]),
      );
    } else {
      writer.push(
        `JUNCTION ${id} style=${node.junctionStyle}${
          netForTerminal.has(id) ? ` net=${netForTerminal.get(id)}` : ""
        }${hiddenFlag(node)}`,
      );
    }
  });

  return {
    components: components.length,
    junctions: junctions.length,
    nets: new Set(netForTerminal.values()).size,
  };
};

export const serializeSceneToDigest = (
  scene: SceneDocument,
  layout?: LayoutSnapshot,
): DigestResult => {
  const writer = new ListWriter();
  const warnings: string[] = [];
  const nodeIds = new Map<string, string>();
  const counts: Record<string, number> = {};

  const declared = (prefix: string, ids: readonly string[]): void => {
    ids.forEach((id, index) => nodeIds.set(id, `${prefix}${index + 1}`));
  };
  const byPosition = Object.values(scene.nodes).sort(nodeSort);
  if (scene.meta.diagramKind === "er") {
    declared(
      "E",
      byPosition.filter((node) => node.kind === "table").map((node) => node.id),
    );
  } else if (scene.meta.diagramKind === "uml-class") {
    declared(
      "C",
      byPosition.filter((node) => node.kind === "table").map((node) => node.id),
    );
  } else if (scene.meta.diagramKind === "uml-object") {
    declared(
      "O",
      byPosition.filter((node) => node.kind === "object").map((node) => node.id),
    );
  } else if (scene.meta.diagramKind === "uml-use-case") {
    declared(
      "A",
      byPosition.filter((node) => node.kind === "actor").map((node) => node.id),
    );
    declared(
      "U",
      byPosition.filter((node) => node.kind === "useCase").map((node) => node.id),
    );
  } else if (scene.meta.diagramKind === "uml-sequence") {
    declared(
      "P",
      byPosition.filter((node) => node.kind === "lifeline").map((node) => node.id),
    );
  } else if (scene.meta.diagramKind === "uml-state-machine") {
    declared(
      "S",
      byPosition.filter((node) => node.kind === "state").map((node) => node.id),
    );
    declared(
      "P",
      byPosition.filter((node) => node.kind === "pseudostate").map((node) => node.id),
    );
  } else if (scene.meta.diagramKind === "circuit") {
    declared(
      "X",
      byPosition.filter((node) => node.kind === "circuitComponent").map((node) => node.id),
    );
    declared(
      "J",
      byPosition.filter((node) => node.kind === "circuitJunction").map((node) => node.id),
    );
  }

  writer.push("UMLER-DIGEST 1");
  writer.push(`KIND ${scene.meta.diagramKind}`);
  writer.push(`TITLE ${q(scene.meta.title)}`);
  if ((scene.meta.description ?? "").trim().length > 0) {
    writer.push(`DESCRIPTION ${q(scene.meta.description)}`);
  }
  for (const line of readInstructions(scene.meta.diagramKind)) writer.push(line);
  const countsInsertIndex = writer.lines.length;

  if (scene.meta.diagramKind === "er") {
    Object.assign(counts, serializeEr(scene, writer, warnings));
  } else if (scene.meta.diagramKind === "uml-class") {
    Object.assign(counts, serializeClass(scene, writer, warnings));
  } else if (scene.meta.diagramKind === "uml-object") {
    Object.assign(counts, serializeObject(scene, writer));
  } else if (scene.meta.diagramKind === "uml-use-case") {
    Object.assign(counts, serializeUseCase(scene, writer));
  } else if (scene.meta.diagramKind === "uml-sequence") {
    Object.assign(counts, serializeSequence(scene, layout, writer, warnings));
  } else if (scene.meta.diagramKind === "uml-communication") {
    Object.assign(counts, serializeCommunication(scene, writer, warnings));
  } else if (scene.meta.diagramKind === "uml-state-machine") {
    Object.assign(counts, serializeState(scene, writer));
  } else if (scene.meta.diagramKind === "circuit") {
    Object.assign(counts, serializeCircuit(scene, writer, warnings));
  }

  commonAnnotations(scene, writer, nodeIds, warnings);

  if (warnings.length > 0) {
    writer.push("");
    writer.push(`WARNINGS ${warnings.length}`);
    warnings.forEach((warning, index) => writer.push(`W${index + 1} ${warning}`));
  } else {
    writer.push("WARNINGS 0");
  }

  const stats: Record<string, number> = {
    ...counts,
    nodes: Object.keys(scene.nodes).length,
    edges: Object.keys(scene.edges).length,
    self_relations: Object.values(scene.edges).filter(isSelfEdge).length,
  };
  writer.lines.splice(
    countsInsertIndex,
    0,
    `COUNTS ${Object.entries(stats)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}`,
  );

  return {
    text: `${writer.toString()}\n`,
    warnings,
    stats,
  };
};
