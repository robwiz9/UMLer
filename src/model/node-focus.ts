import type { RowId, SectionId } from "./ids.ts";

/**
 * Canvas focus granularity for the floating object menu. Node selection is
 * still needed for dragging/resizing; this adds the table part the user
 * clicked.
 */
export type NodeFocus =
  | { readonly kind: "table"; readonly nodeId: string }
  | { readonly kind: "section"; readonly nodeId: string; readonly sectionId: SectionId }
  | { readonly kind: "row"; readonly nodeId: string; readonly rowId: RowId }
  | { readonly kind: "object"; readonly nodeId: string }
  /** Clicked the dashed spine at a scene-space y; the lifeline menu anchors there. */
  | { readonly kind: "lifelineSpine"; readonly nodeId: string; readonly y: number };
