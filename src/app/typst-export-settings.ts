import {
  DEFAULT_EXPORT_SETTINGS,
  defaultDiagramId,
  type ExportSettings,
} from "../export/page.ts";
import type { SceneDocument } from "../model/scene.ts";

const KEY_PREFIX = "umler.typst-export.scene.";

const keyFor = (sceneId: string): string => `${KEY_PREFIX}${sceneId}`;

export const defaultExportSettingsForScene = (
  scene: SceneDocument,
): ExportSettings => ({
  ...DEFAULT_EXPORT_SETTINGS,
  label: scene.meta.title,
  diagramId: defaultDiagramId(scene.meta.title),
});

export const loadSceneExportSettings = (
  sceneId: string,
): ExportSettings | null => {
  try {
    const raw = window.localStorage.getItem(keyFor(sceneId));
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<ExportSettings>;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof value.page !== "object" ||
      typeof value.zoom !== "number" ||
      (value.scope !== "diagram" && value.scope !== "selection") ||
      typeof value.align !== "string" ||
      typeof value.border !== "object" ||
      typeof value.diagramId !== "string" ||
      typeof value.resourceFolder !== "string"
    ) {
      return null;
    }
    return value as ExportSettings;
  } catch {
    return null;
  }
};

export const saveSceneExportSettings = (
  sceneId: string,
  settings: ExportSettings,
): void => {
  try {
    window.localStorage.setItem(keyFor(sceneId), JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private windows; export still works.
  }
};
