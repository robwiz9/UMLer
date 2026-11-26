/**
 * Browser-side administrator-key derivation for live collaboration.
 *
 * The administrator code never goes over the network. It is used as an HMAC key
 * over the room id, and only that per-room key is sent to the room server. A
 * leaked room key therefore unlocks one project, not every project.
 */

const toBase64Url = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const deriveRoomKey = async (
  administratorCode: string,
  roomId: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(administratorCode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(roomId));
  return toBase64Url(signature);
};

/** Convert the configured WebSocket URL to the matching HTTP endpoint. */
export const collaborationHttpUrl = (wsUrl: string): string =>
  wsUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
