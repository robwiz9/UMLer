/** Shared caption/gap metrics for image objects. */

import type { ImageNode } from "./nodes.ts";
import { resolveTextStyle } from "./styles.ts";

export const IMAGE_CAPTION_GAP = 4;

export const imageCaptionHeight = (node: ImageNode): number =>
  node.caption !== undefined && node.caption.length > 0
    ? Math.max(12, resolveTextStyle(node.style.text, node.textStyle).fontSize * 1.3)
    : 0;

export const imageCaptionBlockHeight = (node: ImageNode): number => {
  const height = imageCaptionHeight(node);
  return height > 0 ? height + IMAGE_CAPTION_GAP : 0;
};

/** Visible image-area height after reserving the caption and its gap. */
export const imageContentHeight = (node: ImageNode): number =>
  Math.max(1, node.frame.height - imageCaptionBlockHeight(node));

export const imageContentAspect = (node: ImageNode): number =>
  node.frame.width / imageContentHeight(node);

export const imageFrameHeightForWidth = (
  node: ImageNode,
  width: number,
  aspect: number,
): number =>
  Math.max(1, width / Math.max(0.0001, aspect)) + imageCaptionBlockHeight(node);
