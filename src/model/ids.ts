/**
 * Branded identifiers.
 *
 * The scene graph is serialized to JSON and imported from user documents, so
 * IDs are treated as opaque strings with a compile-time brand. Branding stops
 * accidental cross-assignment (e.g. using a NodeId where an EdgeId is needed)
 * without adding a runtime wrapper that would complicate persistence.
 */

declare const idBrand: unique symbol;

type BrandedId<Name extends string> = string & {
  readonly [idBrand]: Name;
};

export type SceneId = BrandedId<"SceneId">;
export type NodeId = BrandedId<"NodeId">;
export type EdgeId = BrandedId<"EdgeId">;
export type RowId = BrandedId<"RowId">;
export type SectionId = BrandedId<"SectionId">;
export type LabelId = BrandedId<"LabelId">;
export type WaypointId = BrandedId<"WaypointId">;
export type ActivationId = BrandedId<"ActivationId">;
export type AssetId = BrandedId<"AssetId">;
export type PortId = BrandedId<"PortId">;

export const asSceneId = (value: string): SceneId => value as SceneId;
export const asNodeId = (value: string): NodeId => value as NodeId;
export const asEdgeId = (value: string): EdgeId => value as EdgeId;
export const asRowId = (value: string): RowId => value as RowId;
export const asSectionId = (value: string): SectionId => value as SectionId;
export const asLabelId = (value: string): LabelId => value as LabelId;
export const asWaypointId = (value: string): WaypointId => value as WaypointId;
export const asActivationId = (value: string): ActivationId => value as ActivationId;
export const asAssetId = (value: string): AssetId => value as AssetId;
export const asPortId = (value: string): PortId => value as PortId;

/** Lowercase, URL-safe slug used as a readable ID stem. */
export function idStem(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug.length > 0 ? slug : "item";
}

/**
 * A stable ID allocated by the editor. `crypto.randomUUID` is available in all
 * target browsers and Node 24; the fallback keeps model fixtures usable in
 * restricted runtimes.
 */
export function newId<Id extends string>(prefix: string): Id {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${suffix}` as unknown as Id;}
