/**
 * Vercel Function: GitHub OAuth configuration.
 *
 * The client id is public by design. Keeping it in a server environment
 * variable means the same deployment can be moved between repositories without
 * rebuilding the frontend, and `.env.local` is not shipped to Vercel.
 */

const CLIENT_ID_ENV_KEYS = [
  "GITHUB_OAUTH_CLIENT_ID",
  "VITE_GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_ID",
];

const readClientId = () => {
  for (const key of CLIENT_ID_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
};

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({
      error: "method_not_allowed",
      error_description: "Use GET for the OAuth configuration.",
    });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    clientId: readClientId(),
    proxy: true,
  });
}
