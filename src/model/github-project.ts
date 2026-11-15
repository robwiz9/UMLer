/**
 * Framework-agnostic helpers for GitHub project files.
 *
 * The GitHub API layer lives in `src/app`; these helpers are pure so path
 * validation, change detection and conflict classification can be tested
 * without a browser or a network.
 */

import type { ImageAsset } from "./nodes.ts";
import type { SceneDocument } from "./scene.ts";
import { newId, type SceneId } from "./ids.ts";

export const DEFAULT_GITHUB_PROJECT_FILE = "umler-project.umler";
export const GITHUB_PROJECT_EXTENSION = ".umler";

export interface GitHubTarget {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly path: string;
}

export interface GitHubBinding extends GitHubTarget {
  /** Blob SHA of the last loaded/saved revision; null until the file exists. */
  readonly sha: string | null;
  /** Project digest at the last successful load/save. */
  readonly syncedDigest: string;
  readonly syncedAt: string;
  readonly htmlUrl?: string;
  /** Per-scene baseline used for three-way conflict detection. */
  readonly sceneDigests?: Readonly<Record<string, string>>;
}

export interface ProjectSnapshot {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
  /** Project asset library, including uploaded images not currently placed. */
  readonly assets?: Readonly<Record<string, ImageAsset>>;
}

export type MergeChoice = "local" | "remote" | "both" | null;

export interface SceneMergeConflict {
  readonly sceneId: string;
  readonly local: SceneDocument;
  readonly remote: SceneDocument;
}

/** Fingerprint of one scene, independent of embedded image bytes. */
export const sceneDigest = (scene: SceneDocument): string =>
  projectDigest([scene], scene.id);

export const sceneDigestMap = (
  scenes: readonly SceneDocument[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(scenes.map((scene) => [scene.id, sceneDigest(scene)]));

/**
 * Scenes present on both sides with different content. When a per-scene
 * baseline from the last sync is available, only scenes changed on both sides
 * are conflicts; one-sided changes can be merged automatically.
 */
export const conflictingScenes = (
  localScenes: readonly SceneDocument[],
  remoteScenes: readonly SceneDocument[],
  baseline?: Readonly<Record<string, string>>,
): readonly SceneMergeConflict[] => {
  const remoteById = new Map(remoteScenes.map((scene) => [scene.id, scene]));
  return localScenes.flatMap((local) => {
    const remote = remoteById.get(local.id);
    if (remote === undefined) return [];
    const localDigest = sceneDigest(local);
    const remoteDigest = sceneDigest(remote);
    if (localDigest === remoteDigest) return [];
    if (baseline !== undefined) {
      const base = baseline[local.id];
      if (base !== undefined && (localDigest === base || remoteDigest === base)) {
        return [];
      }
    }
    return [{ sceneId: local.id, local, remote }];
  });
};

/**
 * Choices for differing scenes that changed on only one side. Returning these
 * alongside the explicit conflict choices lets the merge retain one-sided
 * remote edits without asking the user about them.
 */
export const mergeAutoChoices = (
  localScenes: readonly SceneDocument[],
  remoteScenes: readonly SceneDocument[],
  baseline?: Readonly<Record<string, string>>,
): Readonly<Record<string, MergeChoice>> => {
  if (baseline === undefined) return {};
  const remoteById = new Map(remoteScenes.map((scene) => [scene.id, scene]));
  const choices: Record<string, MergeChoice> = {};
  for (const local of localScenes) {
    const remote = remoteById.get(local.id);
    if (remote === undefined) continue;
    const base = baseline[local.id];
    if (base === undefined) continue;
    const localChanged = sceneDigest(local) !== base;
    const remoteChanged = sceneDigest(remote) !== base;
    if (localChanged && !remoteChanged) choices[local.id] = "local";
    if (!localChanged && remoteChanged) choices[local.id] = "remote";
  }
  return choices;
};

export interface MergedProjectScenes {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
}

const uniqueSceneTitle = (
  base: string,
  usedTitles: ReadonlySet<string>,
): string => {
  const stem = base.trim().length > 0 ? base.trim() : "Remote scene";
  const first = `${stem} (remote)`;
  if (!usedTitles.has(first)) return first;
  let suffix = 2;
  while (usedTitles.has(`${stem} (remote ${suffix})`)) suffix += 1;
  return `${stem} (remote ${suffix})`;
};

/**
 * Combines the two project copies. For each conflicting scene the chosen side
 * replaces both copies, or "both" keeps the local scene and inserts a renamed
 * copy of the remote scene as a separate project scene.
 */
export const mergeProjectScenes = (
  localScenes: readonly SceneDocument[],
  localActiveSceneId: string,
  remoteScenes: readonly SceneDocument[],
  remoteActiveSceneId: string,
  choices: Readonly<Record<string, MergeChoice>>,
): MergedProjectScenes => {
  const remoteById = new Map(remoteScenes.map((scene) => [scene.id, scene]));
  const scenes: SceneDocument[] = [];
  const usedIds = new Set<string>();
  const usedTitles = new Set<string>();
  for (const scene of [...localScenes, ...remoteScenes]) usedTitles.add(scene.meta.title);

  for (const local of localScenes) {
    const remote = remoteById.get(local.id);
    const differs =
      remote !== undefined && sceneDigest(local) !== sceneDigest(remote);
    const choice: MergeChoice = differs ? choices[local.id] ?? null : null;
    if (choice === "remote" && remote !== undefined) {
      scenes.push(remote);
      usedIds.add(local.id);
      continue;
    }
    scenes.push(local);
    usedIds.add(local.id);
    if (choice === "both" && remote !== undefined) {
      const title = uniqueSceneTitle(remote.meta.title, usedTitles);
      usedTitles.add(title);
      const now = new Date().toISOString();
      const inserted: SceneDocument = {
        ...remote,
        id: newId<SceneId>("scene"),
        meta: {
          ...remote.meta,
          title,
          createdAt: now,
          updatedAt: now,
        },
      };
      scenes.push(inserted);
      usedIds.add(inserted.id);
    }
  }
  for (const remote of remoteScenes) {
    if (usedIds.has(remote.id)) continue;
    scenes.push(remote);
    usedIds.add(remote.id);
  }
  const activeSceneId =
    scenes.some((scene) => scene.id === localActiveSceneId)
      ? localActiveSceneId
      : scenes.some((scene) => scene.id === remoteActiveSceneId)
        ? remoteActiveSceneId
        : scenes[0]?.id ?? localActiveSceneId;
  return { scenes, activeSceneId };
};

export type RemoteFileRelation = "unchanged" | "changed" | "deleted" | "appeared";

/**
 * Explains how the current remote blob relates to the SHA we last synced.
 *
 * `appeared` covers both a file that was absent when the binding was created
 * and a path that was never bound. A caller can treat it as "remote exists but
 * we do not own a known revision" and ask before replacing either side.
 */
export const compareRemoteFile = (
  syncedSha: string | null,
  remoteSha: string | null,
): RemoteFileRelation => {
  if (remoteSha === null) {
    return syncedSha === null ? "unchanged" : "deleted";
  }
  if (syncedSha === null) return "appeared";
  return syncedSha === remoteSha ? "unchanged" : "changed";
};

const fnv1a = (input: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * Stable, synchronous fingerprint of the persisted project payload. It is
 * deliberately independent of `exportedAt`, so simply opening a project does
 * not mark it dirty.
 */
export const projectDigest = (
  scenes: readonly SceneDocument[],
  activeSceneId: string,
): string => {
  // Image bytes are immutable and can be large; identity is the asset metadata
  // (id/checksum/dimensions), not the repeated data URL.
  const digestScenes = scenes.map((scene) => ({
    ...scene,
    assets: Object.fromEntries(
      Object.entries(scene.assets).map(([id, asset]) => [
        id,
        { ...asset, dataUrl: undefined },
      ]),
    ),
  }));
  const serialized = JSON.stringify({ activeSceneId, scenes: digestScenes });
  return `${fnv1a(serialized, 0x811c9dc5)}${fnv1a(serialized, 0x9e3779b9)}`;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const splitPath = (raw: string, label: string): string[] => {
  const normalized = raw.trim().replace(/\\/g, "/");
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new Error(`${label} contains an unsupported character.`);
  }
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`${label} cannot contain "." or ".." segments.`);
    }
    if (segment.length > 255) {
      throw new Error(`${label} has a segment that is too long.`);
    }
  }
  return segments;
};

/** Normalizes a repository folder. The repository root is `""`. */
export const normalizeGitHubFolder = (raw: string): string =>
  splitPath(raw, "Folder").join("/");

export const normalizeGitHubFolderName = (raw: string): string => {
  const normalized = normalizeGitHubFolder(raw);
  if (normalized.length === 0) {
    throw new Error("Enter a folder name.");
  }
  if (normalized.includes("/")) {
    throw new Error("A folder name cannot contain other folders.");
  }
  return normalized;
};

/** Characters Git forbids anywhere in a ref name (`git-check-ref-format`). */
const INVALID_BRANCH_CHARACTERS = /[\u0000-\u0020\u007f~^:?*[\\]/;

/**
 * Validates a branch name before it reaches GitHub. Slashes are allowed for
 * namespaced branches such as `feature/er-export`, but every path component
 * still has to be a valid Git ref component.
 */
export const normalizeGitHubBranchName = (raw: string): string => {
  const value = raw.trim();
  if (value.length === 0) throw new Error("Enter a branch name.");
  if (value.length > 255) throw new Error("The branch name is too long.");
  if (value === "HEAD" || value.startsWith("-")) {
    throw new Error("That branch name is reserved.");
  }
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith(".") ||
    value.endsWith(".lock")
  ) {
    throw new Error("That branch name is not valid.");
  }
  if (INVALID_BRANCH_CHARACTERS.test(value)) {
    throw new Error("A branch name cannot contain spaces or Git special characters.");
  }
  for (const component of value.split("/")) {
    if (component.length === 0 || component.startsWith(".") || component.endsWith(".lock")) {
      throw new Error("That branch name is not valid.");
    }
  }
  return value;
};

export const joinGitHubFolder = (folder: string, name: string): string => {
  const normalizedFolder = normalizeGitHubFolder(folder);
  const folderName = normalizeGitHubFolderName(name);
  return normalizedFolder.length === 0
    ? folderName
    : `${normalizedFolder}/${folderName}`;
};

export const normalizeGitHubFilePath = (raw: string): string => {
  const segments = splitPath(raw, "Project path");
  const fileName = segments[segments.length - 1];
  if (fileName === undefined) {
    throw new Error("Choose a project file name.");
  }
  if (!fileName.toLowerCase().endsWith(GITHUB_PROJECT_EXTENSION)) {
    throw new Error(`The project file must end with ${GITHUB_PROJECT_EXTENSION}.`);
  }
  return segments.join("/");
};

export const isGitHubProjectFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(GITHUB_PROJECT_EXTENSION);

export const joinGitHubPath = (folder: string, fileName: string): string => {
  const normalizedFolder = normalizeGitHubFolder(folder);
  if (fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("The file name cannot contain folders.");
  }
  return normalizeGitHubFilePath(
    normalizedFolder.length === 0 ? fileName : `${normalizedFolder}/${fileName}`,
  );
};

export const githubFolderOf = (path: string): string => {
  const segments = normalizeGitHubFilePath(path).split("/");
  return segments.slice(0, -1).join("/");
};

export const githubFileNameOf = (path: string): string => {
  const segments = normalizeGitHubFilePath(path).split("/");
  return segments[segments.length - 1] ?? DEFAULT_GITHUB_PROJECT_FILE;
};

export const githubParentFolder = (folder: string): string => {
  const segments = normalizeGitHubFolder(folder).split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
};

/** A readable scene title for a project created at `path`. */
export const projectTitleFromPath = (path: string): string => {
  const fileName = githubFileNameOf(path);
  const stem = fileName.replace(/\.umler$/i, "").trim();
  return stem.length > 0 ? stem : "Untitled project";
};

export const githubTargetLabel = (target: GitHubTarget): string =>
  `${target.owner}/${target.repo} · ${target.branch} · ${target.path}`;
