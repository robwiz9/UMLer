/**
 * Shared collaboration protocol types.
 *
 * The room is authoritative for confirmed document actions. Clients send a
 * list of field/array patches; the room applies them in receipt order and
 * stamps the action with a monotonic sequence. That sequence, not a client
 * clock, decides which overlapping field edit wins.
 */

import type { ImageAsset } from "../model/nodes.ts";
import type { SceneDocument } from "../model/scene.ts";

export interface CollabProject {
  readonly scenes: readonly SceneDocument[];
  readonly assets?: Readonly<Record<string, ImageAsset>>;
}

export type PatchPath = readonly (string | number)[];

export type Patch =
  | {
      readonly op: "set";
      readonly path: PatchPath;
      readonly value: unknown;
    }
  | {
      readonly op: "delete";
      readonly path: PatchPath;
    }
  | {
      readonly op: "insert";
      readonly path: PatchPath;
      readonly value: unknown;
      /** Insert before this array element id, or append when omitted. */
      readonly beforeId?: string;
    }
  | {
      readonly op: "remove";
      readonly path: PatchPath;
      readonly id: string;
    }
  | {
      readonly op: "reorder";
      readonly path: PatchPath;
      readonly order: readonly string[];
    }
  | {
      readonly op: "replaceArray";
      readonly path: PatchPath;
      readonly value: readonly unknown[];
    };

export interface CollabUser {
  readonly id: string;
  readonly name: string;
  readonly login?: string;
  readonly avatarUrl?: string;
  readonly color: string;
}

export interface CursorPoint {
  readonly x: number;
  readonly y: number;
}

export interface PresenceSelection {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

/** World-space rectangle for a live drag-to-select gesture. */
export interface PresenceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PresenceState {
  readonly sceneId: string;
  readonly cursor: CursorPoint | null;
  readonly selection?: PresenceSelection | null;
  /** Field path currently being edited, without its text payload. */
  readonly editing?: string | null;
  /** World-space centre of the sender's viewport at their current zoom. */
  readonly viewCenter?: CursorPoint | null;
  /** Active marquee/drag-to-select rectangle, cleared when the drag ends. */
  readonly marquee?: PresenceRect | null;
}

export interface ServerUser extends PresenceState {
  readonly clientId: string;
  readonly user: CollabUser;
  readonly joinedAt: number;
}

/**
 * Apply the local user's presence optimistically. The server broadcasts
 * presence to the other clients only, so the sender must update its own entry
 * or it will keep showing the scene it joined on.
 */
export const withSelfPresence = (
  users: readonly ServerUser[],
  selfId: string | null,
  sceneId: string,
  selection: PresenceSelection | null,
  editing: string | null,
): readonly ServerUser[] => {
  if (selfId === null) return users;
  let changed = false;
  const next = users.map((entry) => {
    if (entry.clientId !== selfId) return entry;
    if (
      entry.sceneId === sceneId &&
      (entry.selection ?? null) === selection &&
      (entry.editing ?? null) === editing
    ) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      sceneId,
      selection,
      editing,
    };
  });
  return changed ? next : users;
};

export type ClientMessage =
  | {
      readonly type: "join";
      readonly user: CollabUser;
      readonly sceneId: string;
      /** Used only when the room has no cached state yet. */
      readonly seed?: CollabProject;
    }
  | {
      readonly type: "action";
      readonly actionId: string;
      readonly baseSeq: number;
      readonly patches: readonly Patch[];
    }
  | {
      readonly type: "presence";
      readonly presence: PresenceState;
    }
  | { readonly type: "resync" };

export type ServerMessage =
  | {
      readonly type: "welcome";
      readonly room: string;
      readonly selfId: string;
      readonly seq: number;
      readonly project: CollabProject;
      readonly users: readonly ServerUser[];
      readonly leaderId: string | null;
    }
  | {
      readonly type: "action";
      readonly seq: number;
      readonly actor: CollabUser;
      readonly actionId: string;
      readonly patches: readonly Patch[];
    }
  | {
      readonly type: "users";
      readonly users: readonly ServerUser[];
      readonly leaderId: string | null;
    }
  | {
      readonly type: "presence";
      readonly user: ServerUser;
    }
  | {
      readonly type: "leader";
      readonly leaderId: string | null;
    }
  | {
      readonly type: "error";
      readonly message: string;
      readonly snapshot?: {
        readonly seq: number;
        readonly project: CollabProject;
      };
    }
  | { readonly type: "pong" };

export const isClientMessage = (value: unknown): value is ClientMessage => {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "join" || type === "action" || type === "presence" || type === "resync";
};

export const isServerMessage = (value: unknown): value is ServerMessage => {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "welcome" ||
    type === "action" ||
    type === "users" ||
    type === "presence" ||
    type === "leader" ||
    type === "error" ||
    type === "pong"
  );
};

export const parseJsonMessage = <T>(
  data: unknown,
  guard: (value: unknown) => value is T,
): T | null => {
  try {
    const text = typeof data === "string"
      ? data
      : new TextDecoder().decode(data as ArrayBuffer);
    const parsed: unknown = JSON.parse(text);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Deterministic avatar/cursor colour from a user or login id. */
export const collabColor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 68% 42%)`;
};
