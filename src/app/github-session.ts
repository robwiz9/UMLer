/**
 * GitHub sign-in is kept in localStorage so a refresh and additional tabs use
 * the same device-flow session instead of asking for another sign-in.
 */

import type { GitHubSession } from "./github-client.ts";

const SESSION_STORAGE_KEY = "umler.github.session";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const loadStoredGitHubSession = (): GitHubSession | null => {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    // Fall through to the legacy per-tab location.
  }
  if (raw === null) {
    try {
      const legacy = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (legacy !== null) {
        raw = legacy;
        // Migrate a tab-scoped session from before this change so the user
        // does not have to sign in again after upgrading.
        try {
          window.localStorage.setItem(SESSION_STORAGE_KEY, legacy);
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {
          // Keep using the legacy value for this tab even if migration fails.
        }
      }
    } catch {
      return null;
    }
  }
  if (raw === null) return null;

  try {
    const payload = JSON.parse(raw) as unknown;
    if (!isRecord(payload) || typeof payload.token !== "string") return null;
    if (!isRecord(payload.user) || typeof payload.user.login !== "string") return null;
    if (payload.token.length === 0 || payload.user.login.length === 0) return null;
    return {
      token: payload.token,
      user: {
        login: payload.user.login,
        name: typeof payload.user.name === "string" ? payload.user.name : null,
        avatarUrl:
          typeof payload.user.avatarUrl === "string" ? payload.user.avatarUrl : "",
        htmlUrl:
          typeof payload.user.htmlUrl === "string" ? payload.user.htmlUrl : "",
      },
      ...(typeof payload.refreshToken === "string" && payload.refreshToken.length > 0
        ? { refreshToken: payload.refreshToken }
        : {}),
      ...(typeof payload.accessTokenExpiresAt === "string"
        ? { accessTokenExpiresAt: payload.accessTokenExpiresAt }
        : {}),
      ...(typeof payload.refreshTokenExpiresAt === "string"
        ? { refreshTokenExpiresAt: payload.refreshTokenExpiresAt }
        : {}),
    };
  } catch {
    return null;
  }
};

export const storeGitHubSession = (session: GitHubSession | null): void => {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore a blocked legacy storage area; localStorage below is canonical.
  }
  try {
    if (session === null) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A blocked storage area should not prevent the current session from working.
  }
};
