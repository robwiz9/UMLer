import { useEffect } from "react";

export interface GitHubDecisionOption {
  readonly label: string;
  readonly tone?: "primary" | "danger";
  readonly run: () => void | Promise<void>;
}

export interface GitHubDecision {
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly options: readonly GitHubDecisionOption[];
}

interface GitHubDecisionDialogProps {
  readonly decision: GitHubDecision;
  readonly onDismiss: () => void;
  readonly onChoose: (option: GitHubDecisionOption) => void;
}

export const GitHubDecisionDialog = ({
  decision,
  onDismiss,
  onChoose,
}: GitHubDecisionDialogProps) => {
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onDismiss]);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="dialog github-decision-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="github-decision-title"
        aria-describedby="github-decision-message"
      >
        <div className="dialog-head">
          <strong id="github-decision-title">{decision.title}</strong>
          <button type="button" className="icon-button" onClick={onDismiss} title="Close dialog">
            ×
          </button>
        </div>

        <p className="dialog-warning" id="github-decision-message">
          {decision.message}
        </p>
        {decision.detail !== undefined ? (
          <p className="gh-detail">{decision.detail}</p>
        ) : null}
        <p className="gh-note">
          Changes are not auto-merged. Choose which copy to keep.
        </p>

        <div className="dialog-actions gh-decision-actions">
          <button type="button" className="dialog-button" onClick={onDismiss}>
            Cancel
          </button>
          {decision.options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`dialog-button ${option.tone ?? ""}`}
              onClick={() => onChoose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
