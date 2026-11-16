import { useCallback, useState } from "react";
import type { ObjectTemplateId } from "../model/object-catalog.ts";

const STORAGE_KEY = "umler.circuit.recent.v1";
const MAX_RECENTS = 6;

const isCircuitTemplateId = (value: string): value is ObjectTemplateId =>
  value === "circuit-node" || value.startsWith("circuit:");

export const readRecentCircuitTemplates = (): readonly ObjectTemplateId[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .filter(isCircuitTemplateId)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
};

export const rememberRecentCircuitTemplate = (
  templateId: ObjectTemplateId,
): readonly ObjectTemplateId[] => {
  if (!isCircuitTemplateId(templateId)) return readRecentCircuitTemplates();
  const next = [templateId, ...readRecentCircuitTemplates().filter((id) => id !== templateId)]
    .slice(0, MAX_RECENTS);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing / quota can reject storage; recents are optional.
    }
  }
  return next;
};

export const useCircuitRecents = (): {
  readonly recents: readonly ObjectTemplateId[];
  readonly remember: (templateId: ObjectTemplateId) => void;
} => {
  const [recents, setRecents] = useState<readonly ObjectTemplateId[]>(readRecentCircuitTemplates);
  const remember = useCallback((templateId: ObjectTemplateId) => {
    setRecents(rememberRecentCircuitTemplate(templateId));
  }, []);
  return { recents, remember };
};
