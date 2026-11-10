/**
 * Round-trip checks for scene and project files.
 *
 * Run with `npm run test:persistence`; the full `npm run check` also runs it.
 */

import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
import { asAssetId, asSceneId } from "../src/model/ids.ts";
import {
  deserializeProjectFile,
  deserializeSceneFile,
  FileFormatError,
  serializeProjectFile,
  serializeSceneFile,
} from "../src/model/persistence.ts";

let checked = 0;

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
  checked += 1;
};

const assertThrows = (action: () => void, message: string): void => {
  try {
    action();
  } catch (error) {
    assert(error instanceof FileFormatError, `${message}: expected FileFormatError, got ${String(error)}`);
    return;
  }
  throw new Error(`${message}: expected the operation to throw`);
};

const scenes = STEP1_FIXTURES.map((fixture) => fixture.scene);
const firstScene = scenes[0];
if (firstScene === undefined) throw new Error("fixture set is empty");

for (const scene of scenes) {
  const restored = deserializeSceneFile(serializeSceneFile(scene));
  assert(
    JSON.stringify(restored) === JSON.stringify(scene),
    `scene round-trip changed "${scene.meta.title}"`,
  );

  const bare = deserializeSceneFile(JSON.stringify(scene));
  assert(
    JSON.stringify(bare) === JSON.stringify(scene),
    `bare scene round-trip changed "${scene.meta.title}"`,
  );

  const bom = deserializeSceneFile(`\ufeff${serializeSceneFile(scene)}`);
  assert(
    JSON.stringify(bom) === JSON.stringify(scene),
    `BOM-prefixed scene round-trip changed "${scene.meta.title}"`,
  );
}

const activeScene = scenes[3];
if (activeScene === undefined) throw new Error("fixture set is missing the sequence scene");
const project = deserializeProjectFile(
  serializeProjectFile(scenes, activeScene.id),
);
assert(project.scenes.length === scenes.length, "project lost scenes");
assert(project.activeSceneId === activeScene.id, "project lost the active scene");
assert(
  JSON.stringify(project.scenes) === JSON.stringify(scenes),
  "project round-trip changed scene contents",
);

const imageScene = scenes.find((scene) => Object.keys(scene.assets).length > 0);
if (imageScene === undefined) throw new Error("fixture set is missing an image scene");
const imageAssetId = Object.keys(imageScene.assets)[0];
const imageAsset = imageAssetId === undefined ? undefined : imageScene.assets[imageAssetId];
if (imageAssetId === undefined || imageAsset === undefined) {
  throw new Error("image fixture is missing its asset");
}
const dataUrl =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
const hydratedScene = {
  ...imageScene,
  assets: {
    ...imageScene.assets,
    [imageAssetId]: { ...imageAsset, dataUrl },
  },
};
const imageProjectText = serializeProjectFile([hydratedScene], hydratedScene.id);
const imageProjectJson = JSON.parse(imageProjectText) as {
  assets: Record<string, { dataUrl?: string }>;
  scenes: readonly {
    assets: Record<string, { dataUrl?: string }>;
  }[];
};
assert(
  imageProjectJson.assets[imageAssetId]?.dataUrl === dataUrl,
  "project JSON should store image bytes once at the project level",
);
assert(
  imageProjectJson.scenes[0]?.assets[imageAssetId]?.dataUrl === undefined,
  "project scene copies should reference assets without repeating bytes",
);
const importedImageProject = deserializeProjectFile(imageProjectText);
assert(
  importedImageProject.assets[imageAssetId]?.dataUrl === dataUrl,
  "project image bytes should restore at the project level",
);
assert(
  importedImageProject.scenes[0]?.assets[imageAssetId]?.dataUrl === dataUrl,
  "scene assets should be hydrated from project-level bytes",
);

const clonedImageScene = {
  ...hydratedScene,
  id: asSceneId("scene_image_copy"),
  meta: { ...hydratedScene.meta, title: "Image copy" },
};
const multiSceneText = serializeProjectFile(
  [hydratedScene, clonedImageScene],
  clonedImageScene.id,
);
const multiSceneJson = JSON.parse(multiSceneText) as {
  assets: Record<string, unknown>;
};
assert(
  Object.keys(multiSceneJson.assets).length === 1,
  "the same image bytes should be stored once across multiple scenes",
);
const multiSceneProject = deserializeProjectFile(multiSceneText);
assert(
  multiSceneProject.scenes.every(
    (scene) => scene.assets[imageAssetId]?.dataUrl === dataUrl,
  ),
  "both scenes should reference the shared project asset",
);
assert(
  deserializeSceneFile(serializeSceneFile(hydratedScene)).assets[imageAssetId]?.dataUrl ===
    dataUrl,
  "standalone scene files should keep their image bytes",
);

const libraryAsset = {
  ...imageAsset,
  id: asAssetId("asset_library_only"),
  fileName: "library-only.svg",
  checksum: "sha256:library-only",
  dataUrl,
};
const libraryProjectText = serializeProjectFile(
  [hydratedScene],
  hydratedScene.id,
  { [libraryAsset.id]: libraryAsset },
);
const libraryProjectJson = JSON.parse(libraryProjectText) as {
  assets: Record<string, { dataUrl?: string }>;
};
assert(
  libraryProjectJson.assets[libraryAsset.id] === undefined,
  "serialization should omit unused library assets",
);
const importedLibraryProject = deserializeProjectFile(libraryProjectText);
assert(
  importedLibraryProject.assets[libraryAsset.id] === undefined,
  "unused library assets should not round-trip through the project file",
);

const fallbackProject = deserializeProjectFile(
  JSON.stringify({
    format: "umler.project",
    version: 1,
    activeSceneId: "scene_missing",
    scenes,
  }),
);
assert(
  fallbackProject.activeSceneId === scenes[0]?.id,
  "missing active scene should fall back to the first scene",
);

assertThrows(
  () => deserializeSceneFile("{}"),
  "empty object should not be a scene",
);
assertThrows(
  () => deserializeSceneFile('{"format":"umler.scene","version":2,"scene":{}}'),
  "future scene version should be rejected",
);
assertThrows(
  () => deserializeProjectFile('{"format":"umler.project","version":1,"scenes":[]}'),
  "empty project should be rejected",
);
assertThrows(
  () =>
    deserializeProjectFile(
      JSON.stringify({
        format: "umler.project",
        version: 1,
        scenes: [firstScene, firstScene],
      }),
    ),
  "duplicate scene ids should be rejected",
);
assertThrows(
  () => serializeProjectFile([firstScene, firstScene], activeScene.id),
  "export should reject duplicate scene ids",
);

const danglingEdges = JSON.parse(JSON.stringify(firstScene)) as {
  nodes: Record<string, unknown>;
};
danglingEdges.nodes = {};
assertThrows(
  () =>
    deserializeSceneFile(
      JSON.stringify({
        format: "umler.scene",
        version: 1,
        scene: danglingEdges,
      }),
    ),
  "a scene with dangling edge attachments should be rejected",
);

const badKind = JSON.parse(JSON.stringify(firstScene)) as {
  meta: { diagramKind: string };
};
badKind.meta.diagramKind = "toString";
assertThrows(
  () =>
    deserializeSceneFile(
      JSON.stringify({
        format: "umler.scene",
        version: 1,
        scene: badKind,
      }),
    ),
  "an inherited object key should not be accepted as a diagram kind",
);

console.log(`Persistence checks passed (${checked} assertions).`);
