/**
 * Read-only scene thumbnail used by conflict resolution. It reuses the same
 * layout pass, node skeletons and edge renderer as the editor so the two merge
 * choices are visually comparable without mounting another interactive canvas.
 */

import { useMemo } from "react";
import type { ImageAsset, SceneNode } from "../model/nodes.ts";
import type { SceneDocument } from "../model/scene.ts";
import { expandRect } from "../model/geometry.ts";
import { buildLayoutSnapshot } from "../layout/build-layout.ts";
import { CanvasTextMeasurer } from "../layout/text.ts";
import { EdgeLayer, edgeLayerItem } from "./Edges.tsx";
import { NodeSkeleton } from "./NodeSkeleton.tsx";

interface ScenePreviewProps {
  readonly scene: SceneDocument;
  readonly assets?: Readonly<Record<string, ImageAsset>>;
  readonly label?: string;
}

const sequenceMarkers = (edge: SceneDocument["edges"][string]) =>
  edge.semantic.family === "sequence" &&
  edge.markers.source.family === "none" &&
  edge.markers.target.family === "none"
    ? {
        source: { family: "none" as const, kind: "none" as const },
        target:
          edge.semantic.messageKind === "reply"
            ? { family: "generic" as const, kind: "arrow" as const }
            : { family: "generic" as const, kind: "filledArrow" as const },
      }
    : edge.markers;

const imageAssetFor = (
  scene: SceneDocument,
  assets: Readonly<Record<string, ImageAsset>>,
  node: SceneNode,
): ImageAsset | undefined =>
  node.kind === "image" && node.assetId !== undefined
    ? assets[node.assetId] ?? scene.assets[node.assetId]
    : undefined;

export const ScenePreview = ({ scene, assets = {}, label }: ScenePreviewProps) => {
  const layout = useMemo(
    () => buildLayoutSnapshot(scene, new CanvasTextMeasurer()),
    [scene],
  );
  const edgeItems = useMemo(
    () =>
      Object.values(scene.edges)
        .sort((left, right) => left.z - right.z)
        .flatMap((edge) => {
          const edgeLayout = layout.edges[edge.id];
          return edgeLayout === undefined
            ? []
            : [edgeLayerItem(edgeLayout, sequenceMarkers(edge), edge.style.stroke)];
        }),
    [layout, scene.edges],
  );
  const nodes = useMemo(
    () =>
      Object.values(layout.nodes)
        .sort(
          (left, right) =>
            (scene.nodes[left.nodeId]?.z ?? 0) - (scene.nodes[right.nodeId]?.z ?? 0),
        )
        .flatMap((nodeLayout) => {
          const node = scene.nodes[nodeLayout.nodeId];
          return node === undefined ? [] : [{ node, nodeLayout }];
        }),
    [layout, scene.nodes],
  );
  const bounds = expandRect(layout.fitBounds, 14);
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const empty = nodes.length === 0 && edgeItems.length === 0;

  return (
    <div className="scene-preview" aria-label={label ?? `${scene.meta.title} preview`}>
      <svg
        viewBox={`${bounds.x} ${bounds.y} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label ?? scene.meta.title}
      >
        <rect
          x={bounds.x}
          y={bounds.y}
          width={width}
          height={height}
          fill={scene.canvas.background}
        />
        <g pointerEvents="none">
          <EdgeLayer
            edges={edgeItems}
            theme={scene.theme}
            renderLines
            renderLabels={false}
          />
          {nodes.map(({ node, nodeLayout }) => (
            <NodeSkeleton
              key={node.id}
              node={node}
              layout={nodeLayout}
              theme={scene.theme}
              selected={false}
              skeleton={false}
              hoveredPart={null}
              imageAsset={imageAssetFor(scene, assets, node)}
              onPointerDown={() => undefined}
            />
          ))}
          <EdgeLayer
            edges={edgeItems}
            theme={scene.theme}
            renderLines={false}
            renderLabels
          />
        </g>
      </svg>
      {empty ? <span className="scene-preview-empty">Empty scene</span> : null}
    </div>
  );
};
