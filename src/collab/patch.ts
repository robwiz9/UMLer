/**
 * Structural JSON diff/apply for collaboration.
 *
 * The project uses id-keyed objects and id-bearing arrays. Arrays addressed by
 * id survive inserts/removes in another part of the same array; primitive
 * arrays are replaced wholesale because they have no stable identity.
 */

import type { CollabProject, Patch, PatchPath } from "./protocol.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const idOf = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.id === "string" ? value.id : undefined;

const isIdArray = (value: unknown): value is readonly Record<string, unknown>[] =>
  Array.isArray(value) &&
  value.every((entry) => idOf(entry) !== undefined);

const sameJson = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const pathText = (path: PatchPath): string =>
  path.length === 0 ? "/" : `/${path.map(String).join("/")}`;

const arrayIndexById = (array: readonly unknown[], id: string): number =>
  array.findIndex((entry) => idOf(entry) === id);

const resolveParent = (
  root: unknown,
  path: PatchPath,
): { readonly parent: Record<string, unknown> | unknown[]; readonly key: string | number } => {
  if (path.length === 0) throw new Error("Path must name a field.");
  let cursor = root;
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(cursor)) {
      const index =
        typeof segment === "number"
          ? segment
          : arrayIndexById(cursor, String(segment));
      if (index < 0 || index >= cursor.length) {
        throw new Error(`Unknown array item at ${pathText(path)}.`);
      }
      cursor = cursor[index];
    } else if (isRecord(cursor)) {
      cursor = cursor[String(segment)];
    } else {
      throw new Error(`Cannot traverse ${pathText(path)}.`);
    }
    if (cursor === undefined) throw new Error(`Missing path ${pathText(path)}.`);
  }
  if (!Array.isArray(cursor) && !isRecord(cursor)) {
    throw new Error(`Path ${pathText(path)} has no container.`);
  }
  return { parent: cursor, key: path[path.length - 1] as string | number };
};

const resolveArray = (root: unknown, path: PatchPath): unknown[] => {
  if (path.length === 0) {
    if (!Array.isArray(root)) throw new Error("Root is not an array.");
    return root;
  }
  const { parent, key } = resolveParent(root, path);
  const value = Array.isArray(parent)
    ? parent[typeof key === "number" ? key : arrayIndexById(parent, String(key))]
    : parent[String(key)];
  if (!Array.isArray(value)) throw new Error(`Path ${pathText(path)} is not an array.`);
  return value;
};

export const applyPatch = (root: CollabProject, patch: Patch): void => {
  const target = root as unknown as Record<string, unknown>;
  if (patch.op === "set") {
    const { parent, key } = resolveParent(target, patch.path);
    if (Array.isArray(parent)) {
      const index = typeof key === "number" ? key : arrayIndexById(parent, String(key));
      if (index < 0) throw new Error(`Unknown array item at ${pathText(patch.path)}.`);
      parent[index] = patch.value;
    } else {
      parent[String(key)] = patch.value;
    }
    return;
  }
  if (patch.op === "delete") {
    const { parent, key } = resolveParent(target, patch.path);
    if (Array.isArray(parent)) {
      const index = typeof key === "number" ? key : arrayIndexById(parent, String(key));
      if (index < 0) throw new Error(`Unknown array item at ${pathText(patch.path)}.`);
      parent.splice(index, 1);
    } else {
      delete parent[String(key)];
    }
    return;
  }
  if (patch.op === "insert") {
    const array = resolveArray(target, patch.path);
    const index = patch.beforeId === undefined ? -1 : arrayIndexById(array, patch.beforeId);
    array.splice(index < 0 ? array.length : index, 0, structuredClone(patch.value));
    return;
  }
  if (patch.op === "remove") {
    const array = resolveArray(target, patch.path);
    const index = arrayIndexById(array, patch.id);
    if (index < 0) throw new Error(`Unknown array item ${patch.id} at ${pathText(patch.path)}.`);
    array.splice(index, 1);
    return;
  }
  if (patch.op === "reorder") {
    const array = resolveArray(target, patch.path);
    const byId = new Map<string, unknown>();
    for (const entry of array) {
      const id = idOf(entry);
      if (id !== undefined) byId.set(id, entry);
    }
    const ordered: unknown[] = [];
    for (const id of patch.order) {
      const entry = byId.get(id);
      if (entry !== undefined) ordered.push(entry);
    }
    // Keep any array item a concurrent client inserted after this action was
    // computed instead of dropping it from the reorder.
    for (const entry of array) {
      if (!patch.order.includes(idOf(entry) ?? "")) ordered.push(entry);
    }
    array.splice(0, array.length, ...ordered);
    return;
  }
  const { parent, key } = resolveParent(target, patch.path);
  const value = structuredClone(patch.value);
  if (Array.isArray(parent)) {
    const index = typeof key === "number" ? key : arrayIndexById(parent, String(key));
    if (index < 0) throw new Error(`Unknown array item at ${pathText(patch.path)}.`);
    parent[index] = value;
  } else {
    parent[String(key)] = value;
  }
};

export const applyPatches = (
  project: CollabProject,
  patches: readonly Patch[],
): CollabProject => {
  const next = structuredClone(project) as CollabProject & Record<string, unknown>;
  for (const patch of patches) applyPatch(next as unknown as CollabProject, patch);
  return next;
};

const diffArray = (
  previous: readonly unknown[],
  next: readonly unknown[],
  path: PatchPath,
  patches: Patch[],
): void => {
  if (sameJson(previous, next)) return;
  if (isIdArray(previous) && isIdArray(next)) {
    const nextIds = new Set(next.map((entry) => idOf(entry) as string));
    const previousIds = new Set(previous.map((entry) => idOf(entry) as string));
    for (const entry of previous) {
      const id = idOf(entry);
      if (id !== undefined && !nextIds.has(id)) {
        patches.push({ op: "remove", path, id });
      }
    }
    for (let index = 0; index < next.length; index += 1) {
      const entry = next[index] as Record<string, unknown>;
      const id = idOf(entry) as string;
      if (!previousIds.has(id)) {
        const before = next[index + 1];
        patches.push({
          op: "insert",
          path,
          value: entry,
          beforeId: before === undefined ? undefined : idOf(before),
        });
      }
    }
    const previousOrder = previous
      .map((entry) => idOf(entry))
      .filter((id): id is string => id !== undefined && nextIds.has(id));
    const nextOrder = next
      .map((entry) => idOf(entry))
      .filter((id): id is string => id !== undefined && previousIds.has(id));
    if (previousOrder.join("\u0000") !== nextOrder.join("\u0000")) {
      patches.push({ op: "reorder", path, order: next.map((entry) => idOf(entry) as string) });
    }
    const previousById = new Map(previous.map((entry) => [idOf(entry) as string, entry]));
    for (const entry of next) {
      const id = idOf(entry) as string;
      const before = previousById.get(id);
      if (before !== undefined) diffValue(before, entry, [...path, id], patches);
    }
    return;
  }
  patches.push({ op: "replaceArray", path, value: next });
};

const diffValue = (
  previous: unknown,
  next: unknown,
  path: PatchPath,
  patches: Patch[],
): void => {
  if (sameJson(previous, next)) return;
  if (isRecord(previous) && isRecord(next)) {
    for (const key of Object.keys(previous)) {
      if (!(key in next)) patches.push({ op: "delete", path: [...path, key] });
    }
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) {
        if (key in previous) patches.push({ op: "delete", path: [...path, key] });
        continue;
      }
      if (!(key in previous)) {
        patches.push({ op: "set", path: [...path, key], value });
      } else {
        diffValue(previous[key], value, [...path, key], patches);
      }
    }
    return;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    diffArray(previous, next, path, patches);
    return;
  }
  patches.push({ op: "set", path, value: next });
};

export const diffProject = (
  previous: CollabProject,
  next: CollabProject,
): readonly Patch[] => {
  const patches: Patch[] = [];
  diffValue(previous, next, [], patches);
  return patches;
};

/** Apply patches received in server order, ignoring already-seen sequences. */
export class ProjectReplica {
  private project: CollabProject;
  private seq = 0;

  constructor(initial: CollabProject, seq = 0) {
    this.project = structuredClone(initial);
    this.seq = seq;
  }

  snapshot(): { readonly project: CollabProject; readonly seq: number } {
    return { project: this.project, seq: this.seq };
  }

  apply(seq: number, patches: readonly Patch[]): boolean {
    if (seq <= this.seq) return false;
    this.project = applyPatches(this.project, patches);
    this.seq = seq;
    return true;
  }

  replace(project: CollabProject, seq: number): void {
    this.project = structuredClone(project);
    this.seq = seq;
  }
}
