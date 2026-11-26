/**
 * Bounded undo/redo history for the immutable scene document.
 *
 * A scene snapshot is small and structurally immutable, so whole-document
 * snapshots are simpler and safer than command inversion. Updates that arrive
 * in a short burst (typing in a text field) are coalesced into one step.
 */

import { useCallback, useState } from "react";
import type { SceneDocument } from "../model/scene.ts";
import {
  mergeNearbyCircuitJunctions,
  normalizeCircuitDuplicateConnections,
  normalizeCircuitJunctionStyles,
  normalizeCircuitPinConnections,
  refineAutoMergedJunctionStyles,
} from "../model/circuit-wires.ts";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 350;

type SceneUpdater = SceneDocument | ((current: SceneDocument) => SceneDocument);

export interface SceneUpdateOptions {
  /** Merge this update into the previous undo step. */
  readonly coalesce?: boolean;
  /** Force a fresh undo step even when the update arrives in a burst. */
  readonly newStep?: boolean;
  /** Internal preview/gesture updates that must not auto-connect coincident pins. */
  readonly skipNormalize?: boolean;
}

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

  const update = useCallback(
    (updater: SceneUpdater, options?: SceneUpdateOptions) => {
      setHistory((current) => {
        const raw =
          typeof updater === "function" ? updater(current.present) : updater;
        let next = raw;
        if (!options?.skipNormalize && raw.meta.diagramKind === "circuit") {
          next = normalizeCircuitPinConnections(raw);
          next = normalizeCircuitDuplicateConnections(next);
          next = mergeNearbyCircuitJunctions(next);
          next = normalizeCircuitDuplicateConnections(next);
          next = normalizeCircuitJunctionStyles(next);
          if (raw.layout.visualRefinements !== false) {
            next = refineAutoMergedJunctionStyles(next);
          }
        }
        if (next === current.present) return current;
        const now = Date.now();
        const merge = options?.coalesce === true
          ? true
          : options?.newStep === true
            ? false
            : now - current.lastUpdateAt < COALESCE_MS && current.past.length > 0;
        const past = merge
          ? current.past
          : [...current.past, current.present].slice(-HISTORY_LIMIT);
        return {
          past,
          present: next,
          future: [],
          lastUpdateAt: options?.coalesce === true ? 0 : now,
        };
      });
    },
    [],
  );

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

  /**
   * Replace the present scene without adding a local undo step. Used for
   * remote collaboration snapshots; remote changes are not locally undoable.
   */
  const replace = useCallback((scene: SceneDocument) => {
    setHistory((current) => ({
      ...current,
      present: scene,
      future: [],
      lastUpdateAt: 0,
    }));
  }, []);

  return {
    scene: history.present,
    setScene: update,
    undo,
    redo,
    reset,
    replace,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  } as const;
};
