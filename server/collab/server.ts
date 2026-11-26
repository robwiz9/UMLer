/**
 * Standalone live-collaboration room server.
 *
 * The room is the authority for confirmed document actions. It applies field
 * patches in receipt order and broadcasts the assigned sequence, so overlapping
 * edits resolve to the last confirmation instead of a CRDT client-id tie-break.
 *
 * The cache is intentionally temporary (TTL, default 4 hours). GitHub remains
 * the durable project store; the connected leader client publishes snapshots
 * through the existing editor save path.
 *
 * Optional infrastructure:
 * - Upstash Redis receives debounced snapshots only (never cursor or per-action
 *   traffic), so a restarted process can recover a room.
 * - Vercel Blob receives large image bytes that are stripped from those
 *   snapshots and hydrated back when the room is restored.
 * - An administrator code gates room creation so only explicitly enabled
 *   projects consume Redis/Blob quota.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  collabColor,
  isClientMessage,
  parseJsonMessage,
  type CollabProject,
  type CollabUser,
  type PresenceState,
  type ServerMessage,
  type ServerUser,
} from "../../src/collab/protocol.ts";
import { applyPatches } from "../../src/collab/patch.ts";
import type { ImageAsset } from "../../src/model/nodes.ts";
import {
  BLOB_PREFIX,
  blobOptionsFromEnv,
  createVercelBlobStore,
  roomBlobHash,
  type BlobStore,
} from "./blob.ts";
import {
  createRedisSnapshotStore,
  redisOptionsFromEnv,
  type CachedBlobRef,
  type RoomSnapshot,
  type SnapshotStore,
} from "./redis.ts";

const DEFAULT_PORT = 1234;
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const CACHE_SAVE_DEBOUNCE_MS = 800;
const DEFAULT_REDIS_SNAPSHOT_MS = 5000;
const DEFAULT_BLOB_MIN_BYTES = 4096;

interface ClientState {
  readonly ws: WebSocket;
  readonly clientId: string;
  readonly user: CollabUser;
  readonly canEdit: boolean;
  readonly joinedAt: number;
  presence: PresenceState;
}

interface Room {
  readonly id: string;
  readonly cachePath: string;
  project: CollabProject | null;
  seq: number;
  revision: number;
  readonly clients: Map<WebSocket, ClientState>;
  leaderId: string | null;
  lastActivity: number;
  saveTimer: NodeJS.Timeout | null;
  redisTimer: NodeJS.Timeout | null;
  dirty: boolean;
  redisDirty: boolean;
  snapshotChain: Promise<void>;
  blobRefs: Map<string, CachedBlobRef>;
  readonly blobUploads: Map<string, Promise<CachedBlobRef | null>>;
}

export interface CollabServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly cacheDir?: string;
  readonly ttlMs?: number;
  /** Optional shared room token. Omit for local development. */
  readonly accessToken?: string;
  /** Optional HMAC secret for the Vercel /api/collab/token JWT. */
  readonly secret?: string;
  /** Optional administrator code required before a room accepts connections. */
  readonly adminCode?: string;
  /** Redis snapshot store; pass null to disable an environment-configured store. */
  readonly snapshotStore?: SnapshotStore | null;
  /** Vercel Blob store; pass null to keep image bytes inline in snapshots. */
  readonly blobStore?: BlobStore | null;
  /** Minimum data-URL byte length before an image moves to Blob. */
  readonly blobMinBytes?: number;
  /** Interval between Redis snapshots while a room is dirty. */
  readonly redisSnapshotMs?: number;
}

interface RoomAuth {
  readonly user: CollabUser;
  readonly canEdit: boolean;
}

const decodeBase64Url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const verifyCollabToken = (
  token: string,
  secret: string,
  roomId: string,
): RoomAuth | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const actual = decodeBase64Url(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(body).toString("utf8")) as {
      sub?: unknown;
      name?: unknown;
      avatarUrl?: unknown;
      room?: unknown;
      canEdit?: unknown;
      exp?: unknown;
    };
    if (payload.room !== roomId) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) return null;
    const id = payload.sub.trim();
    return {
      user: {
        id,
        login: id,
        name: typeof payload.name === "string" && payload.name.trim().length > 0
          ? payload.name.trim().slice(0, 80)
          : id,
        avatarUrl: typeof payload.avatarUrl === "string" && payload.avatarUrl.length > 0
          ? payload.avatarUrl.slice(0, 500)
          : undefined,
        color: collabColor(id),
      },
      canEdit: payload.canEdit === true,
    };
  } catch {
    return null;
  }
};

export interface CollabServerHandle {
  readonly httpServer: HttpServer;
  readonly port: number;
  close(): Promise<void>;
}

const safeUser = (input: CollabUser | undefined): CollabUser => {
  const name = (input?.name ?? "").trim().slice(0, 80);
  const login = (input?.login ?? "").trim().slice(0, 80);
  const avatarUrl = (input?.avatarUrl ?? "").trim().slice(0, 500);
  const id = (input?.id ?? "").trim().slice(0, 120) || randomUUID();
  return {
    id,
    name: name.length > 0 ? name : login.length > 0 ? login : "Guest",
    login: login.length > 0 ? login : undefined,
    avatarUrl: avatarUrl.length > 0 ? avatarUrl : undefined,
    color: input?.color?.trim() || collabColor(id),
  };
};

const isProjectLike = (value: unknown): value is CollabProject =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { scenes?: unknown }).scenes);

const isSnapshotLike = (value: unknown): value is RoomSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as {
    project?: unknown;
    seq?: unknown;
    savedAt?: unknown;
    blobs?: unknown;
  };
  return (
    isProjectLike(snapshot.project) &&
    typeof snapshot.seq === "number" &&
    typeof snapshot.savedAt === "number" &&
    (snapshot.blobs === undefined || Array.isArray(snapshot.blobs))
  );
};

const serverUser = (client: ClientState): ServerUser => ({
  clientId: client.clientId,
  user: client.user,
  ...client.presence,
  joinedAt: client.joinedAt,
});

const usersOf = (room: Room): readonly ServerUser[] =>
  [...room.clients.values()].map(serverUser);

const send = (ws: WebSocket, message: ServerMessage): void => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
};

const broadcast = (room: Room, message: ServerMessage, except?: WebSocket): void => {
  for (const ws of room.clients.keys()) {
    if (ws !== except) send(ws, message);
  }
};

const userListMessage = (room: Room): ServerMessage => ({
  type: "users",
  users: usersOf(room),
  leaderId: room.leaderId,
});

const errorMessage = (room: Room, message: string): ServerMessage => ({
  type: "error",
  message,
  snapshot:
    room.project === null
      ? undefined
      : { seq: room.seq, project: room.project },
});

/** Per-room administrator key: HMAC(admin code, room id), never the raw code. */
export const roomAdministratorKey = (adminCode: string, roomId: string): string =>
  createHmac("sha256", adminCode).update(roomId).digest("base64url");

const sameKey = (expected: string, provided: string): boolean => {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

const parseDataUrl = (
  dataUrl: string,
): { readonly mimeType: string; readonly bytes: Buffer } | null => {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(dataUrl);
  if (match === null) return null;
  const mimeType = match[1] ?? "application/octet-stream";
  const parameters = match[2] ?? "";
  const payload = match[3] ?? "";
  if (!/;base64(?:;|$)/i.test(parameters)) return null;
  try {
    return { mimeType, bytes: Buffer.from(payload, "base64") };
  } catch {
    return null;
  }
};

const extensionForMimeType = (mimeType: string): string => {
  switch (mimeType.toLowerCase()) {
    case "image/png": return ".png";
    case "image/jpeg":
    case "image/jpg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/svg+xml": return ".svg";
    case "image/avif": return ".avif";
    default: return ".bin";
  }
};

const safeKeyPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80) || "asset";

const cacheName = (roomId: string): string =>
  `${createHash("sha256").update(roomId).digest("hex")}.json`;

export const createCollabServer = async (
  options: CollabServerOptions = {},
): Promise<CollabServerHandle> => {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "127.0.0.1";
  const cacheDir = options.cacheDir ?? join(process.cwd(), ".collab-cache");
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const accessToken = options.accessToken;
  const secret = options.secret;
  const adminCode = options.adminCode ?? process.env.COLLAB_ADMIN_CODE?.trim() ?? "";
  const redisSnapshotOption =
    options.redisSnapshotMs ??
    Number(process.env.COLLAB_REDIS_SNAPSHOT_MS ?? DEFAULT_REDIS_SNAPSHOT_MS);
  const redisSnapshotMs = Number.isFinite(redisSnapshotOption)
    ? Math.max(1000, redisSnapshotOption)
    : DEFAULT_REDIS_SNAPSHOT_MS;
  const blobMinOption =
    options.blobMinBytes ??
    Number(process.env.COLLAB_BLOB_MIN_BYTES ?? DEFAULT_BLOB_MIN_BYTES);
  const blobMinBytes = Number.isFinite(blobMinOption)
    ? Math.max(0, blobMinOption)
    : DEFAULT_BLOB_MIN_BYTES;

  const environmentRedis = redisOptionsFromEnv();
  const snapshotStore = options.snapshotStore === undefined
    ? (environmentRedis === null ? null : createRedisSnapshotStore(environmentRedis))
    : options.snapshotStore;
  const environmentBlob = blobOptionsFromEnv();
  const blobStore = options.blobStore === undefined
    ? (environmentBlob === null ? null : createVercelBlobStore(environmentBlob))
    : options.blobStore;

  const rooms = new Map<string, Room>();
  const loading = new Map<string, Promise<Room>>();

  const ensureBlob = async (
    room: Room,
    checksum: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<CachedBlobRef | null> => {
    if (blobStore === null) return null;
    const existing = room.blobRefs.get(checksum);
    if (existing !== undefined) return existing;
    const pending = room.blobUploads.get(checksum);
    if (pending !== undefined) return pending;
    const key =
      `${BLOB_PREFIX}${roomBlobHash(room.id)}/${safeKeyPart(checksum)}` +
      extensionForMimeType(mimeType);
    const upload = blobStore
      .put(key, bytes, mimeType)
      .then((ref) => {
        const cached: CachedBlobRef = {
          checksum,
          key: ref.key,
          url: ref.url,
          mimeType,
        };
        room.blobRefs.set(checksum, cached);
        return cached;
      })
      .catch((error) => {
        console.warn(`[collab] blob upload failed for room ${room.id}:`, error);
        return null;
      })
      .finally(() => {
        room.blobUploads.delete(checksum);
      });
    room.blobUploads.set(checksum, upload);
    return upload;
  };

  /**
   * Replace large data URLs with Blob references for storage. The live room
   * project keeps its bytes, so WebSocket patches and the leader's GitHub save
   * remain unchanged.
   */
  const compactProject = async (
    room: Room,
  ): Promise<{ readonly project: CollabProject; readonly blobs: readonly CachedBlobRef[] }> => {
    const project = room.project;
    if (project === null || project.assets === undefined || blobStore === null) {
      return {
        project: project ?? { scenes: [] },
        blobs: [...room.blobRefs.values()],
      };
    }
    const assets: Record<string, ImageAsset> = {};
    for (const [id, asset] of Object.entries(project.assets)) {
      if (asset.dataUrl === undefined) {
        assets[id] = asset;
        continue;
      }
      const parsed = parseDataUrl(asset.dataUrl);
      if (parsed === null || parsed.bytes.byteLength < blobMinBytes) {
        assets[id] = asset;
        continue;
      }
      const checksum = asset.checksum.trim().length > 0
        ? asset.checksum
        : createHash("sha256").update(parsed.bytes).digest("hex");
      const ref = await ensureBlob(room, checksum, parsed.bytes, asset.mimeType);
      assets[id] = ref === null ? asset : { ...asset, dataUrl: undefined };
    }
    return {
      project: { ...project, assets },
      blobs: [...room.blobRefs.values()],
    };
  };

  const hydrateSnapshot = async (
    room: Room,
    snapshot: RoomSnapshot,
  ): Promise<void> => {
    room.blobRefs = new Map(
      (snapshot.blobs ?? []).map((ref) => [ref.checksum, ref]),
    );
    let project = snapshot.project as CollabProject;
    if (blobStore !== null && project.assets !== undefined && room.blobRefs.size > 0) {
      const assets: Record<string, ImageAsset> = {};
      let changed = false;
      for (const [id, asset] of Object.entries(project.assets)) {
        if (asset.dataUrl !== undefined) {
          assets[id] = asset;
          continue;
        }
        const ref = room.blobRefs.get(asset.checksum);
        if (ref === undefined) {
          assets[id] = asset;
          continue;
        }
        const bytes = await blobStore.get({ key: ref.key, url: ref.url }).catch(() => null);
        if (bytes === null) {
          assets[id] = asset;
          continue;
        }
        assets[id] = {
          ...asset,
          dataUrl: `data:${asset.mimeType || ref.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
        };
        changed = true;
      }
      if (changed) project = { ...project, assets };
    }
    room.project = project;
    room.seq = snapshot.seq;
    room.revision = 0;
    room.dirty = false;
    room.redisDirty = false;
  };

  const readFileSnapshot = async (room: Room): Promise<RoomSnapshot | null> => {
    try {
      const info = await stat(room.cachePath);
      if (Date.now() - info.mtimeMs > ttlMs) {
        await unlink(room.cachePath).catch(() => undefined);
        return null;
      }
      const parsed: unknown = JSON.parse(await readFile(room.cachePath, "utf8"));
      return isSnapshotLike(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const loadRoomCache = async (room: Room): Promise<void> => {
    const fileSnapshot = await readFileSnapshot(room);
    let redisSnapshot: RoomSnapshot | null = null;
    if (snapshotStore !== null) {
      redisSnapshot = await snapshotStore.load(room.id).catch((error) => {
        console.warn(`[collab] could not read Redis snapshot for ${room.id}:`, error);
        return null;
      });
    }
    const candidates = [fileSnapshot, redisSnapshot]
      .filter((entry): entry is RoomSnapshot => entry !== null)
      .sort((a, b) => b.savedAt - a.savedAt || b.seq - a.seq);
    const best = candidates[0];
    if (best === undefined) return;
    await hydrateSnapshot(room, best);
  };

  const writeRoomSnapshot = (
    room: Room,
    includeRedis: boolean,
  ): Promise<void> => {
    const run = room.snapshotChain.then(async () => {
      if (room.project === null) return;
      const revision = room.revision;
      const snapshot = await compactProject(room);
      const payload: RoomSnapshot = {
        project: snapshot.project,
        seq: room.seq,
        savedAt: Date.now(),
        blobs: snapshot.blobs,
      };
      let fileOk = true;
      try {
        await mkdir(dirname(room.cachePath), { recursive: true });
        await writeFile(room.cachePath, JSON.stringify(payload));
      } catch (error) {
        fileOk = false;
        console.error(`[collab] could not cache room ${room.id}:`, error);
      }
      if (fileOk && room.revision === revision) room.dirty = false;
      if (includeRedis && snapshotStore !== null) {
        try {
          await snapshotStore.save(room.id, payload, ttlMs);
          room.redisDirty = false;
        } catch (error) {
          room.redisDirty = true;
          console.warn(`[collab] could not write Redis snapshot for ${room.id}:`, error);
        }
      }
      if (room.revision !== revision) {
        room.dirty = true;
        room.redisDirty = true;
        scheduleRoomCache(room);
      }
    }).catch((error) => {
      console.error(`[collab] snapshot failed for room ${room.id}:`, error);
    });
    room.snapshotChain = run;
    return run;
  };

  const scheduleRedisSnapshot = (room: Room): void => {
    if (snapshotStore === null || room.redisTimer !== null || !room.redisDirty) return;
    room.redisTimer = setTimeout(() => {
      room.redisTimer = null;
      void writeRoomSnapshot(room, true).finally(() => {
        if (room.redisDirty) scheduleRedisSnapshot(room);
      });
    }, redisSnapshotMs);
  };

  const scheduleRoomCache = (room: Room): void => {
    room.dirty = true;
    room.redisDirty = true;
    if (room.saveTimer === null) {
      room.saveTimer = setTimeout(() => {
        room.saveTimer = null;
        void writeRoomSnapshot(room, false);
      }, CACHE_SAVE_DEBOUNCE_MS);
    }
    scheduleRedisSnapshot(room);
  };

  const deleteRoomBlobs = async (room: Room): Promise<void> => {
    if (blobStore === null || room.blobRefs.size === 0) return;
    const keys = [...new Set([...room.blobRefs.values()].map((ref) => ref.key))];
    try {
      await blobStore.delete(keys);
    } catch (error) {
      console.warn(`[collab] could not delete blobs for room ${room.id}:`, error);
    }
  };

  const getRoom = (roomId: string): Promise<Room> => {
    const existing = rooms.get(roomId);
    if (existing !== undefined) return Promise.resolve(existing);
    const pending = loading.get(roomId);
    if (pending !== undefined) return pending;
    const created = (async () => {
      const room: Room = {
        id: roomId,
        cachePath: join(cacheDir, cacheName(roomId)),
        project: null,
        seq: 0,
        revision: 0,
        clients: new Map(),
        leaderId: null,
        lastActivity: Date.now(),
        saveTimer: null,
        redisTimer: null,
        dirty: false,
        redisDirty: false,
        snapshotChain: Promise.resolve(),
        blobRefs: new Map(),
        blobUploads: new Map(),
      };
      await loadRoomCache(room);
      rooms.set(roomId, room);
      loading.delete(roomId);
      return room;
    })();
    loading.set(roomId, created);
    return created;
  };

  const closeClient = (room: Room, ws: WebSocket): void => {
    const client = room.clients.get(ws);
    if (client === undefined) return;
    room.clients.delete(ws);
    room.lastActivity = Date.now();
    if (room.leaderId === client.clientId) {
      room.leaderId = room.clients.values().next().value?.clientId ?? null;
    }
    if (room.clients.size > 0) {
      broadcast(room, userListMessage(room));
      broadcast(room, { type: "leader", leaderId: room.leaderId });
    } else {
      void writeRoomSnapshot(room, true);
    }
  };

  const attach = (ws: WebSocket, room: Room, auth: RoomAuth | null): void => {
    let client: ClientState | null = null;

    ws.on("message", (data) => {
      const message = parseJsonMessage(data, isClientMessage);
      if (message === null) {
        send(ws, { type: "error", message: "Malformed collaboration message." });
        return;
      }
      room.lastActivity = Date.now();

      if (message.type === "join") {
        if (client !== null) return;
        const user = auth?.user ?? safeUser(message.user);
        if (room.project === null) {
          if (!isProjectLike(message.seed)) {
            send(
              ws,
              errorMessage(
                room,
                "This live room has no cached project yet. Keep one editor open to seed it.",
              ),
            );
            return;
          }
          room.project = structuredClone(message.seed);
          room.seq = 0;
          room.revision += 1;
          room.dirty = true;
          scheduleRoomCache(room);
        }
        const presence: PresenceState = {
          sceneId:
            typeof message.sceneId === "string" && message.sceneId.length > 0
              ? message.sceneId
              : room.project.scenes[0]?.id ?? "",
          cursor: null,
        };
        client = {
          ws,
          clientId: randomUUID(),
          user,
          canEdit: auth?.canEdit ?? true,
          joinedAt: Date.now(),
          presence,
        };
        room.clients.set(ws, client);
        const leaderChanged = room.leaderId === null;
        if (leaderChanged) room.leaderId = client.clientId;
        send(ws, {
          type: "welcome",
          room: room.id,
          selfId: client.clientId,
          seq: room.seq,
          project: room.project,
          users: usersOf(room),
          leaderId: room.leaderId,
        });
        broadcast(room, userListMessage(room), ws);
        if (leaderChanged) broadcast(room, { type: "leader", leaderId: room.leaderId });
        return;
      }

      if (client === null) {
        send(ws, { type: "error", message: "Join the room before sending updates." });
        return;
      }

      if (message.type === "presence") {
        client.presence = {
          sceneId: message.presence.sceneId,
          cursor: message.presence.cursor,
          selection: message.presence.selection ?? null,
          editing: message.presence.editing ?? null,
          viewCenter: message.presence.viewCenter ?? null,
          marquee: message.presence.marquee ?? null,
        };
        broadcast(room, { type: "presence", user: serverUser(client) }, ws);
        return;
      }

      if (message.type === "resync") {
        if (room.project !== null) {
          send(ws, {
            type: "welcome",
            room: room.id,
            selfId: client.clientId,
            seq: room.seq,
            project: room.project,
            users: usersOf(room),
            leaderId: room.leaderId,
          });
        }
        return;
      }

      if (message.type === "action") {
        if (!client.canEdit) {
          send(ws, errorMessage(room, "View-only collaborators cannot edit this room."));
          return;
        }
        if (!Array.isArray(message.patches)) {
          send(ws, errorMessage(room, "Action has no patch list."));
          return;
        }
        if (room.project === null) {
          send(ws, errorMessage(room, "The room has no project."));
          return;
        }
        try {
          room.project = applyPatches(room.project, message.patches);
        } catch (error) {
          send(
            ws,
            errorMessage(
              room,
              error instanceof Error ? error.message : "The action could not be applied.",
            ),
          );
          return;
        }
        room.seq += 1;
        room.revision += 1;
        scheduleRoomCache(room);
        broadcast(room, {
          type: "action",
          seq: room.seq,
          actor: client.user,
          actionId: message.actionId,
          patches: message.patches,
        });
      }
    });

    ws.on("close", () => closeClient(room, ws));
    ws.on("error", () => closeClient(room, ws));
  };

  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  const httpServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/unlock") {
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      const targetRoom = url.searchParams.get("room") ?? "";
      const provided = url.searchParams.get("key") ?? "";
      const required = adminCode.length > 0;
      const ok =
        !required ||
        (targetRoom.length > 0 &&
          sameKey(roomAdministratorKey(adminCode, targetRoom), provided));
      response.writeHead(ok ? 200 : 403, {
        ...corsHeaders,
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok, required }));
      return;
    }

    if (url.pathname === "/health") {
      response.writeHead(200, {
        ...corsHeaders,
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({
        ok: true,
        rooms: rooms.size,
        adminGate: adminCode.length > 0,
        redis: snapshotStore?.kind ?? null,
        blob: blobStore?.kind ?? null,
      }));
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        const match = /^\/room\/(.+)$/.exec(url.pathname);
        if (match === null) {
          socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
          socket.destroy();
          return;
        }
        const roomId = decodeURIComponent(match[1] as string);
        if (adminCode.length > 0) {
          const provided = url.searchParams.get("key") ?? "";
          if (!sameKey(roomAdministratorKey(adminCode, roomId), provided)) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
        }
        let auth: RoomAuth | null = null;
        if (secret !== undefined && secret.length > 0) {
          auth = verifyCollabToken(
            url.searchParams.get("token") ?? "",
            secret,
            roomId,
          );
          if (auth === null || auth.canEdit !== true) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        } else if (accessToken !== undefined && accessToken.length > 0) {
          if (url.searchParams.get("token") !== accessToken) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        }
        const room = await getRoom(roomId);
        wss.handleUpgrade(request, socket, head, (ws) => {
          attach(ws, room, auth);
        });
      } catch (error) {
        console.error("[collab] upgrade failed:", error);
        socket.destroy();
      }
    })();
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (room.clients.size === 0 && now - room.lastActivity > ttlMs) {
        if (room.saveTimer !== null) clearTimeout(room.saveTimer);
        if (room.redisTimer !== null) clearTimeout(room.redisTimer);
        rooms.delete(id);
        void (async () => {
          await room.snapshotChain.catch(() => undefined);
          await unlink(room.cachePath).catch(() => undefined);
          await snapshotStore?.delete(id).catch((error) => {
            console.warn(`[collab] could not delete Redis snapshot for ${id}:`, error);
          });
          await deleteRoomBlobs(room);
        })();
      }
    }
    void (async () => {
      try {
        const files = await readdir(cacheDir);
        const active = new Set(
          [...rooms.values()]
            .filter((room) => room.clients.size > 0)
            .map((room) => room.cachePath),
        );
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const path = join(cacheDir, file);
          if (active.has(path)) continue;
          const info = await stat(path).catch(() => null);
          if (info !== null && now - info.mtimeMs > ttlMs) await unlink(path).catch(() => undefined);
        }
      } catch {
        // Cache directory does not exist yet.
      }
    })();
    if (blobStore !== null) {
      const activeHashes = new Set([...rooms.keys()].map(roomBlobHash));
      // Keep an extra hour so a restart cannot delete bytes from a room whose
      // Redis snapshot is still inside its TTL but has not been reopened yet.
      void blobStore.sweep(activeHashes, ttlMs + 60 * 60 * 1000).catch((error) => {
        console.warn("[collab] blob sweep failed:", error);
      });
    }
  }, 10 * 60 * 1000);
  cleanup.unref();

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    httpServer,
    port: actualPort,
    close: async () => {
      clearInterval(cleanup);
      for (const room of rooms.values()) {
        if (room.saveTimer !== null) clearTimeout(room.saveTimer);
        if (room.redisTimer !== null) clearTimeout(room.redisTimer);
        if (room.dirty || room.redisDirty) await writeRoomSnapshot(room, true);
      }
      for (const client of wss.clients) client.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
};

const isMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const accessToken = process.env.COLLAB_ACCESS_TOKEN?.trim() || undefined;
  const secret = process.env.COLLAB_SECRET?.trim() || undefined;
  const adminCode = process.env.COLLAB_ADMIN_CODE?.trim() || undefined;
  const ttlHours = Number(process.env.COLLAB_TTL_HOURS ?? "4");
  createCollabServer({
    port: Number(process.env.COLLAB_PORT ?? DEFAULT_PORT),
    host: process.env.COLLAB_HOST ?? "0.0.0.0",
    cacheDir: process.env.COLLAB_CACHE_DIR ?? join(process.cwd(), ".collab-cache"),
    ttlMs: Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : DEFAULT_TTL_MS,
    accessToken,
    secret,
    adminCode,
  }).then((handle) => {
    console.log(
      `[collab] listening on ws://127.0.0.1:${handle.port} ` +
        `(auth: ${secret !== undefined ? "GitHub JWT" : accessToken !== undefined ? "shared token" : "off"}, ` +
        `admin gate: ${adminCode !== undefined ? "on" : "off"}, ` +
        `redis: ${redisOptionsFromEnv() !== null ? "on" : "off"}, ` +
        `blob: ${blobOptionsFromEnv() !== null ? "on" : "off"}, ` +
        `cache: ${process.env.COLLAB_CACHE_DIR ?? ".collab-cache"})`,
    );
    const shutdown = (): void => {
      void handle.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }).catch((error) => {
    console.error("[collab] failed to start:", error);
    process.exit(1);
  });
}
