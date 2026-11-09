import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ER_COMMERCE, STEP1_FIXTURES } from "../fixtures/index.ts";
import type { Rect } from "../model/geometry.ts";
import type { DiagramKind, SceneDocument } from "../model/scene.ts";
import { createEmptyScene } from "../model/scene.ts";
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
import { CanvasStage } from "../canvas/CanvasStage.tsx";
import { LayoutPanel } from "./LayoutPanel.tsx";
import { ProjectImportDialog } from "./ProjectImportDialog.tsx";
import { SceneDialog, type SceneDialogMode } from "./SceneDialog.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { downloadTextFile, readTextFile } from "./file-transfer.ts";
import { useSceneHistory } from "./use-scene-history.ts";
import type {
  EdgeAttachment,
  EdgeLabelZone,
  EdgeRoutingMode,
} from "../model/edges.ts";
import type { EdgeEnd, EndpointMarker } from "../model/markers.ts";
import type { StrokePattern } from "../model/styles.ts";
import type { CanvasTextFocusRequest, CanvasTextTarget } from "../model/text-targets.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { SceneNode, TableRow, TableSection } from "../model/nodes.ts";
import { asEdgeId, asLabelId, asNodeId, asRowId, asSectionId, newId, type ActivationId, type SceneId } from "../model/ids.ts";
import { snap, type Point } from "../model/geometry.ts";
import type { ObjectTemplateId } from "../model/object-catalog.ts";
import { createObjectFromTemplate } from "../model/object-catalog.ts";
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
  deleteRow,
  deleteSection,
  insertEdge,
  insertObject,
  moveSequenceEdge,
  patchLayout,
  patchNode,
  rerouteEdge,
  setEdgeAttachment,
  setEdgeLabelOffset,
  setEndpointLabel,
  setMarker,
  setRoutingMode,
  setStrokePattern,
  setStrokeWidth,
  updateActivation,
  updateRow,
  updateSection,
} from "../model/edits.ts";

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

type ImportTarget = "scene" | "project";
type ToastTone = "info" | "error";

interface ToastMessage {
  readonly message: string;
  readonly tone: ToastTone;
}

interface PendingProjectImport {
  readonly project: ImportedProject;
  readonly fileName: string;
}

export const App = () => {
  const {
    scene,
    setScene,
    undo,
    redo,
    reset: resetHistory,
    canUndo,
    canRedo,
  } = useSceneHistory(ER_COMMERCE);
  const [scenes, setScenes] = useState<SceneDocument[]>(() =>
    STEP1_FIXTURES.map((fixture) => fixture.scene),
  );
  const [activeSceneId, setActiveSceneId] = useState<string>(ER_COMMERCE.id);
  const [sceneDialog, setSceneDialog] = useState<SceneDialogMode | null>(null);
  const [pendingProjectImport, setPendingProjectImport] =
    useState<PendingProjectImport | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
  const importTargetRef = useRef<ImportTarget>("scene");

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
    if (toast === null) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" ? 7000 : 2600,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentScenes = useMemo(
    () => scenes.map((item) => (item.id === scene.id ? scene : item)),
    [scene, scenes],
  );

  const effectiveScene = useMemo(() => withNodeFrames(scene, previewFrames), [scene, previewFrames]);
  const layout = useMemo(
    () => buildLayoutSnapshot(effectiveScene, measurer),
    [effectiveScene, measurer, fontTick],
  );

  const loadScene = useCallback((sceneId: string) => {
    const target = scenes.find((item) => item.id === sceneId);
    if (target === undefined) return;
    setActiveSceneId(sceneId);
    resetHistory(target);
    setSelectedNodeId(null);
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

  const handleSceneDialogSubmit = useCallback(
    (
      name: string,
      diagramKind: DiagramKind,
      startMode: "template" | "empty",
    ) => {
      const mode = sceneDialog;
      setSceneDialog(null);
      if (mode === "new") {
        const template = startMode === "template"
          ? STEP1_FIXTURES.find(
              (fixture) => fixture.scene.meta.diagramKind === diagramKind,
            )?.scene
          : undefined;
        const next = template === undefined
          ? createEmptyScene(diagramKind, name)
          : cloneSceneAs(template, name);
        setScenes((current) => [...current, next]);
        activateSceneDocument(next);
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
    [activateSceneDocument, deleteActiveScene, sceneDialog, setScene],
  );

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, tone });
  }, []);

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
        serializeProjectFile(currentScenes, scene.id),
      );
      showToast(`Project exported · ${currentScenes.length} scenes.`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "The project could not be exported.",
        "error",
      );
    }
  }, [currentScenes, scene.id, showToast]);

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
    activateSceneDocument(active);
    setPendingProjectImport(null);
    showToast(
      `Imported project · ${pendingProjectImport.project.scenes.length} scenes.`,
    );
  }, [activateSceneDocument, pendingProjectImport, showToast]);

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
    setScene((current) => patchNode(current, asNodeId(nodeId), patch));
  }, []);

  const handleRowUpdate = useCallback((nodeId: string, rowId: string, patch: Partial<TableRow>) => {
    setScene((current) => updateRow(current, asNodeId(nodeId), asRowId(rowId), patch));
  }, []);

  const handleRowAdd = useCallback((nodeId: string, sectionId?: string) => {
    setScene((current) =>
      addRow(current, asNodeId(nodeId), sectionId === undefined ? undefined : asSectionId(sectionId)),
    );
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
    (templateId: ObjectTemplateId, world: Point) => {
      const created = createObjectFromTemplate(scene.meta.diagramKind, templateId, scene, world);
      if (created === null) return;
      const node = created.node;
      setScene((current) => insertObject(current, node, created.asset));
      setSelectedNodeId(node.id);
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
      setNodeFocus(null);
      setLayoutNote("Connector created. Click the line or a terminal to refine it.");
    },
    [scene],
  );

  const handleDeleteNode = useCallback((nodeId: string) => {
    setScene((current) => deleteNode(current, asNodeId(nodeId)));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setSelectedActivation((current) => (current?.nodeId === nodeId ? null : current));
    setNodeFocus((current) => (current?.nodeId === nodeId ? null : current));
    setLayoutNote("Object and its connectors deleted.");
  }, []);

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

      if (selectedNodeId !== null) {
        event.preventDefault();
        setScene((current) => deleteNode(current, asNodeId(selectedNodeId)));
        setSelectedNodeId(null);
        setNodeFocus(null);
        setLayoutNote("Object and its connectors deleted.");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodeFocus, scene.nodes, selectedActivation, selectedEdgeId, selectedNodeId]);

  const handleSetEdgeLabel = useCallback((edgeId: string, zone: EdgeLabelZone, text: string) => {
    setScene((current) => setEndpointLabel(current, asEdgeId(edgeId), zone, text));
  }, []);

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

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedActivation(null);
    setNodeFocus((current) => (current !== null && current.nodeId === nodeId ? current : null));
    if (nodeId !== null) setSelectedEdgeId(null);
  }, []);

  const selectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    if (edgeId !== null) {
      setSelectedActivation(null);
      setNodeFocus(null);
      setSelectedNodeId(null);
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
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
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
  }, [requestFocus, scene.nodes]);

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
    setSelectedNodeId(focus.nodeId);
    setSelectedEdgeId(null);
    const same = nodeFocus !== null &&
      nodeFocus.kind === focus.kind &&
      nodeFocus.nodeId === focus.nodeId &&
      (focus.kind !== "section" || (nodeFocus.kind === "section" && nodeFocus.sectionId === focus.sectionId)) &&
      (focus.kind !== "row" || (nodeFocus.kind === "row" && nodeFocus.rowId === focus.rowId)) &&
      (focus.kind !== "lifelineSpine" ||
        (nodeFocus.kind === "lifelineSpine" && Math.abs(nodeFocus.y - focus.y) < 1));
    if (same) requestFocus(focus.nodeId, nodeTargetForFocus(focus));
    setNodeFocus(focus);
  }, [nodeFocus, nodeTargetForFocus, requestFocus]);

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
        onExportScene={handleExportScene}
        onImportScene={() => requestImport("scene")}
        onExportProject={handleExportProject}
        onImportProject={() => requestImport("project")}
        onNewScene={() => setSceneDialog("new")}
        onRenameScene={() => setSceneDialog("rename")}
        onDuplicateScene={duplicateScene}
        onDeleteScene={() => setSceneDialog("delete")}
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

      <main className={`workspace ${panelVisible ? "" : "panel-hidden"}`}>
        {panelVisible ? (
          <section className="scene-rail">
            <LayoutPanel
              direction={scene.layout.direction}
              engine={scene.layout.engine}
              note={layoutNote}
              onDirectionChange={handleLayoutDirection}
              onRun={runAutoLayout}
            />
          </section>
        ) : null}

        <CanvasStage
          scene={effectiveScene}
          layout={layout}
          camera={camera}
          zoom={zoom}
          gridVisible={gridVisible}
          gridSize={scene.canvas.grid.size}
          majorEvery={scene.canvas.grid.majorEvery}
          snapEnabled={snapEnabled}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          selectedActivation={selectedActivation}
          fitNonce={fitNonce}
          onSelectNode={selectNode}
          onSelectEdge={selectEdge}
          onSelectActivation={selectActivation}
          onSetMarker={handleSetMarker}
          onSetEdgeLabel={handleSetEdgeLabel}
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
      </main>

      <footer className="statusbar">
        <span>
          <strong>{scene.meta.title}</strong> · {scene.meta.diagramKind}
        </span>
        <span>
          revision {scene.revision} · {Object.keys(scene.nodes).length} nodes · {Object.keys(scene.edges).length} edges
        </span>
        <span className="status-spacer" />
      </footer>

      {sceneDialog !== null ? (
        <SceneDialog
          mode={sceneDialog}
          sceneTitle={scene.meta.title}
          initialName={
            sceneDialog === "new" ? "Untitled diagram" : scene.meta.title
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
        <div className={`app-toast ${toast.tone}`}>{toast.message}</div>
      ) : null}
    </div>
  );
};
