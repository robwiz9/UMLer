import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutSnapshot } from "../model/layout.ts";
import type { SceneDocument } from "../model/scene.ts";
import type { ImageAsset } from "../model/nodes.ts";
import {
  CETZ_EXPORT_VERSION,
  CETZ_PREVIEW_VERSION,
  serializeSceneToCetz,
} from "../export/cetz.ts";
import {
  DEFAULT_PAGE,
  defaultDiagramId,
  pageSize,
  ptToUnit,
  unitToPt,
  type ExportAlign,
  type ExportScope,
  type ExportSettings,
  type PagePreset,
  type PageSpec,
  type PageUnit,
} from "../export/page.ts";
import type { PreviewImage } from "../export/typst-preview.ts";
import { useTypstPreview } from "./use-typst-preview.ts";

export interface CodePanelProps {
  readonly scene: SceneDocument;
  readonly layout: LayoutSnapshot;
  readonly selectedNodeIds: readonly string[];
  readonly selectedEdgeId: string | null;
  readonly assets: Readonly<Record<string, ImageAsset>>;
  readonly onClose: () => void;
}

interface StoredSettings {
  readonly page?: PageSpec;
  readonly zoom?: number;
  readonly align?: ExportAlign;
  readonly resourceFolder?: string;
}

const STORAGE_KEY = "umler.typst-export.v1";

const loadStored = (): StoredSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as StoredSettings;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const pagePresetLabel = (page: PageSpec): string => {
  if (page.preset === "a4-portrait") return "A4 vertical";
  if (page.preset === "a4-landscape") return "A4 horizontal";
  return `Custom ${page.customWidth} × ${page.customHeight} ${page.unit}`;
};

const ALIGN_OPTIONS: readonly { readonly value: ExportAlign; readonly label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const PageIcon = ({ kind }: { readonly kind: "portrait" | "landscape" | "custom" }) => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    {kind === "portrait" ? (
      <rect x="4" y="1.8" width="10" height="14.4" rx="1.5" />
    ) : kind === "landscape" ? (
      <rect x="1.8" y="4" width="14.4" height="10" rx="1.5" />
    ) : (
      <>
        <rect x="3" y="3" width="12" height="12" rx="1.5" strokeDasharray="2.2 2.2" />
        <path d="M3 7h12M7 3v12" opacity="0.55" />
      </>
    )}
  </svg>
);

const AlignIcon = ({ align }: { readonly align: ExportAlign }) => {
  const paths: Record<ExportAlign, string> = {
    left: "M2 3.5h14M2 9h8M2 14.5h11",
    center: "M2 3.5h14M5 9h8M3.5 14.5h11",
    right: "M2 3.5h14M8 9h8M5 14.5h11",
  };
  return (
    <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path d={paths[align]} />
    </svg>
  );
};

const CopyIcon = () => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="6" y="6" width="9" height="10" rx="1.5" />
    <path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v8A1.5 1.5 0 0 0 4.5 14H6" />
  </svg>
);

const ChevronIcon = ({ open }: { readonly open: boolean }) => (
  <svg className={`code-icon code-chevron ${open ? "open" : ""}`} viewBox="0 0 18 18" aria-hidden="true">
    <path d="M5 7l4 4 4-4" />
  </svg>
);

const ClearIcon = () => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M5 5l8 8M13 5l-8 8" />
  </svg>
);

const PAGE_OPTIONS: readonly {
  readonly preset: PagePreset;
  readonly label: string;
  readonly icon: "portrait" | "landscape" | "custom";
}[] = [
  { preset: "a4-portrait", label: "A4 vertical", icon: "portrait" },
  { preset: "a4-landscape", label: "A4 horizontal", icon: "landscape" },
  { preset: "custom", label: "Custom", icon: "custom" },
];

const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    if (!copied) throw new Error("Clipboard access was denied.");
  }
};

export const CodePanel = ({
  scene,
  layout,
  selectedNodeIds,
  selectedEdgeId,
  assets,
  onClose,
}: CodePanelProps) => {
  const stored = useRef<StoredSettings | null>(null);
  if (stored.current === null) stored.current = loadStored();
  const [page, setPage] = useState<PageSpec>(stored.current.page ?? DEFAULT_PAGE);
  const [zoom, setZoom] = useState<number>(stored.current.zoom ?? 1);
  const [zoomDraft, setZoomDraft] = useState<string>(
    String(Math.round((stored.current.zoom ?? 1) * 100)),
  );
  const [scope, setScope] = useState<ExportScope>("diagram");
  const [align, setAlign] = useState<ExportAlign>(stored.current.align ?? "center");
  const [label, setLabel] = useState<string>(scene.meta.title);
  const [resourceFolder, setResourceFolder] = useState<string>(
    stored.current.resourceFolder ?? "assets",
  );
  const [diagramId, setDiagramId] = useState<string>(() => defaultDiagramId(scene.meta.title));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const copyTimer = useRef<number | null>(null);

  const selectionCount = selectedNodeIds.length + (selectedEdgeId === null ? 0 : 1);

  useEffect(() => {
    setDiagramId(defaultDiagramId(scene.meta.title));
    setLabel(scene.meta.title);
    setScope("diagram");
  }, [scene.id, scene.meta.title]);

  useEffect(() => {
    if (scope === "selection" && selectionCount === 0) setScope("diagram");
  }, [scope, selectionCount]);

  useEffect(() => {
    setZoomDraft(String(Math.round(zoom * 100)));
  }, [zoom]);

  const commitZoom = (): void => {
    const trimmed = zoomDraft.trim();
    const value = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(value)) {
      setZoomDraft(String(Math.round(zoom * 100)));
      return;
    }
    const clamped = Math.min(300, Math.max(10, value));
    setZoom(clamped / 100);
    setZoomDraft(String(clamped));
  };

  useEffect(() => {
    const data: StoredSettings = { page, zoom, align, resourceFolder };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Local storage can be unavailable in private windows; export still works.
    }
  }, [page, zoom, align, resourceFolder]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  const settings: ExportSettings = useMemo(
    () => ({
      page,
      zoom,
      scope,
      align,
      label,
      diagramId,
      resourceFolder,
    }),
    [page, zoom, scope, align, label, diagramId, resourceFolder],
  );

  const result = useMemo(
    () =>
      serializeSceneToCetz({
        scene,
        layout,
        settings,
        selectedNodeIds,
        selectedEdgeId,
        assets,
      }),
    [scene, layout, settings, selectedNodeIds, selectedEdgeId, assets],
  );

  const previewImages = useMemo<PreviewImage[]>(
    () =>
      result.images.map((reference) => {
        const asset = reference.assetId === undefined ? undefined : assets[reference.assetId];
        return { path: reference.path, dataUrl: asset?.dataUrl };
      }),
    [result.images, assets],
  );
  const preview = useTypstPreview(result.previewCode, previewImages, !previewCollapsed);
  const missingPreviewImages = result.images.filter((reference) => {
    if (reference.missing) return true;
    const asset = reference.assetId === undefined ? undefined : assets[reference.assetId];
    return asset?.dataUrl === undefined;
  });

  const setPreset = (preset: PagePreset): void => {
    if (preset === "custom") {
      const size = pageSize(page);
      setPage({
        preset,
        customWidth: Math.round(ptToUnit(size.widthPt, page.unit) * 10) / 10,
        customHeight: Math.round(ptToUnit(size.heightPt, page.unit) * 10) / 10,
        unit: page.unit,
      });
      return;
    }
    setPage({ ...page, preset });
  };

  const changeUnit = (unit: PageUnit): void => {
    if (unit === page.unit) return;
    const widthPt = unitToPt(page.customWidth, page.unit);
    const heightPt = unitToPt(page.customHeight, page.unit);
    setPage({
      ...page,
      unit,
      customWidth: Math.round(ptToUnit(widthPt, unit) * 10) / 10,
      customHeight: Math.round(ptToUnit(heightPt, unit) * 10) / 10,
    });
  };

  const openPreview = (): void => {
    // A page-wide text selection left over from copying the source would also
    // paint the SVG text in the modal. Clear it before mounting the page.
    window.getSelection()?.removeAllRanges();
    setPreviewZoom(1);
    setPreviewOpen(true);
  };

  const copyCode = async (): Promise<void> => {
    try {
      await copyToClipboard(result.code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const ready = preview.status === "ready" && preview.svg !== undefined;
  const previewStatus =
    preview.status === "error"
      ? "Preview error"
      : preview.status === "rendering"
        ? ready
          ? "Updating…"
          : "Compiling…"
        : ready
          ? `${preview.durationMs ?? 0} ms`
          : "Waiting";

  return (
    <>
      <aside className="code-panel" aria-label="Typst and CeTZ export">
      <header className="code-panel-head">
        <div>
          <div className="code-panel-kicker">Step 4 · Export</div>
          <h2>Typst / CeTZ</h2>
        </div>
        <button
          type="button"
          className="code-panel-close"
          onClick={onClose}
          title="Close export panel"
          aria-label="Close export panel"
        >
          ×
        </button>
      </header>

      <div className="code-panel-scroll">
        <section className="code-section">
          <div className="code-section-title">Objects</div>
          <div className="code-segmented" role="group" aria-label="Export scope">
            <button
              type="button"
              className={scope === "diagram" ? "active" : ""}
              onClick={() => setScope("diagram")}
            >
              Whole diagram
            </button>
            <button
              type="button"
              className={scope === "selection" ? "active" : ""}
              disabled={selectionCount === 0}
              onClick={() => setScope("selection")}
              title={
                selectionCount === 0
                  ? "Select one or more objects on the canvas first"
                  : `Export ${selectionCount} selected object${selectionCount === 1 ? "" : "s"}`
              }
            >
              Selection{selectionCount > 0 ? ` · ${selectionCount}` : ""}
            </button>
          </div>
          <p className="code-hint">
            {scope === "selection"
              ? "Only the selected objects and the connectors fully inside the selection are exported."
              : "Every visible object in the scene is exported."}
          </p>
        </section>

        <section className="code-section">
          <div className="code-section-title">Page format</div>
          <div className="code-page-options" role="group" aria-label="Document size">
            {PAGE_OPTIONS.map((option) => (
              <button
                key={option.preset}
                type="button"
                className={page.preset === option.preset ? "active" : ""}
                onClick={() => setPreset(option.preset)}
                aria-pressed={page.preset === option.preset}
              >
                <PageIcon kind={option.icon} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          {page.preset === "custom" ? (
            <div className="code-dimension-row">
              <label className="code-inline-field">
                <span>Width</span>
                <input
                  id="code-page-width"
                  name="code-page-width"
                  type="number"
                  min={10}
                  step={1}
                  value={page.customWidth}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value > 0) {
                      setPage({ ...page, customWidth: value });
                    }
                  }}
                />
              </label>
              <label className="code-inline-field code-unit-field">
                <span className="sr-only">Page unit</span>
                <select
                  id="code-page-unit"
                  name="code-page-unit"
                  value={page.unit}
                  onChange={(event) => changeUnit(event.target.value as PageUnit)}
                >
                  <option value="mm">mm</option>
                  <option value="pt">pt</option>
                </select>
              </label>
              <span className="code-times">×</span>
              <label className="code-inline-field">
                <span>Height</span>
                <input
                  id="code-page-height"
                  name="code-page-height"
                  type="number"
                  min={10}
                  step={1}
                  value={page.customHeight}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value > 0) {
                      setPage({ ...page, customHeight: value });
                    }
                  }}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="code-section">
          <div className="code-section-title">Placement</div>
          <div className="code-field">
            <span>Diagram zoom</span>
            <label className="code-number-field">
              <input
                id="code-diagram-zoom-value"
                name="code-diagram-zoom-value"
                type="number"
                min={10}
                max={300}
                step={1}
                value={zoomDraft}
                onChange={(event) => setZoomDraft(event.target.value)}
                onBlur={commitZoom}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitZoom();
                  } else if (event.key === "Escape") {
                    setZoomDraft(String(Math.round(zoom * 100)));
                  }
                }}
                aria-label="Diagram zoom percentage"
              />
              <span>%</span>
            </label>
          </div>
          <div className="code-align-row">
            <div className="code-segmented" role="group" aria-label="Horizontal alignment">
              {ALIGN_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={align === option.value ? "active" : ""}
                  onClick={() => setAlign(option.value)}
                >
                  <AlignIcon align={option.value} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="code-summary">
            <div className="code-summary-line">
              <span>
                {Math.round(result.selection.naturalWidth)} ×{" "}
                {Math.round(result.selection.naturalHeight)} pt
              </span>
              <span>
                {Math.round(result.fit.scale * 100)}% · {pagePresetLabel(page)}
              </span>
            </div>
            <div className="code-summary-line code-summary-muted">
              <span>
                {result.stats.nodes} nodes · {result.stats.edges} connectors · {result.stats.labels} labels
              </span>
              <span>{result.code.split("\n").length} lines</span>
            </div>
            {result.fit.fitReduced ? (
              <div className="code-fit-chip">
                Scaled down to fit document (requested{" "}
                {Math.round(result.fit.requested * 100)}%, reduced to{" "}
                {Math.round(result.fit.scale * 100)}%)
              </div>
            ) : null}
            {result.warnings.length > 0 ? (
              <ul className="code-warnings">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <label className="code-field">
            <span>Label below</span>
            <span className="code-input-with-action">
              <input
                id="code-label"
                name="code-label"
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="No label"
              />
              {label.length > 0 ? (
                <button
                  type="button"
                  className="code-input-action"
                  onClick={() => setLabel("")}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label="Clear label"
                  title="Clear label"
                >
                  <ClearIcon />
                </button>
              ) : null}
            </span>
          </label>
        </section>

        <section className="code-section">
          <div className="code-section-title">Reference</div>
          <label className="code-field">
            <span>Diagram id</span>
            <input
              id="code-diagram-id"
              name="code-diagram-id"
              type="text"
              value={diagramId}
              onChange={(event) => setDiagramId(event.target.value)}
              spellCheck={false}
              placeholder="fig-scene-name"
            />
          </label>
          <p className="code-hint code-mono-hint">
            Reference with <code>@{(result.label)}</code>
          </p>
          <label className="code-field">
            <span>Resources folder</span>
            <input
              id="code-resource-folder"
              name="code-resource-folder"
              type="text"
              value={resourceFolder}
              onChange={(event) => setResourceFolder(event.target.value)}
              spellCheck={false}
              placeholder="assets"
            />
          </label>
          <p className="code-hint">
            Images are referenced, never embedded:
            <code> {resourceFolder.length > 0 ? resourceFolder.replace(/\/+$/, "") : "."}/file.ext</code>
          </p>
          {result.images.length > 0 ? (
            <div className="code-resource-list">
              <div className="code-section-title">Referenced files</div>
              <ul>
                {result.images.map((image) => (
                  <li key={`${image.nodeId}:${image.path}`}>
                    <code>{image.path}</code>
                    {image.missing ? <span>missing</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="code-section">
          <div className="code-section-head">
            <div className="code-section-title">Preview</div>
            <div className="code-preview-actions">
              <span className={`code-preview-status ${previewCollapsed ? "idle" : preview.status}`}>
                {previewCollapsed ? "Paused" : previewStatus}
              </span>
              {!previewCollapsed ? (
                <button
                  type="button"
                  className="code-expand-button"
                  onClick={openPreview}
                  disabled={!ready}
                  title={ready ? "Open a larger page preview" : "Preview is still compiling"}
                >
                  Expand
                </button>
              ) : null}
              <button
                type="button"
                className="code-collapse-button"
                onClick={() => setPreviewCollapsed((value) => !value)}
                aria-expanded={!previewCollapsed}
                aria-label={previewCollapsed ? "Expand preview section" : "Collapse preview section"}
                title={previewCollapsed ? "Expand preview" : "Collapse preview"}
              >
                <ChevronIcon open={!previewCollapsed} />
              </button>
            </div>
          </div>
          {!previewCollapsed ? (
            <>
              <div className="code-preview-page" aria-label="Rendered Typst page preview">
                {ready ? (
                  <div
                    className="code-preview-svg"
                    // Typst emits a self-contained SVG for one page. User text is
                    // escaped as Typst markup in the generated source.
                    dangerouslySetInnerHTML={{ __html: preview.svg ?? "" }}
                  />
                ) : (
                  <div className="code-preview-empty">
                    {preview.status === "error"
                      ? "The preview could not compile."
                      : "Compiling Typst…"}
                  </div>
                )}
              </div>
              {preview.status === "error" ? (
                <pre className="code-preview-error">{preview.error ?? "Unknown Typst error"}</pre>
              ) : null}
              {missingPreviewImages.length > 0 ? (
                <p className="code-hint code-warning-hint">
                  {missingPreviewImages.length} image
                  {missingPreviewImages.length === 1 ? "" : "s"} lack bytes in this session; the
                  preview shows a placeholder while the exported path stays correct.
                </p>
              ) : null}
              <p className="code-hint code-preview-note">
                Preview compiled with CeTZ {CETZ_PREVIEW_VERSION} (Typst 0.14); the exported
                code targets CeTZ {CETZ_EXPORT_VERSION}.
              </p>
            </>
          ) : null}
        </section>

        <section className="code-section code-source-section">
          <div className="code-section-head">
            <div className="code-section-title">CeTZ source</div>
            <button
              type="button"
              className={`code-copy-button ${copyState}`}
              onClick={() => void copyCode()}
            >
              <CopyIcon />
              <span>
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "error"
                    ? "Copy failed"
                    : "Copy code"}
              </span>
            </button>
          </div>
          <div className="code-import-card">
            <code>#import "@preview/cetz:{CETZ_EXPORT_VERSION}": canvas, draw</code>
            <span>The snippet sets no page size and no global text styles.</span>
          </div>
          <pre className="code-block" tabIndex={0}>
            <code>{result.code}</code>
          </pre>
        </section>
      </div>
      </aside>

      {previewOpen && ready ? (
        <div
          className="code-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Rendered Typst page"
          onClick={() => setPreviewOpen(false)}
        >
          <div className="code-preview-modal-inner" onClick={(event) => event.stopPropagation()}>
            <div className="code-preview-modal-head">
              <div>
                <span className="code-panel-kicker">Typst page preview</span>
                <strong>{pagePresetLabel(page)}</strong>
              </div>
              <div className="code-preview-modal-tools">
                <div className="code-preview-zoom" role="group" aria-label="Preview zoom">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewZoom((value) => Math.max(0.25, Math.round((value / 1.25) * 100) / 100))
                    }
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    −
                  </button>
                  <span>{Math.round(previewZoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewZoom((value) => Math.min(4, Math.round(value * 1.25 * 100) / 100))
                    }
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="code-preview-zoom-fit"
                    onClick={() => setPreviewZoom(1)}
                    title="Reset preview zoom"
                  >
                    100%
                  </button>
                </div>
                <button
                  type="button"
                  className="code-panel-close"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close preview"
                  title="Close preview"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="code-preview-modal-svg">
              <div
                className="code-preview-modal-page"
                style={{ width: `${previewZoom * 100}%` }}
                dangerouslySetInnerHTML={{ __html: preview.svg ?? "" }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
