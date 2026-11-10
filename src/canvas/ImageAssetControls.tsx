import { useRef, useState } from "react";
import type { ImageAsset, ImageNode } from "../model/nodes.ts";
import { isSupportedImageFile } from "../app/image-assets.ts";

interface ImageAssetControlsProps {
  readonly node: ImageNode;
  readonly imageAssets: Readonly<Record<string, ImageAsset>>;
  readonly onAssign: (file: File) => Promise<void>;
  readonly onUseAsset: (assetId: string) => void;
  readonly onRemove: () => void;
}

export const ImageAssetControls = ({
  node,
  imageAssets,
  onAssign,
  onUseAsset,
  onRemove,
}: ImageAssetControlsProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentAsset = node.assetId === undefined ? undefined : imageAssets[node.assetId];
  const hasImage = currentAsset?.dataUrl !== undefined;
  const availableAssets = Object.values(imageAssets)
    .filter((asset) => asset.dataUrl !== undefined)
    .sort((left, right) => left.fileName.localeCompare(right.fileName));

  const assign = async (file: File): Promise<void> => {
    if (!isSupportedImageFile(file)) {
      setError("Use a PNG, JPG or SVG image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAssign(file);
    } catch (assignmentError) {
      setError(
        assignmentError instanceof Error
          ? assignmentError.message
          : "The image could not be added.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (hasImage && currentAsset !== undefined) {
    return (
      <div className="image-asset-current">
        <span className="image-asset-name" title={currentAsset.fileName}>
          {currentAsset.fileName}
        </span>
        <button
          type="button"
          className="dialog-button danger image-remove"
          onClick={onRemove}
        >
          Remove image
        </button>
      </div>
    );
  }

  return (
    <div className="image-asset-picker">
      <label className="field-label">
        Use uploaded image
        <select
          value=""
          disabled={busy || availableAssets.length === 0}
          onChange={(event) => {
            if (event.target.value.length > 0) onUseAsset(event.target.value);
          }}
        >
          <option value="">
            {availableAssets.length === 0 ? "No uploaded images" : "Choose an image…"}
          </option>
          {availableAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.fileName}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={`image-drop-zone ${dragActive ? "on" : ""}`}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          const file = [...event.dataTransfer.files].find(isSupportedImageFile);
          if (file !== undefined) void assign(file);
        }}
      >
        <strong>{busy ? "Adding image…" : "Drop an image or choose a file"}</strong>
        <small>PNG, JPG or SVG · up to 10 MB</small>
      </button>
      <input
        ref={inputRef}
        id={`image-file-${node.id}`}
        name={`image-file-${node.id}`}
        className="file-input"
        type="file"
        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file !== undefined) void assign(file);
        }}
      />
      {error !== null ? <p className="image-error">{error}</p> : null}
    </div>
  );
};
