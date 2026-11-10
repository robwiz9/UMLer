/**
 * Project-level image asset helpers.
 *
 * Scene documents keep asset metadata so a standalone scene stays valid.
 * Project JSON stores the actual bytes once in a top-level asset map; scenes
 * reference those assets by id. This makes the same bytes reusable from
 * several image nodes or scenes without duplicating them on disk.
 */

import type { SceneDocument } from "./scene.ts";
import type { ImageAsset } from "./nodes.ts";

export type ProjectAssets = Readonly<Record<string, ImageAsset>>;

export const referencedAssetIds = (
  scenes: readonly SceneDocument[],
): Set<string> => {
  const ids = new Set<string>();
  for (const scene of scenes) {
    for (const node of Object.values(scene.nodes)) {
      if (node.kind === "image" && node.assetId !== undefined) {
        ids.add(String(node.assetId));
      }
    }
  }
  return ids;
};

/** Merge assets from every scene, preferring records that carry bytes. */
export const collectProjectAssets = (
  scenes: readonly SceneDocument[],
): Record<string, ImageAsset> => {
  const assets: Record<string, ImageAsset> = {};
  const referenced = referencedAssetIds(scenes);
  for (const scene of scenes) {
    for (const [id, asset] of Object.entries(scene.assets)) {
      if (!referenced.has(id)) continue;
      const existing = assets[id];
      if (existing === undefined || (asset.dataUrl !== undefined && existing.dataUrl === undefined)) {
        assets[id] = asset;
      }
    }
  }
  return assets;
};

/**
 * Keep only assets referenced by at least one image node. The browser keeps
 * unused uploads in its library for reuse; project serialization and reload
 * recovery use this to avoid carrying orphaned bytes forever.
 */
export const pruneUnusedProjectAssets = (
  scenes: readonly SceneDocument[],
  assets: ProjectAssets,
): Record<string, ImageAsset> => {
  const referenced = referencedAssetIds(scenes);
  const sceneAssets = new Map<string, ImageAsset>();
  for (const scene of scenes) {
    for (const [id, asset] of Object.entries(scene.assets)) {
      const existing = sceneAssets.get(id);
      if (existing === undefined || (asset.dataUrl !== undefined && existing.dataUrl === undefined)) {
        sceneAssets.set(id, asset);
      }
    }
  }

  const pruned: Record<string, ImageAsset> = {};
  for (const id of referenced) {
    const stored = assets[id];
    const sceneAsset = sceneAssets.get(id);
    const asset = stored?.dataUrl !== undefined ? stored : sceneAsset ?? stored;
    if (asset !== undefined) pruned[id] = asset;
  }
  return pruned;
};

export const unusedProjectAssets = (
  scenes: readonly SceneDocument[],
  assets: ProjectAssets,
): readonly ImageAsset[] => {
  const referenced = referencedAssetIds(scenes);
  return Object.entries(assets)
    .filter(([id]) => !referenced.has(id))
    .map(([, asset]) => asset);
};

export const findAssetByChecksum = (
  assets: ProjectAssets,
  checksum: string,
): ImageAsset | undefined =>
  Object.values(assets).find((asset) => asset.checksum === checksum);

/** Project JSON scene copies omit the bulky data URL; the top level owns it. */
export const assetMetadataOnly = (asset: ImageAsset): ImageAsset => ({
  ...asset,
  dataUrl: undefined,
});
