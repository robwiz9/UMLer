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
  parseLatestFileCommit,
} from "../src/app/github-client.ts";
import {
  compareRemoteFile,
  conflictingScenes,
  githubFileNameOf,
  githubFolderOf,
  githubParentFolder,
  githubTargetLabel,
  isGitHubProjectFile,
  joinGitHubFolder,
  joinGitHubPath,
  mergeAutoChoices,
  mergeProjectScenes,
  normalizeGitHubBranchName,
  normalizeGitHubFilePath,
  normalizeGitHubFolder,
  normalizeGitHubFolderName,
  projectDigest,
  projectTitleFromPath,
  sceneDigestMap,
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
  normalizeGitHubFilePath(" diagrams\\nested//umler-project.umler ") ===
    "diagrams/nested/umler-project.umler",
  "file paths should normalize slashes and surrounding space",
);
assert(
  normalizeGitHubFolder("/diagrams//nested/") === "diagrams/nested",
  "folder paths should normalize duplicate and edge slashes",
);
assert(normalizeGitHubFolder("") === "", "repository root should stay empty");
assert(
  joinGitHubPath("diagrams/nested", "umler-project.umler") ===
    "diagrams/nested/umler-project.umler",
  "folder and file should join",
);
assert(
  joinGitHubFolder("diagrams", "nested") === "diagrams/nested",
  "new folder should join the current folder",
);
assert(
  normalizeGitHubBranchName(" feature/er-export ") === "feature/er-export",
  "branch names should trim slashes, spaces and nested names",
);
assert(
  normalizeGitHubBranchName("main") === "main",
  "simple branch names should pass validation",
);
assertThrows(() => normalizeGitHubBranchName(""), "empty branch names should fail");
assertThrows(
  () => normalizeGitHubBranchName("feature branch"),
  "branch names with spaces should fail",
);
assertThrows(
  () => normalizeGitHubBranchName("feature..branch"),
  "branch names with double dots should fail",
);
assertThrows(
  () => normalizeGitHubBranchName("/feature"),
  "branch names with a leading slash should fail",
);
assertThrows(
  () => normalizeGitHubBranchName("feature.lock"),
  "branch names ending in .lock should fail",
);
assert(
  isGitHubProjectFile("order-model.umler") && !isGitHubProjectFile("order-model.uscn"),
  "only .umler files should be listed as projects",
);
assert(
  githubFolderOf("diagrams/nested/umler-project.umler") === "diagrams/nested",
  "folder extraction failed",
);
assert(
  githubFileNameOf("diagrams/nested/umler-project.umler") === "umler-project.umler",
  "file extraction failed",
);
assert(
  githubParentFolder("diagrams/nested") === "diagrams",
  "parent folder extraction failed",
);
assert(
  projectTitleFromPath("diagrams/order-model.umler") === "order-model",
  "project title should use the file stem",
);
assert(
  githubTargetLabel({
    owner: "acme",
    repo: "diagrams",
    branch: "main",
    path: "models/order.umler",
  }) === "acme/diagrams · main · models/order.umler",
  "target label should include owner, repo, branch and path",
);

assertThrows(() => normalizeGitHubFilePath("umler.txt"), "non-project extension should fail");
assertThrows(() => normalizeGitHubFilePath(""), "empty file should fail");
assertThrows(
  () => normalizeGitHubFilePath("../umler-project.umler"),
  "parent traversal should fail",
);
assertThrows(
  () => normalizeGitHubFilePath("diagrams/./umler-project.umler"),
  "current-directory segment should fail",
);
assertThrows(
  () => normalizeGitHubFolder("diagrams/../secrets"),
  "folder traversal should fail",
);
assertThrows(
  () => joinGitHubPath("diagrams", "nested/umler-project.umler"),
  "file names should not contain folders",
);
assertThrows(
  () => normalizeGitHubFolderName("nested/sub"),
  "a single folder name should not contain slashes",
);

const scenes = STEP1_FIXTURES.map((fixture) => fixture.scene);
const first = scenes[0];
const second = scenes[1];
if (first === undefined || second === undefined) {
  throw new Error("fixture set is missing scenes");
}

const third = scenes[2];
if (third === undefined) throw new Error("fixture set is missing a third scene");

const localFirst = {
  ...first,
  revision: first.revision + 1,
  meta: { ...first.meta, updatedAt: "2026-01-02T00:00:00.000Z" },
};
const remoteFirst = {
  ...first,
  revision: first.revision + 2,
  meta: { ...first.meta, updatedAt: "2026-01-03T00:00:00.000Z" },
};
const localScenes = [localFirst, second];
const remoteScenes = [remoteFirst, third];
const conflicts = conflictingScenes(localScenes, remoteScenes);
assert(conflicts.length === 1, "only scenes present on both sides with different content conflict");
assert(conflicts[0]?.sceneId === first.id, "the changed scene should be reported");
assert(
  conflicts[0]?.local === localFirst && conflicts[0]?.remote === remoteFirst,
  "conflict should expose both scene copies",
);

const mergedLocal = mergeProjectScenes(
  localScenes,
  localFirst.id,
  remoteScenes,
  third.id,
  { [first.id]: "local" },
);
assert(mergedLocal.scenes.length === 3, "local merge should retain local and remote-only scenes");
assert(mergedLocal.scenes[0] === localFirst, "local choice should keep the local scene");
assert(mergedLocal.scenes[2] === third, "remote-only scene should be appended");
assert(mergedLocal.activeSceneId === localFirst.id, "local active scene should be retained");

const mergedRemote = mergeProjectScenes(
  localScenes,
  localFirst.id,
  remoteScenes,
  third.id,
  { [first.id]: "remote" },
);
assert(mergedRemote.scenes[0] === remoteFirst, "remote choice should replace the local scene");

const mergedBoth = mergeProjectScenes(
  localScenes,
  localFirst.id,
  remoteScenes,
  third.id,
  { [first.id]: "both" },
);
assert(mergedBoth.scenes.length === 4, "keep both should add the remote scene");
assert(mergedBoth.scenes[0] === localFirst, "keep both should retain the local scene first");
const insertedRemote = mergedBoth.scenes[1];
assert(
  insertedRemote !== undefined && insertedRemote.id !== localFirst.id,
  "keep both should insert the remote scene with a new id",
);
assert(
  insertedRemote?.meta.title === `${remoteFirst.meta.title} (remote)`,
  "the inserted remote scene should get a distinct title",
);
assert(mergedBoth.scenes[2] === second, "local-only scenes should remain after the inserted copy");

const mergedFallbackActive = mergeProjectScenes(
  localScenes,
  "missing-scene",
  remoteScenes,
  third.id,
  { [first.id]: "local" },
);
assert(
  mergedFallbackActive.activeSceneId === third.id,
  "remote active scene should be used when the local one is absent",
);

const localBaseline = sceneDigestMap([localFirst, second]);
assert(
  conflictingScenes(localScenes, remoteScenes, localBaseline).length === 0,
  "a scene changed remotely while local matches its baseline should not be a conflict",
);
assert(
  mergeAutoChoices(localScenes, remoteScenes, localBaseline)[first.id] === "remote",
  "a remotely changed scene should be selected automatically",
);
const remoteBaseline = sceneDigestMap([remoteFirst, third]);
assert(
  conflictingScenes(localScenes, remoteScenes, remoteBaseline).length === 0,
  "a scene changed locally while remote matches its baseline should not be a conflict",
);
assert(
  mergeAutoChoices(localScenes, remoteScenes, remoteBaseline)[first.id] === "local",
  "a locally changed scene should be selected automatically",
);
const bothChangedBaseline = sceneDigestMap([first]);
assert(
  conflictingScenes(localScenes, remoteScenes, bothChangedBaseline).length === 1,
  "a scene changed on both sides should remain a conflict",
);
assert(
  mergeAutoChoices(localScenes, remoteScenes, bothChangedBaseline)[first.id] === undefined,
  "a both-sides conflict should require an explicit choice",
);

const remoteSecond = {
  ...second,
  revision: second.revision + 1,
  meta: { ...second.meta, updatedAt: "2026-01-04T00:00:00.000Z" },
};
const disjointLocal = [localFirst, second];
const disjointRemote = [first, remoteSecond];
const originalBaseline = sceneDigestMap([first, second]);
assert(
  conflictingScenes(disjointLocal, disjointRemote, originalBaseline).length === 0,
  "edits to different scenes should not be a merge conflict",
);
const disjointChoices = mergeAutoChoices(
  disjointLocal,
  disjointRemote,
  originalBaseline,
);
assert(disjointChoices[first.id] === "local", "the locally edited scene should stay local");
assert(disjointChoices[second.id] === "remote", "the remotely edited scene should be adopted");
const disjointMerged = mergeProjectScenes(
  disjointLocal,
  first.id,
  disjointRemote,
  remoteSecond.id,
  disjointChoices,
);
assert(
  disjointMerged.scenes[0] === localFirst && disjointMerged.scenes[1] === remoteSecond,
  "both disjoint scene edits should be written into the merged project",
);

const localSecond = {
  ...second,
  revision: second.revision + 1,
  meta: { ...second.meta, updatedAt: "2026-01-05T00:00:00.000Z" },
};
const overlappingLocal = [localFirst, localSecond];
const overlappingRemote = [remoteFirst, remoteSecond];
assert(
  conflictingScenes(overlappingLocal, overlappingRemote, originalBaseline).length === 2,
  "edits to the same scenes on both sides should produce two conflicts",
);

// Scene deletion is a first-class project change when a last-sync baseline is
// available. This is what stops a remote deletion from being re-added by a
// browser tab that still has the old scene locally.
const deletionBaseline = sceneDigestMap(scenes);
assert(
  conflictingScenes([first, second, third], [first, third], deletionBaseline).length === 0,
  "a one-sided deletion is not a both-present conflict",
);
const mergedRemoteDeletion = mergeProjectScenes(
  [first, second, third],
  second.id,
  [first, third],
  third.id,
  {},
  deletionBaseline,
);
assert(
  !mergedRemoteDeletion.scenes.some((scene) => scene.id === second.id),
  "an unchanged scene deleted remotely must be removed locally",
);
assert(mergedRemoteDeletion.scenes.length === 2, "remote deletion should reduce the merged scene count");
assert(
  mergedRemoteDeletion.activeSceneId === third.id,
  "a deleted active scene should fall back to the remote active scene",
);

const mergedLocalDeletion = mergeProjectScenes(
  [first, third],
  first.id,
  [first, second, third],
  third.id,
  {},
  deletionBaseline,
);
assert(
  !mergedLocalDeletion.scenes.some((scene) => scene.id === second.id),
  "an unchanged scene deleted locally must not be re-added from remote",
);
assert(mergedLocalDeletion.scenes.length === 2, "local deletion should reduce the merged scene count");

const locallyEditedSecond = {
  ...second,
  revision: second.revision + 1,
  meta: { ...second.meta, updatedAt: "2026-01-06T00:00:00.000Z" },
};
const mergedEditAgainstRemoteDeletion = mergeProjectScenes(
  [first, locallyEditedSecond, third],
  first.id,
  [first, third],
  first.id,
  {},
  deletionBaseline,
);
assert(
  mergedEditAgainstRemoteDeletion.scenes.some(
    (scene) => scene.id === second.id && scene.revision === locallyEditedSecond.revision,
  ),
  "a locally edited scene survives a remote deletion",
);

const remotelyEditedSecond = {
  ...second,
  revision: second.revision + 2,
  meta: { ...second.meta, updatedAt: "2026-01-07T00:00:00.000Z" },
};
const mergedEditAgainstLocalDeletion = mergeProjectScenes(
  [first, third],
  first.id,
  [first, remotelyEditedSecond, third],
  first.id,
  {},
  deletionBaseline,
);
assert(
  mergedEditAgainstLocalDeletion.scenes.some(
    (scene) => scene.id === second.id && scene.revision === remotelyEditedSecond.revision,
  ),
  "a remotely edited scene survives a local deletion",
);

const mergedWithoutBaseline = mergeProjectScenes(
  [first],
  first.id,
  [first, second],
  first.id,
  {},
);
assert(
  mergedWithoutBaseline.scenes.some((scene) => scene.id === second.id),
  "without a baseline, remote-only scenes keep the old union behaviour",
);

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
  isGitHubConflict(
    new GitHubApiError(
      "examples/umler-project.umler does not match e443c7607560c713931f377751849c991f840082",
      422,
    ),
  ),
  "the Contents API 'does not match' message should be a save conflict",
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
assert(
  describeGitHubError(
    new GitHubApiError("Reference already exists", 422),
  ).includes("already exists"),
  "branch creation conflicts should mention the existing branch",
);

const parsedCommit = parseLatestFileCommit({
  sha: "commit-sha",
  html_url: "https://github.com/acme/diagrams/commit/commit-sha",
  author: { login: "robwiz9" },
  commit: {
    sha: "commit-sha",
    message: "Merge project from UMLer",
    author: {
      name: "Martin Zezula",
      email: "162130149+robwiz9@users.noreply.github.com",
      date: "2026-11-15T20:37:59Z",
    },
  },
});
assert(parsedCommit?.authorName === "Martin Zezula", "commit author name should parse");
assert(
  parsedCommit?.authorEmail.includes("robwiz9") === true,
  "commit author email should parse",
);
assert(parsedCommit?.date === "2026-11-15T20:37:59Z", "commit date should parse");
assert(
  parsedCommit?.message === "Merge project from UMLer",
  "commit message should parse",
);
assert(
  parseLatestFileCommit({
    sha: "commit-sha",
    author: { login: "octocat" },
    commit: { sha: "commit-sha", message: "No Git author" },
  })?.authorName === "octocat",
  "the linked GitHub account should be used when the Git author name is absent",
);
assert(
  parseLatestFileCommit({ sha: "commit-sha" }) === undefined,
  "a commit list entry without commit details should be ignored",
);

console.log(`GitHub project checks passed (${checked} assertions).`);

