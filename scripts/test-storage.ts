/**
 * Browser-storage recovery checks.
 *
 * The storage modules only touch `window` when called, so a small in-memory
 * Storage shim lets Node exercise the round trip.
 */

import { STEP1_FIXTURES } from "../src/fixtures/index.ts";
import { collectProjectAssets } from "../src/model/assets.ts";
import { copySceneNodes } from "../src/model/clipboard.ts";
import { asAssetId } from "../src/model/ids.ts";
import {
  CLIPBOARD_STORAGE_KEY,
  loadSceneClipboard,
  parseSceneClipboard,
  storeSceneClipboard,
} from "../src/app/clipboard-storage.ts";
import { projectDigest, type GitHubBinding } from "../src/model/github-project.ts";
import { loadStoredGitHubSession, storeGitHubSession } from "../src/app/github-session.ts";
import { loadStoredProject, saveStoredProject } from "../src/app/project-storage.ts";
import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  parseUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_KEY,
} from "../src/app/ui-preferences.ts";

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
  sceneDigests: { [activeScene.id]: "scene-digest" },
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
  restored?.githubBinding?.sceneDigests?.[activeScene.id] === "scene-digest",
  "restored project lost its per-scene GitHub baseline",
);
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

// A session written by the old per-tab storage should migrate on first load.
sessionStorage.setItem(
  "umler.github.session",
  JSON.stringify({
    token: "legacy-token",
    user: { login: "legacy", name: null, avatarUrl: "", htmlUrl: "" },
  }),
);
const migrated = loadStoredGitHubSession();
assert(migrated?.token === "legacy-token", "legacy session token should migrate");
assert(
  localStorage.getItem("umler.github.session") !== null,
  "legacy session should move to shared local storage",
);
assert(
  sessionStorage.getItem("umler.github.session") === null,
  "legacy tab session should be cleared after migration",
);

storeGitHubSession({
  token: "token",
  user: { login: "octocat", name: "Octo Cat", avatarUrl: "", htmlUrl: "" },
  refreshToken: "refresh-token",
  accessTokenExpiresAt: "2026-11-21T00:00:00.000Z",
  refreshTokenExpiresAt: "2027-05-21T00:00:00.000Z",
});
const session = loadStoredGitHubSession();
assert(session?.token === "token", "session token should restore across tabs");
assert(session?.user.login === "octocat", "session user should restore");
assert(session?.refreshToken === "refresh-token", "refresh token should restore");
assert(
  session?.accessTokenExpiresAt === "2026-11-21T00:00:00.000Z",
  "access-token expiry should restore",
);
assert(
  session?.refreshTokenExpiresAt === "2027-05-21T00:00:00.000Z",
  "refresh-token expiry should restore",
);
assert(
  localStorage.getItem("umler.github.session") !== null,
  "the shared session should persist in local storage",
);
assert(
  sessionStorage.getItem("umler.github.session") === null,
  "the shared session should not remain tab-scoped",
);
storeGitHubSession(null);
assert(loadStoredGitHubSession() === null, "signing out should clear the session");
assert(
  localStorage.getItem("umler.github.session") === null,
  "signing out should remove the shared session",
);

assert(
  JSON.stringify(loadUiPreferences()) === JSON.stringify(DEFAULT_UI_PREFERENCES),
  "empty storage should restore default UI toggles",
);
saveUiPreferences({
  panelVisible: false,
  codePanelVisible: true,
  gridVisible: false,
  snapEnabled: false,
  lowPerformanceMode: true,
  colorMode: "dark",
});
assert(loadUiPreferences().panelVisible === false, "layout panel visibility should restore");
assert(loadUiPreferences().codePanelVisible === true, "Typst panel visibility should restore");
assert(loadUiPreferences().gridVisible === false, "grid visibility should restore");
assert(loadUiPreferences().snapEnabled === false, "snap setting should restore");
assert(
  loadUiPreferences().lowPerformanceMode === true,
  "low performance mode should restore",
);
assert(
  loadUiPreferences().colorMode === "dark",
  "color mode should restore",
);
assert(
  parseUiPreferences('{"panelVisible":"yes","gridVisible":true}').panelVisible === true,
  "invalid toggle values should fall back to defaults",
);
assert(
  parseUiPreferences("{not json").gridVisible === true,
  "corrupt toggle data should be ignored",
);
localStorage.removeItem(UI_PREFERENCES_KEY);

const clipboardScene = scenes[0];
if (clipboardScene === undefined) throw new Error("fixture set is missing a clipboard scene");
const clipboardNodeId = Object.keys(clipboardScene.nodes)[0];
if (clipboardNodeId === undefined) throw new Error("clipboard fixture has no nodes");
const clipboard = copySceneNodes(clipboardScene, [clipboardNodeId]);
if (clipboard === null) throw new Error("clipboard fixture could not be copied");
assert(storeSceneClipboard(clipboard) === true, "clipboard should persist for other tabs");
assert(
  localStorage.getItem(CLIPBOARD_STORAGE_KEY) !== null,
  "clipboard should use the shared storage key",
);
const restoredClipboard = loadSceneClipboard();
assert(
  restoredClipboard?.nodes.length === clipboard.nodes.length,
  "clipboard nodes should round-trip across tabs",
);
assert(
  restoredClipboard?.diagramKind === clipboard.diagramKind,
  "clipboard diagram kind should round-trip",
);
assert(parseSceneClipboard(null) === null, "empty clipboard storage should be ignored");
localStorage.setItem(CLIPBOARD_STORAGE_KEY, "{not json");
assert(loadSceneClipboard() === null, "corrupt clipboard storage should be ignored");
localStorage.setItem(
  CLIPBOARD_STORAGE_KEY,
  JSON.stringify({ version: 1, clipboard: { sceneId: "x" } }),
);
assert(loadSceneClipboard() === null, "invalid clipboard payload should be ignored");

console.log(`Storage checks passed (${checked} assertions).`);
