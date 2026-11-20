import { useEffect } from "react";

interface SaveFilePromptDialogProps {
  readonly fileName: string;
  readonly onUse: () => void;
  readonly onSkip: () => void;
}

export const SaveFilePromptDialog = ({
  fileName,
  onUse,
  onSkip,
}: SaveFilePromptDialogProps) => {
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onSkip]);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSkip();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-file-prompt-title"
      >
        <div className="dialog-head">
          <strong id="save-file-prompt-title">Use this file for saving?</strong>
          <button type="button" className="icon-button" onClick={onSkip} title="Close dialog">
            ×
          </button>
        </div>
        <p>
          Use <strong>{fileName}</strong> as the save file? Pressing{" "}
          <kbd>Ctrl</kbd>+<kbd>S</kbd> will write the project to it.
        </p>
        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={onSkip}>
            Not now
          </button>
          <button type="button" className="dialog-button primary" onClick={onUse} autoFocus>
            Use as save file
          </button>
        </div>
      </div>
    </div>
  );
};
