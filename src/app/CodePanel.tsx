import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutSnapshot } from "../model/layout.ts";
import type { SceneDocument } from "../model/scene.ts";
import type { ImageAsset } from "../model/nodes.ts";
import {
  CETZ_EXPORT_VERSION,
  serializeSceneToCetz,
} from "../export/cetz.ts";
import {
  defaultDiagramId,
  normalizeBorder,
  normalizePageSpec,
  pageSize,
  ptToUnit,
  unitToPt,
  type BorderSettings,
  type ExportAlign,
  type ExportScope,
  type ExportSettings,
  type PagePreset,
  type PageSpec,
  type PageUnit,
} from "../export/page.ts";
import type { PreviewImage } from "../export/typst-preview.ts";
import { cleanTypstSvg, renderTypstPng } from "../export/typst-png.ts";
import { downloadBinaryFile, downloadBlob, downloadTextFile } from "./file-transfer.ts";
import {
  ensureWritePermission,
  pickTypstExportFile,
  supportsSaveFilePicker,
  writeProjectToHandle,
} from "./file-system-access.ts";
import {
  loadExportFileBinding,
  storeExportFileBinding,
  type ExportFileBinding,
} from "./export-file-storage.ts";
import { saveSceneExportSettings } from "./typst-export-settings.ts";
import { useTypstPreview } from "./use-typst-preview.ts";

const IMPORT_STATEMENT = `#import "@preview/cetz:${CETZ_EXPORT_VERSION}": canvas, draw`;

export interface CodePanelProps {
  readonly scene: SceneDocument;
  readonly layout: LayoutSnapshot;
  readonly selectedNodeIds: readonly string[];
  readonly selectedEdgeId: string | null;
  readonly selectedEdgeIds: readonly string[];
  readonly assets: Readonly<Record<string, ImageAsset>>;
  readonly onClose: () => void;
}

interface StoredSettings {
  readonly page?: PageSpec;
  readonly zoom?: number;
  readonly align?: ExportAlign;
  readonly border?: Partial<BorderSettings>;
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

const DownloadIcon = () => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M9 2.5v8.5M5.8 8l3.2 3.2L12.2 8" />
    <path d="M3 13.2v1.3A1.5 1.5 0 0 0 4.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-1.3" />
  </svg>
);

const PickFileIcon = () => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M2.5 5.2h5l1.5 2h6.5v6.3a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5Z" />
    <path d="M2.5 5.2V3.7A1.2 1.2 0 0 1 3.7 2.5h3l1.5 2" />
  </svg>
);

const SaveFileIcon = () => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M3 2.5h8.5L15 6v9.5H3Z" />
    <path d="M6 2.5v4h5v-4M6 15.5v-4h6v4" />
  </svg>
);

const ExportFileIcon = ({ kind }: { readonly kind: "pdf" | "png" | "svg" }) => (
  <svg className="code-icon" viewBox="0 0 18 18" aria-hidden="true">
    {kind === "pdf" ? (
      <>
        <path d="M4 2.5h6l3 3v10H4Z" />
        <path d="M10 2.5v3h3M6.5 8.5h4M6.5 11h4" />
      </>
    ) : kind === "png" ? (
      <>
        <rect x="2.8" y="3.5" width="12.4" height="11" rx="1.4" />
        <circle cx="6.1" cy="7" r="1.1" />
        <path d="M3.2 12.8l3.2-3.2 2.4 2.4 1.9-1.9 3.9 3.9" />
      </>
    ) : (
      <>
        <path d="M3 14.5C6 8 9 14 15 4.5" />
        <rect x="1.8" y="13.3" width="2.4" height="2.4" />
        <rect x="13.8" y="3.3" width="2.4" height="2.4" />
      </>
    )}
  </svg>
);

const MagnifierIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.3" />
    <path d="M10.2 10.2 14 14" />
  </svg>
);

const DirectionIcon = ({ side }: { readonly side: "top" | "right" | "bottom" | "left" }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {side === "top" ? <path d="M8 14V2M4 6l4-4 4 4" /> : null}
    {side === "right" ? <path d="M2 8h12M10 4l4 4-4 4" /> : null}
    {side === "bottom" ? <path d="M8 2v12M4 10l4 4 4-4" /> : null}
    {side === "left" ? <path d="M14 8H2M6 4 2 8l4 4" /> : null}
  </svg>
);

const BorderWidthIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4.5h12M2 8h12M2 11.5h12" />
    <path d="M2 8h12" strokeWidth="2.8" />
  </svg>
);

const PaddingIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.2" />
    <rect x="5.2" y="5.2" width="5.6" height="5.6" rx="0.7" strokeDasharray="1.9 1.4" />
  </svg>
);

const ChevronIcon = ({ open }: { readonly open: boolean }) => (
  <svg className={`code-icon code-chevron ${open ? "open" : ""}`} viewBox="0 0 18 18" aria-hidden="true">
    <path d="M5 7l4 4 4-4" />
  </svg>
);

const SectionToggle = ({
  title,
  collapsed,
  onToggle,
}: {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) => (
  <div className="code-section-head">
    <div className="code-section-title">{title}</div>
    <button
      type="button"
      className="code-collapse-button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${title} section`}
      title={`${collapsed ? "Expand" : "Collapse"} ${title}`}
    >
      <ChevronIcon open={!collapsed} />
    </button>
  </div>
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

const MARGIN_SIDES = ["top", "right", "bottom", "left"] as const;

const MARGIN_LABELS: Record<(typeof MARGIN_SIDES)[number], string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
};

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
  selectedEdgeIds,
  assets,
  onClose,
}: CodePanelProps) => {
  const stored = useRef<StoredSettings | null>(null);
  if (stored.current === null) stored.current = loadStored();
  const [page, setPage] = useState<PageSpec>(normalizePageSpec(stored.current.page));
  const [zoom, setZoom] = useState<number>(stored.current.zoom ?? 1);
  const [zoomDraft, setZoomDraft] = useState<string>(
    String(Math.round((stored.current.zoom ?? 1) * 100)),
  );
  const [scope, setScope] = useState<ExportScope>("diagram");
  const [align, setAlign] = useState<ExportAlign>(stored.current.align ?? "center");
  const [border, setBorder] = useState<BorderSettings>(normalizeBorder(stored.current.border));
  const [label, setLabel] = useState<string>(scene.meta.title);
  const [resourceFolder, setResourceFolder] = useState<string>(
    stored.current.resourceFolder ?? "assets",
  );
  const [diagramId, setDiagramId] = useState<string>(() => defaultDiagramId(scene.meta.title));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [importState, setImportState] = useState<"idle" | "copied" | "error">("idle");
  const [fileState, setFileState] = useState<"idle" | "copied" | "error">("idle");
  const [downloadState, setDownloadState] = useState<"idle" | "saved" | "error">("idle");
  const [exportFileState, setExportFileState] = useState<"idle" | "saved" | "error">("idle");
  const [exportBinding, setExportBinding] = useState<ExportFileBinding | null>(null);
  const [automaticExport, setAutomaticExport] = useState(false);
  const [codeMode, setCodeMode] = useState<"export" | "source">("export");
  const [objectsCollapsed, setObjectsCollapsed] = useState(false);
  const [placementCollapsed, setPlacementCollapsed] = useState(false);
  const [borderCollapsed, setBorderCollapsed] = useState(false);
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(true);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [transparentPng, setTransparentPng] = useState(false);
  const [fileExportBusy, setFileExportBusy] = useState<"pdf" | "png" | "svg" | null>(null);
  const [fileExportError, setFileExportError] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  const importTimer = useRef<number | null>(null);
  const fileTimer = useRef<number | null>(null);
  const downloadTimer = useRef<number | null>(null);
  const exportFileTimer = useRef<number | null>(null);
  const persistedSettingsScene = useRef<string | null>(null);

  const selectionCount = selectedNodeIds.length + selectedEdgeIds.length;
  const exportFilesSupported = supportsSaveFilePicker();

  useEffect(() => {
    setDiagramId(defaultDiagramId(scene.meta.title));
    setLabel(scene.meta.title);
    setScope("diagram");
    setCodeMode("export");
  }, [scene.id, scene.meta.title]);

  useEffect(() => {
    let cancelled = false;
    setExportBinding(null);
    setAutomaticExport(false);
    void loadExportFileBinding(scene.id).then((binding) => {
      if (cancelled || binding === null) return;
      setExportBinding(binding);
      setAutomaticExport(binding.automatic);
    });
    return () => {
      cancelled = true;
    };
  }, [scene.id]);

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
    const data: StoredSettings = { page, zoom, align, border, resourceFolder };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Local storage can be unavailable in private windows; export still works.
    }
  }, [page, zoom, align, border, resourceFolder]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      if (importTimer.current !== null) window.clearTimeout(importTimer.current);
      if (fileTimer.current !== null) window.clearTimeout(fileTimer.current);
      if (downloadTimer.current !== null) window.clearTimeout(downloadTimer.current);
      if (exportFileTimer.current !== null) window.clearTimeout(exportFileTimer.current);
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
      border,
      label,
      diagramId,
      resourceFolder,
    }),
    [page, zoom, scope, align, border, label, diagramId, resourceFolder],
  );

  useEffect(() => {
    // Skip the first render after a scene change so the old scene's settings
    // are not written under the new scene id before its own state settles.
    if (persistedSettingsScene.current === null) {
      persistedSettingsScene.current = scene.id;
      return;
    }
    if (persistedSettingsScene.current !== scene.id) {
      persistedSettingsScene.current = scene.id;
      return;
    }
    saveSceneExportSettings(scene.id, settings);
  }, [scene.id, settings]);

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

  const fileName = `${result.label}.typ`;
  const fileCommand = `#include "${fileName}"`;

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
        margins: page.margins,
      });
      return;
    }
    setPage({ ...page, preset });
  };

  const changeUnit = (unit: PageUnit): void => {
    if (unit === page.unit) return;
    const widthPt = unitToPt(page.customWidth, page.unit);
    const heightPt = unitToPt(page.customHeight, page.unit);
    const round = (value: number): number => Math.round(value * 10) / 10;
    setPage({
      ...page,
      unit,
      customWidth: round(ptToUnit(widthPt, unit)),
      customHeight: round(ptToUnit(heightPt, unit)),
      margins: {
        top: round(ptToUnit(unitToPt(page.margins.top, page.unit), unit)),
        right: round(ptToUnit(unitToPt(page.margins.right, page.unit), unit)),
        bottom: round(ptToUnit(unitToPt(page.margins.bottom, page.unit), unit)),
        left: round(ptToUnit(unitToPt(page.margins.left, page.unit), unit)),
      },
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

  const copyImport = async (): Promise<void> => {
    try {
      await copyToClipboard(IMPORT_STATEMENT);
      setImportState("copied");
    } catch {
      setImportState("error");
    }
    if (importTimer.current !== null) window.clearTimeout(importTimer.current);
    importTimer.current = window.setTimeout(() => setImportState("idle"), 1800);
  };

  const copyFileCommand = async (): Promise<void> => {
    try {
      await copyToClipboard(fileCommand);
      setFileState("copied");
    } catch {
      setFileState("error");
    }
    if (fileTimer.current !== null) window.clearTimeout(fileTimer.current);
    fileTimer.current = window.setTimeout(() => setFileState("idle"), 1800);
  };

  const downloadCode = (): void => {
    try {
      downloadTextFile(
        fileName,
        `${IMPORT_STATEMENT}\n\n${result.code}`,
        "text/plain;charset=utf-8",
      );
      setDownloadState("saved");
    } catch {
      setDownloadState("error");
    }
    if (downloadTimer.current !== null) window.clearTimeout(downloadTimer.current);
    downloadTimer.current = window.setTimeout(() => setDownloadState("idle"), 1800);
  };

  const flashExportFileState = (state: "saved" | "error"): void => {
    setExportFileState(state);
    if (exportFileTimer.current !== null) window.clearTimeout(exportFileTimer.current);
    exportFileTimer.current = window.setTimeout(() => setExportFileState("idle"), 1800);
  };

  const chooseExportFile = async (): Promise<void> => {
    try {
      const handle = await pickTypstExportFile(fileName);
      if (handle === null) return;
      if (!(await ensureWritePermission(handle))) {
        flashExportFileState("error");
        return;
      }
      const binding: ExportFileBinding = {
        handle,
        automatic: automaticExport,
        fileName: handle.name,
      };
      setExportBinding(binding);
      await storeExportFileBinding(scene.id, binding);
      saveSceneExportSettings(scene.id, settings);
    } catch {
      flashExportFileState("error");
    }
  };

  const saveExportFile = async (): Promise<void> => {
    if (exportBinding === null) return;
    try {
      await writeProjectToHandle(
        exportBinding.handle,
        `${IMPORT_STATEMENT}\n\n${result.code}`,
      );
      flashExportFileState("saved");
    } catch {
      flashExportFileState("error");
    }
  };

  const changeAutomaticExport = (enabled: boolean): void => {
    setAutomaticExport(enabled);
    if (exportBinding === null) return;
    const binding = { ...exportBinding, automatic: enabled };
    setExportBinding(binding);
    void storeExportFileBinding(scene.id, binding);
    saveSceneExportSettings(scene.id, settings);
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
  const fileExportBase =
    result.label.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-") ||
    "uml-diagram";

  const currentExportSvg = async (): Promise<string> => {
    const mounted = ready
      ? document.querySelector<SVGSVGElement>(
          ".code-panel .code-preview-svg svg",
        )
      : null;
    if (mounted !== null) {
      return new XMLSerializer().serializeToString(mounted);
    }
    const { renderTypstPreview } = await import("../export/typst-preview.ts");
    return (await renderTypstPreview(result.previewCode, previewImages)).svg;
  };

  const savePdf = async (): Promise<void> => {
    if (fileExportBusy !== null) return;
    setFileExportBusy("pdf");
    setFileExportError(null);
    try {
      const { renderTypstPdf } = await import("../export/typst-preview.ts");
      const pdf = await renderTypstPdf(result.previewCode, previewImages);
      downloadBinaryFile(`${fileExportBase}.pdf`, pdf, "application/pdf");
    } catch (error) {
      setFileExportError(
        error instanceof Error ? error.message : "The PDF could not be exported.",
      );
    } finally {
      setFileExportBusy(null);
    }
  };

  const savePng = async (): Promise<void> => {
    if (fileExportBusy !== null) return;
    setFileExportBusy("png");
    setFileExportError(null);
    try {
      const png = await renderTypstPng(await currentExportSvg(), {
        page,
        transparent: transparentPng,
      });
      downloadBlob(`${fileExportBase}.png`, png);
    } catch (error) {
      setFileExportError(
        error instanceof Error ? error.message : "The PNG could not be exported.",
      );
    } finally {
      setFileExportBusy(null);
    }
  };

  const saveSvg = async (): Promise<void> => {
    if (fileExportBusy !== null) return;
    setFileExportBusy("svg");
    setFileExportError(null);
    try {
      const svg = cleanTypstSvg(await currentExportSvg());
      downloadTextFile(
        `${fileExportBase}.svg`,
        svg,
        "image/svg+xml;charset=utf-8",
      );
    } catch (error) {
      setFileExportError(
        error instanceof Error ? error.message : "The SVG could not be exported.",
      );
    } finally {
      setFileExportBusy(null);
    }
  };

  return (
    <>
      <aside className="code-panel" aria-label="Typst and CeTZ export">
        <header className="code-panel-head">
          <div>
            {/* <div className="code-panel-kicker"></div> */}
            <h2>Typst</h2>
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
            <SectionToggle
              title="Export Objects"
              collapsed={objectsCollapsed}
              onToggle={() => setObjectsCollapsed((value) => !value)}
            />
            {!objectsCollapsed ? (
              <>
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
                    : null}
                </p>
              </>
            ) : null}
          </section>
          <ColoredLine color="var(--line)" />
          {/* ) : null} */}

          <section className="code-section">
            <SectionToggle
              title="Page Format & Placement"
              collapsed={placementCollapsed}
              onToggle={() => setPlacementCollapsed((value) => !value)}
            />
            {!placementCollapsed ? (
              <>
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
                  </div>
                ) : null}
                {/* </section>

        <section className="code-section"> */}
                {/* <div className="code-section-title">Placement</div> */}
                <div className="code-field">
                  <span>Diagram zoom</span>
                  <label className="code-number-field">
                    <MagnifierIcon />
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

                <label className="code-field">
                  <span>Page margins ({page.unit})</span>
                  <div className="code-section-title"></div>
                  <div className="code-margin-grid">
                    {MARGIN_SIDES.map((side) => (
                      <label className="code-margin-field" key={side}>
                        <span>{MARGIN_LABELS[side]}</span>
                        <span className="code-icon-input">
                          <DirectionIcon side={side} />
                          <input
                            id={`code-margin-${side}`}
                            name={`code-margin-${side}`}
                            type="number"
                            min={0}
                            step={1}
                            value={page.margins[side]}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (Number.isFinite(value) && value >= 0) {
                                setPage({
                                  ...page,
                                  margins: { ...page.margins, [side]: value },
                                });
                              }
                            }}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                </label>
              </>
            ) : null}
          </section>
          <ColoredLine color="var(--line)" />
          <section className="code-section">
            <SectionToggle
              title="Border"
              collapsed={borderCollapsed}
              onToggle={() => setBorderCollapsed((value) => !value)}
            />
            {!borderCollapsed ? (
              <>
                <label className="code-checkbox">
                  <input
                    id="code-border-enabled"
                    name="code-border-enabled"
                    type="checkbox"
                    checked={border.enabled}
                    onChange={(event) => setBorder({ ...border, enabled: event.target.checked })}
                  />
                  <span>Draw border</span>
                </label>
                <div className="code-border-grid">
                  <label className="code-border-field code-border-color">
                    <span>Color</span>
                    <input
                      id="code-border-color"
                      name="code-border-color"
                      type="color"
                      value={border.color}
                      onInput={(event) =>
                        setBorder({ ...border, color: event.currentTarget.value })
                      }
                      disabled={!border.enabled}
                    />
                  </label>
                  <label className="code-border-field">
                    <span>Width (pt)</span>
                    <span className="code-icon-input code-border-input">
                      <BorderWidthIcon />
                      <input
                        id="code-border-width"
                        name="code-border-width"
                        type="number"
                        min={0}
                        step={0.25}
                        value={border.width}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value >= 0) {
                            setBorder({ ...border, width: value });
                          }
                        }}
                        disabled={!border.enabled}
                      />
                    </span>
                  </label>
                  <label className="code-border-field">
                    <span>Padding (pt)</span>
                    <span className="code-icon-input code-border-input">
                      <PaddingIcon />
                      <input
                        id="code-border-padding"
                        name="code-border-padding"
                        type="number"
                        min={0}
                        step={1}
                        value={border.padding}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value >= 0) {
                            setBorder({ ...border, padding: value });
                          }
                        }}
                        disabled={!border.enabled}
                      />
                    </span>
                  </label>
                </div>
              </>
            ) : null}
          </section>
          <ColoredLine color="var(--line)" />
          <section className="code-section">
            <SectionToggle
              title="Reference"
              collapsed={referenceCollapsed}
              onToggle={() => setReferenceCollapsed((value) => !value)}
            />
            {!referenceCollapsed ? (
              <>
                <label className="code-field">
                  <span>Label text</span>
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
                <label className="code-field">
                  <span>Diagram ID</span>
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
                  Reference diagram with <code>@{(result.label)}</code>
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
                  Place used images in the folder:
                  <code>{resourceFolder.length > 0 ? resourceFolder.replace(/\/+$/, "") : "."}/file.ext</code>
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
              </>
            ) : null}
          </section>
          <ColoredLine color="var(--line)" />
          <section className="code-section">
            <div className="code-section-head">
              <div className="code-section-title">Preview</div>
              <div className="code-preview-actions">
                <span className={`code-preview-status ${previewCollapsed ? "idle" : preview.status}`}>
                  {previewCollapsed ? null : previewStatus}
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

                <div className="code-summary">
                  <div className="code-summary-line">
                    <span>
                      {Math.round(result.canvasWidthPt)} ×{" "}
                      {Math.round(result.canvasHeightPt)} pt
                    </span>
                    <span>
                      {Math.round(result.fit.scale * 100)}% · {pagePresetLabel(page)}
                    </span>
                  </div>
                  <div className="code-summary-line code-summary-muted">
                    <span>
                      {result.stats.nodes} nodes · {result.stats.edges} connectors · {result.stats.labels} labels
                    </span>
                    {/* <span>{result.code.split("\n").length} lines</span> */}
                  </div>

                  {result.warnings.length > 0 ? (
                    <ul className="code-warnings">
                      {result.fit.fitReduced ? (
                        <li>
                          Scaled down to fit document (requested{" "}
                          {Math.round(result.fit.requested * 100)}%, reduced to{" "}
                          {Math.round(result.fit.scale * 100)}%)
                        </li>
                      ) : null}
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>

          <ColoredLine color="var(--line)" />

          <section className="code-section">
            <div className="code-section-head">
              <div className="code-section-title">File export</div>
            </div>
            <div className="code-file-export-actions">
              <button
                type="button"
                className="code-download-button secondary"
                onClick={() => void savePdf()}
                disabled={fileExportBusy !== null}
              > <ExportFileIcon kind="pdf" />
                {fileExportBusy === "pdf" ? "Saving PDF…" : "Save as PDF"}
              </button>
              <button
                type="button"
                className="code-download-button secondary"
                onClick={() => void savePng()}
                disabled={fileExportBusy !== null}
              > <ExportFileIcon kind="png" />
                {fileExportBusy === "png" ? "Saving PNG…" : "Save as PNG"}
              </button>
              <button
                type="button"
                className="code-download-button secondary"
                onClick={() => void saveSvg()}
                disabled={fileExportBusy !== null}
              > <ExportFileIcon kind="svg" />
                {fileExportBusy === "svg" ? "Saving SVG…" : "Save as SVG"}
              </button>
            </div>
              <label className="code-checkbox">
                <input
                  type="checkbox"
                  checked={transparentPng}
                  onChange={(event) => setTransparentPng(event.target.checked)}
                  disabled={fileExportBusy !== null}
                />
                Transparent PNG background
              </label>
            {fileExportError !== null ? (
              <p className="code-hint code-warning-hint">{fileExportError}</p>
            ) : null}
          </section>

          <ColoredLine color="var(--line)" />

          <section className="code-section code-source-section">
            <div className="code-section-head">
              <div className="code-section-title">Typst Code</div>
            </div>
            {missingPreviewImages.length > 0 ? (
              <p className="code-hint code-warning-hint">
                {missingPreviewImages.length} image
                {missingPreviewImages.length === 1 ? "" : "s"} lack bytes in this session; the
                preview shows a placeholder while the exported path stays correct.
              </p>
            ) : null}
            <div
              className="code-segmented code-mode-switch"
              role="group"
              aria-label="Typst output"
            >
              <button
                type="button"
                className={codeMode === "export" ? "active" : ""}
                aria-pressed={codeMode === "export"}
                onClick={() => setCodeMode("export")}
              >
                Export .typ File
              </button>
              <button
                type="button"
                className={codeMode === "source" ? "active" : ""}
                aria-pressed={codeMode === "source"}
                onClick={() => setCodeMode("source")}
              >
                View Source Code
              </button>
            </div>

            {codeMode === "export" ? (
              <>
                <p className="code-hint code-export-hint">
                  {exportFilesSupported ? (
                    exportBinding !== null ? (
                      automaticExport && scope === "diagram" ? (
                        <>Automatic export writes this scene to{" "}
                          <code>{exportBinding.fileName}</code> on <kbd>Ctrl</kbd>+<kbd>S</kbd>.</>
                      ) : (
                        <>Writing to <code>{exportBinding.fileName}</code>. Enable automatic
                          export to write it on <kbd>Ctrl</kbd>+<kbd>S</kbd>.</>
                      )
                    ) : (
                      <><strong>Recommended.</strong> Pick a <code>.typ</code> file to
                        write exports directly. You can still download it instead.</>
                    )
                  ) : (
                    <><strong>Recommended.</strong> Download the standalone{" "}
                      <code>.typ</code> file, then include it where the diagram
                      should appear.</>
                  )}
                </p>
                {exportFilesSupported ? (
                  <>
                    {scope === "diagram" ? (
                      <label
                        className={`code-auto-export ${automaticExport ? "on" : ""}`}
                        title={
                          exportBinding === null
                            ? "Pick an export file first"
                            : "Write this scene's .typ file whenever Ctrl+S saves"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={automaticExport}
                          disabled={exportBinding === null}
                          onChange={(event) => changeAutomaticExport(event.target.checked)}
                        />
                        <span>Automatic export</span>
                        {exportBinding === null ? <em>Pick an export file first</em> : null}
                      </label>
                    ) : null}
                    {exportBinding !== null ? (
                      <div className="code-export-file-row">
                        <button
                          type="button"
                          className={`code-download-button code-download-wide ${exportFileState}`}
                          onClick={() => void saveExportFile()}
                          title={`Save ${exportBinding.fileName}`}
                        >
                          <SaveFileIcon />
                          <span>
                            {exportFileState === "saved"
                              ? "Saved"
                              : exportFileState === "error"
                                ? "Save failed"
                                : "Save to file"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="code-export-pick"
                          onClick={() => void chooseExportFile()}
                          title="Choose another export file"
                          aria-label="Choose another export file"
                        >
                          <PickFileIcon />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="code-download-button code-download-wide"
                        onClick={() => void chooseExportFile()}
                        title={`Pick an export file for ${fileName}`}
                      >
                        <PickFileIcon />
                        <span>Pick export file</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className={`code-download-button code-download-wide secondary ${downloadState}`}
                      onClick={downloadCode}
                      title={`Download ${fileName}`}
                    >
                      <DownloadIcon />
                      <span>
                        {downloadState === "saved"
                          ? "Downloaded"
                          : downloadState === "error"
                            ? "Download failed"
                            : `Download ${fileName}`}
                      </span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`code-download-button code-download-wide ${downloadState}`}
                    onClick={downloadCode}
                    title={`Download ${fileName}`}
                  >
                    <DownloadIcon />
                    <span>
                      {downloadState === "saved"
                        ? "Downloaded"
                        : downloadState === "error"
                          ? "Download failed"
                          : `Download ${fileName}`}
                    </span>
                  </button>
                )}
                <div className="code-import-card">
                  <div className="code-import-head">
                    <code>{fileCommand}</code>
                    <button
                      type="button"
                      className={`code-import-copy ${fileState}`}
                      onClick={() => void copyFileCommand()}
                      aria-label="Copy command for the downloaded file"
                      title={fileState === "copied" ? "Copied" : "Copy file include command"}
                    >
                      <CopyIcon />
                    </button>
                  </div>
                  <span>
                    Include the file where the figure should appear.
                  </span>
                </div>
              </>
            ) : (
              <>
                {/* <p className="code-hint code-export-hint">
                  Import CeTZ package, then paste the source below into
                  the document.
                </p> */}
                <div className="code-import-card">
                  <div className="code-import-head">
                    <code>{IMPORT_STATEMENT}</code>
                    <button
                      type="button"
                      className={`code-import-copy ${importState}`}
                      onClick={() => void copyImport()}
                      aria-label="Copy CeTZ import"
                      title={importState === "copied" ? "Copied" : "Copy CeTZ import"}
                    >
                      <CopyIcon />
                    </button>
                  </div>
                  <span>Import CeTZ package, then paste the source below into
                    the document.</span>
                </div>
                <div className="code-block-wrap">
                  <button
                    type="button"
                    className={`code-copy-button code-copy-overlay ${copyState}`}
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
                  <pre className="code-block" tabIndex={0}>
                    <code>{result.code}</code>
                  </pre>
                </div>
              </>
            )}
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
                    Fit
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

const ColoredLine = ({ color = "black" }) => (
  <hr
    style={{
      color: color,
      backgroundColor: "transparent",
      height: 1,
      width: "100%",
      margin: "1px",
      border: "1px dashed",
    }}
  />
);