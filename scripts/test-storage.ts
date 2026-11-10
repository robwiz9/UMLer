/**
 * Browser-storage recovery checks.
 *
 * The storage modules only touch `window` when called, so a small in-memory
 * Storage shim lets Node exercise the round trip.
 */

import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
import { collectProjectAssets } from "../src/model/assets.ts";
import { asAssetId } from "../src/model/ids.ts";
import { projectDigest, type GitHubBinding } from "../src/model/github-project.ts";
import { loadStoredGitHubSession, storeGitHubSession } from "../src/app/github-session.ts";
import { loadStoredProject, saveStoredProject } from "../src/app/project-storage.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = {
  localStorage,
  sessionStorage,
};

let checked = 0;

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
  checked += 1;
};

const scenes = STEP1_FIXTURES.map((fixture) => fixture.scene);
const activeScene = scenes[3];
if (activeScene === undefined) throw new Error("fixture set is missing the sequence scene");

const binding: GitHubBinding = {
  owner: "acme",
  repo: "diagrams",
  branch: "main",
  path: "models/er.json",
  sha: "blob-sha",
  syncedDigest: "sync-digest",
  syncedAt: "2026-01-01T00:00:00.000Z",
  htmlUrl: "https://github.com/acme/diagrams",
};

assert(loadStoredProject() === null, "empty storage should not restore a project");

const usedAssets = collectProjectAssets(scenes);
const sampleAsset = Object.values(usedAssets)[0];
if (sampleAsset === undefined) throw new Error("fixture set is missing an image asset");
const unusedAsset = {
  ...sampleAsset,
  id: asAssetId("asset_unused"),
  fileName: "unused.svg",
  checksum: "sha256:unused",
  dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
};

saveStoredProject({
  scenes,
  activeSceneId: activeScene.id,
  baselineDigest: projectDigest(scenes, activeScene.id),
  githubBinding: binding,
  assets: { ...usedAssets, [unusedAsset.id]: unusedAsset },
});
const restored = loadStoredProject();
assert(restored !== null, "saved project should restore");
assert(restored?.scenes.length === scenes.length, "restored project lost scenes");
assert(restored?.activeSceneId === activeScene.id, "restored project lost the active scene");
assert(restored?.githubBinding?.path === binding.path, "restored project lost the GitHub path");
assert(restored?.githubBinding?.sha === binding.sha, "restored project lost the GitHub SHA");
assert(
  restored?.baselineDigest === projectDigest(scenes, activeScene.id),
  "restored project lost its sync baseline",
);
assert(
  Object.keys(restored?.assets ?? {}).length === Object.keys(usedAssets).length,
  "restored project lost its referenced asset library",
);
assert(
  restored?.assets[unusedAsset.id] === undefined,
  "unused images should be pruned on reload",
);

localStorage.setItem("umler.openProject", "{not json");
assert(loadStoredProject() === null, "corrupt recovery data should be ignored");
assert(localStorage.getItem("umler.openProject") === null, "corrupt recovery data should be cleared");

localStorage.setItem("umler.openProject", JSON.stringify({ version: 1, scenes: [] }));
assert(loadStoredProject() === null, "empty recovery project should be ignored");

assert(loadStoredGitHubSession() === null, "empty storage should not restore a session");
storeGitHubSession({
  token: "token",
  user: { login: "octocat", name: "Octo Cat", avatarUrl: "", htmlUrl: "" },
});
const session = loadStoredGitHubSession();
assert(session?.token === "token", "session token should restore");
assert(session?.user.login === "octocat", "session user should restore");
storeGitHubSession(null);
assert(loadStoredGitHubSession() === null, "signing out should clear the session");

console.log(`Storage checks passed (${checked} assertions).`);
