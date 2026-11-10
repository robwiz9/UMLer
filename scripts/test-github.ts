/**
 * Pure GitHub project helpers: path validation, digests and conflict classes.
 *
 * Run with `npm run test:github`; `npm run check` also runs it.
 */

import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
import {
  describeGitHubError,
  GitHubApiError,
  GitHubOAuthError,
  isGitHubConflict,
} from "../src/app/github-client.ts";
import {
  compareRemoteFile,
  githubFileNameOf,
  githubFolderOf,
  githubParentFolder,
  githubTargetLabel,
  joinGitHubPath,
  normalizeGitHubFilePath,
  normalizeGitHubFolder,
  projectDigest,
  projectTitleFromPath,
} from "../src/model/github-project.ts";

let checked = 0;

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
  checked += 1;
};

const assertThrows = (action: () => void, message: string): void => {
  try {
    action();
  } catch {
    checked += 1;
    return;
  }
  throw new Error(`${message}: expected the operation to throw`);
};

assert(
  normalizeGitHubFilePath(" diagrams\\nested//umler-project.json ") ===
    "diagrams/nested/umler-project.json",
  "file paths should normalize slashes and surrounding space",
);
assert(
  normalizeGitHubFolder("/diagrams//nested/") === "diagrams/nested",
  "folder paths should normalize duplicate and edge slashes",
);
assert(normalizeGitHubFolder("") === "", "repository root should stay empty");
assert(
  joinGitHubPath("diagrams/nested", "umler-project.json") ===
    "diagrams/nested/umler-project.json",
  "folder and file should join",
);
assert(
  githubFolderOf("diagrams/nested/umler-project.json") === "diagrams/nested",
  "folder extraction failed",
);
assert(
  githubFileNameOf("diagrams/nested/umler-project.json") === "umler-project.json",
  "file extraction failed",
);
assert(
  githubParentFolder("diagrams/nested") === "diagrams",
  "parent folder extraction failed",
);
assert(
  projectTitleFromPath("diagrams/order-model.json") === "order-model",
  "project title should use the file stem",
);
assert(
  githubTargetLabel({
    owner: "acme",
    repo: "diagrams",
    branch: "main",
    path: "models/order.json",
  }) === "acme/diagrams · main · models/order.json",
  "target label should include owner, repo, branch and path",
);

assertThrows(() => normalizeGitHubFilePath("umler.txt"), "non-JSON file should fail");
assertThrows(() => normalizeGitHubFilePath(""), "empty file should fail");
assertThrows(
  () => normalizeGitHubFilePath("../umler-project.json"),
  "parent traversal should fail",
);
assertThrows(
  () => normalizeGitHubFilePath("diagrams/./umler-project.json"),
  "current-directory segment should fail",
);
assertThrows(
  () => normalizeGitHubFolder("diagrams/../secrets"),
  "folder traversal should fail",
);
assertThrows(
  () => joinGitHubPath("diagrams", "nested/umler-project.json"),
  "file names should not contain folders",
);

const scenes = STEP1_FIXTURES.map((fixture) => fixture.scene);
const first = scenes[0];
const second = scenes[1];
if (first === undefined || second === undefined) {
  throw new Error("fixture set is missing scenes");
}

const digest = projectDigest(scenes, first.id);
assert(digest === projectDigest(scenes, first.id), "digest should be stable");
assert(
  digest !== projectDigest(scenes, second.id),
  "active scene should affect the digest",
);
assert(
  digest !== projectDigest(scenes.slice(1), first.id),
  "scene list should affect the digest",
);
const editedFirst = { ...first, revision: first.revision + 1 };
assert(
  digest !== projectDigest([editedFirst, ...scenes.slice(1)], first.id),
  "scene content should affect the digest",
);

const imageScene = scenes.find((scene) => Object.keys(scene.assets).length > 0);
if (imageScene === undefined) throw new Error("fixture set is missing an image scene");
const assetKey = Object.keys(imageScene.assets)[0];
const imageAsset = assetKey === undefined ? undefined : imageScene.assets[assetKey];
if (assetKey === undefined || imageAsset === undefined) {
  throw new Error("image fixture is missing its asset");
}
const imageWithBytes = {
  ...imageScene,
  assets: {
    ...imageScene.assets,
    [assetKey]: { ...imageAsset, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
  },
};
const imageWithOtherBytes = {
  ...imageScene,
  assets: {
    ...imageScene.assets,
    [assetKey]: { ...imageAsset, dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
  },
};
assert(
  projectDigest([imageWithBytes], imageWithBytes.id) ===
    projectDigest([imageWithOtherBytes], imageWithOtherBytes.id),
  "immutable image bytes should not be re-hashed on every project digest",
);

assert(
  compareRemoteFile("abc", "abc") === "unchanged",
  "same blob SHA should be unchanged",
);
assert(
  compareRemoteFile("abc", "def") === "changed",
  "different blob SHA should be changed",
);
assert(
  compareRemoteFile("abc", null) === "deleted",
  "missing blob should be deleted",
);
assert(
  compareRemoteFile(null, "def") === "appeared",
  "new remote blob should be appeared",
);
assert(
  compareRemoteFile(null, null) === "unchanged",
  "absent file with no binding should be unchanged",
);

assert(
  isGitHubConflict(new GitHubApiError("sha does not match", 409)),
  "409 should be a save conflict",
);
assert(
  isGitHubConflict(new GitHubApiError("sha wasn't supplied", 422)),
  "422 sha mismatch should be a save conflict",
);
assert(
  !isGitHubConflict(new GitHubApiError("bad request", 400)),
  "ordinary validation errors should not be conflicts",
);
assert(
  describeGitHubError(new GitHubOAuthError("", "device_flow_disabled")).includes(
    "Device flow",
  ),
  "device-flow errors should tell the user what to enable",
);
assert(
  describeGitHubError(new GitHubApiError("Bad credentials", 401)).includes(
    "Sign in again",
  ),
  "401 errors should ask the user to sign in again",
);

console.log(`GitHub project checks passed (${checked} assertions).`);
