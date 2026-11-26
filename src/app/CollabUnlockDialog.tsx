import { useEffect, useRef, useState } from "react";
import type { CollaborationStatus } from "../collab/use-collaboration.ts";

interface CollabUnlockDialogProps {
  readonly room: string | null;
  readonly httpUrl: string | null;
  readonly active: boolean;
  readonly canDisable: boolean;
  readonly status: CollaborationStatus;
  readonly onClose: () => void;
  readonly onUnlock: (administratorCode: string) => Promise<void>;
  readonly onDisable: () => void;
}

const STATUS_LABELS: Record<CollaborationStatus, string> = {
  disabled: "off",
  connecting: "connecting",
  connected: "connected",
  reconnecting: "reconnecting",
  error: "error",
};

export const CollabUnlockDialog = ({
  room,
  httpUrl,
  active,
  canDisable,
  status,
  onClose,
  onUnlock,
  onDisable,
}: CollabUnlockDialogProps) => {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  const ready = room !== null && httpUrl !== null;
  const submit = async (): Promise<void> => {
    if (code.trim().length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(code);
      setCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The administrator code was rejected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog collab-unlock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collab-unlock-title"
      >
        <div className="dialog-head">
          <strong id="collab-unlock-title">Live collaboration</strong>
          <button type="button" className="icon-button" onClick={onClose} title="Close dialog">
            ×
          </button>
        </div>

        {!ready ? (
          <p className="dialog-warning">
            {room === null
              ? "Open a GitHub-backed project to use live collaboration."
              : "The live collaboration server URL is not configured for this deployment. Set VITE_COLLAB_URL and reload."}
          </p>
        ) : (
          <>
            <p className="collab-unlock-note">
              {active
                ? "Live editing is enabled for this project on this browser."
                : "Live editing is off. Enter the administrator code to enable it for this project."}
            </p>
            <dl className="collab-unlock-meta">
              <dt>Project</dt>
              <dd title={room}>{room}</dd>
              <dt>Status</dt>
              <dd>{STATUS_LABELS[status]}</dd>
            </dl>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="field-label">
                Administrator code
                <input
                  ref={inputRef}
                  id="collab-unlock-code"
                  name="collab-unlock-code"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Enter code"
                />
              </label>
              {error !== null ? <p className="dialog-warning">{error}</p> : null}
              <div className="dialog-actions">
                <button type="button" className="dialog-button" onClick={onClose}>
                  Cancel
                </button>
                {active && canDisable ? (
                  <button
                    type="button"
                    className="dialog-button danger"
                    onClick={() => {
                      onDisable();
                      onClose();
                    }}
                  >
                    Disable on this browser
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="dialog-button primary"
                  disabled={busy || code.trim().length === 0}
                >
                  {busy ? "Checking…" : active ? "Update code" : "Unlock"}
                </button>
              </div>
            </form>
            <p className="collab-unlock-hint">
              Collaborators enter the same code once on their own browser. The code is never
              sent to the room; only a project-specific key derived from it is used.
            </p>
          </>
        )}

        {!ready ? (
          <div className="dialog-actions">
            <button type="button" className="dialog-button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
