/**
 * Reads a dropped PNG/JPEG/SVG into the project-level image asset shape.
 *
 * Asset bytes live as a data URL in the project JSON. The checksum lets the
 * same file be dropped again as a reference to the existing asset instead of
 * storing a second copy.
 */

import type { ImageAsset } from "../model/nodes.ts";
import type { ProjectAssets } from "../model/assets.ts";
import { findAssetByChecksum } from "../model/assets.ts";
import { asAssetId, newId } from "../model/ids.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
};

export const imageMimeType = (file: File): string | null => {
  const type = file.type.toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (type === "image/png" || type === "image/jpeg" || type === "image/svg+xml") {
    return type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[extension] ?? null;
};

export const isSupportedImageFile = (file: File): boolean =>
  imageMimeType(file) !== null;

const readDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(`${file.name}: could not be read.`));
    };
    reader.onerror = () => reject(new Error(`${file.name}: could not be read.`));
    reader.readAsDataURL(file);
  });

const measureRaster = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    image.onerror = () => reject(new Error("The image dimensions could not be read."));
    image.src = dataUrl;
  });

const measureSvg = async (
  file: File,
): Promise<{ width: number; height: number } | null> => {
  try {
    const text = await file.text();
    const width = /<svg[^>]*\swidth=["']?([\d.]+)/i.exec(text)?.[1];
    const height = /<svg[^>]*\sheight=["']?([\d.]+)/i.exec(text)?.[1];
    if (width !== undefined && height !== undefined) {
      const parsedWidth = Number(width);
      const parsedHeight = Number(height);
      if (parsedWidth > 0 && parsedHeight > 0) {
        return { width: parsedWidth, height: parsedHeight };
      }
    }
    const viewBox = /\bviewBox=["']([^"']+)["']/i.exec(text)?.[1];
    if (viewBox !== undefined) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && (parts[2] ?? 0) > 0 && (parts[3] ?? 0) > 0) {
        return { width: parts[2] ?? 0, height: parts[3] ?? 0 };
      }
    }
  } catch {
    return null;
  }
  return null;
};

const sha256Hex = async (file: File): Promise<string> => {
  if (crypto.subtle === undefined) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const createImageAssetFromFile = async (
  file: File,
  existingAssets: ProjectAssets,
): Promise<ImageAsset> => {
  const mimeType = imageMimeType(file);
  if (mimeType === null) {
    throw new Error(`${file.name}: use a PNG, JPG or SVG image.`);
  }
  if (file.size === 0) {
    throw new Error(`${file.name}: the image file is empty.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name}: images must be 10 MB or smaller.`);
  }

  const checksum = `sha256:${await sha256Hex(file)}`;
  const existing = findAssetByChecksum(existingAssets, checksum);
  if (existing !== undefined && existing.dataUrl !== undefined) {
    return existing;
  }

  const dataUrl = await readDataUrl(file);
  let dimensions = mimeType === "image/svg+xml" ? await measureSvg(file) : null;
  if (dimensions === null) {
    try {
      dimensions = await measureRaster(dataUrl);
    } catch {
      dimensions = null;
    }
  }
  const width = dimensions !== null && dimensions.width > 0 ? dimensions.width : 320;
  const height = dimensions !== null && dimensions.height > 0 ? dimensions.height : 180;
  const assetId = asAssetId(newId("asset"));
  const extension = MIME_EXTENSIONS[mimeType] ?? "png";

  return {
    id: assetId,
    kind: mimeType === "image/svg+xml" ? "vector" : "raster",
    fileName: file.name,
    mimeType,
    byteLength: file.size,
    intrinsicWidth: width,
    intrinsicHeight: height,
    checksum,
    storage: "project-file",
    dataUrl,
    exportPath: `assets/${assetId}.${extension}`,
  };
};
