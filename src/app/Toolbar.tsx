import type { DiagramKind, SceneDocument } from "../model/scene.ts";
import { DIAGRAM_KIND_LABELS } from "../model/scene.ts";
import { AppMenuBar } from "./AppMenuBar.tsx";

interface ToolbarProps {
  readonly scene: SceneDocument;
  readonly scenes: readonly SceneDocument[];
  readonly activeSceneId: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canDeleteScene: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSceneChange: (sceneId: string) => void;
  readonly panelVisible: boolean;
  readonly onTogglePanel: () => void;
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
  canUndo,
  canRedo,
  canDeleteScene,
  onUndo,
  onRedo,
  onSceneChange,
  panelVisible,
  onTogglePanel,
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
}: ToolbarProps) => (
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
      <label htmlFor="scene-select">Scene</label>
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
      <button
        type="button"
        className="icon-button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        ↷
      </button>
      <button type="button" className={`tool-toggle ${gridVisible ? "on" : ""}`} onClick={onToggleGrid} title="Toggle grid">
        # Grid
      </button>
      <button type="button" className={`tool-toggle ${snapEnabled ? "on" : ""}`} onClick={onToggleSnap} title="Toggle snapping">
        ⌁ Snap
      </button>
      <button
        type="button"
        className={`tool-toggle ${panelVisible ? "on" : ""}`}
        onClick={onTogglePanel}
        title="Toggle layout panel"
      >
        ◧ Panel
      </button>
      <label className="grid-size">
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
      </label>
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
