/**
 * Scene and project file formats.
 *
 * The editor keeps a project as an ordered list of self-contained scenes. A
 * scene export is the same document that undo/redo and the renderer consume,
 * wrapped in a small envelope so a dropped file can be identified before it is
 * validated. A project export wraps every scene plus the active scene id.
 *
 * Only `umler.scene/1` documents are accepted. Import is deliberately strict:
 * a malformed document is rejected before it reaches the editor, instead of
 * producing a half-valid scene that crashes the canvas later.
 */

import type { SceneDocument } from "./scene.ts";
import { DIAGRAM_KIND_LABELS } from "./scene.ts";
import type { ImageAsset } from "./nodes.ts";
import { assetMetadataOnly, collectProjectAssets, pruneUnusedProjectAssets, type ProjectAssets } from "./assets.ts";
import { validateScene, type Diagnostic } from "./validate.ts";

export const SCENE_FILE_FORMAT = "umler.scene";
export const PROJECT_FILE_FORMAT = "umler.project";
export const FILE_FORMAT_VERSION = 1;

export interface SceneFile {
  readonly format: typeof SCENE_FILE_FORMAT;
  readonly version: typeof FILE_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly scene: SceneDocument;
}

export interface ProjectFile {
  readonly format: typeof PROJECT_FILE_FORMAT;
  readonly version: typeof FILE_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly activeSceneId: string;
  readonly scenes: readonly SceneDocument[];
  /** Project-wide image bytes; scenes reference these by asset id. */
  readonly assets: Readonly<Record<string, ImageAsset>>;
}

export interface ImportedProject {
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
  readonly assets: ProjectAssets;
}

export class FileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileFormatError";
  }
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): UnknownRecord => {
  if (!isRecord(value)) {
    throw new FileFormatError(`${label} must be an object.`);
  }
  return value;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new FileFormatError(`${label} must be a non-empty string.`);
  }
  return value;
};

const requireFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FileFormatError(`${label} must be a finite number.`);
  }
  return value;
};

const readProjectAssets = (value: unknown, label: string): ProjectAssets => {
  if (value === undefined) return {};
  const record = requireRecord(value, label);
  const assets: Record<string, ImageAsset> = {};
  for (const [key, entry] of Object.entries(record)) {
    const path = `${label}.${key}`;
    const asset = requireRecord(entry, path);
    requireString(asset.id, `${path}.id`);
    const kind = requireString(asset.kind, `${path}.kind`);
    if (kind !== "raster" && kind !== "vector") {
      throw new FileFormatError(`${path}.kind must be "raster" or "vector".`);
    }
    requireString(asset.fileName, `${path}.fileName`);
    requireString(asset.mimeType, `${path}.mimeType`);
    requireFiniteNumber(asset.byteLength, `${path}.byteLength`);
    const width = requireFiniteNumber(asset.intrinsicWidth, `${path}.intrinsicWidth`);
    const height = requireFiniteNumber(asset.intrinsicHeight, `${path}.intrinsicHeight`);
    if (width <= 0 || height <= 0) {
      throw new FileFormatError(`${path} must have positive intrinsic dimensions.`);
    }
    requireString(asset.checksum, `${path}.checksum`);
    const storage = requireString(asset.storage, `${path}.storage`);
    if (storage !== "indexeddb" && storage !== "data-url" && storage !== "project-file") {
      throw new FileFormatError(`${path}.storage has an unsupported value.`);
    }
    if (asset.dataUrl !== undefined && typeof asset.dataUrl !== "string") {
      throw new FileFormatError(`${path}.dataUrl must be a string when present.`);
    }
    if (asset.exportPath !== undefined && typeof asset.exportPath !== "string") {
      throw new FileFormatError(`${path}.exportPath must be a string when present.`);
    }
    assets[key] = asset as unknown as ImageAsset;
  }
  return assets;
};

const parseJson = (text: string): unknown => {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new FileFormatError("The selected file is not valid JSON.");
  }
};

const formatDiagnostics = (diagnostics: readonly Diagnostic[]): string => {
  const messages = diagnostics
    .slice(0, 3)
    .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`);
  const remainder = diagnostics.length > messages.length
    ? ` (+${diagnostics.length - messages.length} more)`
    : "";
  return `${messages.join("; ")}${remainder}`;
};

const readScene = (
  value: unknown,
  label: string,
  externalAssets: ProjectAssets = {},
): SceneDocument => {
  const scene = requireRecord(value, label);
  if (scene.schemaVersion !== "umler.scene/1") {
    throw new FileFormatError(
      `${label}: unsupported schema version "${String(scene.schemaVersion)}".`,
    );
  }

  requireString(scene.id, `${label}.id`);
  if (typeof scene.revision !== "number" || !Number.isInteger(scene.revision)) {
    throw new FileFormatError(`${label}.revision must be an integer.`);
  }

  const meta = requireRecord(scene.meta, `${label}.meta`);
  requireString(meta.title, `${label}.meta.title`);
  const diagramKind = requireString(meta.diagramKind, `${label}.meta.diagramKind`);
  if (!Object.prototype.hasOwnProperty.call(DIAGRAM_KIND_LABELS, diagramKind)) {
    throw new FileFormatError(
      `${label}.meta.diagramKind: unknown diagram type "${diagramKind}".`,
    );
  }
  if (typeof meta.createdAt !== "string" || typeof meta.updatedAt !== "string") {
    throw new FileFormatError(`${label}.meta must contain createdAt and updatedAt timestamps.`);
  }

  const canvas = requireRecord(scene.canvas, `${label}.canvas`);
  requireRecord(canvas.grid, `${label}.canvas.grid`);
  requireRecord(scene.layout, `${label}.layout`);
  requireRecord(scene.theme, `${label}.theme`);
  const nodes = requireRecord(scene.nodes, `${label}.nodes`);
  requireRecord(scene.edges, `${label}.edges`);
  const sceneAssets = requireRecord(scene.assets, `${label}.assets`);

  const mergedAssets: Record<string, unknown> = { ...sceneAssets };
  for (const node of Object.values(nodes)) {
    if (
      isRecord(node) &&
      node.kind === "image" &&
      typeof node.assetId === "string" &&
      externalAssets[node.assetId] !== undefined
    ) {
      mergedAssets[node.assetId] = externalAssets[node.assetId];
    }
  }

  const candidate = {
    ...scene,
    assets: mergedAssets,
  } as unknown as SceneDocument;
  let diagnostics: readonly Diagnostic[];
  try {
    diagnostics = validateScene(candidate);
  } catch {
    throw new FileFormatError(`${label} has an unsupported or malformed structure.`);
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new FileFormatError(`${label} is invalid: ${formatDiagnostics(errors)}`);
  }

  return candidate;
};

const readSceneFile = (root: UnknownRecord): SceneDocument => {
  if (root.version !== FILE_FORMAT_VERSION) {
    throw new FileFormatError(
      `Unsupported scene file version "${String(root.version)}".`,
    );
  }
  return readScene(root.scene, "Scene");
};

export const serializeSceneFile = (scene: SceneDocument): string =>
  `${JSON.stringify(
    {
      format: SCENE_FILE_FORMAT,
      version: FILE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      scene,
    } satisfies SceneFile,
    null,
    2,
  )}\n`;

export const serializeProjectFile = (
  scenes: readonly SceneDocument[],
  activeSceneId: string,
  assets?: ProjectAssets,
): string => {
  if (scenes.length === 0) {
    throw new FileFormatError("A project must contain at least one scene.");
  }
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (ids.has(scene.id)) {
      throw new FileFormatError(`The project contains duplicate scene id "${scene.id}".`);
    }
    ids.add(scene.id);
  }
  if (!ids.has(activeSceneId)) {
    throw new FileFormatError("The active scene is not part of the project.");
  }
  const projectAssets = pruneUnusedProjectAssets(
    scenes,
    assets ?? collectProjectAssets(scenes),
  );
  const projectScenes = scenes.map((scene) => {
    const referenced = new Set<string>();
    for (const node of Object.values(scene.nodes)) {
      if (node.kind === "image" && node.assetId !== undefined) {
        referenced.add(String(node.assetId));
      }
    }
    return {
      ...scene,
      assets: Object.fromEntries(
        Object.entries(scene.assets)
          .filter(([id]) => referenced.has(id))
          .map(([id, asset]) => [id, assetMetadataOnly(asset)]),
      ),
    };
  });
  return `${JSON.stringify(
    {
      format: PROJECT_FILE_FORMAT,
      version: FILE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      activeSceneId,
      scenes: projectScenes,
      assets: projectAssets,
    } satisfies ProjectFile,
    null,
    2,
  )}\n`;
};

/**
 * Accepts a scene envelope or a bare `SceneDocument`. The latter keeps the
 * existing `examples/*.json` scene documents importable.
 */
export const deserializeSceneFile = (text: string): SceneDocument => {
  const root = requireRecord(parseJson(text), "File");
  if (root.format === SCENE_FILE_FORMAT) return readSceneFile(root);
  if (root.schemaVersion === "umler.scene/1") return readScene(root, "Scene");
  throw new FileFormatError("This is not a UMLer scene file.");
};

export const deserializeProjectFile = (text: string): ImportedProject => {
  const root = requireRecord(parseJson(text), "File");
  if (root.format !== PROJECT_FILE_FORMAT) {
    throw new FileFormatError("This is not a UMLer project file.");
  }
  if (root.version !== FILE_FORMAT_VERSION) {
    throw new FileFormatError(
      `Unsupported project file version "${String(root.version)}".`,
    );
  }
  if (!Array.isArray(root.scenes) || root.scenes.length === 0) {
    throw new FileFormatError("The project does not contain any scenes.");
  }

  const assets = readProjectAssets(root.assets, "Project assets");
  const scenes = root.scenes.map((scene, index) =>
    readScene(scene, `Scene ${index + 1}`, assets),
  );
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (ids.has(scene.id)) {
      throw new FileFormatError(`The project contains duplicate scene id "${scene.id}".`);
    }
    ids.add(scene.id);
  }

  const requestedActive =
    typeof root.activeSceneId === "string" ? root.activeSceneId : "";
  const firstScene = scenes[0];
  if (firstScene === undefined) {
    throw new FileFormatError("The project does not contain any scenes.");
  }
  const activeSceneId = ids.has(requestedActive)
    ? requestedActive
    : firstScene.id;

  return { scenes, activeSceneId, assets };
};

/** Readable, filesystem-safe download names. */
const fileStem = (value: string): string => {
  const slug = value
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return slug.length > 0 ? slug : "UMLer diagram";
};

export const sceneFileName = (title: string): string =>
  `${fileStem(title)}.scene.json`;

export const projectFileName = (): string => "umler-project.json";
