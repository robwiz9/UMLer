/**
 * Structural validation for imported/edited scenes.
 *
 * This is intentionally independent of the renderer. The editor runs it after
 * drop/import and before an export; the fixture script runs it in CI.
 */

import { findRow, isTableLikeNode } from "./nodes.ts";
import type { EdgeAttachment, SceneEdge } from "./edges.ts";
import type { SceneDocument } from "./scene.ts";
import type { Rect } from "./geometry.ts";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

type ErrorReporter = (code: string, path: string, message: string) => void;

const isFiniteNumber = (n: number): boolean => Number.isFinite(n);

const isGridAligned = (value: number, step: number): boolean => {
  if (!isFiniteNumber(step) || step <= 0 || !isFiniteNumber(value)) return false;
  const remainder = Math.abs(value / step - Math.round(value / step));
  return remainder < 1e-6;
};

const validRect = (r: Rect): boolean =>
  [r.x, r.y, r.width, r.height].every(isFiniteNumber) && r.width > 0 && r.height > 0;

const NODE_KINDS = new Set([
  "table",
  "relationAttribute",
  "relationship",
  "actor",
  "useCase",
  "object",
  "state",
  "pseudostate",
  "lifeline",
  "frame",
  "image",
  "comment",
]);

const EDGE_FAMILIES = new Set(["uml", "er", "sequence", "communication", "state", "generic"]);

export const validateScene = (scene: SceneDocument): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const error: ErrorReporter = (code, path, message) => {
    diagnostics.push({ severity: "error", code, path, message });
  };
  const warning: ErrorReporter = (code, path, message) => {
    diagnostics.push({ severity: "warning", code, path, message });
  };

  if (scene.schemaVersion !== "umler.scene/1") {
    error("schema/version", "schemaVersion", `Unsupported schema version: ${String(scene.schemaVersion)}`);
  }
  if (!Number.isInteger(scene.revision) || scene.revision < 1) {
    error("scene/revision", "revision", "revision must be a positive integer");
  }
  if (!(scene.canvas.grid.size > 0)) {
    error("grid/size", "canvas.grid.size", "grid size must be greater than zero");
  }
  if (scene.canvas.exportPadding < 0) {
    error("canvas/padding", "canvas.exportPadding", "export padding cannot be negative");
  }
  if (scene.layout.rankGap < 0 || scene.layout.nodeGap < 0) {
    error("layout/gap", "layout", "layout gaps cannot be negative");
  }

  const { nodes, edges, assets } = scene;

  for (const [key, node] of Object.entries(nodes)) {
    const path = `nodes.${key}`;
    if (key !== node.id) {
      error("node/id-mismatch", path, `record key "${key}" does not match node.id "${node.id}"`);
    }
    if (!NODE_KINDS.has(node.kind)) {
      error("node/kind", `${path}.kind`, `unknown node kind "${String(node.kind)}"`);
    }
    if (!validRect(node.frame)) {
      error("node/frame", `${path}.frame`, "frame must have finite coordinates and positive size");
    } else {
      const frameEntries: readonly [string, number][] = [
        ["x", node.frame.x],
        ["y", node.frame.y],
        ["width", node.frame.width],
        ["height", node.frame.height],
      ];
      for (const [name, value] of frameEntries) {
        if (!isGridAligned(value, scene.canvas.grid.size)) {
          warning(
            "node/off-grid",
            `${path}.frame.${name}`,
            `${name}=${value} is not aligned to the ${scene.canvas.grid.size}pt grid`,
          );
        }
      }
    }
    if (typeof node.locked !== "boolean") {
      error("node/locked", `${path}.locked`, "locked must be a boolean");
    }

    if (node.kind === "table") {
      const rowIds = new Set<string>();
      for (const [sectionIndex, section] of node.sections.entries()) {
        if (section.rows.length === 0) {
          warning(
            "table/empty-section",
            `${path}.sections[${sectionIndex}]`,
            "section has no rows; it will render as an empty compartment",
          );
        }
        for (const [rowIndex, row] of section.rows.entries()) {
          if (rowIds.has(row.id)) {
            error(
              "table/duplicate-row",
              `${path}.sections[${sectionIndex}].rows[${rowIndex}]`,
              `duplicate row id "${row.id}"`,
            );
          }
          rowIds.add(row.id);
        }
      }
    }

    if (node.kind === "relationAttribute") {
      const rowIds = new Set<string>();
      for (const [rowIndex, row] of node.rows.entries()) {
        if (rowIds.has(row.id)) {
          error(
            "relation-attribute/duplicate-row",
            `${path}.rows[${rowIndex}]`,
            `duplicate row id "${row.id}"`,
          );
        }
        rowIds.add(row.id);
      }
    }

    if (node.kind === "lifeline") {
      for (const [index, bar] of node.activationBars.entries()) {
        if (!isFiniteNumber(bar.top) || !isFiniteNumber(bar.height) || bar.height <= 0) {
          error(
            "lifeline/activation",
            `${path}.activationBars[${index}]`,
            "activation must have a finite top and positive height",
          );
        }
        if (bar.top < 0 || bar.top + bar.height > node.frame.height + 1e-6) {
          warning(
            "lifeline/activation-outside",
            `${path}.activationBars[${index}]`,
            "activation extends outside the lifeline frame",
          );
        }
      }
      if (
        node.destroyAt !== undefined &&
        (node.destroyAt < 0 || node.destroyAt > node.frame.height)
      ) {
        warning(
          "lifeline/destroy-outside",
          `${path}.destroyAt`,
          "destruction marker is outside the lifeline frame",
        );
      }
    }

    if (
      node.kind === "image" &&
      node.assetId !== undefined &&
      assets[node.assetId] === undefined
    ) {
      error("image/missing-asset", `${path}.assetId`, `asset "${node.assetId}" is not present in assets`);
    }
  }

  for (const [key, asset] of Object.entries(assets)) {
    const path = `assets.${key}`;
    if (key !== asset.id) {
      error("asset/id-mismatch", path, `record key "${key}" does not match asset.id "${asset.id}"`);
    }
    if (!(asset.intrinsicWidth > 0) || !(asset.intrinsicHeight > 0)) {
      error("asset/dimensions", path, "intrinsic dimensions must be positive");
    }
  }

  const edgeDeps = new Map<string, readonly string[]>();

  for (const [key, edge] of Object.entries(edges)) {
    const path = `edges.${key}`;
    if (key !== edge.id) {
      error("edge/id-mismatch", path, `record key "${key}" does not match edge.id "${edge.id}"`);
    }
    if (!EDGE_FAMILIES.has(edge.semantic.family)) {
      error("edge/semantic-family", `${path}.semantic.family`, `unknown edge family "${String(edge.semantic.family)}"`);
    }
    if (!edge.routing.waypoints.every((w) => isFiniteNumber(w.point.x) && isFiniteNumber(w.point.y))) {
      error("edge/waypoint", `${path}.routing.waypoints`, "waypoints must have finite coordinates");
    }
    if (edge.routing.stubLength < 0 || edge.routing.obstaclePadding < 0) {
      error("edge/routing", `${path}.routing`, "stubLength and obstaclePadding cannot be negative");
    }

    const deps: string[] = [];
    validateAttachment(scene, edge, edge.source, "source", `${path}.source`, error, deps);
    validateAttachment(scene, edge, edge.target, "target", `${path}.target`, error, deps);
    edgeDeps.set(edge.id, deps);

    const zones = new Set<string>();
    for (const [index, label] of edge.labels.entries()) {
      if (zones.has(label.zone)) {
        error(
          "edge/duplicate-label-zone",
          `${path}.labels[${index}]`,
          `more than one ${label.zone} label`,
        );
      }
      zones.add(label.zone);
      if (!isFiniteNumber(label.offset.x) || !isFiniteNumber(label.offset.y)) {
        error("edge/label-offset", `${path}.labels[${index}].offset`, "label offset must be finite");
      }
      if (label.anchor.kind === "edgePoint" && (label.anchor.t < 0 || label.anchor.t > 1)) {
        error("edge/label-anchor", `${path}.labels[${index}].anchor.t`, "label anchor t must be in [0, 1]");
      }
    }

    if (edge.markers.source.family !== "none" && edge.markers.source.scale !== undefined && !(edge.markers.source.scale > 0)) {
      error("edge/marker-scale", `${path}.markers.source.scale`, "marker scale must be positive");
    }
    if (edge.markers.target.family !== "none" && edge.markers.target.scale !== undefined && !(edge.markers.target.scale > 0)) {
      error("edge/marker-scale", `${path}.markers.target.scale`, "marker scale must be positive");
    }

    if (edge.semantic.family === "er" && edge.markers.source.family === "uml") {
      warning("edge/marker-family", `${path}.markers.source`, "ER edge uses a UML marker");
    }
    if (edge.semantic.family === "er" && edge.markers.target.family === "uml") {
      warning("edge/marker-family", `${path}.markers.target`, "ER edge uses a UML marker");
    }
    if (edge.semantic.family === "uml" && edge.markers.source.family === "er") {
      warning("edge/marker-family", `${path}.markers.source`, "UML edge uses an ER marker");
    }
    if (edge.semantic.family === "uml" && edge.markers.target.family === "er") {
      warning("edge/marker-family", `${path}.markers.target`, "UML edge uses an ER marker");
    }
  }

  detectEdgeAttachmentCycles(edgeDeps, error);

  return diagnostics;
};

function validateAttachment(
  scene: SceneDocument,
  edge: SceneEdge,
  attachment: EdgeAttachment,
  endName: "source" | "target",
  path: string,
  error: ErrorReporter,
  deps: string[],
): void {
  if (attachment.target === "free") {
    if (!isFiniteNumber(attachment.point.x) || !isFiniteNumber(attachment.point.y)) {
      error("edge/free-endpoint", path, `${endName} endpoint has a non-finite point`);
    }
    return;
  }

  if (attachment.target === "edge") {
    if (attachment.edgeId === edge.id) {
      error("edge/self-attachment", path, "an edge cannot attach to itself");
      return;
    }
    if (!Number.isFinite(attachment.t) || attachment.t < 0 || attachment.t > 1) {
      error("edge/edge-anchor-t", path, "edge-to-edge anchor t must be in [0, 1]");
    }
    if (scene.edges[attachment.edgeId] === undefined) {
      error("edge/missing-edge", path, `edge "${attachment.edgeId}" does not exist`);
      return;
    }
    deps.push(attachment.edgeId);
    return;
  }

  const node = scene.nodes[attachment.nodeId];
  if (node === undefined) {
    error("edge/missing-node", path, `node "${attachment.nodeId}" does not exist`);
    return;
  }

  switch (attachment.port.kind) {
    case "row": {
      if (!isTableLikeNode(node)) {
        error("edge/row-port-type", path, `node "${node.id}" is not a table-like node`);
        return;
      }
      if (attachment.port.side !== "west" && attachment.port.side !== "east") {
        error("edge/row-port-side", path, "row port side must be west or east");
      }
      if (findRow(node, attachment.port.rowId) === undefined) {
        error("edge/missing-row", path, `row "${attachment.port.rowId}" does not exist on node "${node.id}"`);
      }
      return;
    }
    case "perimeter":
      if (
        ![
          "north",
          "north-east",
          "east",
          "south-east",
          "south",
          "south-west",
          "west",
          "north-west",
        ].includes(attachment.port.side)
      ) {
        error("edge/perimeter-side", path, `unknown perimeter side "${attachment.port.side}"`);
      }
      return;
    case "angle":
      if (!isFiniteNumber(attachment.port.angle) || attachment.port.angle < 0 || attachment.port.angle > 360) {
        error("edge/angle-port", path, "perimeter angle must be in [0, 360]");
      }
      return;
    case "spine":
      if (node.kind !== "lifeline") {
        error("edge/spine-port-type", path, `node "${node.id}" is not a lifeline`);
        return;
      }
      if (!isFiniteNumber(attachment.port.t) || attachment.port.t < 0 || attachment.port.t > 1) {
        error("edge/spine-t", path, "spine t must be in [0, 1]");
      }
      return;
  }
}

function detectEdgeAttachmentCycles(
  deps: ReadonlyMap<string, readonly string[]>,
  error: ErrorReporter,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id].join(" -> ");
      error("edge/attachment-cycle", `edges.${id}`, `edge-to-edge attachment cycle: ${cycle}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of deps.keys()) visit(id);
}
