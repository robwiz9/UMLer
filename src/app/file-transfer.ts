/** Browser file helpers kept out of the framework-agnostic model. */

export const downloadBlob = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadTextFile = (
  filename: string,
  text: string,
  mimeType = "application/json;charset=utf-8",
): void => {
  downloadBlob(filename, new Blob([text], { type: mimeType }));
};

export const downloadBinaryFile = (
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): void => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  downloadBlob(filename, new Blob([buffer], { type: mimeType }));
};

export const readTextFile = async (file: File): Promise<string> => {
  try {
    return await file.text();
  } catch {
    throw new Error("The selected file could not be read.");
  }
};
