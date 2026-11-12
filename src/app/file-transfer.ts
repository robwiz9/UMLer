/** Browser file helpers kept out of the framework-agnostic model. */

export const downloadTextFile = (
  filename: string,
  text: string,
  mimeType = "application/json;charset=utf-8",
): void => {
  const blob = new Blob([text], { type: mimeType });
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

export const readTextFile = async (file: File): Promise<string> => {
  try {
    return await file.text();
  } catch {
    throw new Error("The selected file could not be read.");
  }
};
