import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitHubTarget } from "../model/github-project.ts";
import {
  DEFAULT_GITHUB_PROJECT_FILE,
  githubFileNameOf,
  githubFolderOf,
  githubParentFolder,
  isGitHubProjectFile,
  joinGitHubFolder,
  joinGitHubPath,
} from "../model/github-project.ts";
import { deserializeProjectFile } from "../model/persistence.ts";
import {
  describeGitHubError,
  getProjectFile,
  listBranches,
  listDirectoryContents,
  listRepositories,
  loadGitHubOAuthConfig,
  loadSessionFromToken,
  pollDeviceAuthorization,
  startDeviceAuthorization,
  storeGitHubClientId,
  type GitHubBranch,
  type GitHubDeviceAuthorization,
  type GitHubDirectoryEntry,
  type GitHubOAuthConfig,
  type GitHubRepo,
  type GitHubSession,
} from "./github-client.ts";

interface GitHubProjectDialogProps {
  readonly session: GitHubSession | null;
  readonly initialTarget: GitHubTarget | null;
  readonly onSession: (session: GitHubSession | null) => void;
  readonly onOpen: (target: GitHubTarget) => Promise<void>;
  readonly onClose: () => void;
}

type FileStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "new" }
  | { readonly kind: "existing"; readonly scenes: number }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const PAT_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=UMLer";

const initialFolderOf = (target: GitHubTarget | null): string => {
  if (target === null) return "";
  try {
    return githubFolderOf(target.path);
  } catch {
    return "";
  }
};

const initialFileNameOf = (target: GitHubTarget | null): string => {
  if (target === null) return DEFAULT_GITHUB_PROJECT_FILE;
  try {
    return githubFileNameOf(target.path);
  } catch {
    return DEFAULT_GITHUB_PROJECT_FILE;
  }
};

const breadcrumbSegments = (folder: string): readonly string[] =>
  folder.split("/").filter((segment) => segment.length > 0);

export const GitHubProjectDialog = ({
  session,
  initialTarget,
  onSession,
  onOpen,
  onClose,
}: GitHubProjectDialogProps) => {
  const [config, setConfig] = useState<GitHubOAuthConfig | null>(null);
  const [device, setDevice] = useState<GitHubDeviceAuthorization | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoFilter, setRepoFilter] = useState("");
  const [repoFullName, setRepoFullName] = useState(
    initialTarget === null ? "" : `${initialTarget.owner}/${initialTarget.repo}`,
  );
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [branch, setBranch] = useState(initialTarget?.branch ?? "");
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [folder, setFolder] = useState(initialFolderOf(initialTarget));
  const [fileName, setFileName] = useState(initialFileNameOf(initialTarget));
  const [directories, setDirectories] = useState<GitHubDirectoryEntry[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);

  const [fileStatus, setFileStatus] = useState<FileStatus>({ kind: "idle" });
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.fullName === repoFullName),
    [repos, repoFullName],
  );

  useEffect(() => {
    let cancelled = false;
    void loadGitHubOAuthConfig().then((next) => {
      if (!cancelled) setConfig(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !openBusy) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, openBusy]);

  useEffect(() => {
    if (device === null || config === null || session !== null) return;
    let cancelled = false;
    let timer: number | undefined;
    let intervalSeconds = Math.max(5, device.interval);

    const poll = async (): Promise<void> => {
      try {
        const result = await pollDeviceAuthorization(config, device.deviceCode);
        if (cancelled) return;
        if (result.status === "authorized") {
          const nextSession = await loadSessionFromToken(result.token);
          if (cancelled) return;
          onSession(nextSession);
          setDevice(null);
          setAuthError(null);
          return;
        }
        if (result.status === "slow_down") intervalSeconds += 5;
        timer = window.setTimeout(() => {
          void poll();
        }, intervalSeconds * 1000);
      } catch (error) {
        if (cancelled) return;
        setAuthError(describeGitHubError(error));
        setDevice(null);
      }
    };

    timer = window.setTimeout(() => {
      void poll();
    }, intervalSeconds * 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [config, device, onSession, session]);

  useEffect(() => {
    if (session === null) {
      setRepos([]);
      setBranches([]);
      setDirectories([]);
      return;
    }

    let cancelled = false;
    setLoadingRepos(true);
    setRepoError(null);
    void listRepositories(session.token)
      .then((items) => {
        if (cancelled) return;
        setRepos(items);
        setRepoFullName((current) => {
          if (current.length > 0 && items.some((repo) => repo.fullName === current)) {
            return current;
          }
          return items[0]?.fullName ?? "";
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setRepoError(describeGitHubError(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (session === null || selectedRepo === undefined) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    setLoadingBranches(true);
    void listBranches(session.token, {
      owner: selectedRepo.owner,
      repo: selectedRepo.name,
    })
      .then((items) => {
        if (cancelled) return;
        setBranches(items);
        setBranch((current) => {
          if (current.length > 0 && items.some((item) => item.name === current)) {
            return current;
          }
          if (items.some((item) => item.name === selectedRepo.defaultBranch)) {
            return selectedRepo.defaultBranch;
          }
          return items[0]?.name ?? "";
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setRepoError(describeGitHubError(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, selectedRepo]);

  useEffect(() => {
    if (session === null || selectedRepo === undefined || branch.length === 0) {
      setDirectories([]);
      return;
    }
    let cancelled = false;
    setLoadingDirectories(true);
    setDirectoryError(null);
    void listDirectoryContents(session.token, {
      owner: selectedRepo.owner,
      repo: selectedRepo.name,
      branch,
      path: folder,
    })
      .then((items) => {
        if (!cancelled) setDirectories(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDirectoryError(describeGitHubError(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingDirectories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, selectedRepo, branch, folder]);

  const projectPath = useMemo(() => {
    try {
      return joinGitHubPath(folder, fileName);
    } catch {
      return null;
    }
  }, [folder, fileName]);

  const pathError = useMemo(() => {
    try {
      joinGitHubPath(folder, fileName);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Choose a valid project file name.";
    }
  }, [folder, fileName]);

  useEffect(() => {
    if (
      session === null ||
      selectedRepo === undefined ||
      branch.length === 0 ||
      projectPath === null
    ) {
      setFileStatus({ kind: "idle" });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFileStatus({ kind: "checking" });
      void getProjectFile(session.token, {
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch,
        path: projectPath,
      })
        .then((file) => {
          if (cancelled) return;
          if (file === null) {
            setFileStatus({ kind: "new" });
            return;
          }
          try {
            const project = deserializeProjectFile(file.text);
            setFileStatus({ kind: "existing", scenes: project.scenes.length });
          } catch (error) {
            setFileStatus({
              kind: "invalid",
              message: error instanceof Error ? error.message : "The file is not a UMLer project.",
            });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setFileStatus({ kind: "error", message: describeGitHubError(error) });
          }
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session, selectedRepo, branch, projectPath]);

  const repoOptions = useMemo(() => {
    const query = repoFilter.trim().toLowerCase();
    const filtered = query.length === 0
      ? repos
      : repos.filter((repo) => repo.fullName.toLowerCase().includes(query));
    if (
      selectedRepo !== undefined &&
      !filtered.some((repo) => repo.fullName === selectedRepo.fullName)
    ) {
      return [selectedRepo, ...filtered];
    }
    return filtered;
  }, [repoFilter, repos, selectedRepo]);

  const currentTarget: GitHubTarget | null =
    selectedRepo !== undefined && branch.length > 0 && projectPath !== null
      ? {
          owner: selectedRepo.owner,
          repo: selectedRepo.name,
          branch,
          path: projectPath,
        }
      : null;

  const startAuth = useCallback(async () => {
    if (config === null) return;
    setAuthBusy(true);
    setAuthError(null);
    setCopied(false);
    try {
      setDevice(await startDeviceAuthorization(config));
    } catch (error) {
      setAuthError(describeGitHubError(error));
    } finally {
      setAuthBusy(false);
    }
  }, [config]);

  const useToken = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const nextSession = await loadSessionFromToken(tokenDraft);
      onSession(nextSession);
      setTokenDraft("");
      setShowToken(false);
    } catch (error) {
      setAuthError(describeGitHubError(error));
    } finally {
      setAuthBusy(false);
    }
  }, [onSession, tokenDraft]);

  const saveOAuthClientId = useCallback(() => {
    const trimmed = clientIdDraft.trim();
    if (trimmed.length === 0) {
      setAuthError("Enter the OAuth App client id.");
      return;
    }
    storeGitHubClientId(trimmed);
    setConfig({ clientId: trimmed, oauthProxy: true });
    setShowSetup(false);
    setAuthError(null);
  }, [clientIdDraft]);

  const toggleOAuthSetup = useCallback(() => {
    setShowSetup((value) => {
      const next = !value;
      if (next) setClientIdDraft(config?.clientId ?? "");
      return next;
    });
  }, [config?.clientId]);

  const forgetOAuthClientId = useCallback(() => {
    storeGitHubClientId("");
    setClientIdDraft("");
    setShowSetup(false);
    setAuthError(null);
    setConfig({ clientId: "", oauthProxy: true });
  }, []);

  const signOut = useCallback(() => {
    onSession(null);
    setDevice(null);
    setAuthError(null);
    setRepos([]);
    setBranches([]);
    setDirectories([]);
    setFileStatus({ kind: "idle" });
  }, [onSession]);

  const chooseRepo = useCallback((fullName: string) => {
    const repo = repos.find((item) => item.fullName === fullName);
    setRepoFullName(fullName);
    setBranch(repo?.defaultBranch ?? "");
    setBranches([]);
    setFolder("");
    setFileName(DEFAULT_GITHUB_PROJECT_FILE);
    setNewFolderName("");
    setFolderError(null);
    setOpenError(null);
  }, [repos]);

  const chooseBranch = useCallback((name: string) => {
    setBranch(name);
    setFolder("");
    setNewFolderName("");
    setFolderError(null);
    setOpenError(null);
  }, []);

  const useNewFolder = useCallback(() => {
    setFolderError(null);
    try {
      if (newFolderName.trim().length === 0) return;
      setFolder(joinGitHubFolder(folder, newFolderName));
      setNewFolderName("");
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "The folder could not be used.",
      );
    }
  }, [folder, newFolderName]);

  const openProject = useCallback(async () => {
    if (currentTarget === null) return;
    setOpenBusy(true);
    setOpenError(null);
    try {
      await onOpen(currentTarget);
    } catch (error) {
      setOpenError(describeGitHubError(error));
    } finally {
      setOpenBusy(false);
    }
  }, [currentTarget, onOpen]);

  const copyCode = useCallback(async () => {
    if (device === null) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setAuthError("The code could not be copied. Select it and copy manually.");
    }
  }, [device]);

  const segments = breadcrumbSegments(folder);
  const atRoot = segments.length === 0;
  const subfolders = useMemo(
    () => directories.filter((entry) => entry.type === "dir"),
    [directories],
  );
  const projectFiles = useMemo(
    () =>
      directories.filter(
        (entry) => entry.type === "file" && isGitHubProjectFile(entry.name),
      ),
    [directories],
  );
  const canOpen =
    currentTarget !== null &&
    pathError === null &&
    fileStatus.kind !== "invalid" &&
    !openBusy;

  const renderAuth = () => (
    <div className="gh-auth">
      <p className="gh-intro">
        Connect a GitHub account to open a project file, or create one at a new
        repository location.
      </p>

      {authError !== null ? (
        <p className="gh-error" role="alert">
          {authError}
        </p>
      ) : null}

      {device !== null ? (
        <div className="gh-device">
          <div className="gh-device-label">Enter this code on GitHub</div>
          <div className="gh-device-code">{device.userCode}</div>
          <div className="gh-device-actions">
            <button type="button" className="dialog-button" onClick={() => void copyCode()}>
              {copied ? "Copied" : "Copy code"}
            </button>
            <a
              className="dialog-button primary gh-link"
              href={device.verificationUri}
              target="_blank"
              rel="noreferrer"
            >
              Open GitHub
            </a>
          </div>
          <p className="gh-note">
            Waiting for authorization… This window updates automatically.
          </p>
          <button
            type="button"
            className="gh-link-button"
            onClick={() => {
              setDevice(null);
              setAuthError(null);
            }}
          >
            Cancel sign-in
          </button>
        </div>
      ) : (
        <>
          {config === null ? (
            <p className="gh-note">Checking GitHub sign-in configuration…</p>
          ) : config.clientId.length > 0 && config.oauthProxy ? (
            <button
              type="button"
              className="dialog-button primary gh-sign-in"
              onClick={() => void startAuth()}
              disabled={authBusy}
            >
              {authBusy ? "Starting…" : "Sign in with GitHub"}
            </button>
          ) : (
            <p className="gh-note gh-note-warn">
              {!config.oauthProxy
                ? "GitHub sign-in needs the local dev server. Start UMLer with npm run dev, or use a personal access token below."
                : "GitHub OAuth needs a one-time OAuth App setup. Add its public client id below, or use a personal access token."}
            </p>
          )}

          {config !== null &&
          config.oauthProxy &&
          (config.clientId.length === 0 || showSetup) ? (
            <div className="gh-token-form">
              <label className="field-label">
                OAuth App client id
                <input
                  id="gh-client-id"
                  name="gh-client-id"
                  value={clientIdDraft}
                  onChange={(event) => setClientIdDraft(event.target.value)}
                  placeholder="Ov23li…"
                  spellCheck={false}
                />
              </label>
              <div className="gh-token-actions">
                <a
                  className="gh-link"
                  href="https://github.com/settings/developers"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create an OAuth App
                </a>
                <span className="gh-action-row">
                  {config.clientId.length > 0 ? (
                    <button
                      type="button"
                      className="gh-link-button"
                      onClick={forgetOAuthClientId}
                    >
                      Forget
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="dialog-button primary"
                    onClick={saveOAuthClientId}
                    disabled={clientIdDraft.trim().length === 0}
                  >
                    Use client id
                  </button>
                </span>
              </div>
              <p className="gh-note">
                In the OAuth App settings, enable “Device flow” and use any
                callback URL. The client id is public; no client secret is stored.
              </p>
            </div>
          ) : null}

          {config !== null && (config.clientId.length === 0 || !config.oauthProxy) ? (
            <div className="gh-token-form">
              <label className="field-label">
                Personal access token
                <input
                  id="gh-token"
                  name="gh-token"
                  type="password"
                  autoComplete="off"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder="github_pat_… or ghp_…"
                />
              </label>
              <div className="gh-token-actions">
                <a className="gh-link" href={PAT_URL} target="_blank" rel="noreferrer">
                  Create a token with repo scope
                </a>
                <button
                  type="button"
                  className="dialog-button primary"
                  onClick={() => void useToken()}
                  disabled={authBusy || tokenDraft.trim().length === 0}
                >
                  {authBusy ? "Checking…" : "Use token"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="gh-link-button"
              onClick={() => setShowToken((value) => !value)}
            >
              {showToken ? "Hide token sign-in" : "Use a personal access token instead"}
            </button>
          )}

          {config !== null && config.clientId.length > 0 && config.oauthProxy ? (
            <button
              type="button"
              className="gh-link-button"
              onClick={toggleOAuthSetup}
            >
              {showSetup ? "Hide OAuth settings" : "OAuth settings"}
            </button>
          ) : null}

          {showToken && config !== null && config.clientId.length > 0 && config.oauthProxy ? (
            <div className="gh-token-form">
              <label className="field-label">
                Personal access token
                <input
                  id="gh-token-optional"
                  name="gh-token-optional"
                  type="password"
                  autoComplete="off"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder="github_pat_… or ghp_…"
                />
              </label>
              <div className="gh-token-actions">
                <a className="gh-link" href={PAT_URL} target="_blank" rel="noreferrer">
                  Create a token
                </a>
                <button
                  type="button"
                  className="dialog-button primary"
                  onClick={() => void useToken()}
                  disabled={authBusy || tokenDraft.trim().length === 0}
                >
                  {authBusy ? "Checking…" : "Use token"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const renderPicker = () => (
    <div className="gh-picker">
      <div className="gh-account">
        <span>
          Signed in as <strong>{session?.user.login}</strong>
        </span>
        <button type="button" className="gh-link-button" onClick={signOut}>
          Sign out
        </button>
      </div>

      <div className="gh-repo-row">
        <label className="field-label">
          Repository
          <input
            id="gh-repo-filter"
            name="gh-repo-filter"
            value={repoFilter}
            onChange={(event) => setRepoFilter(event.target.value)}
            placeholder="Filter repositories"
            disabled={loadingRepos}
          />
        </label>
        <select
          id="gh-repo"
          name="gh-repo"
          className="gh-select"
          value={repoFullName}
          onChange={(event) => chooseRepo(event.target.value)}
          disabled={loadingRepos || repoOptions.length === 0}
          aria-label="Repository"
        >
          {repoOptions.length === 0 ? <option value="">No repositories</option> : null}
          {repoOptions.map((repo) => (
            <option key={repo.fullName} value={repo.fullName}>
              {repo.fullName}
              {repo.private ? " · private" : ""}
            </option>
          ))}
        </select>
        {loadingRepos ? <span className="gh-note">Loading repositories…</span> : null}
        {repoError !== null ? <p className="gh-error">{repoError}</p> : null}
      </div>

      {selectedRepo !== undefined ? (
        <>
          <div className="gh-branch-row">
            <label className="field-label">
              Branch
              <select
                id="gh-branch"
                name="gh-branch"
                className="gh-select"
                value={branch}
                onChange={(event) => chooseBranch(event.target.value)}
                disabled={loadingBranches || branches.length === 0}
              >
                {branches.length === 0 ? <option value="">No branches</option> : null}
                {branches.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {loadingBranches ? <span className="gh-note">Loading branches…</span> : null}
          </div>

          <div className="gh-location">
            <div className="gh-location-head">
              <span>Location</span>
              <span className="gh-location-repo">{selectedRepo.fullName}</span>
            </div>

            <div className="gh-breadcrumb">
              <button
                type="button"
                className={`gh-crumb ${atRoot ? "on" : ""}`}
                onClick={() => setFolder("")}
              >
                root
              </button>
              {segments.map((segment, index) => {
                const targetFolder = segments.slice(0, index + 1).join("/");
                return (
                  <span className="gh-crumb-wrap" key={targetFolder}>
                    <span className="gh-crumb-sep">/</span>
                    <button
                      type="button"
                      className={`gh-crumb ${index === segments.length - 1 ? "on" : ""}`}
                      onClick={() => setFolder(targetFolder)}
                    >
                      {segment}
                    </button>
                  </span>
                );
              })}
            </div>

            <div className="gh-dir-list">
              {loadingDirectories ? (
                <span className="gh-note">Loading contents…</span>
              ) : directoryError !== null ? (
                <p className="gh-error">{directoryError}</p>
              ) : (
                <>
                  {!atRoot ? (
                    <button
                      type="button"
                      className="gh-dir"
                      onClick={() => setFolder(githubParentFolder(folder))}
                    >
                      <span className="gh-dir-icon">↑</span>
                      <span>Parent folder</span>
                    </button>
                  ) : null}
                  {subfolders.map((entry) => (
                    <button
                      type="button"
                      className="gh-dir"
                      key={entry.path}
                      onClick={() => setFolder(entry.path)}
                    >
                      <span className="gh-dir-icon">▸</span>
                      <span>{entry.name}</span>
                    </button>
                  ))}
                  {projectFiles.map((entry) => (
                    <button
                      type="button"
                      className={`gh-dir gh-project-file ${fileName === entry.name ? "on" : ""}`}
                      key={entry.path}
                      onClick={() => {
                        setFileName(entry.name);
                        setOpenError(null);
                      }}
                    >
                      <span className="gh-dir-icon">▪</span>
                      <span>{entry.name}</span>
                    </button>
                  ))}
                  {subfolders.length === 0 && projectFiles.length === 0 ? (
                    <span className="gh-note">No folders or .umler projects here.</span>
                  ) : null}
                </>
              )}
            </div>

            <div className="gh-new-folder">
              <input
                id="gh-new-folder"
                name="gh-new-folder"
                value={newFolderName}
                onChange={(event) => {
                  setNewFolderName(event.target.value);
                  setFolderError(null);
                }}
                placeholder="New folder name"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={useNewFolder}
                disabled={newFolderName.trim().length === 0}
              >
                New folder
              </button>
            </div>
            <span className="gh-note">
              The folder is created when the project file is saved.
            </span>
            {folderError !== null ? <p className="gh-error">{folderError}</p> : null}

            <label className="field-label">
              Project file
              <input
                id="gh-file-name"
                name="gh-file-name"
                value={fileName}
                onChange={(event) => {
                  setFileName(event.target.value);
                  setOpenError(null);
                }}
                placeholder={DEFAULT_GITHUB_PROJECT_FILE}
                spellCheck={false}
              />
            </label>
            <div className="gh-path">
              {currentTarget === null ? "—" : currentTarget.path}
            </div>
            {pathError !== null ? <p className="gh-error">{pathError}</p> : null}

            <div className={`gh-file-status ${fileStatus.kind}`}>
              {fileStatus.kind === "idle" ? "Choose a repository, branch and file." : null}
              {fileStatus.kind === "checking" ? "Checking the selected path…" : null}
              {fileStatus.kind === "new" ? "New project file will be created here." : null}
              {fileStatus.kind === "existing"
                ? `Existing UMLer project · ${fileStatus.scenes} ${fileStatus.scenes === 1 ? "scene" : "scenes"}. It will load.`
                : null}
              {fileStatus.kind === "invalid"
                ? `A file exists here but it is not a valid project: ${fileStatus.message}`
                : null}
              {fileStatus.kind === "error" ? fileStatus.message : null}
            </div>
          </div>
        </>
      ) : null}

      {openError !== null ? <p className="gh-error">{openError}</p> : null}

      <div className="dialog-actions">
        <button type="button" className="dialog-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="dialog-button primary"
          onClick={() => void openProject()}
          disabled={!canOpen}
        >
          {openBusy
            ? "Working…"
            : fileStatus.kind === "new"
              ? "Create project"
              : "Open project"}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !openBusy) onClose();
      }}
    >
      <div
        className="dialog github-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-dialog-title"
      >
        <div className="dialog-head">
          <strong id="github-dialog-title">Open from GitHub</strong>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            title="Close dialog"
            disabled={openBusy}
          >
            ×
          </button>
        </div>

        {session === null ? renderAuth() : renderPicker()}
      </div>
    </div>
  );
};
