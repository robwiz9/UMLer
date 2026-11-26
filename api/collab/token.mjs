/**
 * Vercel Function: mint a short-lived live-collaboration token.
 *
 * The browser presents its GitHub OAuth token and the bound project room. This
 * function verifies repository write access, then signs a room-scoped token
 * with COLLAB_SECRET. The collaboration server verifies that token; the GitHub
 * token is never sent to the collaboration server.
 */

import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const ROOM_PATTERN = /^([^/]+)\/([^@]+)@([^:]+):(.+)$/;

const base64url = (value) =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const sign = (payload, secret) => {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${data}.${signature}`;
};

const readBody = async (request) => {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(request.body)) {
    try {
      return JSON.parse(request.body.toString("utf8"));
    } catch {
      return null;
    }
  }
  let raw = "";
  for await (const chunk of request) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const github = async (path, token) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "UMLer collaboration",
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  return { ok: true, data: await response.json() };
};

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const secret = process.env.COLLAB_SECRET?.trim();
  if (!secret) {
    response.status(501).json({
      error: "not_configured",
      error_description:
        "Live collaboration is not configured. Set COLLAB_SECRET on the server and redeploy.",
    });
    return;
  }
  const body = await readBody(request);
  const githubToken = typeof body?.githubToken === "string" ? body.githubToken.trim() : "";
  const room = typeof body?.room === "string" ? body.room.trim() : "";
  const match = ROOM_PATTERN.exec(room);
  if (githubToken.length === 0 || match === null) {
    response.status(400).json({ error: "invalid_request" });
    return;
  }
  const [, owner, repo, branch, path] = match;
  if (branch.length === 0 || path.length === 0) {
    response.status(400).json({ error: "invalid_request" });
    return;
  }

  try {
    const userResult = await github("/user", githubToken);
    if (!userResult.ok) {
      response.status(401).json({ error: "github_unauthorized" });
      return;
    }
    const repoResult = await github(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      githubToken,
    );
    if (!repoResult.ok) {
      response.status(repoResult.status === 404 ? 404 : 403).json({ error: "repository_forbidden" });
      return;
    }
    const permissions = repoResult.data?.permissions ?? {};
    const canEdit = permissions.push === true || permissions.maintain === true ||
      permissions.admin === true;
    if (!canEdit) {
      response.status(403).json({
        error: "write_required",
        error_description: "Live editing requires push access to the repository.",
      });
      return;
    }
    const login = String(userResult.data?.login ?? "").trim();
    if (login.length === 0) {
      response.status(502).json({ error: "github_invalid_user" });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: login,
      name: String(userResult.data?.name ?? "").trim() || login,
      avatarUrl: String(userResult.data?.avatar_url ?? "").trim(),
      room,
      canEdit: true,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    };
    response.status(200).json({
      token: sign(payload, secret),
      user: {
        id: login,
        login,
        name: payload.name,
        avatarUrl: payload.avatarUrl,
      },
      room,
      canEdit: true,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } catch {
    response.status(502).json({ error: "github_unreachable" });
  }
}
