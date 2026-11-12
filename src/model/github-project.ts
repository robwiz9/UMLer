/**
 * Framework-agnostic helpers for GitHub project files.
 *
 * The GitHub API layer lives in `src/app`; these helpers are pure so path
 * validation, change detection and conflict classification can be tested
 * without a browser or a network.
 */

import type { ImageAsset } from "./nodes.ts";
import type { SceneDocument } from "./scene.ts";

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
}

export interface ProjectSnapshot {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
  /** Project asset library, including uploaded images not currently placed. */
  readonly assets?: Readonly<Record<string, ImageAsset>>;
}

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
