/**
 * Editor chrome preferences.
 *
 * These are intentionally separate from the project file: they describe the
 * workspace, not the diagram, and survive project switches and reloads.
 */

export type ColorMode = "light" | "dark";

export interface UiPreferences {
  readonly panelVisible: boolean;
  readonly codePanelVisible: boolean;
  readonly gridVisible: boolean;
  readonly snapEnabled: boolean;
  /** Freeze connector routing while an object is being dragged. */
  readonly lowPerformanceMode: boolean;
  readonly colorMode: ColorMode;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  panelVisible: true,
  codePanelVisible: false,
  gridVisible: true,
  snapEnabled: true,
  lowPerformanceMode: false,
  colorMode: "light",
};

export const UI_PREFERENCES_KEY = "umler.ui.preferences";

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export const parseUiPreferences = (raw: string | null): UiPreferences => {
  if (raw === null || raw.length === 0) return DEFAULT_UI_PREFERENCES;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return DEFAULT_UI_PREFERENCES;
    }
    const record = data as Record<string, unknown>;
    return {
      panelVisible: asBoolean(record.panelVisible, DEFAULT_UI_PREFERENCES.panelVisible),
      codePanelVisible: asBoolean(
        record.codePanelVisible,
        DEFAULT_UI_PREFERENCES.codePanelVisible,
      ),
      gridVisible: asBoolean(record.gridVisible, DEFAULT_UI_PREFERENCES.gridVisible),
      snapEnabled: asBoolean(record.snapEnabled, DEFAULT_UI_PREFERENCES.snapEnabled),
      lowPerformanceMode: asBoolean(
        record.lowPerformanceMode,
        DEFAULT_UI_PREFERENCES.lowPerformanceMode,
      ),
      colorMode: record.colorMode === "dark" ? "dark" : "light",
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
};

export const loadUiPreferences = (): UiPreferences => {
  try {
    return parseUiPreferences(window.localStorage.getItem(UI_PREFERENCES_KEY));
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
};

export const saveUiPreferences = (preferences: UiPreferences): void => {
  try {
    window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Private browsing can reject storage; the in-memory toggles still work.
  }
};
