import type { SceneDocument } from "../model/scene.ts";
import type { EdgeLayout, LayoutSnapshot, NodeLayout } from "../model/layout.ts";
import type { SceneNode } from "../model/nodes.ts";
import type { SceneEdge } from "../model/edges.ts";
import { edgeDisplayName } from "../model/edges.ts";
import { markerDefinition } from "../model/markers.ts";

interface InspectorProps {
  readonly scene: SceneDocument;
  readonly node: SceneNode | null;
  readonly edge: SceneEdge | null;
  readonly layout: LayoutSnapshot;
  readonly nodeLayout: NodeLayout | null;
  readonly edgeLayout: EdgeLayout | null;
}

const kindLabel: Record<SceneNode["kind"], string> = {
  table: "Entity / class table",
  relationAttribute: "Relation attribute",
  relationship: "ER relationship",
  actor: "UML actor",
  useCase: "Use case",
  object: "Object",
  state: "State",
  pseudostate: "Pseudostate",
  lifeline: "Lifeline",
  frame: "Frame / boundary",
  image: "Foreign image",
  comment: "Comment / note",
};

const rowCount = (node: SceneNode): number | null => {
  if (node.kind === "table") return node.sections.reduce((sum, section) => sum + section.rows.length, 0);
  if (node.kind === "relationAttribute") return node.rows.length;
  return null;
};

const portCounts = (layout: NodeLayout): { row: number; perimeter: number; spine: number } => {
  const counts = { row: 0, perimeter: 0, spine: 0 };
  for (const port of layout.ports) {
    if (port.ref.kind === "row") counts.row += 1;
    if (port.ref.kind === "perimeter") counts.perimeter += 1;
    if (port.ref.kind === "spine") counts.spine += 1;
  }
  return counts;
};

export const Inspector = ({ scene, node, edge, layout, nodeLayout, edgeLayout }: InspectorProps) => {
  const counts = nodeLayout === null ? null : portCounts(nodeLayout);
  const rows = node === null ? null : rowCount(node);

  return (
    <aside className="inspector">
      <section className="panel">
        <div className="panel-heading">
          <span>Inspector</span>
          <span className="panel-hint">read only</span>
        </div>
        {edge !== null && edgeLayout !== null ? (
          <div className="selected-inspector">
            <div className="selected-title">{edgeDisplayName(edge)}</div>
            <div className="selected-kind">{edge.id} · {edge.semantic.family}</div>
            <dl className="stat-list">
              <div><dt>Route</dt><dd>{edgeLayout.routedBy}</dd></div>
              <div><dt>Bends</dt><dd>{edgeLayout.bendCount}</dd></div>
              <div><dt>Source</dt><dd>{markerDefinition(edge.markers.source).shortLabel}</dd></div>
              <div><dt>Target</dt><dd>{markerDefinition(edge.markers.target).shortLabel}</dd></div>
            </dl>
            <p className="panel-footnote">Click the line to open line controls; click a terminal to edit that end.</p>
          </div>
        ) : node !== null && nodeLayout !== null ? (
          <div className="selected-inspector">
            <div className="selected-title">{node.name}</div>
            <div className="selected-kind">{kindLabel[node.kind]}</div>
            <dl className="stat-list">
              <div><dt>Position</dt><dd>{nodeLayout.frame.x.toFixed(1)}, {nodeLayout.frame.y.toFixed(1)}</dd></div>
              <div><dt>Size</dt><dd>{nodeLayout.frame.width.toFixed(1)} × {nodeLayout.frame.height.toFixed(1)}</dd></div>
              <div><dt>Locked</dt><dd>{node.locked ? "yes" : "no"}</dd></div>
              {rows === null ? null : <div><dt>Rows</dt><dd>{rows}</dd></div>}
              {counts === null ? null : (
                <div><dt>Ports</dt><dd>{counts.row} row · {counts.perimeter} perimeter{counts.spine > 0 ? ` · ${counts.spine} spine` : ""}</dd></div>
              )}
            </dl>
            <p className="panel-footnote">
              Object controls now appear beside the object. Click a table header, section, row or text to open
              its focused controls.
            </p>
          </div>
        ) : (
          <div className="empty-inspector">
            <p>Select a node or connector. Object editing controls appear beside the object on the canvas.</p>
            <dl className="stat-list">
              <div><dt>Nodes</dt><dd>{Object.keys(scene.nodes).length}</dd></div>
              <div><dt>Edges</dt><dd>{Object.keys(scene.edges).length}</dd></div>
              <div><dt>Diagram</dt><dd>{scene.meta.diagramKind}</dd></div>
            </dl>
          </div>
        )}
      </section>

      <section className="panel diagnostics">
        <div className="panel-heading">
          <span>Geometry</span>
          <span className="panel-hint">live</span>
        </div>
        <dl className="stat-list">
          <div>
            <dt>Route collisions</dt>
            <dd className={layout.diagnostics.routeCollisions > 0 ? "warn" : ""}>{layout.diagnostics.routeCollisions}</dd>
          </div>
          <div>
            <dt>Node overlaps</dt>
            <dd className={layout.diagnostics.overlappingNodes > 0 ? "warn" : ""}>{layout.diagnostics.overlappingNodes}</dd>
          </div>
          <div>
            <dt>Content bounds</dt>
            <dd>{`${Math.round(layout.contentBounds.width)} × ${Math.round(layout.contentBounds.height)}`}</dd>
          </div>
          <div>
            <dt>Fit bounds</dt>
            <dd>{`${Math.round(layout.fitBounds.width)} × ${Math.round(layout.fitBounds.height)}`}</dd>
          </div>
        </dl>
        <p className="panel-footnote">
          A* routing, label collision and layered crossing-reduction are active. Label dragging/pinning and
          multiline wrapping remain the next refinement.
        </p>
      </section>
    </aside>
  );
};
