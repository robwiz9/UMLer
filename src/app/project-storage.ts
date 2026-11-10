/**
 * Local recovery of the open project across a page refresh.
 *
 * This is a local convenience cache, not a replacement for scene/project
 * files or GitHub. It stores only the same JSON documents the app already
 * exports, plus the last sync baseline and GitHub binding.
 */

import type { SceneDocument } from "../model/scene.ts";
import type { ImageAsset } from "../model/nodes.ts";
import { pruneUnusedProjectAssets } from "../model/assets.ts";
import { deserializeProjectFile } from "../model/persistence.ts";
import { projectDigest, type GitHubBinding } from "../model/github-project.ts";

const PROJECT_STORAGE_KEY = "umler.openProject";
const STORAGE_VERSION = 1;

export interface StoredProject {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
  readonly baselineDigest: string;
  readonly githubBinding: GitHubBinding | null;
  readonly assets: Readonly<Record<string, ImageAsset>>;
}

interface StoredProjectPayload extends StoredProject {
  readonly version: typeof STORAGE_VERSION;
  readonly savedAt: string;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBinding = (value: unknown): GitHubBinding | null => {
  if (!isRecord(value)) return null;
  const { owner, repo, branch, path, syncedDigest, syncedAt } = value;
  if (
    typeof owner !== "string" ||
    typeof repo !== "string" ||
    typeof branch !== "string" ||
    typeof path !== "string" ||
    typeof syncedDigest !== "string" ||
    typeof syncedAt !== "string" ||
    owner.length === 0 ||
    repo.length === 0 ||
    branch.length === 0 ||
    path.length === 0
  ) {
    return null;
  }
  if (value.sha !== null && typeof value.sha !== "string") return null;
  return {
    owner,
    repo,
    branch,
    path,
    sha: typeof value.sha === "string" ? value.sha : null,
    syncedDigest,
    syncedAt,
    ...(typeof value.htmlUrl === "string" ? { htmlUrl: value.htmlUrl } : {}),
  };
};

const clearStoredProject = (): void => {
  try {
    window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable; the app still works without recovery.
  }
};

export const loadStoredProject = (): StoredProject | null => {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const payload = JSON.parse(raw) as unknown;
    if (
      !isRecord(payload) ||
      payload.version !== STORAGE_VERSION ||
      !Array.isArray(payload.scenes) ||
      payload.scenes.length === 0
    ) {
      clearStoredProject();
      return null;
    }

    const imported = deserializeProjectFile(
      JSON.stringify({
        format: "umler.project",
        version: 1,
        activeSceneId:
          typeof payload.activeSceneId === "string" ? payload.activeSceneId : "",
        scenes: payload.scenes,
        ...(isRecord(payload.assets) ? { assets: payload.assets } : {}),
      }),
    );
    const baselineDigest =
      typeof payload.baselineDigest === "string"
        ? payload.baselineDigest
        : projectDigest(imported.scenes, imported.activeSceneId);

    return {
      scenes: imported.scenes,
      activeSceneId: imported.activeSceneId,
      baselineDigest,
      githubBinding: readBinding(payload.githubBinding),
      assets: pruneUnusedProjectAssets(imported.scenes, imported.assets),
    };
  } catch {
    clearStoredProject();
    return null;
  }
};

export const saveStoredProject = (project: StoredProject): void => {
  const payload: StoredProjectPayload = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    ...project,
  };
  try {
    window.localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Quota or private-mode failures must not interrupt editing.
  }
};
