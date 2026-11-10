import { useEffect, useRef, useState } from "react";

interface AppMenuBarProps {
  readonly canDeleteScene: boolean;
  readonly canSaveToGitHub: boolean;
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
  readonly onPurgeUnusedImages: () => void;
  readonly unusedImageCount: number;
}

type MenuName = "file" | "scene";

export const AppMenuBar = ({
  canDeleteScene,
  canSaveToGitHub,
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
  onPurgeUnusedImages,
  unusedImageCount,
}: AppMenuBarProps) => {
  const [open, setOpen] = useState<MenuName | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open === null) return;
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (action: () => void): void => {
    setOpen(null);
    action();
  };

  return (
    <nav className="menu-bar" ref={rootRef} aria-label="Application menu">
      <div className="menu-root">
        <button
          type="button"
          className={`menu-trigger ${open === "file" ? "on" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open === "file"}
          onClick={() => setOpen((current) => (current === "file" ? null : "file"))}
        >
          File
        </button>
        {open === "file" ? (
          <div className="menu-dropdown" role="menu">
            <button type="button" role="menuitem" onClick={() => choose(onNewProject)}>
              New project…
            </button>
            <button type="button" role="menuitem" onClick={() => choose(onOpenFromGitHub)}>
              Open from GitHub…
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canSaveToGitHub}
              onClick={() => choose(onSaveToGitHub)}
            >
              Save to GitHub
              <span className="menu-shortcut">Ctrl+S</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={unusedImageCount === 0}
              onClick={() => choose(onPurgeUnusedImages)}
            >
              Purge unused images
              {unusedImageCount > 0 ? (
                <span className="menu-shortcut">{unusedImageCount}</span>
              ) : null}
            </button>
            <div className="menu-divider" />
            <button type="button" role="menuitem" onClick={() => choose(onExportScene)}>
              Export scene…
            </button>
            <button type="button" role="menuitem" onClick={() => choose(onImportScene)}>
              Import scene…
            </button>
            <div className="menu-divider" />
            <button type="button" role="menuitem" onClick={() => choose(onExportProject)}>
              Export project…
            </button>
            <button type="button" role="menuitem" onClick={() => choose(onImportProject)}>
              Import project…
            </button>
          </div>
        ) : null}
      </div>

      <div className="menu-root">
        <button
          type="button"
          className={`menu-trigger ${open === "scene" ? "on" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open === "scene"}
          onClick={() => setOpen((current) => (current === "scene" ? null : "scene"))}
        >
          Scene
        </button>
        {open === "scene" ? (
          <div className="menu-dropdown" role="menu">
            <button type="button" role="menuitem" onClick={() => choose(onNewScene)}>
              New scene…
            </button>
            <button type="button" role="menuitem" onClick={() => choose(onRenameScene)}>
              Rename scene…
            </button>
            <button type="button" role="menuitem" onClick={() => choose(onDuplicateScene)}>
              Duplicate scene
            </button>
            <div className="menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="danger"
              disabled={!canDeleteScene}
              onClick={() => choose(onDeleteScene)}
            >
              Delete this scene…
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
};
