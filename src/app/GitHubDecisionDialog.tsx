import { useEffect, useMemo, useState } from "react";
import type { MergeChoice } from "../model/github-project.ts";
import { GitHubMergePanel, type GitHubMergeData } from "./GitHubMergePanel.tsx";

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
  /** When present, the dialog offers per-scene conflict resolution. */
  readonly merge?: GitHubMergeData;
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
  const merge = decision.merge;
  const defaults = useMemo<Record<string, MergeChoice>>(
    () =>
      Object.fromEntries(
        (merge?.conflicts ?? []).map((conflict) => [conflict.sceneId, null]),
      ),
    [merge],
  );
  const [choices, setChoices] = useState<Record<string, MergeChoice>>(defaults);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  useEffect(() => {
    setChoices(defaults);
    setPreviewSceneId(null);
    setMergeError(null);
  }, [defaults]);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !mergeBusy) onDismiss();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [mergeBusy, onDismiss]);

  const chooseAll = (choice: MergeChoice): void => {
    if (merge === undefined) return;
    setChoices(
      Object.fromEntries(
        merge.conflicts.map((conflict) => [conflict.sceneId, choice]),
      ),
    );
  };

  const confirmMerge = async (): Promise<void> => {
    if (merge === undefined || mergeBusy) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      await merge.onConfirm(choices);
    } catch (error) {
      setMergeError(
        error instanceof Error ? error.message : "The merge could not be completed.",
      );
    } finally {
      setMergeBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !mergeBusy) onDismiss();
      }}
    >
      <div
        className={`dialog github-decision-dialog ${merge === undefined ? "" : "merge"}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="github-decision-title"
        aria-describedby="github-decision-message"
      >
        <div className="dialog-head">
          <strong id="github-decision-title">{decision.title}</strong>
          <button
            type="button"
            className="icon-button"
            onClick={onDismiss}
            title="Close dialog"
            disabled={mergeBusy}
          >
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
          {merge === undefined
            ? "Changes are not auto-merged. Choose which copy to keep."
            : null}
        </p>

        {merge !== undefined ? (
          <GitHubMergePanel
            merge={merge}
            choices={choices}
            previewSceneId={previewSceneId}
            onChoice={(sceneId, choice) =>
              setChoices((current) => ({ ...current, [sceneId]: choice }))}
            onBulkChoice={chooseAll}
            onTogglePreview={(sceneId) =>
              setPreviewSceneId((current) => (current === sceneId ? null : sceneId))}
          />
        ) : null}

        {mergeError !== null ? (
          <p className="gh-error" role="alert">
            {mergeError}
          </p>
        ) : null}

        <div className="dialog-actions gh-decision-actions">
          <button type="button" className="dialog-button" onClick={onDismiss} disabled={mergeBusy}>
            Cancel
          </button>
          {merge === undefined ? (
            decision.options.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`dialog-button ${option.tone ?? ""}`}
                onClick={() => onChoose(option)}
              >
                {option.label}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="dialog-button primary"
              onClick={() => void confirmMerge()}
              disabled={mergeBusy || merge.conflicts.find((c) => choices[c.sceneId] == null) != undefined}
            >
              {mergeBusy ? "Merging…" : merge.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
