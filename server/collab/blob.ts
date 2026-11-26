/**
 * Optional Vercel Blob storage for temporary collaboration image bytes.
 *
 * Room snapshots written to Redis or to disk omit large image data URLs and
 * store only a checksum/key reference. Bytes live in Blob for the room TTL and
 * are hydrated back into the project when a room is restored. If Blob is not
 * configured (or an upload fails), the snapshot keeps the inline data URL so
 * collaboration never depends on the object store for correctness.
 */

import { createHash } from "node:crypto";
import { del, list, put as putBlob } from "@vercel/blob";

export interface BlobRef {
  readonly key: string;
  readonly url: string;
}

export interface BlobStore {
  readonly kind: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<BlobRef>;
  get(ref: BlobRef): Promise<Uint8Array | null>;
  delete(keys: readonly string[]): Promise<void>;
  sweep(activeRoomHashes: ReadonlySet<string>, ttlMs: number): Promise<void>;
}

export interface VercelBlobOptions {
  readonly token: string;
  readonly storeId?: string;
  /**
   * Store access mode. `auto` tries public first and falls back to private (or
   * vice versa when explicitly configured), remembering the working mode.
   */
  readonly access?: "public" | "private" | "auto";
}

export const BLOB_PREFIX = "umler/collab/";

export const roomBlobHash = (roomId: string): string =>
  createHash("sha256").update(roomId).digest("hex").slice(0, 32);

export const blobOptionsFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): VercelBlobOptions | null => {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token === undefined || token.length === 0) return null;
  const storeId = env.BLOB_STORE_ID?.trim();
  const configured = env.BLOB_ACCESS?.trim();
  const access =
    configured === "private" || configured === "public" || configured === "auto"
      ? configured
      : "auto";
  return {
    token,
    storeId: storeId !== undefined && storeId.length > 0 ? storeId : undefined,
    access,
  };
};

const download = async (
  url: string,
  token: string,
): Promise<Uint8Array | null> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  if (response.status !== 401 && response.status !== 403) return null;
  // Private stores reject anonymous reads. The read/write token is accepted by
  // the Blob download host for the same store.
  const authorized = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!authorized.ok) return null;
  return new Uint8Array(await authorized.arrayBuffer());
};

export const createVercelBlobStore = (
  options: VercelBlobOptions,
): BlobStore => {
  const auto = options.access === undefined || options.access === "auto";
  let access: "public" | "private" =
    options.access === "private" ? "private" : "public";

  return {
    kind: "vercel-blob",
    async put(key: string, bytes: Uint8Array, contentType: string): Promise<BlobRef> {
      const body = Buffer.from(bytes);
      const upload = (mode: "public" | "private") => putBlob(key, body, {
        access: mode,
        token: options.token,
        storeId: options.storeId,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      let result;
      try {
        result = await upload(access);
      } catch (error) {
        // A public/private mismatch is a configuration detail, not a reason to
        // lose the image. Try the other mode once and remember it.
        if (!auto) throw error;
        access = access === "public" ? "private" : "public";
        result = await upload(access);
      }
      return { key: result.pathname, url: result.url };
    },
    async get(ref: BlobRef): Promise<Uint8Array | null> {
      const url = /^https?:\/\//i.test(ref.url)
        ? ref.url
        : `https://${ref.url.replace(/^\/+/, "")}`;
      try {
        return await download(url, options.token);
      } catch {
        return null;
      }
    },
    async delete(keys: readonly string[]): Promise<void> {
      if (keys.length === 0) return;
      await del([...keys], { token: options.token, storeId: options.storeId });
    },
    async sweep(activeRoomHashes: ReadonlySet<string>, ttlMs: number): Promise<void> {
      const stale: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await list({
          prefix: BLOB_PREFIX,
          token: options.token,
          storeId: options.storeId,
          cursor,
          limit: 1000,
        });
        for (const blob of result.blobs) {
          const hash = blob.pathname.slice(BLOB_PREFIX.length).split("/")[0];
          if (hash === undefined || activeRoomHashes.has(hash)) continue;
          if (Date.now() - blob.uploadedAt.getTime() > ttlMs) stale.push(blob.pathname);
        }
        if (!result.hasMore || result.cursor === undefined) break;
        cursor = result.cursor;
      }
      if (stale.length > 0) {
        await del(stale, { token: options.token, storeId: options.storeId });
      }
    },
  };
};
