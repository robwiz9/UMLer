import { useEffect, useRef, useState } from "react";
import type { DiagramKind, SceneDocument } from "../model/scene.ts";
import { DIAGRAM_KIND_LABELS } from "../model/scene.ts";
import { AppMenuBar } from "./AppMenuBar.tsx";

interface ToolbarProps {
  readonly scene: SceneDocument;
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
  readonly canDeleteScene: boolean;
  readonly onSceneChange: (sceneId: string) => void;
  readonly panelVisible: boolean;
  readonly onTogglePanel: () => void;
  readonly codePanelVisible: boolean;
  readonly onToggleCodePanel: () => void;
  readonly onExportScene: () => void;
  readonly onImportScene: () => void;
  readonly onExportProject: () => void;
  readonly onImportProject: () => void;
  readonly onNewProject: () => void;
  readonly onNewScene: () => void;
  readonly onRenameScene: () => void;
  readonly onDuplicateScene: () => void;
  readonly onDeleteScene: () => void;
  readonly onOpenFromGitHub: () => void;
  readonly onSaveToGitHub: () => void;
  readonly canSaveToGitHub: boolean;
  readonly onPurgeUnusedImages: () => void;
  readonly unusedImageCount: number;
  readonly zoom: number;
  readonly gridVisible: boolean;
  readonly snapEnabled: boolean;
  readonly gridSize: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
  readonly onToggleGrid: () => void;
  readonly onToggleSnap: () => void;
  readonly onGridSizeChange: (size: number) => void;
}

export const Toolbar = ({
  scene,
  scenes,
  activeSceneId,
  canDeleteScene,
  onSceneChange,
  panelVisible,
  onTogglePanel,
  codePanelVisible,
  onToggleCodePanel,
  onExportScene,
  onImportScene,
  onExportProject,
  onImportProject,
  onNewProject,
  onNewScene,
  onRenameScene,
  onDuplicateScene,
  onDeleteScene,
  onOpenFromGitHub,
  onSaveToGitHub,
  canSaveToGitHub,
  onPurgeUnusedImages,
  unusedImageCount,
  zoom,
  gridVisible,
  snapEnabled,
  gridSize,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleGrid,
  onToggleSnap,
  onGridSizeChange,
}: ToolbarProps) => {
  const [compactOpen, setCompactOpen] = useState(false);
  const compactRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!compactOpen) return;
    const close = (event: PointerEvent): void => {
      if (!compactRef.current?.contains(event.target as Node)) setCompactOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setCompactOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [compactOpen]);

  return (
    <header className="topbar">
    <div className="brand">
      <div className="brand-mark">U</div>
      <div>
        <div className="brand-name">UMLer</div>
        <div className="brand-sub">diagram editor</div>
      </div>
    </div>

    <AppMenuBar
      canDeleteScene={canDeleteScene}
      canSaveToGitHub={canSaveToGitHub}
      onExportScene={onExportScene}
      onImportScene={onImportScene}
      onExportProject={onExportProject}
      onImportProject={onImportProject}
      onNewProject={onNewProject}
      onNewScene={onNewScene}
      onRenameScene={onRenameScene}
      onDuplicateScene={onDuplicateScene}
      onDeleteScene={onDeleteScene}
      onOpenFromGitHub={onOpenFromGitHub}
      onSaveToGitHub={onSaveToGitHub}
      onPurgeUnusedImages={onPurgeUnusedImages}
      unusedImageCount={unusedImageCount}
    />

    <div className="topbar-group scene-picker">
      {/* <label htmlFor="scene-select">Scene</label> */}
      <select
        id="scene-select"
        value={activeSceneId}
        onChange={(event) => onSceneChange(event.target.value)}
      >
        {scenes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.meta.title}
          </option>
        ))}
      </select>
      <span className="kind-chip">{DIAGRAM_KIND_LABELS[scene.meta.diagramKind as DiagramKind]}</span>
    </div>

    <div className="topbar-group toolbar-actions">
      {scene.meta.diagramKind == "circuit" ? null :
        <><button type="button" className={`tool-toggle ${gridVisible ? "on" : ""}`} onClick={onToggleGrid} title="Toggle grid">
          <span className="tool-icon" aria-hidden="true">#</span>
          <span className="tool-label">Grid</span>
        </button><button type="button" className={`tool-toggle ${snapEnabled ? "on" : ""}`} onClick={onToggleSnap} title="Toggle snapping">
            <span className="tool-icon" aria-hidden="true">⌁</span>
            <span className="tool-label">Snap</span>
          </button></>
      }
      <button
        type="button"
        className={`tool-toggle ${panelVisible ? "on" : ""}`}
        onClick={onTogglePanel}
        title="Toggle layout panel"
      >
        <span className="tool-icon" aria-hidden="true">◧</span>
        <span className="tool-label">Panel</span>
      </button>
      <button
        type="button"
        className={`tool-toggle ${codePanelVisible ? "on" : ""}`}
        onClick={onToggleCodePanel}
        title="Toggle the Typst / CeTZ export panel"
        aria-pressed={codePanelVisible}
      >
        <span className="tool-icon" aria-hidden="true">{"</>"}</span>
        <span className="tool-label">Typst</span>
      </button>

      {scene.meta.diagramKind == "circuit" ? null : <label className="grid-size">
        step
        <input
          id="grid-step"
          name="grid-step"
          type="number"
          min={3}
          max={72}
          step={1}
          value={gridSize}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 3 && value <= 72) onGridSizeChange(value);
          }}
        />
        pt
      </label>}
    </div>

    <div className="toolbar-compact" ref={compactRef}>
      <button
        type="button"
        className={`toolbar-compact-trigger ${compactOpen ? "on" : ""}`}
        onClick={() => setCompactOpen((open) => !open)}
        title="More toolbar options"
        aria-label="More toolbar options"
        aria-haspopup="menu"
        aria-expanded={compactOpen}
      >
        ⋯
      </button>
      {compactOpen ? (
        <div className="toolbar-compact-menu" role="menu">
          {scene.meta.diagramKind === "circuit" ? null : (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={gridVisible}
                className={gridVisible ? "on" : ""}
                onClick={onToggleGrid}
              >
                <span className="toolbar-menu-icon" aria-hidden="true">#</span>
                <span>Grid</span>
                <span className="toolbar-menu-check">{gridVisible ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={snapEnabled}
                className={snapEnabled ? "on" : ""}
                onClick={onToggleSnap}
              >
                <span className="toolbar-menu-icon" aria-hidden="true">⌁</span>
                <span>Snap</span>
                <span className="toolbar-menu-check">{snapEnabled ? "✓" : ""}</span>
              </button>
              <label className="toolbar-compact-step">
                Grid step
                <span>
                  <input
                    type="number"
                    min={3}
                    max={72}
                    step={1}
                    value={gridSize}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= 3 && value <= 72) {
                        onGridSizeChange(value);
                      }
                    }}
                  />
                  pt
                </span>
              </label>
              <div className="toolbar-menu-divider" />
            </>
          )}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={panelVisible}
            className={panelVisible ? "on" : ""}
            onClick={onTogglePanel}
          >
            <span className="toolbar-menu-icon" aria-hidden="true">◧</span>
            <span>Layout panel</span>
            <span className="toolbar-menu-check">{panelVisible ? "✓" : ""}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={codePanelVisible}
            className={codePanelVisible ? "on" : ""}
            onClick={onToggleCodePanel}
          >
            <span className="toolbar-menu-icon" aria-hidden="true">{"</>"}</span>
            <span>Typst panel</span>
            <span className="toolbar-menu-check">{codePanelVisible ? "✓" : ""}</span>
          </button>
        </div>
      ) : null}
    </div>

    <div className="topbar-group zoom-group">
      <button type="button" className="icon-button" onClick={onZoomOut} title="Zoom out">
        −
      </button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button type="button" className="icon-button" onClick={onZoomIn} title="Zoom in">
        +
      </button>
      <button type="button" className="fit-button" onClick={onFit}>
        Fit
      </button>
    </div>
  </header>
  );
};
