/**
 * Typst page presets and diagram-to-page fitting.
 *
 * Scene coordinates and Typst lengths are both points. The serializer never
 * uses CSS pixels; the browser camera zoom is deliberately not part of this
 * module.
 */

export type PagePreset = "a4-portrait" | "a4-landscape" | "custom";
export type PageUnit = "mm" | "pt";
export type ExportAlign = "left" | "center" | "right";
export type ExportScope = "diagram" | "selection";

/** ISO A4 in Typst points (210mm × 297mm). */
export const A4_WIDTH_PT = 595.2756;
export const A4_HEIGHT_PT = 841.8898;

export const PAGE_PRESET_LABELS: Record<PagePreset, string> = {
  "a4-portrait": "A4 vertical",
  "a4-landscape": "A4 horizontal",
  custom: "Custom",
};

export interface PageSpec {
  readonly preset: PagePreset;
  /** Custom width/height are entered by the user in `unit`. */
  readonly customWidth: number;
  readonly customHeight: number;
  readonly unit: PageUnit;
}

export interface PageSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

export const DEFAULT_PAGE: PageSpec = {
  preset: "a4-portrait",
  customWidth: 210,
  customHeight: 297,
  unit: "mm",
};

export const MM_TO_PT = 72 / 25.4;

export const unitToPt = (value: number, unit: PageUnit): number =>
  unit === "mm" ? value * MM_TO_PT : value;

export const ptToUnit = (value: number, unit: PageUnit): number =>
  unit === "mm" ? value / MM_TO_PT : value;

/** A4 dimensions are exact constants so the generated page never drifts. */
export const pageSize = (spec: PageSpec): PageSize => {
  if (spec.preset === "a4-portrait") {
    return { widthPt: A4_WIDTH_PT, heightPt: A4_HEIGHT_PT };
  }
  if (spec.preset === "a4-landscape") {
    return { widthPt: A4_HEIGHT_PT, heightPt: A4_WIDTH_PT };
  }
  const widthPt = Math.max(1, unitToPt(spec.customWidth, spec.unit));
  const heightPt = Math.max(1, unitToPt(spec.customHeight, spec.unit));
  return { widthPt, heightPt };
};

/** Room reserved below the canvas for a one-line figure caption. */
export const CAPTION_RESERVE_PT = 22;

export interface FitResult {
  /** Multiplier applied to every scene coordinate, font size and stroke width. */
  readonly scale: number;
  /** Largest scale the page allows; may exceed 1 on a very large page. */
  readonly fitLimit: number;
  /** The user's requested document zoom. */
  readonly requested: number;
  /** True when the requested zoom had to be reduced to fit the page. */
  readonly fitReduced: boolean;
  readonly diagramWidthPt: number;
  readonly diagramHeightPt: number;
  readonly pageWidthPt: number;
  readonly pageHeightPt: number;
  /** Available page area after reserving the caption band. */
  readonly availableWidthPt: number;
  readonly availableHeightPt: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The diagram keeps its natural size at 100% even on a huge page: it is never
 * stretched merely because the page is larger. A user zoom above 100% is an
 * explicit request to enlarge, so it is honoured until the page limit.
 */
export const fitDiagramToPage = (
  naturalWidthPt: number,
  naturalHeightPt: number,
  page: PageSize,
  requestedZoom: number,
  hasCaption: boolean,
): FitResult => {
  const width = Math.max(0.01, naturalWidthPt);
  const height = Math.max(0.01, naturalHeightPt);
  const requested = clamp(Number.isFinite(requestedZoom) ? requestedZoom : 1, 0.05, 4);
  const reserve = hasCaption ? CAPTION_RESERVE_PT : 0;
  const availableWidthPt = Math.max(1, page.widthPt);
  const availableHeightPt = Math.max(1, page.heightPt - reserve);
  const fitLimit = Math.min(
    availableWidthPt / width,
    availableHeightPt / height,
  );
  // Extremely small custom pages may need a factor below 5%; the only hard
  // lower bound is a positive canvas (CeTZ rejects zero-sized content).
  const scale = Math.max(0.001, Math.min(requested, fitLimit));
  return {
    scale,
    fitLimit,
    requested,
    fitReduced: scale + 1e-6 < requested,
    diagramWidthPt: width * scale,
    diagramHeightPt: height * scale,
    pageWidthPt: page.widthPt,
    pageHeightPt: page.heightPt,
    availableWidthPt,
    availableHeightPt,
  };
};

export interface ExportSettings {
  readonly page: PageSpec;
  readonly zoom: number;
  readonly scope: ExportScope;
  readonly align: ExportAlign;
  /**
   * Caption text. `undefined` means "use the scene name"; an empty or
   * whitespace-only string deliberately means "no label".
   */
  readonly label?: string;
  readonly diagramId: string;
  readonly resourceFolder: string;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  page: DEFAULT_PAGE,
  zoom: 1,
  scope: "diagram",
  align: "center",
  diagramId: "",
  resourceFolder: "assets",
};

export interface ExportSettingsPatch {
  readonly page?: Partial<PageSpec>;
  readonly zoom?: number;
  readonly scope?: ExportScope;
  readonly align?: ExportAlign;
  readonly label?: string;
  readonly diagramId?: string;
  readonly resourceFolder?: string;
}

export const mergeExportSettings = (
  base: ExportSettings,
  patch: ExportSettingsPatch,
): ExportSettings => ({
  ...base,
  ...patch,
  page: { ...base.page, ...patch.page },
});

/**
 * Typst labels accept a conservative ASCII subset. The editor prefixes the
 * generated label with `fig-` when the user has not already done so, which
 * keeps a bare scene title from producing a confusing reference name.
 */
export const toDiagramLabel = (value: string): string => {
  const stem = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const safe = stem.length > 0 ? stem : "diagram";
  return safe.startsWith("fig-") ? safe : `fig-${safe}`;
};

export const defaultDiagramId = (title: string): string => toDiagramLabel(title);

/** Resource folders are emitted as a Typst path; keep them relative. */
export const normalizeResourceFolder = (value: string): string =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
