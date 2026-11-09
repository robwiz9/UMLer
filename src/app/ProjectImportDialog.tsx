import { useEffect } from "react";

interface ProjectImportDialogProps {
  readonly fileName: string;
  readonly currentSceneCount: number;
  readonly importedSceneCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export const ProjectImportDialog = ({
  fileName,
  currentSceneCount,
  importedSceneCount,
  onCancel,
  onConfirm,
}: ProjectImportDialogProps) => {
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onCancel]);

  const currentLabel = currentSceneCount === 1 ? "scene" : "scenes";
  const importedLabel = importedSceneCount === 1 ? "scene" : "scenes";

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-import-title"
      >
        <div className="dialog-head">
          <strong id="project-import-title">Import project</strong>
          <button type="button" className="icon-button" onClick={onCancel} title="Close dialog">
            ×
          </button>
        </div>

        <p className="dialog-warning">
          <strong>{fileName}</strong> replaces the {currentSceneCount} open {currentLabel} with{" "}
          {importedSceneCount} imported {importedLabel}. This cannot be undone.
        </p>

        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="dialog-button danger" onClick={onConfirm}>
            Replace project
          </button>
        </div>
      </div>
    </div>
  );
};
