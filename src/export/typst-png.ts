import { unitToPt, type PageSpec } from "./page.ts";

export interface TypstPngOptions {
  readonly page: PageSpec;
  readonly transparent: boolean;
}

const svgSize = (svg: string): { width: number; height: number } => {
  // Typst's SVG contains HTML entities (`&nbsp;`) inside foreignObject text,
  // which are valid in HTML but not in XML. Parse the opening tag directly.
  const opening = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const viewBoxMatch = /viewBox\s*=\s*"([^"]+)"/i.exec(opening);
  if (viewBoxMatch !== null) {
    const viewBox = viewBoxMatch[1]?.trim().split(/[\s,]+/).map(Number);
    if (
      viewBox !== undefined &&
      viewBox.length === 4 &&
      Number.isFinite(viewBox[2]) &&
      Number.isFinite(viewBox[3]) &&
      viewBox[2]! > 0 &&
      viewBox[3]! > 0
    ) {
      return { width: viewBox[2]!, height: viewBox[3]! };
    }
  }
  const widthMatch = /(?:^|\s)width\s*=\s*"([^"]+)"/i.exec(opening);
  const heightMatch = /(?:^|\s)height\s*=\s*"([^"]+)"/i.exec(opening);
  const width = Number.parseFloat(widthMatch?.[1] ?? "");
  const height = Number.parseFloat(heightMatch?.[1] ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  throw new Error("The rendered Typst page has no usable dimensions.");
};

const XML_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: "160",
  ensp: "8194",
  emsp: "8195",
  thinsp: "8201",
  ndash: "8211",
  mdash: "8212",
  hellip: "8230",
  times: "215",
  middot: "183",
  copy: "169",
  reg: "174",
  deg: "176",
  plusmn: "177",
  laquo: "171",
  raquo: "187",
  lsaquo: "8249",
  rsaquo: "8250",
};

/** Make Typst's browser-oriented SVG a standalone, image-safe document. */
export const cleanTypstSvg = (svg: string): string =>
  svg
    // Typst emits transparent foreignObject overlays for text selection.
    // They are not part of the visual page and taint a canvas when the SVG is
    // drawn as an image, so remove them before rasterization.
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    // Typst's SVG carries a small JS selection/zoom helper, which is not part
    // of the artwork and is not valid inside an SVG image.
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/&([a-z][a-z0-9]+);/gi, (entity, name: string) => {
      const code = XML_ENTITIES[name.toLowerCase()];
      return code === undefined ? entity : `&#${code};`;
    });

const loadSvg = (svg: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([cleanTypstSvg(svg)], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The rendered Typst page could not be rasterized."));
    };
    image.src = url;
  });

const contentBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  transparent: boolean,
): { x: number; y: number; width: number; height: number } | null => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 0;
      const r = data[offset] ?? 255;
      const g = data[offset + 1] ?? 255;
      const b = data[offset + 2] ?? 255;
      const occupied = transparent
        ? alpha > 8
        : 255 - Math.min(r, g, b) > 8 || alpha < 250;
      if (!occupied) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
};

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("The PNG image could not be encoded."));
      else resolve(blob);
    }, "image/png");
  });

/**
 * Rasterizes a Typst page, removes unused page whitespace, and keeps the page
 * margins around the remaining diagram. Transparent output leaves the
 * background clear instead of filling it with white.
 */
export const renderTypstPng = async (
  svg: string,
  options: TypstPngOptions,
): Promise<Blob> => {
  const scale = 2;
  const image = await loadSvg(svg);
  let size: { width: number; height: number };
  try {
    size = svgSize(svg);
  } catch {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error(
      "The rendered Typst page has no usable dimensions.",
    );
    size = { width: image.naturalWidth, height: image.naturalHeight };
  }
  const pageWidth = Math.max(1, Math.round(size.width * scale));
  const pageHeight = Math.max(1, Math.round(size.height * scale));

  const page = document.createElement("canvas");
  page.width = pageWidth;
  page.height = pageHeight;
  const context = page.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("Canvas rendering is unavailable.");
  context.clearRect(0, 0, pageWidth, pageHeight);
  if (!options.transparent) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageWidth, pageHeight);
  }
  context.drawImage(image, 0, 0, pageWidth, pageHeight);

  const pixels = context.getImageData(0, 0, pageWidth, pageHeight).data;
  const bounds = contentBounds(pixels, pageWidth, pageHeight, options.transparent);
  if (bounds === null) throw new Error("The exported page is empty.");

  const marginScale = pageWidth / size.width;
  const margin = {
    top: Math.round(unitToPt(options.page.margins.top, options.page.unit) * marginScale),
    right: Math.round(unitToPt(options.page.margins.right, options.page.unit) * marginScale),
    bottom: Math.round(unitToPt(options.page.margins.bottom, options.page.unit) * marginScale),
    left: Math.round(unitToPt(options.page.margins.left, options.page.unit) * marginScale),
  };
  const left = Math.max(0, bounds.x - margin.left);
  const top = Math.max(0, bounds.y - margin.top);
  const right = Math.min(pageWidth, bounds.x + bounds.width + margin.right);
  const bottom = Math.min(pageHeight, bounds.y + bounds.height + margin.bottom);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (outputContext === null) throw new Error("Canvas rendering is unavailable.");
  outputContext.clearRect(0, 0, width, height);
  if (!options.transparent) {
    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, width, height);
  }
  outputContext.drawImage(page, left, top, width, height, 0, 0, width, height);
  return canvasBlob(output);
};
