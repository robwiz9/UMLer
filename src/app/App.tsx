import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { ER_COMMERCE, STEP1_FIXTURES } from "../fixtures/index.ts";
import type { Rect } from "../model/geometry.ts";
import type { DiagramKind, LayoutSpacing, SceneDocument } from "../model/scene.ts";
import { createEmptyScene, LAYOUT_SPACING_PRESETS } from "../model/scene.ts";
import {
  deserializeProjectFile,
  deserializeSceneFile,
  projectFileName,
  sceneFileName,
  serializeProjectFile,
  serializeSceneFile,
  type ImportedProject,
} from "../model/persistence.ts";
import { buildLayoutSnapshot, withNodeFrames } from "../layout/build-layout.ts";
import { autoLayoutFrames } from "../layout/auto-layout.ts";
import { CanvasTextMeasurer } from "../layout/text.ts";
import { zoomAtScreenPoint, type Camera, type ViewportSize } from "../canvas/camera.ts";
import { CanvasStage, type CanvasStageHandle } from "../canvas/CanvasStage.tsx";
import { GitHubDecisionDialog, type GitHubDecision, type GitHubDecisionOption } from "./GitHubDecisionDialog.tsx";
import { GitHubProjectDialog } from "./GitHubProjectDialog.tsx";
import { LayoutPanel } from "./LayoutPanel.tsx";
import { ProjectImportDialog } from "./ProjectImportDialog.tsx";
import { SceneDialog, type SceneDialogMode } from "./SceneDialog.tsx";
import { ThemePanel } from "./ThemePanel.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { downloadTextFile, readTextFile } from "./file-transfer.ts";
import { loadStoredGitHubSession, storeGitHubSession } from "./github-session.ts";
import { loadStoredProject, saveStoredProject } from "./project-storage.ts";
import {
  describeGitHubError,
  getProjectFile,
  isGitHubConflict,
  writeProjectFile,
  type GitHubRemoteFile,
  type GitHubSession,
} from "./github-client.ts";
import { useSceneHistory } from "./use-scene-history.ts";
import {
  compareRemoteFile,
  githubTargetLabel,
  projectDigest,
  projectTitleFromPath,
  type GitHubBinding,
  type GitHubTarget,
  type ProjectSnapshot,
} from "../model/github-project.ts";
import type {
  EdgeAttachment,
  EdgeLabelZone,
  EdgeRoutingMode,
} from "../model/edges.ts";
import type { EdgeEnd, EndpointMarker } from "../model/markers.ts";
import type { StrokePattern, TextStyleOverride, Theme } from "../model/styles.ts";
import type { CanvasTextFocusRequest, CanvasTextTarget } from "../model/text-targets.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { ImageAsset, SceneNode, TableRow, TableSection } from "../model/nodes.ts";
import { asEdgeId, asLabelId, asNodeId, asRowId, asSectionId, newId, type ActivationId, type SceneId } from "../model/ids.ts";
import { snap, type Point } from "../model/geometry.ts";
import type { ObjectTemplateId } from "../model/object-catalog.ts";
import { createImageObject, createObjectFromTemplate } from "../model/object-catalog.ts";
import { collectProjectAssets, pruneUnusedProjectAssets, unusedProjectAssets } from "../model/assets.ts";
import { copySceneNodes, pasteSceneClipboard, type SceneClipboard } from "../model/clipboard.ts";
import { convertNodeForDiagram } from "../model/convert.ts";
import { imageCaptionBlockHeight } from "../model/image-geometry.ts";
import { createImageAssetFromFile, isSupportedImageFile } from "./image-assets.ts";
import type { EdgeAttachmentRef, EdgeTargetRef, PortAttachmentRef } from "../model/edge-create.ts";
import { createEdgeForDiagram } from "../model/edge-create.ts";
import {
  addActivation,
  addRow,
  addSection,
  commitAutoLayout,
  deleteActivation,
  deleteEdge,
  deleteNode,
  deleteNodes,
  deleteRow,
  deleteSection,
  insertEdge,
  insertObject,
  insertSubgraph,
  insertConnectedObject,
  moveSequenceEdge,
  patchLayout,
  patchNode,
  rerouteEdge,
  setEdgeAttachment,
  setEdgeLabelOffset,
  setEdgeLabelTextStyle,
  setEndpointLabel,
  setMarker,
  setNodeImage,
  setRoutingMode,
  setSceneTheme,
  setStrokePattern,
  setStrokeWidth,
  updateActivation,
  updateRow,
  updateSection,
} from "../model/edits.ts";

/**
 * typst.ts and the compiler/renderer wrappers are sizeable and only needed
 * while the export panel is open, so keep them out of the editor's initial
 * bundle. The 28 MB WASM is still requested only on first preview compile.
 */
const CodePanel = lazy(() =>
  import("./CodePanel.tsx").then((module) => ({ default: module.CodePanel })),
);

const cloneSceneAs = (source: SceneDocument, title: string): SceneDocument => {
  const now = new Date().toISOString();
  return {
    ...source,
    id: newId<SceneId>("scene"),
    revision: 1,
    meta: {
      ...source.meta,
      title,
      createdAt: now,
      updatedAt: now,
    },
    nodes: { ...source.nodes },
    edges: { ...source.edges },
    assets: { ...source.assets },
  };
};

const importSceneCopy = (source: SceneDocument, title: string): SceneDocument => ({
  ...source,
  id: newId<SceneId>("scene"),
  revision: 1,
  meta: {
    ...source.meta,
    title,
    updatedAt: new Date().toISOString(),
  },
  nodes: { ...source.nodes },
  edges: { ...source.edges },
  assets: { ...source.assets },
});

const uniqueSceneTitle = (
  title: string,
  scenes: readonly SceneDocument[],
): string => {
  const base = title.replace(/ \(\d+\)$/, "").trim() || "Imported scene";
  const existing = new Set(scenes.map((scene) => scene.meta.title));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
};

const initialScenes = (): SceneDocument[] =>
  STEP1_FIXTURES.map((fixture) => fixture.scene);

const uploadProjectSnapshot = async (
  session: GitHubSession,
  target: GitHubTarget,
  snapshot: ProjectSnapshot,
  sha: string | null,
  message: string,
): Promise<{ sha: string; htmlUrl: string }> =>
  writeProjectFile({
    token: session.token,
    target,
    text: serializeProjectFile(
      snapshot.scenes,
      snapshot.activeSceneId,
      snapshot.assets,
    ),
    sha,
    message,
  });

const targetOf = (binding: GitHubBinding): GitHubTarget => ({
  owner: binding.owner,
  repo: binding.repo,
  branch: binding.branch,
  path: binding.path,
});

type ImportTarget = "scene" | "project";
type ToastTone = "info" | "error" | "warning" | "progress";
type GitHubSaveMode = "manual" | "auto";

interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

interface ToastOptions {
  readonly sticky?: boolean;
  readonly action?: ToastAction;
}

interface ToastMessage extends ToastOptions {
  readonly message: string;
  readonly tone: ToastTone;
}

interface PendingProjectImport {
  readonly project: ImportedProject;
  readonly fileName: string;
}

export const App = () => {
  const [initialProject] = useState(() => loadStoredProject());
  const initialScene =
    initialProject?.scenes.find((item) => item.id === initialProject.activeSceneId) ??
    initialProject?.scenes[0] ??
    ER_COMMERCE;
  const {
    scene,
    setScene,
    undo,
    redo,
    reset: resetHistory,
    canUndo,
    canRedo,
  } = useSceneHistory(initialScene);
  const [scenes, setScenes] = useState<SceneDocument[]>(() =>
    initialProject === null ? initialScenes() : [...initialProject.scenes],
  );
  const [baselineDigest, setBaselineDigest] = useState(() =>
    initialProject === null
      ? projectDigest(initialScenes(), ER_COMMERCE.id)
      : initialProject.baselineDigest,
  );
  const [activeSceneId, setActiveSceneId] = useState<string>(initialScene.id);
  const [sceneDialog, setSceneDialog] = useState<SceneDialogMode | null>(null);
  const [pendingProjectImport, setPendingProjectImport] =
    useState<PendingProjectImport | null>(null);
  const [githubSession, setGithubSession] = useState<GitHubSession | null>(() =>
    loadStoredGitHubSession(),
  );
  const [githubBinding, setGithubBinding] = useState<GitHubBinding | null>(() =>
    initialProject === null ? null : initialProject.githubBinding,
  );
  const [assetLibrary, setAssetLibrary] = useState<Record<string, ImageAsset>>(
    () =>
      initialProject === null
        ? {}
        : pruneUnusedProjectAssets(
            initialProject.scenes,
            initialProject.assets,
          ),
  );
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [githubBusy, setGithubBusy] = useState<"open" | "save" | null>(null);
  const [githubDecision, setGithubDecision] = useState<GitHubDecision | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  const [codePanelVisible, setCodePanelVisible] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedActivation, setSelectedActivation] = useState<{
    readonly nodeId: string;
    readonly activationId: ActivationId;
  } | null>(null);
  const [previewFrames, setPreviewFrames] = useState<Readonly<Record<string, Rect>>>({});
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [fontTick, setFontTick] = useState(0);
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<CanvasTextFocusRequest | null>(null);
  const [nodeFocus, setNodeFocus] = useState<NodeFocus | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clipboardRef = useRef<SceneClipboard | null>(null);
  const pasteOffsetRef = useRef(0);
  const importTargetRef = useRef<ImportTarget>("scene");
  const canvasStageRef = useRef<CanvasStageHandle | null>(null);
  const manualSaveRef = useRef<() => void>(() => {});
  const autoSaveRef = useRef<() => void>(() => {});

  const measurer = useMemo(() => new CanvasTextMeasurer(), [fontTick]);

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontTick((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setScenes((current) => {
      const index = current.findIndex((item) => item.id === scene.id);
      if (index < 0) return [...current, scene];
      if (current[index] === scene) return current;
      return current.map((item) => (item.id === scene.id ? scene : item));
    });
  }, [scene]);

  useEffect(() => {
    if (toast === null || toast.sticky === true) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" || toast.tone === "warning" ? 7000 : 2600,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentScenes = useMemo(
    () => scenes.map((item) => (item.id === scene.id ? scene : item)),
    [scene, scenes],
  );
  const currentDigest = useMemo(
    () => projectDigest(currentScenes, scene.id),
    [currentScenes, scene.id],
  );
  const projectDirty = currentDigest !== baselineDigest;
  const githubDirty =
    githubBinding !== null && currentDigest !== githubBinding.syncedDigest;
  const unusedImageCount = useMemo(
    () => unusedProjectAssets(currentScenes, assetLibrary).length,
    [assetLibrary, currentScenes],
  );
  const hasUnsavedChanges =
    githubBinding !== null ? githubDirty : projectDirty;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "Changes you made may not be saved.";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const persist = (): void => {
      saveStoredProject({
        scenes: currentScenes,
        activeSceneId: scene.id,
        baselineDigest,
        githubBinding,
        assets: assetLibrary,
      });
    };
    const timer = window.setTimeout(persist, 250);
    window.addEventListener("pagehide", persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
    };
  }, [assetLibrary, baselineDigest, currentScenes, githubBinding, scene.id]);

  const effectiveScene = useMemo(() => withNodeFrames(scene, previewFrames), [scene, previewFrames]);
  const layout = useMemo(
    () => buildLayoutSnapshot(effectiveScene, measurer),
    [effectiveScene, measurer, fontTick],
  );
  const exportAssets = useMemo(
    () => ({ ...scene.assets, ...assetLibrary }),
    [scene.assets, assetLibrary],
  );

  const loadScene = useCallback((sceneId: string) => {
    const target = scenes.find((item) => item.id === sceneId);
    if (target === undefined) return;
    setActiveSceneId(sceneId);
    resetHistory(target);
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setSelectedActivation(null);
    setPreviewFrames({});
    setLayoutNote(null);
    setFocusRequest(null);
    setNodeFocus(null);
    setFitNonce((value) => value + 1);
  }, [resetHistory, scenes]);

  const commitFrames = useCallback((frames: Readonly<Record<string, Rect>>) => {
    setScene((current) => {
      const next = withNodeFrames(current, frames);
      return {
        ...next,
        revision: current.revision + 1,
        meta: { ...next.meta, updatedAt: new Date().toISOString() },
      };
    });
    setPreviewFrames({});
  }, []);

  const clearTransientSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setSelectedActivation(null);
    setNodeFocus(null);
    setFocusRequest(null);
    setPreviewFrames({});
  }, []);

  const activateSceneDocument = useCallback(
    (next: SceneDocument) => {
      setActiveSceneId(next.id);
      resetHistory(next);
      clearTransientSelection();
      setLayoutNote(null);
      setFitNonce((value) => value + 1);
    },
    [clearTransientSelection, resetHistory],
  );

  const startNewProject = useCallback(
    (next: SceneDocument) => {
      const nextScenes = [next];
      setScenes(nextScenes);
      setAssetLibrary(collectProjectAssets(nextScenes));
      activateSceneDocument(next);
      setBaselineDigest(projectDigest(nextScenes, next.id));
      setGithubBinding(null);
      setGithubDecision(null);
    },
    [activateSceneDocument],
  );

  const duplicateScene = useCallback(() => {
    const baseTitle = scene.meta.title.replace(/ \(\d+\)$/, "");
    const existing = new Set(scenes.map((item) => item.meta.title));
    let suffix = 2;
    while (existing.has(`${baseTitle} (${suffix})`)) suffix += 1;
    const clone = cloneSceneAs(scene, `${baseTitle} (${suffix})`);
    setScenes((current) => [...current, clone]);
    activateSceneDocument(clone);
  }, [activateSceneDocument, scene, scenes]);

  const deleteActiveScene = useCallback(() => {
    if (scenes.length <= 1) return;
    const index = scenes.findIndex((item) => item.id === activeSceneId);
    const remaining = scenes.filter((item) => item.id !== activeSceneId);
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    if (next === undefined) return;
    setScenes(remaining);
    activateSceneDocument(next);
  }, [activateSceneDocument, activeSceneId, scenes]);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "info", options?: ToastOptions) => {
      setToast({ message, tone, ...options });
    },
    [],
  );

  const handleSceneDialogSubmit = useCallback(
    (
      name: string,
      diagramKind: DiagramKind,
      startMode: "template" | "empty",
    ) => {
      const mode = sceneDialog;
      setSceneDialog(null);
      if (mode === "new" || mode === "new-project") {
        const template = startMode === "template"
          ? STEP1_FIXTURES.find(
              (fixture) => fixture.scene.meta.diagramKind === diagramKind,
            )?.scene
          : undefined;
        const next = template === undefined
          ? createEmptyScene(diagramKind, name)
          : cloneSceneAs(template, name);
        if (mode === "new-project") {
          startNewProject(next);
          showToast("New project started.");
        } else {
          setScenes((current) => [...current, next]);
          setAssetLibrary((current) => ({
            ...current,
            ...collectProjectAssets([next]),
          }));
          activateSceneDocument(next);
        }
      } else if (mode === "rename") {
        setScene((current) => ({
          ...current,
          revision: current.revision + 1,
          meta: { ...current.meta, title: name, updatedAt: new Date().toISOString() },
        }));
      } else if (mode === "delete") {
        deleteActiveScene();
      }
    },
    [activateSceneDocument, deleteActiveScene, sceneDialog, setScene, startNewProject, showToast],
  );

  const handleExportScene = useCallback(() => {
    try {
      downloadTextFile(
        sceneFileName(scene.meta.title),
        serializeSceneFile(scene),
      );
      showToast("Scene exported.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "The scene could not be exported.",
        "error",
      );
    }
  }, [scene, showToast]);

  const handleExportProject = useCallback(() => {
    try {
      downloadTextFile(
        projectFileName(),
        serializeProjectFile(currentScenes, scene.id, assetLibrary),
      );
      showToast(`Project exported · ${currentScenes.length} scenes.`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "The project could not be exported.",
        "error",
      );
    }
  }, [assetLibrary, currentScenes, scene.id, showToast]);

  const requestImport = useCallback((target: ImportTarget) => {
    importTargetRef.current = target;
    const input = fileInputRef.current;
    if (input === null) return;
    input.value = "";
    input.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      const target = importTargetRef.current;
      input.value = "";
      if (file === undefined) return;

      try {
        const text = await readTextFile(file);
        if (target === "scene") {
          const imported = deserializeSceneFile(text);
          const title = uniqueSceneTitle(imported.meta.title, currentScenes);
          const copy = importSceneCopy(imported, title);
          setScenes([...currentScenes, copy]);
          setAssetLibrary((current) => ({
            ...current,
            ...collectProjectAssets([copy]),
          }));
          activateSceneDocument(copy);
          showToast(`Imported scene “${title}”.`);
        } else {
          const project = deserializeProjectFile(text);
          setPendingProjectImport({ project, fileName: file.name });
        }
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "The file could not be imported.",
          "error",
        );
      }
    },
    [activateSceneDocument, currentScenes, showToast],
  );

  const confirmProjectImport = useCallback(() => {
    if (pendingProjectImport === null) return;
    const active =
      pendingProjectImport.project.scenes.find(
        (item) => item.id === pendingProjectImport.project.activeSceneId,
      ) ?? pendingProjectImport.project.scenes[0];
    if (active === undefined) {
      showToast("The project does not contain an active scene.", "error");
      setPendingProjectImport(null);
      return;
    }
    setScenes([...pendingProjectImport.project.scenes]);
    setAssetLibrary({
      ...collectProjectAssets(pendingProjectImport.project.scenes),
      ...pendingProjectImport.project.assets,
    });
    activateSceneDocument(active);
    setBaselineDigest(
      projectDigest(pendingProjectImport.project.scenes, active.id),
    );
    setGithubBinding(null);
    setPendingProjectImport(null);
    showToast(
      `Imported project · ${pendingProjectImport.project.scenes.length} scenes.`,
    );
  }, [activateSceneDocument, pendingProjectImport, showToast]);

  const askGitHub = useCallback((decision: GitHubDecision) => {
    setToast(null);
    setGithubDecision(decision);
    setGithubDialogOpen(false);
  }, []);

  const applyRemoteProject = useCallback(
    (
      target: GitHubTarget,
      remote: GitHubRemoteFile,
      project: ImportedProject,
    ) => {
      const active =
        project.scenes.find((item) => item.id === project.activeSceneId) ??
        project.scenes[0];
      if (active === undefined) {
        throw new Error("The remote project does not contain any scenes.");
      }
      const digest = projectDigest(project.scenes, active.id);
      setScenes([...project.scenes]);
      setAssetLibrary({
        ...collectProjectAssets(project.scenes),
        ...project.assets,
      });
      activateSceneDocument(active);
      setBaselineDigest(digest);
      setGithubBinding({
        ...target,
        sha: remote.sha,
        syncedDigest: digest,
        syncedAt: new Date().toISOString(),
        htmlUrl: remote.htmlUrl,
      });
      setGithubDecision(null);
      setGithubDialogOpen(false);
      showToast(`Opened ${target.owner}/${target.repo} · ${target.path}`);
    },
    [activateSceneDocument, showToast],
  );

  const commitSnapshotToGitHub = useCallback(
    async (
      target: GitHubTarget,
      snapshot: ProjectSnapshot,
      sha: string | null,
      digest: string,
      message: string,
      mode: GitHubSaveMode = "manual",
    ): Promise<void> => {
      if (githubSession === null) {
        throw new Error("Sign in to GitHub before saving.");
      }
      setGithubBusy("save");
      try {
        const result = await uploadProjectSnapshot(
          githubSession,
          target,
          snapshot,
          sha,
          message,
        );
        setGithubBinding({
          ...target,
          sha: result.sha,
          syncedDigest: digest,
          syncedAt: new Date().toISOString(),
          htmlUrl: result.htmlUrl,
        });
        setBaselineDigest(digest);
        setGithubDecision(null);
        setGithubDialogOpen(false);
        showToast(
          mode === "auto"
            ? `Auto-saved to GitHub · ${target.path}`
            : `Saved to GitHub · ${target.owner}/${target.repo} · ${target.path}`,
        );
      } finally {
        setGithubBusy(null);
      }
    },
    [githubSession, showToast],
  );

  const createBlankRemoteProject = useCallback(
    async (target: GitHubTarget): Promise<void> => {
      if (githubSession === null) {
        throw new Error("Sign in to GitHub before creating a project.");
      }
      const scene = createEmptyScene(
        "er",
        projectTitleFromPath(target.path),
      );
      const snapshot: ProjectSnapshot = {
        scenes: [scene],
        activeSceneId: scene.id,
        assets: {},
      };
      const digest = projectDigest(snapshot.scenes, snapshot.activeSceneId);
      setGithubBusy("open");
      try {
        const result = await uploadProjectSnapshot(
          githubSession,
          target,
          snapshot,
          null,
          "Create project from UMLer",
        );
        setScenes([scene]);
        setAssetLibrary({});
        activateSceneDocument(scene);
        setBaselineDigest(digest);
        setGithubBinding({
          ...target,
          sha: result.sha,
          syncedDigest: digest,
          syncedAt: new Date().toISOString(),
          htmlUrl: result.htmlUrl,
        });
        setGithubDecision(null);
        setGithubDialogOpen(false);
        showToast(`Created ${target.owner}/${target.repo} · ${target.path}`);
      } finally {
        setGithubBusy(null);
      }
    },
    [activateSceneDocument, githubSession, showToast],
  );

  const presentSaveConflict = useCallback(
    (
      target: GitHubTarget,
      remote: GitHubRemoteFile,
      snapshot: ProjectSnapshot,
      digest: string,
      mode: GitHubSaveMode = "manual",
    ) => {
      const warnAutoConflict = (message: string): void => {
        showToast(message, "warning", {
          sticky: true,
          action: {
            label: "Review",
            run: () => manualSaveRef.current(),
          },
        });
      };

      let remoteProject: ImportedProject | null = null;
      try {
        remoteProject = deserializeProjectFile(remote.text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The remote file is invalid.";
        if (mode === "auto") {
          warnAutoConflict(
            "GitHub conflict: the remote file is not a valid UMLer project. Click to review.",
          );
          return;
        }
        askGitHub({
          title: "Remote file is not a valid project",
          message: `${target.path} changed on GitHub, but it cannot be read as a UMLer project. Overwriting replaces it with the local project.`,
          detail: message,
          options: [
            {
              label: "Overwrite remote",
              tone: "primary",
              run: () =>
                commitSnapshotToGitHub(
                  target,
                  snapshot,
                  remote.sha,
                  digest,
                  "Overwrite project from UMLer",
                ),
            },
          ],
        });
        return;
      }

      const remoteDigest = projectDigest(
        remoteProject.scenes,
        remoteProject.activeSceneId,
      );
      if (remoteDigest === digest) {
        setGithubBinding({
          ...target,
          sha: remote.sha,
          syncedDigest: digest,
          syncedAt: new Date().toISOString(),
          htmlUrl: remote.htmlUrl,
        });
        setBaselineDigest(digest);
        setGithubDecision(null);
        setGithubDialogOpen(false);
        showToast(
          mode === "auto"
            ? "Auto-synced with GitHub."
            : "Project is already up to date.",
        );
        return;
      }

      if (mode === "auto") {
        warnAutoConflict(
          `GitHub conflict: ${target.path} changed remotely. Click to review.`,
        );
        return;
      }

      askGitHub({
        title: "Remote project changed",
        message: `${target.path} has changes on GitHub. Choose which copy to keep.`,
        detail: githubTargetLabel(target),
        options: [
          {
            label: "Replace local with remote",
            tone: "danger",
            run: () => applyRemoteProject(target, remote, remoteProject),
          },
          {
            label: "Overwrite remote",
            tone: "primary",
            run: () =>
              commitSnapshotToGitHub(
                target,
                snapshot,
                remote.sha,
                digest,
                "Overwrite project from UMLer",
              ),
          },
        ],
      });
    },
    [applyRemoteProject, askGitHub, commitSnapshotToGitHub, showToast],
  );

  const openFromGitHub = useCallback(
    async (target: GitHubTarget): Promise<void> => {
      if (githubSession === null) {
        throw new Error("Sign in to GitHub before opening a project.");
      }
      if (githubBusy !== null) {
        throw new Error("Another GitHub operation is still running.");
      }
      setGithubBusy("open");
      try {
        const remote = await getProjectFile(githubSession.token, target);
        const snapshot: ProjectSnapshot = {
          scenes: currentScenes,
          activeSceneId: scene.id,
          assets: assetLibrary,
        };
        const localDirty = currentDigest !== baselineDigest;

        if (remote === null) {
          if (localDirty) {
            askGitHub({
              title: "Create a project on GitHub?",
              message: `No project exists at ${target.path}. Creating one replaces the current local project.`,
              detail: githubTargetLabel(target),
              options: [
                {
                  label: "Create blank project",
                  tone: "primary",
                  run: () => createBlankRemoteProject(target),
                },
                {
                  label: "Upload current project",
                  run: () =>
                    commitSnapshotToGitHub(
                      target,
                      snapshot,
                      null,
                      currentDigest,
                      "Create project from UMLer",
                    ),
                },
              ],
            });
            return;
          }
          await createBlankRemoteProject(target);
          return;
        }

        const project = deserializeProjectFile(remote.text);
        const remoteDigest = projectDigest(project.scenes, project.activeSceneId);

        if (remoteDigest === currentDigest) {
          setGithubBinding({
            ...target,
            sha: remote.sha,
            syncedDigest: currentDigest,
            syncedAt: new Date().toISOString(),
            htmlUrl: remote.htmlUrl,
          });
          setBaselineDigest(currentDigest);
          setGithubDecision(null);
          setGithubDialogOpen(false);
          showToast(`Opened ${target.owner}/${target.repo} · ${target.path}`);
          return;
        }

        if (localDirty) {
          askGitHub({
            title: "Replace the local project?",
            message: `The project at ${target.path} exists and your local project has unsaved changes. Choose which copy to keep.`,
            detail: githubTargetLabel(target),
            options: [
              {
                label: "Replace local with remote",
                tone: "danger",
                run: () => applyRemoteProject(target, remote, project),
              },
              {
                label: "Overwrite remote",
                tone: "primary",
                run: () =>
                  commitSnapshotToGitHub(
                    target,
                    snapshot,
                    remote.sha,
                    currentDigest,
                    "Overwrite project from UMLer",
                  ),
              },
            ],
          });
          return;
        }

        applyRemoteProject(target, remote, project);
      } finally {
        setGithubBusy(null);
      }
    },
    [
      applyRemoteProject,
      askGitHub,
      baselineDigest,
      commitSnapshotToGitHub,
      createBlankRemoteProject,
      currentDigest,
      currentScenes,
      githubBusy,
      githubSession,
      assetLibrary,
      scene.id,
      showToast,
    ],
  );

  const saveToGitHub = useCallback(
    async (mode: GitHubSaveMode = "manual"): Promise<void> => {
      if (githubBinding === null) {
        if (mode === "manual") {
          setGithubDialogOpen(true);
          showToast("Open a GitHub project before saving.");
        }
        return;
      }
      if (githubSession === null) {
        if (mode === "manual") {
          setGithubDialogOpen(true);
          showToast("Sign in to GitHub before saving.", "error");
        }
        return;
      }
      if (currentDigest === githubBinding.syncedDigest) {
        if (mode === "manual") showToast("Project is already synced.");
        return;
      }
      if (githubBusy !== null) return;

      const target = targetOf(githubBinding);
      const snapshot: ProjectSnapshot = {
        scenes: currentScenes,
        activeSceneId: scene.id,
        assets: assetLibrary,
      };
      const digest = currentDigest;
      showToast(
        mode === "auto" ? "Auto-saving to GitHub…" : "Saving to GitHub…",
        "progress",
        { sticky: true },
      );
      setGithubBusy("save");
      try {
        const remote = await getProjectFile(githubSession.token, target);
        if (remote === null) {
          if (githubBinding.sha !== null) {
            if (mode === "auto") {
              showToast(
                `GitHub conflict: ${target.path} was deleted remotely. Click to review.`,
                "warning",
                {
                  sticky: true,
                  action: { label: "Review", run: () => manualSaveRef.current() },
                },
              );
            } else {
              askGitHub({
                title: "Remote project is missing",
                message: `${target.path} no longer exists on GitHub. Recreate it with the current local project, or cancel.`,
                detail: githubTargetLabel(target),
                options: [
                  {
                    label: "Recreate remote",
                    tone: "primary",
                    run: () =>
                      commitSnapshotToGitHub(
                        target,
                        snapshot,
                        null,
                        digest,
                        "Recreate project from UMLer",
                      ),
                  },
                ],
              });
            }
            return;
          }
          await commitSnapshotToGitHub(
            target,
            snapshot,
            null,
            digest,
            "Save project from UMLer",
            mode,
          );
          return;
        }

        if (compareRemoteFile(githubBinding.sha, remote.sha) !== "unchanged") {
          presentSaveConflict(target, remote, snapshot, digest, mode);
          return;
        }

        await commitSnapshotToGitHub(
          target,
          snapshot,
          remote.sha,
          digest,
          "Save project from UMLer",
          mode,
        );
      } catch (error) {
        if (isGitHubConflict(error)) {
          try {
            const latest = await getProjectFile(githubSession.token, target);
            if (latest !== null) {
              presentSaveConflict(target, latest, snapshot, digest, mode);
              return;
            }
          } catch (refreshError) {
            const message = describeGitHubError(refreshError);
            if (mode === "auto") {
              showToast(`Auto-save failed: ${message}`, "warning", {
                sticky: true,
                action: { label: "Retry", run: () => manualSaveRef.current() },
              });
            } else {
              showToast(message, "error");
            }
            return;
          }
        }

        const message = describeGitHubError(error);
        if (mode === "auto") {
          showToast(`Auto-save failed: ${message}`, "warning", {
            sticky: true,
            action: { label: "Retry", run: () => manualSaveRef.current() },
          });
        } else {
          showToast(message, "error");
        }
      } finally {
        setGithubBusy(null);
      }
    },
    [
      askGitHub,
      commitSnapshotToGitHub,
      currentDigest,
      currentScenes,
      githubBinding,
      githubBusy,
      githubSession,
      presentSaveConflict,
      assetLibrary,
      scene.id,
      showToast,
    ],
  );

  manualSaveRef.current = () => {
    void saveToGitHub("manual");
  };
  autoSaveRef.current = () => {
    if (githubBinding === null || githubSession === null) return;
    if (githubBusy !== null) return;
    if (githubDecision !== null || githubDialogOpen) return;
    if (sceneDialog !== null || pendingProjectImport !== null) return;
    if (toast?.sticky === true) return;
    if (currentDigest === githubBinding.syncedDigest) return;
    void saveToGitHub("auto");
  };

  useEffect(() => {
    if (githubBinding === null || githubSession === null) return;
    const timer = window.setInterval(() => {
      autoSaveRef.current();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [githubBinding, githubSession]);

  const chooseGitHubDecision = useCallback(
    (option: GitHubDecisionOption) => {
      setGithubDecision(null);
      void Promise.resolve(option.run()).catch((error: unknown) => {
        showToast(describeGitHubError(error), "error");
      });
    },
    [showToast],
  );

  const handleGitHubSession = useCallback((next: GitHubSession | null) => {
    setGithubSession(next);
    storeGitHubSession(next);
  }, []);

  const handleUndo = useCallback(() => {
    undo();
    clearTransientSelection();
    setLayoutNote("Undo");
  }, [clearTransientSelection, undo]);

  const handleRedo = useCallback(() => {
    redo();
    clearTransientSelection();
    setLayoutNote("Redo");
  }, [clearTransientSelection, redo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      const isUndo = key === "z" && !event.shiftKey;
      if (!isUndo && !isRedo) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      if (isRedo) handleRedo();
      else handleUndo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRedo, handleUndo]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveToGitHub();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [saveToGitHub]);

  const changeGridSize = useCallback((size: number) => {
    setScene((current) => ({
      ...current,
      revision: current.revision + 1,
      meta: { ...current.meta, updatedAt: new Date().toISOString() },
      canvas: {
        ...current.canvas,
        grid: { ...current.canvas.grid, size },
      },
    }));
  }, []);

  const handleNodePatch = useCallback((nodeId: string, patch: Partial<SceneNode>) => {
    setScene((current) => {
      const node = current.nodes[nodeId];
      if (node?.kind === "image" && Object.prototype.hasOwnProperty.call(patch, "caption")) {
        const nextNode = {
          ...node,
          caption: (patch as { readonly caption?: string }).caption,
        };
        const delta =
          imageCaptionBlockHeight(nextNode) - imageCaptionBlockHeight(node);
        if (Math.abs(delta) > 0.001) {
          return patchNode(current, asNodeId(nodeId), {
            ...patch,
            frame: {
              ...node.frame,
              height: Math.max(1, node.frame.height + delta),
            },
          });
        }
      }
      return patchNode(current, asNodeId(nodeId), patch);
    });
  }, []);

  const handleRowUpdate = useCallback((nodeId: string, rowId: string, patch: Partial<TableRow>) => {
    setScene((current) => updateRow(current, asNodeId(nodeId), asRowId(rowId), patch));
  }, []);

  const handleRowAdd = useCallback((nodeId: string, sectionId?: string, afterRowId?: string) => {
    const rowId = asRowId(newId("row"));
    setScene((current) =>
      addRow(
        current,
        asNodeId(nodeId),
        sectionId === undefined ? undefined : asSectionId(sectionId),
        {
          rowId,
          afterRowId: afterRowId === undefined ? undefined : asRowId(afterRowId),
        },
      ),
    );
    setSelectedNodeId(nodeId);
    setSelectedNodeIds([nodeId]);
    setSelectedEdgeId(null);
    setNodeFocus({ kind: "row", nodeId, rowId });
    setFocusRequest((current) => ({
      nodeId,
      target: { kind: "rowName", rowId },
      token: (current?.token ?? 0) + 1,
    }));
  }, []);

  const handleRowDelete = useCallback((nodeId: string, rowId: string) => {
    setScene((current) => deleteRow(current, asNodeId(nodeId), asRowId(rowId)));
  }, []);

  const handleSectionAdd = useCallback((nodeId: string) => {
    setScene((current) => addSection(current, asNodeId(nodeId)));
  }, []);

  const handleSectionUpdate = useCallback(
    (nodeId: string, sectionId: string, patch: Partial<TableSection>) => {
      setScene((current) => updateSection(current, asNodeId(nodeId), asSectionId(sectionId), patch));
    },
    [],
  );

  const handleSectionDelete = useCallback((nodeId: string, sectionId: string) => {
    setScene((current) => deleteSection(current, asNodeId(nodeId), asSectionId(sectionId)));
  }, []);

  const handleAddObject = useCallback(
    (templateId: ObjectTemplateId, world: Point): SceneNode | null => {
      const created = createObjectFromTemplate(scene.meta.diagramKind, templateId, scene, world);
      if (created === null) return null;
      const node = created.node;
      setScene((current) => insertObject(current, node, created.asset));
      setSelectedNodeId(node.id);
      setSelectedNodeIds([node.id]);
      setSelectedEdgeId(null);
      const focus: NodeFocus =
        node.kind === "table" || node.kind === "relationAttribute"
          ? { kind: "table", nodeId: node.id }
          : { kind: "object", nodeId: node.id };
      setNodeFocus(focus);
      const target: CanvasTextTarget =
        node.kind === "comment"
          ? { kind: "commentBody" }
          : node.kind === "image"
            ? { kind: "caption" }
            : node.kind === "lifeline"
              ? { kind: "lifelineLabel" }
              : { kind: "nodeName" };
      setFocusRequest((current) => ({
        nodeId: node.id,
        target,
        token: (current?.token ?? 0) + 1,
      }));
      setLayoutNote(`Added ${node.name}. Drag from a border handle to connect it.`);
      return node;
    },
    [scene],
  );

  const handleDropImageFiles = useCallback(
    async (files: readonly File[], world: Point): Promise<void> => {
      const accepted = files.filter(isSupportedImageFile);
      if (accepted.length === 0) {
        showToast("Drop a PNG, JPG or SVG image.", "error");
        return;
      }

      let workingScene = scene;
      let assets: Record<string, ImageAsset> = { ...assetLibrary };
      const placed: SceneNode[] = [];
      const errors: string[] = [];

      for (const [index, file] of accepted.entries()) {
        try {
          const asset = await createImageAssetFromFile(file, assets);
          assets = { ...assets, [asset.id]: asset };
          const created = createImageObject(
            workingScene,
            { x: world.x + index * 28, y: world.y + index * 28 },
            asset,
          );
          workingScene = insertObject(workingScene, created.node, created.asset);
          placed.push(created.node);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `${file.name}: could not be added.`);
        }
      }

      if (placed.length > 0) {
        setAssetLibrary(assets);
        setScene(workingScene);
        const last = placed[placed.length - 1];
        if (last !== undefined) {
          setSelectedNodeId(last.id);
          setSelectedNodeIds([last.id]);
          setSelectedEdgeId(null);
          setSelectedActivation(null);
          setNodeFocus(null);
        }
        setLayoutNote(
          placed.length === 1 ? "Image added. Resize it from a corner; aspect stays locked." : `${placed.length} images added.`,
        );
        showToast(placed.length === 1 ? "Image added." : `${placed.length} images added.`);
      }
      if (errors.length > 0) {
        showToast(errors[0] ?? "The image could not be added.", "error");
      }
    },
    [assetLibrary, scene, showToast],
  );

  const handleAssignImageToNode = useCallback(
    async (nodeId: string, file: File): Promise<void> => {
      const asset = await createImageAssetFromFile(file, assetLibrary);
      setAssetLibrary((current) => ({ ...current, [asset.id]: asset }));
      setScene((current) => setNodeImage(current, asNodeId(nodeId), asset));
      setLayoutNote(`Image set: ${asset.fileName}.`);
    },
    [assetLibrary],
  );

  const handleUseImageAsset = useCallback(
    (nodeId: string, assetId: string) => {
      const asset = assetLibrary[assetId];
      if (asset === undefined) return;
      setScene((current) => setNodeImage(current, asNodeId(nodeId), asset));
      setLayoutNote(`Image set: ${asset.fileName}.`);
    },
    [assetLibrary],
  );

  const handleRemoveImageFromNode = useCallback((nodeId: string) => {
    setScene((current) => setNodeImage(current, asNodeId(nodeId), undefined));
    setLayoutNote("Image removed; empty image frame restored.");
  }, []);

  const handlePurgeUnusedImages = useCallback(() => {
    if (unusedImageCount === 0) {
      showToast("No unused images.");
      return;
    }
    setAssetLibrary((current) =>
      pruneUnusedProjectAssets(currentScenes, current),
    );
    const label = unusedImageCount === 1 ? "image" : "images";
    setLayoutNote(`Purged ${unusedImageCount} unused ${label}.`);
    showToast(`Purged ${unusedImageCount} unused ${label}.`);
  }, [currentScenes, showToast, unusedImageCount]);

  const handleConvertToRelationAttribute = useCallback(
    (edgeId: string, world: Point, anchor: Point) => {
      const parent = scene.edges[edgeId];
      const centerLabel = parent?.labels.find((label) => label.zone === "center");
      const labelText = centerLabel?.text.trim() ?? "";
      if (labelText.length === 0) return;

      const created = createObjectFromTemplate(
        "er",
        "relation-attribute",
        scene,
        world,
      );
      if (created === null || created.node.kind !== "relationAttribute") return;
      const node: SceneNode = { ...created.node, name: labelText };
      const center = {
        x: node.frame.x + node.frame.width / 2,
        y: node.frame.y + node.frame.height / 2,
      };
      const dx = anchor.x - center.x;
      const dy = anchor.y - center.y;
      const side: "north" | "east" | "south" | "west" =
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0 ? "east" : "west"
          : dy >= 0 ? "south" : "north";
      const sceneWithNode: SceneDocument = {
        ...scene,
        nodes: { ...scene.nodes, [node.id]: node },
      };
      const tether = createEdgeForDiagram(
        sceneWithNode,
        { nodeId: node.id, port: { kind: "perimeter", side } },
        { edgeId: asEdgeId(edgeId), t: 0.5 },
      );
      if (tether === null) return;

      setScene(current =>
        insertConnectedObject(
          current,
          node,
          tether,
          { edgeId: asEdgeId(edgeId), zone: "center" },
          created.asset,
        ),
      );
      setSelectedNodeId(node.id);
      setSelectedNodeIds([node.id]);
      setSelectedEdgeId(null);
      setSelectedActivation(null);
      setNodeFocus({ kind: "table", nodeId: node.id });
      setFocusRequest((current) => ({
        nodeId: node.id,
        target: { kind: "nodeName" },
        token: (current?.token ?? 0) + 1,
      }));
      setLayoutNote(`Converted “${labelText}” to a relation attribute.`);
    },
    [scene],
  );

  const handleAddActivation = useCallback(
    (nodeId: string, worldY: number) => {
      const lane = scene.nodes[nodeId];
      if (lane === undefined || lane.kind !== "lifeline") return;
      const grid = Math.max(1, scene.canvas.grid.size);
      const height = Math.min(90, lane.frame.height);
      const topWorld = snap(worldY - height / 2, grid);
      const top = Math.max(0, Math.min(topWorld - lane.frame.y, lane.frame.height - height));
      setScene((current) => addActivation(current, asNodeId(nodeId), top, height));
      setLayoutNote("Activation bar added at the lifeline cursor position.");
    },
    [scene],
  );

  const handleUpdateActivation = useCallback(
    (nodeId: string, activationId: ActivationId, top: number, height: number) => {
      setScene((current) =>
        updateActivation(current, asNodeId(nodeId), activationId, { top, height }),
      );
      setLayoutNote("Activation bar moved/resized.");
    },
    [],
  );

  const handleCreateEdge = useCallback(
    (source: PortAttachmentRef, target: EdgeTargetRef) => {
      const edge = createEdgeForDiagram(scene, source, target);
      if (edge === null) {
        setLayoutNote("Connect two different objects.");
        return;
      }
      setScene((current) => insertEdge(current, edge));
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setNodeFocus(null);
      setLayoutNote("Connector created. Click the line or a terminal to refine it.");
    },
    [scene],
  );

  const selectNodes = useCallback(
    (nodeIds: readonly string[], primary?: string | null) => {
      const unique = [...new Set(nodeIds)];
      setSelectedNodeIds(unique);
      setSelectedNodeId(primary ?? unique[unique.length - 1] ?? null);
      setSelectedActivation(null);
      setSelectedEdgeId(null);
      setNodeFocus((current) =>
        current !== null && unique.length === 1 && unique[0] === current.nodeId
          ? current
          : null);
    },
    [],
  );

  const selectNode = useCallback((nodeId: string | null) => {
    selectNodes(nodeId === null ? [] : [nodeId], nodeId);
  }, [selectNodes]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    const has = selectedNodeIds.includes(nodeId);
    const next = has
      ? selectedNodeIds.filter((id) => id !== nodeId)
      : [...selectedNodeIds, nodeId];
    const primary = has
      ? (selectedNodeId === nodeId ? next[next.length - 1] ?? null : selectedNodeId)
      : nodeId;
    setSelectedNodeIds(next);
    setSelectedNodeId(primary);
    setSelectedActivation(null);
    setSelectedEdgeId(null);
    setNodeFocus(null);
  }, [selectedNodeId, selectedNodeIds]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setScene((current) => deleteNode(current, asNodeId(nodeId)));
    const remaining = selectedNodeIds.filter((id) => id !== nodeId);
    setSelectedNodeIds(remaining);
    setSelectedNodeId((current) =>
      current === nodeId ? remaining[remaining.length - 1] ?? null : current);
    setSelectedActivation((current) => (current?.nodeId === nodeId ? null : current));
    setNodeFocus((current) => (current?.nodeId === nodeId ? null : current));
    setLayoutNote("Object and its connectors deleted.");
  }, [selectedNodeIds]);

  const handleCopySelection = useCallback(() => {
    const focusedNodeId = nodeFocus?.nodeId;
    const copyIds = focusedNodeId !== undefined && scene.nodes[focusedNodeId] !== undefined
      ? [focusedNodeId]
      : selectedNodeIds;
    if (copyIds.length === 0) {
      showToast(
        selectedEdgeId !== null
          ? "Select objects to copy; connectors copy with their objects."
          : "Select objects to copy.",
        "warning",
      );
      return;
    }
    const payload = copySceneNodes(scene, copyIds);
    if (payload === null) {
      showToast("The selected objects are no longer available.", "warning");
      return;
    }
    clipboardRef.current = payload;
    pasteOffsetRef.current = 0;
    const connectors = payload.edges.length === 0
      ? ""
      : ` and ${payload.edges.length} connector${payload.edges.length === 1 ? "" : "s"}`;
    showToast(
      `Copied ${payload.nodes.length} object${payload.nodes.length === 1 ? "" : "s"}${connectors}.`,
    );
  }, [nodeFocus, scene, selectedEdgeId, selectedNodeIds, showToast]);

  const handleCutSelection = useCallback(() => {
    const focusedNodeId = nodeFocus?.nodeId;
    const cutIds = focusedNodeId !== undefined && scene.nodes[focusedNodeId] !== undefined
      ? [focusedNodeId]
      : selectedNodeIds;
    if (cutIds.length === 0) {
      showToast("Select objects to cut.", "warning");
      return;
    }
    const payload = copySceneNodes(scene, cutIds);
    if (payload === null) {
      showToast("The selected objects are no longer available.", "warning");
      return;
    }
    clipboardRef.current = payload;
    pasteOffsetRef.current = 0;
    setScene((current) =>
      deleteNodes(current, cutIds.map((nodeId) => asNodeId(nodeId))),
    );
    selectNodes([], null);
    setSelectedEdgeId(null);
    showToast(`Cut ${payload.nodes.length} object${payload.nodes.length === 1 ? "" : "s"}.`);
  }, [nodeFocus, scene, selectedNodeIds, selectNodes, showToast]);

  const handlePasteSelection = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (clipboard === null) {
      showToast("Nothing to paste.", "warning");
      return;
    }
    if (clipboard.sceneId !== scene.id && clipboard.diagramKind !== scene.meta.diagramKind) {
      if (clipboard.nodes.length !== 1) {
        showToast("Copy a single object to paste it into another diagram type.", "warning");
        return;
      }
      const source = clipboard.nodes[0];
      if (source === undefined) {
        showToast("Nothing to paste.", "warning");
        return;
      }
      const converted = convertNodeForDiagram(source, scene.meta.diagramKind, scene);
      if (converted === null) {
        showToast("This object cannot be converted to the target diagram type.", "warning");
        return;
      }
      pasteOffsetRef.current += 1;
      setScene((current) => insertSubgraph(current, [converted], [], clipboard.assets));
      selectNodes([converted.id], converted.id);
      showToast("Pasted 1 object and converted it for this diagram.");
      return;
    }
    const pasteNumber = pasteOffsetRef.current + 1;
    const result = pasteSceneClipboard(scene, clipboard, {
      x: pasteNumber * 18,
      y: pasteNumber * 18,
    });
    if (result === null) {
      showToast("Nothing to paste.", "warning");
      return;
    }
    pasteOffsetRef.current = pasteNumber;
    setScene(result.scene);
    selectNodes(result.nodeIds, result.nodeIds[result.nodeIds.length - 1] ?? null);
    const connectors = result.edgeIds.length === 0
      ? ""
      : ` and ${result.edgeIds.length} connector${result.edgeIds.length === 1 ? "" : "s"}`;
    showToast(
      `Pasted ${result.nodeIds.length} object${result.nodeIds.length === 1 ? "" : "s"}${connectors}.`,
    );
  }, [scene, selectNodes, showToast]);

  useEffect(() => {
    const handleClipboardKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;
      const target = event.target;
      // Text selected anywhere (including the generated-code block) belongs to
      // the browser's native clipboard. Never turn Ctrl+C into an object copy
      // while the user is selecting text.
      if (key === "c" && (window.getSelection()?.toString().length ?? 0) > 0) return;
      if (target instanceof HTMLElement) {
        // The export panel is a read/copy surface: object copy, cut and paste
        // shortcuts must not run while its inputs or code block are focused.
        if (target.closest(".code-panel") !== null || target.closest(".code-preview-modal") !== null) {
          return;
        }
        const tag = target.tagName.toLowerCase();
        const editable =
          tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
        // A focused table header still represents the whole table. Let Ctrl+C
        // copy that object even when the user is editing its name field.
        const copyFocusedTable =
          key === "c" &&
          nodeFocus?.kind === "table" &&
          target.closest(".node-focus-menu") !== null;
        // A select cannot accept pasted text. Allow object paste after choosing
        // the target scene from the scene switcher, which keeps its focus.
        const pasteIntoSelect = key === "v" && tag === "select";
        if (editable && !copyFocusedTable && !pasteIntoSelect) return;
      }
      event.preventDefault();
      if (key === "c") handleCopySelection();
      else if (key === "x") handleCutSelection();
      else handlePasteSelection();
    };

    window.addEventListener("keydown", handleClipboardKey);
    return () => window.removeEventListener("keydown", handleClipboardKey);
  }, [handleCopySelection, handleCutSelection, handlePasteSelection, nodeFocus]);

  /**
   * Delete is scope-aware: the focused table part is removed before its
   * containing object, so pressing Delete on a section never removes the table.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
          return;
        }
      }

      if (nodeFocus !== null) {
        const focusedNode = scene.nodes[nodeFocus.nodeId];
        if (nodeFocus.kind === "table" && focusedNode !== undefined) {
          event.preventDefault();
          setScene((current) => {
            const node = current.nodes[nodeFocus.nodeId];
            if (node === undefined) return current;
            return patchNode(
              current,
              asNodeId(nodeFocus.nodeId),
              node.kind === "table"
                ? {
                    name: "",
                    header: {
                      ...node.header,
                      stereotype: undefined,
                      keywords: [],
                    },
                  }
                : { name: "" },
            );
          });
          setNodeFocus(null);
          setLayoutNote("Table header cleared. Press Delete again to remove the object.");
          return;
        }
        if (nodeFocus.kind === "section" && focusedNode?.kind === "table") {
          event.preventDefault();
          setScene((current) =>
            deleteSection(current, asNodeId(nodeFocus.nodeId), asSectionId(nodeFocus.sectionId)),
          );
          setNodeFocus(null);
          setLayoutNote("Section deleted. Press Delete again to remove the object.");
          return;
        }
        if (nodeFocus.kind === "row") {
          event.preventDefault();
          setScene((current) =>
            deleteRow(current, asNodeId(nodeFocus.nodeId), asRowId(nodeFocus.rowId)),
          );
          setNodeFocus(null);
          setLayoutNote("Row deleted. Press Delete again to remove the object.");
          return;
        }
      }

      if (selectedActivation !== null) {
        event.preventDefault();
        setScene((current) =>
          deleteActivation(
            current,
            asNodeId(selectedActivation.nodeId),
            selectedActivation.activationId,
          ),
        );
        setSelectedActivation(null);
        setLayoutNote("Activation bar deleted.");
        return;
      }

      if (selectedEdgeId !== null) {
        event.preventDefault();
        setScene((current) => deleteEdge(current, asEdgeId(selectedEdgeId)));
        setSelectedEdgeId(null);
        setNodeFocus(null);
        setLayoutNote("Connector deleted.");
        return;
      }

      const nodeIds = selectedNodeIds.length > 0
        ? selectedNodeIds
        : selectedNodeId === null
          ? []
          : [selectedNodeId];
      if (nodeIds.length > 0) {
        event.preventDefault();
        setScene((current) =>
          deleteNodes(current, nodeIds.map((nodeId) => asNodeId(nodeId))),
        );
        selectNodes([], null);
        setSelectedEdgeId(null);
        setLayoutNote(
          nodeIds.length === 1
            ? "Object and its connectors deleted."
            : `${nodeIds.length} objects and their connectors deleted.`,
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    nodeFocus,
    scene.nodes,
    selectNodes,
    selectedActivation,
    selectedEdgeId,
    selectedNodeId,
    selectedNodeIds,
  ]);

  const handleSetEdgeLabel = useCallback((edgeId: string, zone: EdgeLabelZone, text: string) => {
    setScene((current) => setEndpointLabel(current, asEdgeId(edgeId), zone, text));
  }, []);

  const handleSetEdgeLabelStyle = useCallback(
    (edgeId: string, zone: EdgeLabelZone, style: TextStyleOverride | undefined) => {
      setScene((current) => setEdgeLabelTextStyle(current, asEdgeId(edgeId), zone, style));
    },
    [],
  );

  const handleSetMarker = useCallback((edgeId: string, end: EdgeEnd, marker: EndpointMarker) => {
    setScene((current) => setMarker(current, asEdgeId(edgeId), end, marker));
  }, []);

  const handleSetStrokePattern = useCallback((edgeId: string, pattern: StrokePattern) => {
    setScene((current) => setStrokePattern(current, asEdgeId(edgeId), pattern));
  }, []);

  const handleSetStrokeWidth = useCallback((edgeId: string, width: number) => {
    setScene((current) => setStrokeWidth(current, asEdgeId(edgeId), width));
  }, []);

  const handleSetRoutingMode = useCallback((edgeId: string, mode: EdgeRoutingMode) => {
    setScene((current) => setRoutingMode(current, asEdgeId(edgeId), mode));
  }, []);

  const handleReroute = useCallback((edgeId: string) => {
    setScene((current) => rerouteEdge(current, asEdgeId(edgeId)));
    setLayoutNote("A* reroute requested.");
  }, []);

  const handleReattachEdge = useCallback(
    (
      edgeId: string,
      end: EdgeEnd,
      target: PortAttachmentRef | EdgeAttachmentRef,
    ) => {
      const attachment: EdgeAttachment = "nodeId" in target
        ? { target: "node", nodeId: target.nodeId, port: target.port }
        : { target: "edge", edgeId: target.edgeId, t: target.t };
      setScene((current) => setEdgeAttachment(current, asEdgeId(edgeId), end, attachment));
      setLayoutNote("Connector endpoint reattached.");
    },
    [],
  );

  const handleMoveSequenceEdge = useCallback((edgeId: string, deltaY: number) => {
    setScene((current) => moveSequenceEdge(current, asEdgeId(edgeId), deltaY));
    setLayoutNote("Sequence message moved vertically.");
  }, []);

  const handleMoveEdgeLabel = useCallback(
    (edgeId: string, labelId: string, offset: Point) => {
      setScene((current) =>
        setEdgeLabelOffset(current, asEdgeId(edgeId), asLabelId(labelId), offset),
      );
      setLayoutNote("Label positioned manually.");
    },
    [],
  );

  const handleLayoutDirection = useCallback((direction: "TB" | "LR") => {
    setScene((current) => patchLayout(current, { direction }));
    setLayoutNote(`Layout direction: ${direction}.`);
  }, []);

  const handleLayoutSpacing = useCallback((spacing: LayoutSpacing) => {
    setScene((current) =>
      patchLayout(current, { spacing, ...LAYOUT_SPACING_PRESETS[spacing] }),
    );
    setLayoutNote(`Layout spacing: ${spacing}.`);
  }, []);

  const handleThemeChange = useCallback((theme: Theme) => {
    setScene((current) => setSceneTheme(current, theme));
  }, []);

  const runAutoLayout = useCallback(() => {
    const result = autoLayoutFrames(scene, layout);
    if (result.skipped !== undefined && result.moved === 0) {
      if (Object.keys(result.edgeAttachments).length === 0) {
        setLayoutNote(result.skipped);
        return;
      }
      setScene((current) =>
        commitAutoLayout(current, {}, result.edgeAttachments),
      );
      setLayoutNote(`${result.skipped} Ellipse anchors refreshed.`);
      return;
    }
    setScene((current) =>
      commitAutoLayout(current, result.frames, result.edgeAttachments, {
        engine: "sugiyama",
      }),
    );
    setPreviewFrames({});
    setLayoutNote(
      `${result.moved} nodes · ${result.layers} layers · crossings ${result.crossingsBefore} → ${result.crossingsAfter}`,
    );
    setFitNonce((value) => value + 1);
  }, [layout, scene]);

  const selectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    if (edgeId !== null) {
      setSelectedActivation(null);
      setNodeFocus(null);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
    }
  }, []);

  const selectActivation = useCallback(
    (activation: { readonly nodeId: string; readonly activationId: ActivationId } | null) => {
      setSelectedActivation(activation);
      if (activation !== null) {
        setNodeFocus(null);
        setSelectedEdgeId(null);
      }
    },
    [],
  );

  const requestFocus = useCallback((nodeId: string, target: CanvasTextTarget) => {
    setFocusRequest((current) => ({
      nodeId,
      target,
      token: (current?.token ?? 0) + 1,
    }));
  }, []);

  const handleCanvasTextDoubleClick = useCallback((nodeId: string, target: CanvasTextTarget) => {
    const node = scene.nodes[nodeId];
    selectNodes([nodeId], nodeId);
    if (target.kind === "rowName" || target.kind === "rowType") {
      setNodeFocus({ kind: "row", nodeId, rowId: target.rowId });
    } else if (target.kind === "sectionTitle") {
      setNodeFocus({ kind: "section", nodeId, sectionId: target.sectionId });
    } else if (node?.kind === "table" || node?.kind === "relationAttribute") {
      setNodeFocus({ kind: "table", nodeId });
    } else {
      setNodeFocus({ kind: "object", nodeId });
    }
    requestFocus(nodeId, target);
  }, [requestFocus, scene.nodes, selectNodes]);

  const nodeTargetForFocus = useCallback((focus: NodeFocus): CanvasTextTarget => {
    const node = scene.nodes[focus.nodeId];
    if (focus.kind === "table") return { kind: "nodeName" };
    if (focus.kind === "section") return { kind: "sectionTitle", sectionId: focus.sectionId };
    if (focus.kind === "row") return { kind: "rowName", rowId: focus.rowId };
    if (focus.kind === "lifelineSpine") return { kind: "lifelineLabel" };
    if (node?.kind === "image") return { kind: "caption" };
    if (node?.kind === "comment") return { kind: "commentBody" };
    if (node?.kind === "lifeline") return { kind: "lifelineLabel" };
    return { kind: "nodeName" };
  }, [scene.nodes]);

  const handleNodePartClick = useCallback((focus: NodeFocus) => {
    selectNodes([focus.nodeId], focus.nodeId);
    const same = nodeFocus !== null &&
      nodeFocus.kind === focus.kind &&
      nodeFocus.nodeId === focus.nodeId &&
      (focus.kind !== "section" || (nodeFocus.kind === "section" && nodeFocus.sectionId === focus.sectionId)) &&
      (focus.kind !== "row" || (nodeFocus.kind === "row" && nodeFocus.rowId === focus.rowId)) &&
      (focus.kind !== "lifelineSpine" ||
        (nodeFocus.kind === "lifelineSpine" && Math.abs(nodeFocus.y - focus.y) < 1));
    if (same) requestFocus(focus.nodeId, nodeTargetForFocus(focus));
    setNodeFocus(focus);
  }, [nodeFocus, nodeTargetForFocus, requestFocus, selectNodes]);

  const zoomBy = useCallback(
    (factor: number) => {
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      const next = zoomAtScreenPoint(center, camera, zoom, factor);
      setCamera(next.camera);
      setZoom(next.zoom);
    },
    [camera, viewport.height, viewport.width, zoom],
  );

  const handleViewChange = useCallback((nextCamera: Camera, nextZoom: number) => {
    setCamera(nextCamera);
    setZoom(nextZoom);
  }, []);

  return (
    <div className="app-shell">
      <Toolbar
        scene={scene}
        scenes={scenes}
        activeSceneId={activeSceneId}
        canUndo={canUndo}
        canRedo={canRedo}
        canDeleteScene={scenes.length > 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSceneChange={loadScene}
        panelVisible={panelVisible}
        onTogglePanel={() => setPanelVisible((value) => !value)}
        codePanelVisible={codePanelVisible}
        onToggleCodePanel={() => setCodePanelVisible((value) => !value)}
        onExportScene={handleExportScene}
        onImportScene={() => requestImport("scene")}
        onExportProject={handleExportProject}
        onImportProject={() => requestImport("project")}
        onNewProject={() => setSceneDialog("new-project")}
        onNewScene={() => setSceneDialog("new")}
        onRenameScene={() => setSceneDialog("rename")}
        onDuplicateScene={duplicateScene}
        onDeleteScene={() => setSceneDialog("delete")}
        onOpenFromGitHub={() => setGithubDialogOpen(true)}
        onSaveToGitHub={() => void saveToGitHub()}
        canSaveToGitHub={githubBinding !== null && githubBusy === null}
        onPurgeUnusedImages={handlePurgeUnusedImages}
        unusedImageCount={unusedImageCount}
        zoom={zoom}
        gridVisible={gridVisible}
        snapEnabled={snapEnabled}
        gridSize={scene.canvas.grid.size}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onFit={() => setFitNonce((value) => value + 1)}
        onToggleGrid={() => setGridVisible((value) => !value)}
        onToggleSnap={() => setSnapEnabled((value) => !value)}
        onGridSizeChange={changeGridSize}
      />

      <main
        className={[
          "workspace",
          panelVisible ? "" : "panel-hidden",
          codePanelVisible ? "code-open" : "",
        ]
          .filter((item) => item.length > 0)
          .join(" ")}
      >
        {panelVisible ? (
          <section className="scene-rail">
            <button
              type="button"
              className="panel-add-button"
              onClick={() => canvasStageRef.current?.openAddObjectMenu()}
              title="Add an object to this diagram"
              aria-haspopup="menu"
            >
              <svg
                className="add-glyph"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path
                  d="M6 1.4v9.2M1.4 6h9.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
              Add object
            </button>
            <ThemePanel theme={scene.theme} onChange={handleThemeChange} />
            <LayoutPanel
              direction={scene.layout.direction}
              spacing={scene.layout.spacing ?? "normal"}
              engine={scene.layout.engine}
              note={layoutNote}
              onDirectionChange={handleLayoutDirection}
              onSpacingChange={handleLayoutSpacing}
              onRun={runAutoLayout}
            />
          </section>
        ) : null}

        <CanvasStage
          ref={canvasStageRef}
          scene={effectiveScene}
          layout={layout}
          camera={camera}
          zoom={zoom}
          gridVisible={gridVisible}
          gridSize={scene.canvas.grid.size}
          majorEvery={scene.canvas.grid.majorEvery}
          snapEnabled={snapEnabled}
          showCompactAddButton={!panelVisible}
          imageAssets={assetLibrary}
          onDropImageFiles={(files, world) => {
            void handleDropImageFiles(files, world);
          }}
          onAssignImageToNode={handleAssignImageToNode}
          onUseImageAsset={handleUseImageAsset}
          onRemoveImageFromNode={handleRemoveImageFromNode}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeId={selectedEdgeId}
          selectedActivation={selectedActivation}
          fitNonce={fitNonce}
          onSelectNode={selectNode}
          onSelectNodes={selectNodes}
          onToggleNodeSelection={toggleNodeSelection}
          onSelectEdge={selectEdge}
          onSelectActivation={selectActivation}
          onSetMarker={handleSetMarker}
          onSetEdgeLabel={handleSetEdgeLabel}
          onSetEdgeLabelStyle={handleSetEdgeLabelStyle}
          onConvertToRelationAttribute={handleConvertToRelationAttribute}
          onSetStrokePattern={handleSetStrokePattern}
          onSetStrokeWidth={handleSetStrokeWidth}
          onSetRoutingMode={handleSetRoutingMode}
          onRerouteEdge={handleReroute}
          onReattachEdge={handleReattachEdge}
          onMoveSequenceEdge={handleMoveSequenceEdge}
          onMoveEdgeLabel={handleMoveEdgeLabel}
          onTextDoubleClick={handleCanvasTextDoubleClick}
          nodeFocus={nodeFocus}
          focusRequest={focusRequest}
          onNodePartClick={handleNodePartClick}
          onClearNodeFocus={() => setNodeFocus(null)}
          onUpdateNode={handleNodePatch}
          onUpdateRow={handleRowUpdate}
          onAddRow={handleRowAdd}
          onDeleteRow={handleRowDelete}
          onAddSection={handleSectionAdd}
          onUpdateSection={handleSectionUpdate}
          onDeleteSection={handleSectionDelete}
          onAddObject={handleAddObject}
          onAddActivation={handleAddActivation}
          onUpdateActivation={handleUpdateActivation}
          onCreateEdge={handleCreateEdge}
          onDeleteNode={handleDeleteNode}
          onViewChange={handleViewChange}
          onPreviewFrames={setPreviewFrames}
          onCommitFrames={commitFrames}
          onViewport={setViewport}
        />

        {codePanelVisible ? (
          <Suspense
            fallback={
              <aside className="code-panel code-panel-loading" aria-label="Loading export panel">
                <div className="code-panel-head">
                  <div>
                    {/* <div className="code-panel-kicker">Export</div> */}
                    <h2>Export to Typst</h2>
                  </div>
                </div>
                <div className="code-panel-scroll">
                  <p className="code-hint">Loading the Typst compiler…</p>
                </div>
              </aside>
            }
          >
            <CodePanel
              scene={scene}
              layout={layout}
              selectedNodeIds={selectedNodeIds}
              selectedEdgeId={selectedEdgeId}
              assets={exportAssets}
              onClose={() => setCodePanelVisible(false)}
            />
          </Suspense>
        ) : null}
      </main>

      <footer className="statusbar">
        <span>
          <strong>{scene.meta.title}</strong> · {scene.meta.diagramKind}
        </span>
        <span>
          revision {scene.revision} · {Object.keys(scene.nodes).length} nodes · {Object.keys(scene.edges).length} edges
        </span>
        <span className="status-project">
          {githubBinding === null ? (
            <>
              <span className={`status-dot ${projectDirty ? "dirty" : ""}`} />
              Local project{projectDirty ? " · modified" : ""}
            </>
          ) : (
            <>
              <span className={`status-dot ${githubDirty ? "dirty" : ""}`} />
              <span
                className="status-path"
                title={githubTargetLabel(githubBinding)}
              >
                {githubBinding.owner}/{githubBinding.repo} · {githubBinding.path}
              </span>
              <button
                type="button"
                className="status-save"
                onClick={() => void saveToGitHub()}
                disabled={!githubDirty || githubBusy !== null}
              >
                {githubBusy === "save" ? "Saving…" : githubDirty ? "Save" : "Synced"}
              </button>
            </>
          )}
        </span>
        <span className="status-spacer" />
      </footer>

      {sceneDialog !== null ? (
        <SceneDialog
          mode={sceneDialog}
          sceneTitle={scene.meta.title}
          initialName={
            sceneDialog === "new" || sceneDialog === "new-project"
              ? "Untitled diagram"
              : scene.meta.title
          }
          initialKind={scene.meta.diagramKind}
          onClose={() => setSceneDialog(null)}
          onSubmit={handleSceneDialogSubmit}
        />
      ) : null}

      {pendingProjectImport !== null ? (
        <ProjectImportDialog
          fileName={pendingProjectImport.fileName}
          currentSceneCount={currentScenes.length}
          importedSceneCount={pendingProjectImport.project.scenes.length}
          onCancel={() => setPendingProjectImport(null)}
          onConfirm={confirmProjectImport}
        />
      ) : null}

      {githubDialogOpen ? (
        <GitHubProjectDialog
          session={githubSession}
          initialTarget={githubBinding === null ? null : targetOf(githubBinding)}
          onSession={handleGitHubSession}
          onOpen={openFromGitHub}
          onClose={() => setGithubDialogOpen(false)}
        />
      ) : null}

      {githubDecision !== null ? (
        <GitHubDecisionDialog
          decision={githubDecision}
          onDismiss={() => setGithubDecision(null)}
          onChoose={chooseGitHubDecision}
        />
      ) : null}

      <input
        ref={fileInputRef}
        id="scene-file-input"
        name="scene-file-input"
        className="file-input"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void handleFileInputChange(event);
        }}
      />

      {toast !== null ? (
        <div
          className={`app-toast ${toast.tone}${toast.action ? " actionable" : ""}`}
          role={toast.tone === "error" || toast.tone === "warning" ? "alert" : "status"}
          tabIndex={toast.action ? 0 : undefined}
          onClick={toast.action ? () => toast.action?.run() : undefined}
          onKeyDown={
            toast.action
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toast.action?.run();
                  }
                }
              : undefined
          }
        >
          <span>{toast.message}</span>
          {toast.action ? <span className="toast-action">{toast.action.label}</span> : null}
        </div>
      ) : null}
    </div>
  );
};
