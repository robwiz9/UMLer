/**
 * Optional Upstash Redis snapshot store for collaboration rooms.
 *
 * Redis is deliberately not an event bus. Cursor movement and confirmed actions
 * stay on the WebSocket; this store only receives debounced room snapshots so a
 * restarted or redeployed room process can recover state. That keeps usage
 * within small free-tier action budgets even for multi-hour sessions.
 */

import { createHash } from "node:crypto";

export interface CachedBlobRef {
  readonly checksum: string;
  readonly key: string;
  readonly url: string;
  readonly mimeType: string;
}

export interface RoomSnapshot {
  readonly project: unknown;
  readonly seq: number;
  readonly savedAt: number;
  readonly blobs?: readonly CachedBlobRef[];
}

export interface SnapshotStore {
  readonly kind: string;
  load(roomId: string): Promise<RoomSnapshot | null>;
  save(roomId: string, snapshot: RoomSnapshot, ttlMs: number): Promise<void>;
  delete(roomId: string): Promise<void>;
}

const SNAPSHOT_TIMEOUT_MS = 5000;
const KEY_PREFIX = "umler:collab:room:";

const roomKey = (roomId: string): string =>
  `${KEY_PREFIX}${createHash("sha256").update(roomId).digest("hex")}`;

interface UpstashOptions {
  readonly url: string;
  readonly token: string;
}

const readEnv = (
  env: NodeJS.ProcessEnv,
  ...names: readonly string[]
): string | undefined => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
};

/**
 * Resolve Upstash REST credentials from the aliases used by Vercel KV and the
 * dashboard integration. A `rediss://` URL is a native Redis connection string
 * and cannot be used here.
 */
export const redisOptionsFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): UpstashOptions | null => {
  const url = readEnv(
    env,
    "UMLER_STORAGE_KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
    "KV_REST_API_URL",
  );
  const token = readEnv(
    env,
    "UMLER_STORAGE_KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_TOKEN",
  );
  if (url === undefined || token === undefined) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), token };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeSnapshot = (value: unknown): RoomSnapshot | null => {
  if (!isRecord(value)) return null;
  if (typeof value.savedAt !== "number" || typeof value.seq !== "number") return null;
  if (!isRecord(value.project) || !Array.isArray(value.project.scenes)) return null;
  const blobs = Array.isArray(value.blobs)
    ? value.blobs.filter((entry): entry is CachedBlobRef => {
        if (!isRecord(entry)) return false;
        return (
          typeof entry.checksum === "string" &&
          typeof entry.key === "string" &&
          typeof entry.url === "string" &&
          typeof entry.mimeType === "string"
        );
      })
    : [];
  return {
    project: value.project,
    seq: value.seq,
    savedAt: value.savedAt,
    blobs,
  };
};

const request = async (
  options: UpstashOptions,
  path: string,
  init: RequestInit,
): Promise<unknown> => {
  const response = await fetch(`${options.url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${options.token}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(`Redis request failed: ${message}`);
  }
  if (isRecord(payload) && typeof payload.error === "string") {
    throw new Error(`Redis request failed: ${payload.error}`);
  }
  return payload;
};

export const createRedisSnapshotStore = (
  options: UpstashOptions,
): SnapshotStore => ({
  kind: "redis",
  async load(roomId: string): Promise<RoomSnapshot | null> {
    const payload = await request(
      options,
      `/get/${encodeURIComponent(roomKey(roomId))}`,
      { method: "GET" },
    );
    if (!isRecord(payload) || typeof payload.result !== "string") return null;
    try {
      return normalizeSnapshot(JSON.parse(payload.result) as unknown);
    } catch {
      return null;
    }
  },
  async save(roomId: string, snapshot: RoomSnapshot, ttlMs: number): Promise<void> {
    const ttlSeconds = Math.max(60, Math.ceil(ttlMs / 1000));
    const body = JSON.stringify([
      ["SET", roomKey(roomId), JSON.stringify(snapshot), "EX", String(ttlSeconds)],
    ]);
    const payload = await request(options, "/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (Array.isArray(payload)) {
      const first = payload[0];
      if (isRecord(first) && typeof first.error === "string") {
        throw new Error(`Redis request failed: ${first.error}`);
      }
    }
  },
  async delete(roomId: string): Promise<void> {
    const body = JSON.stringify([["DEL", roomKey(roomId)]]);
    await request(options, "/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  },
});
