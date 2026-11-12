/**
 * Minimal GitHub REST client for project files.
 *
 * OAuth uses the device flow, which needs no client secret. GitHub does not
 * send CORS headers on its OAuth endpoints, so the Vite config exposes a tiny
 * same-origin proxy under `/github/oauth`. The REST API itself is called
 * directly (api.github.com allows browser CORS).
 */

import type { GitHubTarget } from "../model/github-project.ts";

const API_ROOT = "https://api.github.com";
const OAUTH_ROOT = "/github/oauth";
const API_VERSION = "2022-11-28";

export interface GitHubUser {
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string;
  readonly htmlUrl: string;
}

export interface GitHubSession {
  readonly token: string;
  readonly user: GitHubUser;
}

export interface GitHubRepo {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly htmlUrl: string;
  readonly canPush: boolean;
}

export interface GitHubBranch {
  readonly name: string;
}

export interface GitHubDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly type: "dir" | "file" | "symlink" | "submodule";
}

export interface GitHubRemoteFile {
  readonly text: string;
  readonly sha: string;
  readonly htmlUrl: string;
  readonly size: number;
}

export interface GitHubOAuthConfig {
  readonly clientId: string;
  readonly oauthProxy: boolean;
}

const CLIENT_ID_STORAGE_KEY = "umler.github.oauthClientId";

export const readStoredGitHubClientId = (): string => {
  try {
    return window.localStorage.getItem(CLIENT_ID_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

export const storeGitHubClientId = (clientId: string): void => {
  try {
    if (clientId.length === 0) {
      window.localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    }
  } catch {
    // Private browsing can reject storage; the in-memory config still works.
  }
};

export interface GitHubDeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export type DevicePollResult =
  | { readonly status: "pending" }
  | { readonly status: "slow_down" }
  | { readonly status: "authorized"; readonly token: string };

export class GitHubApiError extends Error {
  readonly status: number;
  readonly documentationUrl?: string;

  constructor(message: string, status: number, documentationUrl?: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.documentationUrl = documentationUrl;
  }
}

export class GitHubOAuthError extends Error {
  readonly code: string;
  readonly uri?: string;

  constructor(message: string, code: string, uri?: string) {
    super(message);
    this.name = "GitHubOAuthError";
    this.code = code;
    this.uri = uri;
  }
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readMessage = (data: unknown, fallback: string): string => {
  if (isRecord(data)) {
    if (typeof data.error_description === "string" && data.error_description.length > 0) {
      return data.error_description;
    }
    if (typeof data.message === "string" && data.message.length > 0) {
      return data.message;
    }
    if (typeof data.error === "string" && data.error.length > 0) {
      return data.error;
    }
  }
  return fallback;
};

const readDocumentationUrl = (data: unknown): string | undefined => {
  if (!isRecord(data) || typeof data.documentation_url !== "string") return undefined;
  return data.documentation_url;
};

const apiRequest = async (
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ data: unknown; headers: Headers }> => {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new GitHubApiError(
        "GitHub did not answer the request. Check the network and try again.",
        0,
      );
    }
    throw new GitHubApiError(
      "GitHub could not be reached. Check the network connection and try again.",
      0,
    );
  }

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = readMessage(
      data,
      response.status === 401
        ? "GitHub rejected the access token."
        : response.status === 403
          ? "GitHub denied the request. The token may be missing the repo scope or a rate limit was reached."
          : response.status === 404
            ? "GitHub could not find the repository, branch or path."
            : "GitHub rejected the request.",
    );
    throw new GitHubApiError(
      message,
      response.status,
      readDocumentationUrl(data),
    );
  }

  return { data, headers: response.headers };
};

const readRepo = (value: unknown): GitHubRepo | null => {
  if (!isRecord(value)) return null;
  const owner = isRecord(value.owner) && typeof value.owner.login === "string"
    ? value.owner.login
    : "";
  if (
    owner.length === 0 ||
    typeof value.name !== "string" ||
    typeof value.full_name !== "string"
  ) {
    return null;
  }
  const permissions = isRecord(value.permissions) ? value.permissions : {};
  return {
    owner,
    name: value.name,
    fullName: value.full_name,
    defaultBranch: typeof value.default_branch === "string" ? value.default_branch : "main",
    private: value.private === true,
    htmlUrl: typeof value.html_url === "string" ? value.html_url : "",
    canPush: permissions.push !== false,
  };
};

const readDirectoryEntry = (value: unknown): GitHubDirectoryEntry | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== "string" ||
    typeof value.path !== "string" ||
    (value.type !== "dir" &&
      value.type !== "file" &&
      value.type !== "symlink" &&
      value.type !== "submodule")
  ) {
    return null;
  }
  return { name: value.name, path: value.path, type: value.type };
};

const repoPath = (target: Pick<GitHubTarget, "owner" | "repo">): string =>
  `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;

const contentPath = (path: string): string =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const utf8ToBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64ToUtf8 = (value: string): string => {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8").decode(bytes);
};

const oauthPost = async (
  path: string,
  fields: Readonly<Record<string, string>>,
): Promise<UnknownRecord> => {
  let response: Response;
  try {
    response = await fetch(`${OAUTH_ROOT}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new GitHubOAuthError(
        "GitHub did not answer the sign-in request. Check the network and try again.",
        "timeout",
      );
    }
    throw new GitHubOAuthError(
      "The local GitHub sign-in service is unavailable. Start UMLer with `npm run dev` and try again.",
      "proxy_unavailable",
    );
  }

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (!isRecord(data)) {
    throw new GitHubOAuthError("GitHub sign-in failed. Try again.", "request_failed");
  }
  if (!response.ok && response.status !== 400) {
    const code = typeof data.error === "string" ? data.error : "request_failed";
    const message =
      response.status === 404
        ? "GitHub rejected the OAuth client id. Check that the OAuth App exists and has Device flow enabled."
        : readMessage(data, "GitHub sign-in failed. Try again.");
    throw new GitHubOAuthError(message, code);
  }
  return data;
};

const readOAuthError = (data: UnknownRecord): GitHubOAuthError | null => {
  if (typeof data.error !== "string") return null;
  const description = typeof data.error_description === "string"
    ? data.error_description
    : data.error;
  return new GitHubOAuthError(
    description,
    data.error,
    typeof data.error_uri === "string" ? data.error_uri : undefined,
  );
};

export const loadGitHubOAuthConfig = async (): Promise<GitHubOAuthConfig> => {
  const storedClientId = readStoredGitHubClientId();
  try {
    const response = await fetch(`${OAUTH_ROOT}/config`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { clientId: storedClientId, oauthProxy: false };
    const data = (await response.json()) as unknown;
    if (!isRecord(data) || typeof data.clientId !== "string") {
      return { clientId: storedClientId, oauthProxy: false };
    }
    return {
      clientId: data.clientId.length > 0 ? data.clientId : storedClientId,
      oauthProxy: data.proxy === true,
    };
  } catch {
    return { clientId: storedClientId, oauthProxy: false };
  }
};

export const startDeviceAuthorization = async (
  config: GitHubOAuthConfig,
): Promise<GitHubDeviceAuthorization> => {
  if (config.clientId.length === 0) {
    throw new GitHubOAuthError(
      "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and restart the dev server.",
      "not_configured",
    );
  }
  const data = await oauthPost("/device-code", {
    client_id: config.clientId,
    scope: "repo",
  });
  const oauthError = readOAuthError(data);
  if (oauthError !== null) throw oauthError;
  if (
    typeof data.device_code !== "string" ||
    typeof data.user_code !== "string" ||
    typeof data.verification_uri !== "string"
  ) {
    throw new GitHubOAuthError("GitHub returned an incomplete device-code response.", "bad_response");
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 900,
    interval: typeof data.interval === "number" ? data.interval : 5,
  };
};

export const pollDeviceAuthorization = async (
  config: GitHubOAuthConfig,
  deviceCode: string,
): Promise<DevicePollResult> => {
  const data = await oauthPost("/access-token", {
    client_id: config.clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (typeof data.access_token === "string" && data.access_token.length > 0) {
    return { status: "authorized", token: data.access_token };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "slow_down" };
  const oauthError = readOAuthError(data);
  if (oauthError !== null) throw oauthError;
  throw new GitHubOAuthError("GitHub did not return an access token.", "bad_response");
};

export const loadSessionFromToken = async (token: string): Promise<GitHubSession> => {
  const trimmed = token.trim();
  if (trimmed.length === 0) throw new Error("Enter a GitHub access token.");
  const { data } = await apiRequest(trimmed, "/user");
  if (!isRecord(data) || typeof data.login !== "string") {
    throw new GitHubApiError("GitHub did not return an account for this token.", 401);
  }
  return {
    token: trimmed,
    user: {
      login: data.login,
      name: typeof data.name === "string" ? data.name : null,
      avatarUrl: typeof data.avatar_url === "string" ? data.avatar_url : "",
      htmlUrl: typeof data.html_url === "string" ? data.html_url : "",
    },
  };
};

export const listRepositories = async (token: string): Promise<GitHubRepo[]> => {
  const repositories = new Map<string, GitHubRepo>();
  for (let page = 1; page <= 3; page += 1) {
    const { data } = await apiRequest(
      token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    if (!Array.isArray(data)) break;
    const pageRepos = data
      .map(readRepo)
      .filter((repo): repo is GitHubRepo => repo !== null);
    for (const repo of pageRepos) repositories.set(repo.fullName, repo);
    if (pageRepos.length < 100) break;
  }
  return [...repositories.values()].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
};

export const listBranches = async (
  token: string,
  target: Pick<GitHubTarget, "owner" | "repo">,
): Promise<GitHubBranch[]> => {
  const { data } = await apiRequest(token, `${repoPath(target)}/branches?per_page=100`);
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (branch): branch is { name: string } =>
        isRecord(branch) && typeof branch.name === "string",
    )
    .map((branch) => ({ name: branch.name }));
};

export const listDirectoryContents = async (
  token: string,
  target: GitHubTarget,
): Promise<GitHubDirectoryEntry[]> => {
  const suffix = target.path.length === 0
    ? ""
    : `/${contentPath(target.path)}`;
  let response: Response;
  try {
    response = await fetch(
      `${API_ROOT}${repoPath(target)}/contents${suffix}?ref=${encodeURIComponent(target.branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new GitHubApiError("GitHub could not be reached.", 0);
  }
  if (response.status === 404) return [];
  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new GitHubApiError(readMessage(data, "The folder could not be listed."), response.status);
  }
  if (!Array.isArray(data)) return [];
  return data
    .map(readDirectoryEntry)
    .filter((entry): entry is GitHubDirectoryEntry => entry !== null)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
};

export const getProjectFile = async (
  token: string,
  target: GitHubTarget,
): Promise<GitHubRemoteFile | null> => {
  const fileUrl = `${API_ROOT}${repoPath(target)}/contents/${contentPath(target.path)}?ref=${encodeURIComponent(target.branch)}`;
  let response: Response;
  try {
    response = await fetch(fileUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GitHubApiError("GitHub could not be reached.", 0);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GitHubApiError(
      readMessage(data, "The project file could not be read."),
      response.status,
    );
  }
  if (!isRecord(data) || data.type !== "file") {
    throw new GitHubApiError("The selected path is not a file.", response.status);
  }
  if (typeof data.sha !== "string") {
    throw new GitHubApiError("GitHub did not return a file revision.", response.status);
  }

  const size = typeof data.size === "number" ? data.size : 0;
  const htmlUrl = typeof data.html_url === "string" ? data.html_url : "";
  if (typeof data.content === "string" && data.content.length > 0) {
    return {
      text: base64ToUtf8(data.content),
      sha: data.sha,
      htmlUrl,
      size,
    };
  }

  // The contents API omits the body for files over 1 MB. Fetch the raw blob so
  // projects with embedded images still open.
  let rawResponse: Response;
  try {
    rawResponse = await fetch(fileUrl, {
      headers: {
        Accept: "application/vnd.github.raw",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GitHubApiError("The project file could not be downloaded.", 0);
  }
  if (!rawResponse.ok) {
    throw new GitHubApiError(
      "The project file could not be downloaded.",
      rawResponse.status,
    );
  }
  return {
    text: await rawResponse.text(),
    sha: data.sha,
    htmlUrl,
    size,
  };
};

export interface WriteProjectFileInput {
  readonly token: string;
  readonly target: GitHubTarget;
  readonly text: string;
  /** Known blob SHA. Omit only when creating a new file. */
  readonly sha: string | null;
  readonly message: string;
}

export const writeProjectFile = async (
  input: WriteProjectFileInput,
): Promise<{ sha: string; htmlUrl: string }> => {
  const { data } = await apiRequest(
    input.token,
    `${repoPath(input.target)}/contents/${contentPath(input.target.path)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        content: utf8ToBase64(input.text),
        branch: input.target.branch,
        ...(input.sha === null ? {} : { sha: input.sha }),
      }),
    },
  );
  if (!isRecord(data) || !isRecord(data.content) || typeof data.content.sha !== "string") {
    throw new GitHubApiError("GitHub saved the file but did not return its revision.", 200);
  }
  return {
    sha: data.content.sha,
    htmlUrl:
      isRecord(data.commit) && typeof data.commit.html_url === "string"
        ? data.commit.html_url
        : typeof data.content.html_url === "string"
          ? data.content.html_url
          : "",
  };
};

export const isGitHubConflict = (error: unknown): boolean => {
  if (!(error instanceof GitHubApiError)) return false;
  if (error.status === 409) return true;
  return error.status === 422 && /sha|conflict|already exists/i.test(error.message);
};

export const describeGitHubError = (error: unknown): string => {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return "GitHub rejected the token. Sign in again.";
    if (error.status === 403 && /rate limit/i.test(error.message)) {
      return "GitHub’s API rate limit was reached. Try again later.";
    }
    if (error.status === 403) {
      return "GitHub denied access. Check that the account can push to this repository.";
    }
    if (error.status === 404) {
      return "GitHub could not find the repository, branch or file. Check the selection.";
    }
    if (error.status === 409 || error.status === 422) {
      return `${error.message} The remote file may have changed. Try saving again to resolve it.`;
    }
    return error.message;
  }
  if (error instanceof GitHubOAuthError) {
    if (error.code === "access_denied") return "GitHub authorization was denied.";
    if (error.code === "expired_token") return "The GitHub sign-in code expired. Start again.";
    if (error.code === "device_flow_disabled") {
      return "Device flow is disabled for this OAuth App. Enable it in the OAuth App settings.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "The GitHub operation failed.";
};
