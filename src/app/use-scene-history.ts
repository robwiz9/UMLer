/**
 * Bounded undo/redo history for the immutable scene document.
 *
 * A scene snapshot is small and structurally immutable, so whole-document
 * snapshots are simpler and safer than command inversion. Updates that arrive
 * in a short burst (typing in a text field) are coalesced into one step.
 */

import { useCallback, useState } from "react";
import type { SceneDocument } from "../model/scene.ts";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 350;

type SceneUpdater = SceneDocument | ((current: SceneDocument) => SceneDocument);

interface HistoryState {
  readonly past: readonly SceneDocument[];
  readonly present: SceneDocument;
  readonly future: readonly SceneDocument[];
  readonly lastUpdateAt: number;
}

const restoreRevision = (
  snapshot: SceneDocument,
  current: SceneDocument,
): SceneDocument => ({
  ...snapshot,
  revision: current.revision + 1,
  meta: { ...snapshot.meta, updatedAt: new Date().toISOString() },
});

export const useSceneHistory = (initial: SceneDocument) => {
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initial,
    future: [],
    lastUpdateAt: 0,
  });

  const update = useCallback((updater: SceneUpdater) => {
    setHistory((current) => {
      const next =
        typeof updater === "function" ? updater(current.present) : updater;
      if (next === current.present) return current;
      const now = Date.now();
      const merge =
        now - current.lastUpdateAt < COALESCE_MS && current.past.length > 0;
      const past = merge
        ? current.past
        : [...current.past, current.present].slice(-HISTORY_LIMIT);
      return {
        past,
        present: next,
        future: [],
        lastUpdateAt: now,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (previous === undefined) return current;
      return {
        past: current.past.slice(0, -1),
        present: restoreRevision(previous, current.present),
        future: [current.present, ...current.future].slice(0, HISTORY_LIMIT),
        lastUpdateAt: 0,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (next === undefined) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: restoreRevision(next, current.present),
        future: current.future.slice(1),
        lastUpdateAt: 0,
      };
    });
  }, []);

  const reset = useCallback((scene: SceneDocument) => {
    setHistory({
      past: [],
      present: scene,
      future: [],
      lastUpdateAt: 0,
    });
  }, []);

  return {
    scene: history.present,
    setScene: update,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  } as const;
};
