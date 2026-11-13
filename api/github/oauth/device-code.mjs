/**
 * Vercel Function: GitHub device-flow authorization start.
 *
 * GitHub's `/login/device/code` endpoint has no CORS headers. This same-origin
 * relay accepts the public client id from the app (or an environment variable)
 * and returns GitHub's JSON response unchanged. No client secret is involved.
 */

export const config = {
  api: {
    // Read the form body ourselves; this also works when the platform does not
    // pre-parse application/x-www-form-urlencoded.
    bodyParser: false,
  },
};

const CLIENT_ID_ENV_KEYS = [
  "GITHUB_OAUTH_CLIENT_ID",
  "VITE_GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_ID",
];

const readClientIdFromEnv = () => {
  for (const key of CLIENT_ID_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
};

const readBody = async (request) => {
  if (typeof request.body === "string") return new URLSearchParams(request.body);
  if (Buffer.isBuffer(request.body)) {
    return new URLSearchParams(request.body.toString("utf8"));
  }
  if (request.body && typeof request.body === "object") {
    return new URLSearchParams(request.body);
  }
  let raw = "";
  for await (const chunk of request) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  return new URLSearchParams(raw);
};

const validClientId = (value) => /^[A-Za-z0-9._-]{8,128}$/.test(value);

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({
      error: "method_not_allowed",
      error_description: "Use POST for the device-flow request.",
    });
    return;
  }

  const body = await readBody(request);
  const clientId = (body.get("client_id") ?? "").trim() || readClientIdFromEnv();
  if (!clientId) {
    response.status(500).json({
      error: "not_configured",
      error_description:
        "GitHub OAuth is not configured for this deployment. Set GITHUB_OAUTH_CLIENT_ID and redeploy.",
    });
    return;
  }
  if (!validClientId(clientId)) {
    response.status(400).json({
      error: "invalid_client_id",
      error_description: "The GitHub OAuth client id is not valid.",
    });
    return;
  }

  try {
    const upstream = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "UMLer",
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: "repo",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.send(text);
  } catch (error) {
    response.status(502).json({
      error: "proxy_unavailable",
      error_description:
        error instanceof Error
          ? `GitHub sign-in could not be reached: ${error.message}`
          : "GitHub sign-in could not be reached.",
    });
  }
}
