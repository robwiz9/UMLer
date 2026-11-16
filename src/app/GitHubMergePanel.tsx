/**
 * Per-scene conflict picker used inside the GitHub decision dialog. Each row
 * offers the local copy, the remote copy, or both (the remote copy is inserted
 * as a new scene).
 */

import type { ImageAsset } from "../model/nodes.ts";
import type { MergeChoice, SceneMergeConflict } from "../model/github-project.ts";
import { DIAGRAM_KIND_LABELS } from "../model/scene.ts";
import type { GitHubCommitInfo } from "./github-client.ts";
import { ScenePreview } from "../canvas/ScenePreview.tsx";

export interface GitHubMergeData {
  readonly conflicts: readonly SceneMergeConflict[];
  readonly localAuthor: string;
  readonly localAssets: Readonly<Record<string, ImageAsset>>;
  readonly remoteAssets: Readonly<Record<string, ImageAsset>>;
  readonly remoteCommit?: GitHubCommitInfo;
  readonly confirmLabel: string;
  readonly onConfirm: (
    choices: Readonly<Record<string, MergeChoice>>,
  ) => void | Promise<void>;
}

interface GitHubMergePanelProps {
  readonly merge: GitHubMergeData;
  readonly choices: Readonly<Record<string, MergeChoice>>;
  readonly previewSceneId: string | null;
  readonly onChoice: (sceneId: string, choice: MergeChoice) => void;
  readonly onBulkChoice: (choice: MergeChoice) => void;
  readonly onTogglePreview: (sceneId: string) => void;
}

const formatDate = (value: string): string => {
  if (value.length === 0) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const sceneKindLabel = (scene: SceneMergeConflict["local"]): string =>
  DIAGRAM_KIND_LABELS[scene.meta.diagramKind];

const ChoiceCard = ({
  scene,
  side,
  selected,
  author,
  timestamp,
  onSelect,
}: {
  readonly scene: SceneMergeConflict["local"];
  readonly side: "local" | "remote";
  readonly selected: boolean;
  readonly author: string;
  readonly timestamp: string;
  readonly onSelect: () => void;
}) => (
  <label className={`gh-merge-card ${selected ? "on" : ""}`}>
    <input
      type="radio"
      name={`gh-merge-${scene.id}`}
      value={side}
      checked={selected}
      onChange={onSelect}
    />
    <span className="gh-merge-card-head">
      <span className="gh-merge-card-kicker">{side === "local" ? "Local" : "Remote"}</span>
      <span className="gh-merge-choice-indicator" aria-hidden="true">
        {selected ? "✓" : ""}
      </span>
    </span>
    <strong>{scene.meta.title}</strong>
    <span>{sceneKindLabel(scene)} · revision {scene.revision}</span>
    <span>Edited {formatDate(timestamp)}</span>
    <span>by {author}</span>
  </label>
);

export const GitHubMergePanel = ({
  merge,
  choices,
  previewSceneId,
  onChoice,
  onBulkChoice,
  onTogglePreview,
}: GitHubMergePanelProps) => (
  <div className="gh-merge-panel">
    <div className="gh-merge-summary">
      <div>
        <strong>
          {merge.conflicts.length} conflicting{" "}
          {merge.conflicts.length === 1 ? "scene" : "scenes"}
        </strong>
        <span>
          {merge.conflicts.length === 1 ? "has" : "have"} changes on both sides. Select which of these versions should be kept.
        </span>
      </div>
      <div className="gh-merge-bulk">
        <button type="button" className="gh-link-button" onClick={() => onBulkChoice("local")}>
          All local
        </button>
        <button type="button" className="gh-link-button" onClick={() => onBulkChoice("remote")}>
          All remote
        </button>
        <button type="button" className="gh-link-button" onClick={() => onBulkChoice("both")}>
          Keep all
        </button>
      </div>
    </div>

    {/* {merge.remoteCommit !== undefined ? (
      <p className="gh-merge-commit">
        Remote commit <code>{shortSha(merge.remoteCommit.sha)}</code> by{" "}
        <strong>{merge.remoteCommit.authorName}</strong> ·{" "}
        {formatDate(merge.remoteCommit.date)}
        {merge.remoteCommit.message.length > 0 ? (
          <span className="gh-merge-commit-message">{merge.remoteCommit.message}</span>
        ) : null}
      </p>
    ) : null} */}

    <div className="gh-merge-grid" role="group" aria-label="Conflicting scenes">
      {/* <div className="gh-merge-grid-head" aria-hidden="true">
        <span>Local scene</span>
        <span>Remote scene</span>
        <span>Keep both</span>
      </div> */}
      {merge.conflicts.map((conflict) => {
        const choice = choices[conflict.sceneId] ?? null;
        const previewOpen = previewSceneId === conflict.sceneId;
        return (
          <div className="gh-merge-row" key={conflict.sceneId}>
            <ChoiceCard
              scene={conflict.local}
              side="local"
              selected={choice === "local"}
              author={merge.localAuthor}
              timestamp={conflict.local.meta.updatedAt}
              onSelect={() => onChoice(conflict.sceneId, "local")}
            />
            <ChoiceCard
              scene={conflict.remote}
              side="remote"
              selected={choice === "remote"}
              author={merge.remoteCommit?.authorName ?? "Unknown author"}
              timestamp={merge.remoteCommit?.date ?? conflict.remote.meta.updatedAt}
              onSelect={() => onChoice(conflict.sceneId, "remote")}
            />
            <label className={`gh-merge-card gh-merge-both ${choice === "both" ? "on" : ""}`}>
              <input
                type="radio"
                name={`gh-merge-${conflict.sceneId}`}
                value="both"
                checked={choice === "both"}
                onChange={() => onChoice(conflict.sceneId, "both")}
              />
              <span className="gh-merge-card-head">
                <span className="gh-merge-card-kicker">Both</span>
                <span className="gh-merge-choice-indicator" aria-hidden="true">
                  {choice === "both" ? "✓" : ""}
                </span>
              </span>
              <strong>Keep local + remote</strong>
              <span>Inserts the remote copy as a new scene.</span>
            </label>
            <button
              type="button"
              className="gh-merge-preview-toggle"
              onClick={() => onTogglePreview(conflict.sceneId)}
              aria-expanded={previewOpen}
            >
              {previewOpen ? "Hide canvas previews" : "Show canvas previews"}
            </button>
            {previewOpen ? (
              <div className="gh-merge-previews">
                <div>
                  <span className="gh-merge-preview-label">Local canvas</span>
                  <ScenePreview
                    scene={conflict.local}
                    assets={merge.localAssets}
                    label={`Local preview of ${conflict.local.meta.title}`}
                  />
                </div>
                <div>
                  <span className="gh-merge-preview-label">Remote canvas</span>
                  <ScenePreview
                    scene={conflict.remote}
                    assets={merge.remoteAssets}
                    label={`Remote preview of ${conflict.remote.meta.title}`}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  </div>
);
