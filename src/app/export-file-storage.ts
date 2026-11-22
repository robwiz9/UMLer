/**
 * Per-scene .typ export target. Handles live in IndexedDB; the UI-facing
 * settings and automatic-export flag are stored separately.
 */

import {
  isSaveFileHandleUsable,
  type SaveFileHandle,
} from "./file-system-access.ts";

export interface ExportFileBinding {
  readonly handle: SaveFileHandle;
  readonly automatic: boolean;
  readonly fileName: string;
}

const DB_NAME = "umler.exportFiles";
const DB_VERSION = 1;
const STORE_NAME = "bindings";

/** Same-tab fallback when a handle cannot be structured-cloned into IndexedDB. */
const memoryBindings = new Map<string, ExportFileBinding>();

const openDatabase = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

export const loadExportFileBinding = async (
  sceneId: string,
): Promise<ExportFileBinding | null> => {
  const memory = memoryBindings.get(sceneId);
  if (memory !== undefined) {
    if (await isSaveFileHandleUsable(memory.handle)) return memory;
    memoryBindings.delete(sceneId);
    return null;
  }
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  if (database === null) return null;
  const binding = await new Promise<ExportFileBinding | null>((resolve) => {
    try {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(sceneId);
      request.onsuccess = () => {
        const value = request.result as ExportFileBinding | undefined;
        resolve(
          value !== undefined &&
            typeof value.automatic === "boolean" &&
            typeof value.fileName === "string" &&
            value.handle !== undefined
            ? value
            : null,
        );
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  database.close();
  if (binding === null) return null;
  if (!(await isSaveFileHandleUsable(binding.handle))) {
    await storeExportFileBinding(sceneId, null);
    return null;
  }
  return binding;
};

export const storeExportFileBinding = async (
  sceneId: string,
  binding: ExportFileBinding | null,
): Promise<void> => {
  if (binding === null) memoryBindings.delete(sceneId);
  else memoryBindings.set(sceneId, binding);
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  if (database === null) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (binding === null) store.delete(sceneId);
      else store.put(binding, sceneId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  database.close();
};
