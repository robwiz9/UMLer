import { useEffect, useRef, useState } from "react";
import type { SceneDocument } from "../model/scene.ts";
import type { ServerUser } from "../collab/protocol.ts";
import type { CollaborationStatus } from "../collab/use-collaboration.ts";

interface CollaborationStatusMenuProps {
  readonly users: readonly ServerUser[];
  readonly selfId: string | null;
  readonly leaderId: string | null;
  readonly status: CollaborationStatus;
  readonly error: string | null;
  readonly activeSceneId: string;
  readonly scenes: readonly SceneDocument[];
  readonly suspended: boolean;
  readonly canRejoin: boolean;
  readonly canDisable: boolean;
  readonly viewAsId: string | null;
  readonly onViewAs: (clientId: string) => void;
  readonly onStopViewAs: () => void;
  readonly onLeave: () => void;
  readonly onRejoin: () => void;
  readonly onDisable: () => void;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const statusLabel = (
  status: CollaborationStatus,
  suspended: boolean,
  count: number,
): string => {
  if (suspended) return "Live off";
  if (status === "connected") return `${count} live`;
  if (status === "connecting") return "Connecting";
  if (status === "reconnecting") return "Reconnecting";
  if (status === "error") return "Live error";
  return "Live off";
};

const UserAvatar = ({
  user,
  self,
  leader,
}: {
  readonly user: ServerUser["user"];
  readonly self: boolean;
  readonly leader: boolean;
}) => (
  <span
    className={`collab-avatar ${self ? "self" : ""} ${leader ? "leader" : ""}`}
    style={{ background: user.color }}
    title={`${user.name}${self ? " (you)" : ""}`}
  >
    {user.avatarUrl !== undefined ? (
      <img src={user.avatarUrl} alt="" draggable={false} />
    ) : (
      initials(user.name)
    )}
  </span>
);

export const CollaborationStatusMenu = ({
  users,
  selfId,
  leaderId,
  status,
  error,
  activeSceneId,
  scenes,
  suspended,
  canRejoin,
  canDisable,
  viewAsId,
  onViewAs,
  onStopViewAs,
  onLeave,
  onRejoin,
  onDisable,
}: CollaborationStatusMenuProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const sceneTitle = (sceneId: string): string =>
    scenes.find((entry) => entry.id === sceneId)?.meta.title ?? sceneId;
  const current = users.filter((entry) => entry.sceneId === activeSceneId);
  const elsewhere = users.filter((entry) => entry.sceneId !== activeSceneId);
  const visible = current.slice(0, 3);
  const viewingUser =
    viewAsId === null ? undefined : users.find((entry) => entry.clientId === viewAsId);
  const viewing = viewAsId !== null;
  const label = viewing ? "Viewing" : statusLabel(status, suspended, users.length);
  const canLeave = !suspended && status !== "disabled";
  const title = viewingUser !== undefined
    ? `Viewing ${viewingUser.user.name}. Pan the canvas to stop.`
    : users.length > 0
      ? users
          .map((entry) => {
            const flags = [
              entry.clientId === selfId ? "you" : "",
              entry.clientId === leaderId ? "leader" : "",
            ].filter(Boolean).join(", ");
            return `${entry.user.name}${flags.length > 0 ? ` (${flags})` : ""} · ${sceneTitle(entry.sceneId)}`;
          })
          .join("\n")
      : "Live collaboration";

  return (
    <div className="collab-status" ref={rootRef}>
      <button
        type="button"
        className={`collab-status-button ${suspended ? "disabled" : status} ${viewing ? "viewing" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Live collaboration: ${label}`}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`collab-dot ${suspended ? "disabled" : status}`} />
        <span className="collab-status-label">{label}</span>
        {visible.length > 0 ? (
          <span className="collab-avatars">
            {visible.map((entry) => (
              <UserAvatar
                key={entry.clientId}
                user={entry.user}
                self={entry.clientId === selfId}
                leader={entry.clientId === leaderId}
              />
            ))}
            {current.length > visible.length ? (
              <span className="collab-more">+{current.length - visible.length}</span>
            ) : null}
          </span>
        ) : null}
        {elsewhere.length > 0 ? (
          <span className="collab-status-elsewhere">+{elsewhere.length}</span>
        ) : null}
      </button>

      {open ? (
        <div className="collab-menu" role="menu" aria-label="Live collaboration">
          <div className="collab-menu-head">
            <strong>Live collaboration</strong>
            <span className={`collab-menu-state ${suspended ? "disabled" : status}`}>
              {label}
            </span>
          </div>

          {users.length > 0 ? (
            <div className="collab-menu-list">
              {users.map((entry) => (
                <button
                  type="button"
                  role="menuitem"
                  key={entry.clientId}
                  className={`collab-menu-user ${viewAsId === entry.clientId ? "viewing" : ""}`}
                  disabled={entry.clientId === selfId}
                  title={
                    entry.clientId === selfId
                      ? "This is your session"
                      : "View this user's scene and canvas position"
                  }
                  onClick={() => {
                    if (entry.clientId === selfId) return;
                    setOpen(false);
                    onViewAs(entry.clientId);
                  }}
                >
                  <UserAvatar
                    user={entry.user}
                    self={entry.clientId === selfId}
                    leader={entry.clientId === leaderId}
                  />
                  <span className="collab-menu-user-name">
                    {entry.user.name}
                    {entry.clientId === selfId ? " (you)" : ""}
                    {entry.clientId === leaderId ? " · leader" : ""}
                  </span>
                  <span
                    className={`collab-menu-user-scene ${viewAsId === entry.clientId ? "viewing" : ""}`}
                    title={sceneTitle(entry.sceneId)}
                  >
                    {viewAsId === entry.clientId ? "viewing" : sceneTitle(entry.sceneId)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="collab-menu-empty">
              {suspended
                ? "You left the session. Rejoin to edit with the others."
                : "No collaborators are connected."}
            </p>
          )}

          {error !== null && !suspended ? (
            <p className="collab-menu-error">{error}</p>
          ) : null}

          <div className="collab-menu-divider" />
          {viewing ? (
            <button
              type="button"
              role="menuitem"
              className="collab-menu-action"
              onClick={() => {
                setOpen(false);
                onStopViewAs();
              }}
            >
              Stop viewing
            </button>
          ) : null}
          {canLeave ? (
            <button
              type="button"
              role="menuitem"
              className="collab-menu-action"
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
            >
              Leave session
            </button>
          ) : null}
          {suspended ? (
            <button
              type="button"
              role="menuitem"
              className="collab-menu-action"
              disabled={!canRejoin}
              onClick={() => {
                setOpen(false);
                onRejoin();
              }}
            >
              Rejoin session
            </button>
          ) : null}
          {canDisable ? (
            <button
              type="button"
              role="menuitem"
              className="collab-menu-action danger"
              onClick={() => {
                setOpen(false);
                onDisable();
              }}
            >
              Disable on this browser
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
