/**
 * Chromium File System Access helpers for a persistent Ctrl+S target.
 *
 * The picker and permission methods are intentionally typed locally: they are
 * not present in every TypeScript DOM lib yet, and Firefox simply reports the
 * capability as unsupported.
 */

export interface LocalSaveBaseline {
  readonly digest: string;
  readonly sceneDigests: Readonly<Record<string, string>>;
}

export interface SaveFileHandle {
  readonly name: string;
  readonly kind: "file";
  createWritable(): Promise<WritableProjectFile>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getFile?(): Promise<File>;
}

interface WritableProjectFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface FilePickerWindow {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: readonly {
      description: string;
      accept: Readonly<Record<string, readonly string[]>>;
    }[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<SaveFileHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: readonly {
      description: string;
      accept: Readonly<Record<string, readonly string[]>>;
    }[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<SaveFileHandle[]>;
}

const pickerWindow = (): FilePickerWindow => window as unknown as FilePickerWindow;

export const supportsSaveFilePicker = (): boolean =>
  typeof window !== "undefined" && typeof pickerWindow().showSaveFilePicker === "function";

export const supportsOpenFilePicker = (): boolean =>
  typeof window !== "undefined" && typeof pickerWindow().showOpenFilePicker === "function";

const projectTypes = [
  {
    description: "UMLer project",
    accept: {
      "application/json": [".umler", ".json"],
    },
  },
] as const;

export const pickProjectSaveFile = async (
  suggestedName: string,
): Promise<SaveFileHandle | null> => {
  const picker = pickerWindow().showSaveFilePicker;
  if (picker === undefined) return null;
  try {
    return await picker({
      suggestedName,
      types: projectTypes,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
};

export const pickTypstExportFile = async (
  suggestedName: string,
): Promise<SaveFileHandle | null> => {
  const picker = pickerWindow().showSaveFilePicker;
  if (picker === undefined) return null;
  try {
    return await picker({
      suggestedName,
      types: [
        {
          description: "Typst source",
          accept: { "text/plain": [".typ"] },
        },
      ],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
};

export const pickProjectOpenFile = async (): Promise<{
  readonly handle: SaveFileHandle;
  readonly file: File;
} | null> => {
  const picker = pickerWindow().showOpenFilePicker;
  if (picker === undefined) return null;
  try {
    const [handle] = await picker({
      multiple: false,
      types: projectTypes,
    });
    if (handle === undefined || handle.getFile === undefined) return null;
    return { handle, file: await handle.getFile() };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
};

export const ensureWritePermission = async (handle: SaveFileHandle): Promise<boolean> => {
  if (handle.queryPermission === undefined || handle.requestPermission === undefined) {
    return true;
  }
  try {
    const current = await handle.queryPermission({ mode: "readwrite" });
    if (current === "granted") return true;
    if (current === "denied") return false;
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
};

export const writeProjectToHandle = async (
  handle: SaveFileHandle,
  text: string,
): Promise<void> => {
  if (!(await ensureWritePermission(handle))) {
    throw new Error("Write permission for the selected save file was denied.");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // The write error is more useful than a failed cleanup.
    }
    throw error;
  }
};

const DB_NAME = "umler.fileHandles";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const SAVE_FILE_KEY = "save-file";
const SAVE_BASELINE_KEY = "save-file-baseline";

const openHandleDatabase = (): Promise<IDBDatabase | null> =>
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

/**
 * A persisted native handle is only reusable while Chromium still grants
 * read/write access. Handles restored after a browser restart or a security
 * policy change must be discarded; keeping them produces Chrome's opaque
 * "request is not allowed" `getFile` failures.
 */
export const isSaveFileHandleUsable = async (
  handle: SaveFileHandle,
): Promise<boolean> => {
  try {
    if (handle.queryPermission !== undefined) {
      const permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") return false;
    }
    if (handle.getFile !== undefined) await handle.getFile();
    return true;
  } catch {
    return false;
  }
};

export const loadSaveFileHandle = async (): Promise<SaveFileHandle | null> => {
  if (typeof indexedDB === "undefined") return null;
  const database = await openHandleDatabase();
  if (database === null) return null;
  const handle = await new Promise<SaveFileHandle | null>((resolve) => {
    try {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(SAVE_FILE_KEY);
      request.onsuccess = () => resolve((request.result as SaveFileHandle | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  database.close();
  if (handle === null) return null;
  if (!(await isSaveFileHandleUsable(handle))) {
    await storeSaveFileHandle(null);
    return null;
  }
  return handle;
};

export const storeSaveFileHandle = async (
  handle: SaveFileHandle | null,
): Promise<void> => {
  if (typeof indexedDB === "undefined") return;
  const database = await openHandleDatabase();
  if (database === null) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (handle === null) {
        store.delete(SAVE_FILE_KEY);
        store.delete(SAVE_BASELINE_KEY);
      } else {
        store.put(handle, SAVE_FILE_KEY);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  database.close();
};

export const loadSaveFileBaseline = async (): Promise<LocalSaveBaseline | null> => {
  if (typeof indexedDB === "undefined") return null;
  const database = await openHandleDatabase();
  if (database === null) return null;
  const baseline = await new Promise<LocalSaveBaseline | null>((resolve) => {
    try {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(SAVE_BASELINE_KEY);
      request.onsuccess = () => {
        const value = request.result as LocalSaveBaseline | undefined;
        resolve(
          value !== undefined &&
            typeof value.digest === "string" &&
            typeof value.sceneDigests === "object" &&
            value.sceneDigests !== null
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
  return baseline;
};

export const storeSaveFileBaseline = async (
  baseline: LocalSaveBaseline | null,
): Promise<void> => {
  if (typeof indexedDB === "undefined") return;
  const database = await openHandleDatabase();
  if (database === null) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (baseline === null) store.delete(SAVE_BASELINE_KEY);
      else store.put(baseline, SAVE_BASELINE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  database.close();
};
