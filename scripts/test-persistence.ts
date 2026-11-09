/**
 * Round-trip checks for scene and project files.
 *
 * Run with `npm run test:persistence`; the full `npm run check` also runs it.
 */

import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
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
