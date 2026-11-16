/**
 * Shared object clipboard storage.
 *
 * The in-memory clipboard is enough for one tab. Persisting the payload in
 * localStorage makes an object copy available to other UMLer tabs/windows in
 * the same browser profile. Storage events keep already-open tabs in sync;
 * paste also reads the value directly so a brand-new tab works immediately.
 */

import type { SceneClipboard } from "../model/clipboard.ts";

export const CLIPBOARD_STORAGE_KEY = "umler.objectClipboard.v1";
const STORAGE_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNodePayload = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === "string" &&
  isRecord(value.frame) &&
  isFiniteNumber(value.frame.x) &&
  isFiniteNumber(value.frame.y) &&
  isFiniteNumber(value.frame.width) &&
  isFiniteNumber(value.frame.height);

const isEdgePayload = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === "string" &&
  isRecord(value.source) &&
  isRecord(value.target) &&
  isRecord(value.routing) &&
  Array.isArray(value.routing.waypoints) &&
  Array.isArray(value.labels);

export const parseSceneClipboard = (raw: string | null): SceneClipboard | null => {
  if (raw === null || raw.length === 0) return null;
  try {
    const payload = JSON.parse(raw) as unknown;
    if (
      !isRecord(payload) ||
      payload.version !== STORAGE_VERSION ||
      !isRecord(payload.clipboard)
    ) {
      return null;
    }
    const clipboard = payload.clipboard;
    if (
      typeof clipboard.sceneId !== "string" ||
      typeof clipboard.diagramKind !== "string" ||
      !Array.isArray(clipboard.nodes) ||
      !Array.isArray(clipboard.edges) ||
      !isRecord(clipboard.assets) ||
      !clipboard.nodes.every(isNodePayload) ||
      !clipboard.edges.every(isEdgePayload)
    ) {
      return null;
    }
    return clipboard as unknown as SceneClipboard;
  } catch {
    return null;
  }
};

export const loadSceneClipboard = (): SceneClipboard | null => {
  try {
    return parseSceneClipboard(window.localStorage.getItem(CLIPBOARD_STORAGE_KEY));
  } catch {
    return null;
  }
};

/** Returns false when the payload is too large or storage is unavailable. */
export const storeSceneClipboard = (clipboard: SceneClipboard): boolean => {
  try {
    window.localStorage.setItem(
      CLIPBOARD_STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, clipboard }),
    );
    return true;
  } catch {
    return false;
  }
};

/** Keep an already-open tab's in-memory clipboard in step with other tabs. */
export const subscribeSceneClipboard = (
  listener: (clipboard: SceneClipboard | null) => void,
): (() => void) => {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== CLIPBOARD_STORAGE_KEY) return;
    listener(parseSceneClipboard(event.newValue));
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
};
