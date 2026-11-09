import { useEffect, useRef, useState } from "react";

interface AppMenuBarProps {
  readonly canDeleteScene: boolean;
  readonly onExportScene: () => void;
  readonly onImportScene: () => void;
  readonly onExportProject: () => void;
  readonly onImportProject: () => void;
  readonly onNewScene: () => void;
  readonly onRenameScene: () => void;
  readonly onDuplicateScene: () => void;
  readonly onDeleteScene: () => void;
}

type MenuName = "file" | "scene";

export const AppMenuBar = ({
  canDeleteScene,
  onExportScene,
  onImportScene,
  onExportProject,
  onImportProject,
  onNewScene,
  onRenameScene,
  onDuplicateScene,
  onDeleteScene,
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
