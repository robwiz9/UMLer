/**
 * Factory for connectors drawn by dragging between ports.
 *
 * A connector never appears in the object palette: it is created from the
 * border/row/spine handle of an already placed object. The semantic family is
 * chosen from the diagram type so a dropped line already has the right
 * terminal vocabulary; the line/terminal menus then refine it.
 */

import type { SceneDocument } from "./scene.ts";
import type { EdgeAttachment, NodePortRef, SceneEdge } from "./edges.ts";
import { NO_MARKER } from "./edges.ts";
import type { ErMarkerKind, GenericMarkerKind } from "./markers.ts";
import { DEFAULT_THEME } from "./styles.ts";
import { newId, type EdgeId, type NodeId } from "./ids.ts";

export interface PortAttachmentRef {
  readonly nodeId: NodeId;
  readonly port: NodePortRef;
}

/** A connector dropped on an existing connector, used by relation attributes. */
export interface EdgeAttachmentRef {
  readonly edgeId: EdgeId;
  readonly t: number;
}

export type EdgeTargetRef = PortAttachmentRef | EdgeAttachmentRef;

const er = (kind: ErMarkerKind): { family: "er"; kind: ErMarkerKind } => ({
  family: "er",
  kind,
});

const generic = (kind: GenericMarkerKind): { family: "generic"; kind: GenericMarkerKind } => ({
  family: "generic",
  kind,
});

export const createEdgeForDiagram = (
  scene: SceneDocument,
  source: PortAttachmentRef,
  target: EdgeTargetRef,
): SceneEdge | null => {
  if ("nodeId" in target && source.nodeId === target.nodeId) return null;
  const sourceNode = scene.nodes[source.nodeId];
  if (sourceNode === undefined) return null;
  if ("nodeId" in target && scene.nodes[target.nodeId] === undefined) return null;
  if ("edgeId" in target && scene.edges[target.edgeId] === undefined) return null;

  const targetAttachment: EdgeAttachment = "edgeId" in target
    ? { target: "edge", edgeId: target.edgeId, t: target.t }
    : { target: "node", nodeId: target.nodeId, port: target.port };
  const attachedToEdge = "edgeId" in target;
  const edgeTargetMarkers = attachedToEdge
    ? { source: NO_MARKER, target: NO_MARKER }
    : undefined;
  const edgeTargetStyle = attachedToEdge
    ? {
        ...DEFAULT_THEME.edge,
        stroke: { ...DEFAULT_THEME.edge.stroke, pattern: "dashed" as const },
      }
    : DEFAULT_THEME.edge;

  const base = {
    id: newId<EdgeId>("edge"),
    source: { target: "node" as const, nodeId: source.nodeId, port: source.port },
    target: targetAttachment,
    labels: [],
    locked: false,
    visible: true,
    z: 10,
  };

  switch (scene.meta.diagramKind) {
    case "er":
      return {
        ...base,
        routing: {
          mode: "orthogonal",
          avoidObstacles: true,
          obstaclePadding: 9,
          stubLength: 9,
          waypoints: [],
        },
        markers: edgeTargetMarkers ?? { source: er("one"), target: er("zeroOrMany") },
        semantic: { family: "er", name: attachedToEdge ? "has" : undefined },
        style: edgeTargetStyle,
      };
    case "uml-class":
    case "uml-use-case":
      return {
        ...base,
        routing: {
          mode: "orthogonal",
          avoidObstacles: true,
          obstaclePadding: 9,
          stubLength: 9,
          waypoints: [],
        },
        markers: edgeTargetMarkers ?? { source: NO_MARKER, target: NO_MARKER },
        semantic: { family: "uml", relationship: "association" },
        style: edgeTargetStyle,
      };
    case "uml-sequence":
      return {
        ...base,
        routing: {
          mode: "straight",
          avoidObstacles: false,
          obstaclePadding: 0,
          stubLength: 0,
          waypoints: [],
        },
        markers: edgeTargetMarkers ?? { source: NO_MARKER, target: NO_MARKER },
        semantic: { family: "sequence", messageKind: "sync" },
        style: edgeTargetStyle,
      };
    case "uml-communication":
      return {
        ...base,
        routing: {
          mode: "orthogonal",
          avoidObstacles: true,
          obstaclePadding: 9,
          stubLength: 9,
          waypoints: [],
        },
        markers: edgeTargetMarkers ?? { source: NO_MARKER, target: generic("arrow") },
        semantic: {
          family: "communication",
          sequence: "1",
          signature: "message()",
          direction: "forward",
        },
        style: edgeTargetStyle,
      };
    case "uml-state-machine":
      return {
        ...base,
        routing: {
          mode: "orthogonal",
          avoidObstacles: true,
          obstaclePadding: 9,
          stubLength: 9,
          waypoints: [],
        },
        markers: edgeTargetMarkers ?? { source: NO_MARKER, target: generic("arrow") },
        semantic: { family: "state" },
        style: edgeTargetStyle,
      };
    default:
      return null;
  }
};
