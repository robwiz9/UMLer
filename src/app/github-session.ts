/**
 * GitHub sign-in is kept in sessionStorage so a page refresh does not require
 * another device-flow round. Closing the tab/browser drops the token again.
 */

import type { GitHubSession } from "./github-client.ts";

const SESSION_STORAGE_KEY = "umler.github.session";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const loadStoredGitHubSession = (): GitHubSession | null => {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
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
    };
  } catch {
    return null;
  }
};

export const storeGitHubSession = (session: GitHubSession | null): void => {
  try {
    if (session === null) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A blocked storage area should not prevent the current session from working.
  }
};
