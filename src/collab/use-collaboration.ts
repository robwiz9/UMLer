/**
 * React bridge between the editor's immutable project state and a live room.
 *
 * Local edits stay optimistic in React. A debounced structural diff is sent as
 * confirmed field/array patches. The room numbers them, broadcasts them in
 * order, and that order decides overlapping-field winners.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageAsset } from "../model/nodes.ts";
import type { SceneDocument } from "../model/scene.ts";
import {
  isServerMessage,
  withSelfPresence,
  type ClientMessage,
  type CollabProject,
  type CollabUser,
  type CursorPoint,
  type PresenceRect,
  type PresenceSelection,
  type ServerMessage,
  type ServerUser,
} from "./protocol.ts";
import { applyPatches, diffProject } from "./patch.ts";

export type CollaborationStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface UseCollaborationOptions {
  readonly enabled: boolean;
  readonly url: string | null;
  readonly roomId: string | null;
  readonly token?: string | null;
  /** Per-room administrator key derived from the hidden administrator code. */
  readonly key?: string | null;
  readonly user: CollabUser;
  readonly scenes: readonly SceneDocument[];
  readonly assets: Readonly<Record<string, ImageAsset>>;
  readonly activeSceneId: string;
  readonly onRemoteProject: (project: CollabProject) => void;
  readonly onNotice?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

export interface CollaborationHandle {
  readonly status: CollaborationStatus;
  readonly selfId: string | null;
  readonly users: readonly ServerUser[];
  readonly leaderId: string | null;
  readonly isLeader: boolean;
  readonly error: string | null;
  readonly publishPresence: (
    sceneId: string,
    cursor: CursorPoint | null,
    selection?: PresenceSelection | null,
    editing?: string | null,
  ) => void;
  readonly publishViewCenter: (sceneId: string, viewCenter: CursorPoint | null) => void;
  readonly publishMarquee: (sceneId: string, marquee: PresenceRect | null) => void;
}

const CONNECT_RETRY_MS = 1800;
const LOCAL_DEBOUNCE_MS = 240;
const PRESENCE_THROTTLE_MS = 40;

const mergeUser = (
  users: readonly ServerUser[],
  next: ServerUser,
): readonly ServerUser[] => {
  const index = users.findIndex((entry) => entry.clientId === next.clientId);
  if (index < 0) return [...users, next];
  const copy = [...users];
  copy[index] = next;
  return copy;
};

const parseServerMessage = (data: unknown): ServerMessage | null => {
  try {
    const text = typeof data === "string"
      ? data
      : new TextDecoder().decode(data as ArrayBuffer);
    const parsed: unknown = JSON.parse(text);
    return isServerMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const useCollaboration = (
  options: UseCollaborationOptions,
): CollaborationHandle => {
  const {
    enabled,
    url,
    roomId,
    token,
    key,
    user,
    scenes,
    assets,
    activeSceneId,
    onRemoteProject,
    onNotice,
    onError,
  } = options;

  const [status, setStatus] = useState<CollaborationStatus>(
    enabled && url !== null && roomId !== null ? "connecting" : "disabled",
  );
  const [selfId, setSelfId] = useState<string | null>(null);
  const [users, setUsers] = useState<readonly ServerUser[]>([]);
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const joinedRef = useRef(false);
  const selfIdRef = useRef<string | null>(null);
  const scenesRef = useRef(scenes);
  const assetsRef = useRef(assets);
  const activeSceneRef = useRef(activeSceneId);
  const serverProjectRef = useRef<CollabProject | null>(null);
  const currentProjectRef = useRef<CollabProject>({ scenes, assets });
  const seqRef = useRef(0);
  const pendingActionRef = useRef<string | null>(null);
  const pendingDirtyRef = useRef(false);
  const sendTimerRef = useRef<number | null>(null);
  const presenceTimerRef = useRef<number | null>(null);
  const queuedPresenceRef = useRef<{
    sceneId: string;
    cursor: CursorPoint | null;
    selection?: PresenceSelection | null;
    editing?: string | null;
    viewCenter?: CursorPoint | null;
    marquee?: PresenceRect | null;
  } | null>(null);
  const lastPresenceRef = useRef<{
    sceneId: string;
    cursor: CursorPoint | null;
    selection: PresenceSelection | null;
    editing: string | null;
    viewCenter: CursorPoint | null;
    marquee: PresenceRect | null;
  } | null>(null);
  const marqueeActiveRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const joinedOnceRef = useRef(false);
  const onRemoteProjectRef = useRef(onRemoteProject);
  const onNoticeRef = useRef(onNotice);
  const onErrorRef = useRef(onError);

  onRemoteProjectRef.current = onRemoteProject;
  onNoticeRef.current = onNotice;
  onErrorRef.current = onError;
  scenesRef.current = scenes;
  assetsRef.current = assets;
  activeSceneRef.current = activeSceneId;
  currentProjectRef.current = { scenes, assets };

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN || !joinedRef.current) {
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const sendQueuedPresence = useCallback((): void => {
    if (presenceTimerRef.current !== null) {
      window.clearTimeout(presenceTimerRef.current);
      presenceTimerRef.current = null;
    }
    const queued = queuedPresenceRef.current;
    if (queued === null) return;
    queuedPresenceRef.current = null;
    send({
      type: "presence",
      presence: {
        sceneId: queued.sceneId,
        cursor: queued.cursor,
        selection: queued.selection ?? null,
        editing: queued.editing ?? null,
        viewCenter: queued.viewCenter ?? null,
        marquee: queued.marquee ?? null,
      },
    });
  }, [send]);

  const publishPresence = useCallback(
    (
      sceneId: string,
      cursor: CursorPoint | null,
      selection?: PresenceSelection | null,
      editing?: string | null,
      viewCenter?: CursorPoint | null,
      marquee?: PresenceRect | null,
    ) => {
      const nextSelection = selection ?? null;
      const nextEditing = editing ?? null;
      const previous = lastPresenceRef.current;
      // Cursor-only updates preserve the last published view centre. A scene
      // change clears it until the new camera position is published.
      const nextViewCenter =
        viewCenter !== undefined
          ? viewCenter
          : previous !== null && previous.sceneId === sceneId
            ? previous.viewCenter
            : null;
      const nextMarquee =
        marquee !== undefined
          ? marquee
          : previous !== null && previous.sceneId === sceneId
            ? previous.marquee
            : null;
      lastPresenceRef.current = {
        sceneId,
        cursor,
        selection: nextSelection,
        editing: nextEditing,
        viewCenter: nextViewCenter,
        marquee: nextMarquee,
      };
      // Presence is broadcast to the other clients only, so update our own entry
      // locally. Without this, a tab that changes scene keeps showing its stale
      // join scene and appears in its own "elsewhere" group.
      setUsers((current) =>
        withSelfPresence(
          current,
          selfIdRef.current,
          sceneId,
          nextSelection,
          nextEditing,
        ),
      );
      marqueeActiveRef.current = nextMarquee !== null;
      queuedPresenceRef.current = {
        sceneId,
        cursor,
        selection,
        editing,
        viewCenter: nextViewCenter,
        marquee: nextMarquee,
      };
      if (presenceTimerRef.current !== null) return;
      presenceTimerRef.current = window.setTimeout(() => {
        presenceTimerRef.current = null;
        sendQueuedPresence();
      }, PRESENCE_THROTTLE_MS);
    },
    [sendQueuedPresence],
  );

  /**
   * Publish the world-space view centre without clearing the last cursor or
   * field focus. Used by camera/pan updates and the "view as" follower.
   */
  const publishViewCenter = useCallback(
    (sceneId: string, viewCenter: CursorPoint | null): void => {
      const previous = lastPresenceRef.current;
      if (previous !== null && previous.sceneId === sceneId) {
        publishPresence(
          sceneId,
          previous.cursor,
          previous.selection,
          previous.editing,
          viewCenter,
        );
        return;
      }
      publishPresence(sceneId, null, null, null, viewCenter);
    },
    [publishPresence],
  );

  /** Publish or clear the live drag-to-select rectangle. */
  const publishMarquee = useCallback(
    (sceneId: string, marquee: PresenceRect | null): void => {
      const wasActive = marqueeActiveRef.current;
      const previous = lastPresenceRef.current;
      if (previous !== null && previous.sceneId === sceneId) {
        publishPresence(
          sceneId,
          previous.cursor,
          previous.selection,
          previous.editing,
          previous.viewCenter,
          marquee,
        );
      } else {
        publishPresence(sceneId, null, null, null, null, marquee);
      }
      // Send the first rectangle and the release immediately so a short drag
      // cannot be coalesced away by the presence throttle.
      if ((marquee !== null) !== wasActive) sendQueuedPresence();
    },
    [publishPresence, sendQueuedPresence],
  );

  const scheduleFlush = useCallback((delay = LOCAL_DEBOUNCE_MS): void => {    // A real debounce: every local change restarts the idle window, so text is
    // confirmed after the user pauses rather than being streamed per keystroke.
    if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
    sendTimerRef.current = window.setTimeout(() => {
      sendTimerRef.current = null;
      if (!joinedRef.current) return;
      if (pendingActionRef.current !== null) {
        pendingDirtyRef.current = true;
        return;
      }
      const server = serverProjectRef.current;
      if (server === null) return;
      const patches = diffProject(server, currentProjectRef.current);
      if (patches.length === 0) return;
      const actionId = crypto.randomUUID();
      const sent = send({
        type: "action",
        actionId,
        baseSeq: seqRef.current,
        patches,
      });
      if (!sent) return;
      pendingActionRef.current = actionId;
      pendingDirtyRef.current = false;
    }, delay);
  }, [send]);

  const applySnapshot = useCallback(
    (project: CollabProject, seq: number, notice?: string): void => {
      serverProjectRef.current = structuredClone(project);
      currentProjectRef.current = structuredClone({ scenes: project.scenes, assets: project.assets });
      seqRef.current = seq;
      pendingActionRef.current = null;
      pendingDirtyRef.current = false;
      onRemoteProjectRef.current(project);
      if (notice !== undefined) onNoticeRef.current?.(notice);
    },
    [],
  );

  useEffect(() => {
    if (!enabled || url === null || roomId === null) {
      setStatus("disabled");
      return;
    }
    let disposed = false;
    let ownedSocket: WebSocket | null = null;
    retryRef.current = 0;
    joinedOnceRef.current = false;

    const connect = (): void => {
      if (disposed) return;
      setStatus((current) => (current === "connected" ? "reconnecting" : "connecting"));
      const base = url.replace(/\/+$/, "");
      const params = new URLSearchParams();
      if (token !== undefined && token !== null && token.length > 0) {
        params.set("token", token);
      }
      if (key !== undefined && key !== null && key.length > 0) {
        params.set("key", key);
      }
      const query = params.toString();
      const socket = new WebSocket(
        `${base}/room/${encodeURIComponent(roomId)}${query.length > 0 ? `?${query}` : ""}`,
      );
      ownedSocket = socket;
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed || socketRef.current !== socket) {
          socket.close();
          return;
        }
        retryRef.current = 0;
        joinedRef.current = false;
        socket.send(JSON.stringify({
          type: "join",
          user,
          sceneId: activeSceneRef.current,
          seed: { scenes: scenesRef.current, assets: assetsRef.current },
        } satisfies ClientMessage));
      });

      socket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== socket) return;
        const message = parseServerMessage(event.data);
        if (message === null) return;
        if (message.type === "welcome") {
          joinedRef.current = true;
          lastPresenceRef.current = null;
          marqueeActiveRef.current = false;
          setStatus("connected");
          selfIdRef.current = message.selfId;
          setSelfId(message.selfId);
          setUsers(message.users);
          setLeaderId(message.leaderId);
          setError(null);
          const notice = !joinedOnceRef.current && message.seq > 0
            ? "Joined the live session. The room's project replaced your local copy."
            : undefined;
          joinedOnceRef.current = true;
          applySnapshot(message.project, message.seq, notice);
          const self = message.users.find((entry) => entry.clientId === message.selfId);
          if (self !== undefined) {
            send({
              type: "presence",
              presence: {
                sceneId: activeSceneRef.current,
                cursor: null,
                selection: null,
              },
            });
          }
          return;
        }
        if (message.type === "users") {
          setUsers(message.users);
          setLeaderId(message.leaderId);
          return;
        }
        if (message.type === "presence") {
          setUsers((current) => mergeUser(current, message.user));
          return;
        }
        if (message.type === "leader") {
          setLeaderId(message.leaderId);
          return;
        }
        if (message.type === "error") {
          setError(message.message);
          onErrorRef.current?.(message.message);
          if (message.snapshot !== undefined) {
            applySnapshot(message.snapshot.project, message.snapshot.seq);
          }
          return;
        }
        if (message.type === "action") {
          if (message.seq <= seqRef.current) return;
          if (message.seq !== seqRef.current + 1) {
            send({ type: "resync" });
            return;
          }
          const server = serverProjectRef.current;
          const current = currentProjectRef.current;
          if (server === null) return;
          try {
            const nextServer = applyPatches(server, message.patches);
            const nextCurrent = applyPatches(current, message.patches);
            serverProjectRef.current = nextServer;
            currentProjectRef.current = nextCurrent;
            seqRef.current = message.seq;
            onRemoteProjectRef.current(nextCurrent);
          } catch {
            send({ type: "resync" });
            return;
          }
          if (message.actionId === pendingActionRef.current) {
            pendingActionRef.current = null;
            if (pendingDirtyRef.current) {
              pendingDirtyRef.current = false;
              scheduleFlush();
            }
          }
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          joinedRef.current = false;
          socketRef.current = null;
          pendingActionRef.current = null;
        }
        if (disposed) return;
        if (retryRef.current >= 5) {
          setStatus("error");
          setError("Could not connect to the live collaboration room.");
          onErrorRef.current?.("Could not connect to the live collaboration room.");
          return;
        }
        setStatus("reconnecting");
        const delay = Math.min(10_000, CONNECT_RETRY_MS * Math.max(1, retryRef.current));
        retryRef.current += 1;
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          connect();
        }, delay);
      });

      socket.addEventListener("error", () => {
        // The close event owns reconnect.
      });
    };

    // React StrictMode mounts, unmounts and remounts effects in development.
    // Defer the socket one tick so the first mount's cleanup cancels it instead
    // of leaving a second room connection behind.
    const startTimer = window.setTimeout(connect, 30);

    return () => {
      disposed = true;
      window.clearTimeout(startTimer);
      joinedRef.current = false;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
      if (presenceTimerRef.current !== null) window.clearTimeout(presenceTimerRef.current);
      retryTimerRef.current = null;
      sendTimerRef.current = null;
      presenceTimerRef.current = null;
      ownedSocket?.close();
      if (socketRef.current === ownedSocket) socketRef.current = null;
      setStatus("disabled");
      setUsers([]);
      setLeaderId(null);
      setSelfId(null);
      selfIdRef.current = null;
      lastPresenceRef.current = null;
      marqueeActiveRef.current = false;
    };
  }, [applySnapshot, enabled, key, roomId, scheduleFlush, send, token, url, user]);

  useEffect(() => {
    if (!enabled || status !== "connected") return;
    if (pendingActionRef.current !== null) {
      pendingDirtyRef.current = true;
      return;
    }
    scheduleFlush();
  }, [assets, enabled, scenes, scheduleFlush, status]);

  useEffect(() => {
    if (!enabled || status !== "connected") return;
    publishPresence(activeSceneId, null, null, null);
  }, [activeSceneId, enabled, publishPresence, status]);

  const isLeader = selfId !== null && selfId === leaderId;

  return {
    status,
    selfId,
    users,
    leaderId,
    isLeader,
    error,
    publishPresence,
    publishViewCenter,
    publishMarquee,
  };
};
