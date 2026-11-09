import type { RowId, SectionId } from "./ids.ts";

/**
 * Semantic destination for a canvas text double-click. The canvas only knows
 * what was clicked; the inspector owns the actual input and focus.
 */
export type CanvasTextTarget =
  | { readonly kind: "nodeName" }
  | { readonly kind: "stereotype" }
  | { readonly kind: "sectionTitle"; readonly sectionId: SectionId }
  | { readonly kind: "rowName"; readonly rowId: RowId }
  | { readonly kind: "rowType"; readonly rowId: RowId }
  | { readonly kind: "lifelineLabel" }
  | { readonly kind: "caption" }
  | { readonly kind: "commentBody" };

export interface CanvasTextFocusRequest {
  readonly nodeId: string;
  readonly target: CanvasTextTarget;
  /** Monotonic token so repeated double-clicks re-focus the same input. */
  readonly token: number;
}
