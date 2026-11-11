import { useEffect, useRef, useState } from "react";
import type { DiagramKind } from "../model/scene.ts";
import { DIAGRAM_KIND_LABELS } from "../model/scene.ts";

export type SceneDialogMode = "new" | "new-project" | "rename" | "delete";
export type SceneStartMode = "template" | "empty";

interface SceneDialogProps {
  readonly mode: SceneDialogMode;
  readonly sceneTitle: string;
  readonly initialName: string;
  readonly initialKind: DiagramKind;
  readonly onClose: () => void;
  readonly onSubmit: (
    name: string,
    diagramKind: DiagramKind,
    startMode: SceneStartMode,
  ) => void;
}

const KIND_ORDER: readonly DiagramKind[] = [
  "er",
  "uml-class",
  "uml-object",
  "uml-use-case",
  "uml-sequence",
  "uml-communication",
  "uml-state-machine",
];

const SHORT_LABELS: Record<DiagramKind, string> = {
  er: "ER",
  "uml-class": "Class",
  "uml-object": "Object",
  "uml-use-case": "Use case",
  "uml-sequence": "Sequence",
  "uml-communication": "Comm.",
  "uml-state-machine": "State",
};

const defaultSceneName = (kind: DiagramKind): string =>
  `Untitled ${DIAGRAM_KIND_LABELS[kind]} diagram`;

const DiagramTypeIcon = ({ kind }: { readonly kind: DiagramKind }) => {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "er":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <rect x="5" y="6" width="18" height="14" rx="1" {...common} />
          <line x1="5" y1="11" x2="23" y2="11" {...common} />
          <rect x="11" y="15" width="18" height="13" rx="1" {...common} fill="#fff" />
          <line x1="11" y1="20" x2="29" y2="20" {...common} />
        </svg>
      );
    case "uml-class":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <rect x="6" y="5" width="22" height="24" rx="1" {...common} />
          <line x1="6" y1="11" x2="28" y2="11" {...common} />
          <line x1="6" y1="21" x2="28" y2="21" {...common} />
          <line x1="10" y1="16" x2="20" y2="16" {...common} />
          <line x1="10" y1="26" x2="22" y2="26" {...common} />
        </svg>
      );
    case "uml-object":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <rect x="6" y="9" width="22" height="16" rx="1" {...common} />
          <text x="17" y="20" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">:A</text>
        </svg>
      );
    case "uml-use-case":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <ellipse cx="19" cy="13" rx="11" ry="7" {...common} />
          <circle cx="8" cy="23" r="2.4" {...common} />
          <line x1="8" y1="25.5" x2="8" y2="30" {...common} />
          <line x1="5" y1="27" x2="11" y2="27" {...common} />
          <line x1="14" y1="18" x2="10" y2="23" {...common} />
        </svg>
      );
    case "uml-sequence":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <rect x="4" y="5" width="10" height="6" rx="1" {...common} />
          <rect x="20" y="5" width="10" height="6" rx="1" {...common} />
          <line x1="9" y1="11" x2="9" y2="29" strokeDasharray="3 3" {...common} />
          <line x1="25" y1="11" x2="25" y2="29" strokeDasharray="3 3" {...common} />
          <line x1="9" y1="17" x2="24" y2="17" {...common} />
          <polyline points="21,14 24,17 21,20" {...common} />
        </svg>
      );
    case "uml-communication":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <rect x="3" y="7" width="12" height="8" rx="1" {...common} />
          <rect x="19" y="21" width="12" height="8" rx="1" {...common} />
          <line x1="15" y1="11" x2="21" y2="25" {...common} />
          <line x1="9" y1="15" x2="9" y2="23" {...common} />
        </svg>
      );
    case "uml-state-machine":
      return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <rect x="4" y="9" width="16" height="11" rx="5" {...common} />
          <circle cx="26" cy="24" r="4" {...common} />
          <circle cx="26" cy="24" r="1.6" fill="currentColor" />
          <line x1="20" y1="15" x2="24" y2="21" {...common} />
        </svg>
      );
  }
};

export const SceneDialog = ({
  mode,
  sceneTitle,
  initialName,
  initialKind,
  onClose,
  onSubmit,
}: SceneDialogProps) => {
  const [name, setName] = useState(
    mode === "new" || mode === "new-project"
      ? defaultSceneName(initialKind)
      : initialName,
  );
  const [nameEdited, setNameEdited] = useState(false);
  const [diagramKind, setDiagramKind] = useState<DiagramKind>(initialKind);
  const [startMode, setStartMode] = useState<SceneStartMode>("template");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode === "delete") return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const heading =
    mode === "new"
      ? "New scene"
      : mode === "new-project"
        ? "New project"
        : mode === "rename"
          ? "Rename scene"
          : "Delete scene";
  const actionLabel =
    mode === "new"
      ? "Create scene"
      : mode === "new-project"
        ? "Create project"
        : mode === "rename"
          ? "Rename"
          : "Delete scene";

  const chooseKind = (kind: DiagramKind): void => {
    setDiagramKind(kind);
    if (!nameEdited) setName(defaultSceneName(kind));
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${mode === "new" || mode === "new-project" ? "scene-create-dialog" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-dialog-title"
      >
        <div className="dialog-head">
          <strong id="scene-dialog-title">{heading}</strong>
          <button type="button" className="icon-button" onClick={onClose} title="Close dialog">
            ×
          </button>
        </div>

        {mode === "delete" ? (
          <p className="dialog-warning">
            Delete <strong>{sceneTitle}</strong>? This cannot be undone.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (trimmed.length === 0) return;
              onSubmit(trimmed, diagramKind, startMode);
            }}
          >
            {mode === "new-project" ? (
              <p className="dialog-warning">
                This starts a new project and replaces the scenes currently open.
              </p>
            ) : null}

            {mode === "new" || mode === "new-project" ? (
              <>
                <div className="dialog-section-label">Diagram type</div>
                <div className="diagram-type-grid" role="group" aria-label="Diagram type">
                  {KIND_ORDER.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`diagram-type-button ${diagramKind === kind ? "on" : ""}`}
                      title={DIAGRAM_KIND_LABELS[kind]}
                      aria-pressed={diagramKind === kind}
                      onClick={() => chooseKind(kind)}
                    >
                      <DiagramTypeIcon kind={kind} />
                      <span>{SHORT_LABELS[kind]}</span>
                    </button>
                  ))}
                </div>

                <div className="dialog-section-label">Start with</div>
                <div className="start-mode-row" role="group" aria-label="Starting content">
                  <button
                    type="button"
                    className={`start-mode ${startMode === "template" ? "on" : ""}`}
                    onClick={() => setStartMode("template")}
                  >
                    Template
                    <small>Built-in example</small>
                  </button>
                  <button
                    type="button"
                    className={`start-mode ${startMode === "empty" ? "on" : ""}`}
                    onClick={() => setStartMode("empty")}
                  >
                    Empty
                    <small>Blank canvas</small>
                  </button>
                </div>
              </>
            ) : null}

            <label className="field-label">
              {mode === "new-project" ? "Starting scene name" : "Scene name"}
              <input
                ref={inputRef}
                id="scene-dialog-name"
                name="scene-dialog-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameEdited(true);
                }}
                placeholder="Untitled diagram"
              />
            </label>

            <div className="dialog-actions">
              <button type="button" className="dialog-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="dialog-button primary"
                disabled={name.trim().length === 0}
              >
                {actionLabel}
              </button>
            </div>
          </form>
        )}

        {mode === "delete" ? (
          <div className="dialog-actions">
            <button type="button" className="dialog-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-button danger"
              onClick={() => onSubmit(sceneTitle, initialKind, "empty")}
            >
              {actionLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
