import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CircuitComponentNode, ImageAsset, SceneNode, TableRow, TableSection, Visibility } from "../model/nodes.ts";
import { CLASS_STEREOTYPE_PRESETS, normalizeStereotypeName, withClassStereotype } from "../model/nodes.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { CanvasTextFocusRequest } from "../model/text-targets.ts";
import type { RowId, SectionId } from "../model/ids.ts";
import { asSectionId } from "../model/ids.ts";
import { normalizeRotation, type CircuitJunctionStyle } from "../model/circuit.ts";
import { circuitComponent } from "../model/circuit-catalog.ts";
import { TextStyleControls } from "../app/TextStyleControls.tsx";
import { BackgroundControl } from "../app/BackgroundControl.tsx";
import { ImageAssetControls } from "./ImageAssetControls.tsx";

const RotateGlyph = ({ clockwise }: { readonly clockwise: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      transform={clockwise ? "translate(16 0) scale(-1 1)" : undefined}
    >
      <path d="M3.1 8a4.9 4.9 0 1 1 1.1 3.1" />
      <path d="M2.8 4.1v3.2H6" />
    </g>
  </svg>
);

const MirrorGlyph = ({ axis }: { readonly axis: "horizontal" | "vertical" }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {axis === "horizontal" ? (
        <>
          <path d="M8 1.8v12.4" strokeDasharray="2 2" />
          <path d="M6.2 4.3 2.2 8l4 3.7Z" fill="currentColor" stroke="none" />
          <path d="M9.8 4.3 13.8 8l-4 3.7Z" />
        </>
      ) : (
        <>
          <path d="M1.8 8h12.4" strokeDasharray="2 2" />
          <path d="M4.3 6.2 8 2.2l3.7 4Z" fill="currentColor" stroke="none" />
          <path d="M4.3 9.8 8 13.8l3.7-4Z" />
        </>
      )}
    </g>
  </svg>
);

const orientationAxisFor = (
  node: CircuitComponentNode,
): "horizontal" | "vertical" => {
  const definition = circuitComponent(node.component);
  if (definition === undefined || definition.pins.length <= 2) return "horizontal";
  const base = definition.pins.find(
    (pin) => Math.abs(pin.y) < 0.001 && pin.x < 0,
  );
  return base === undefined ? "horizontal" : "vertical";
};

const OrientationGlyph = () => (
  <svg width="16" height="15" viewBox="0 0 18 16" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4.5h10.1" />
      <path d="M9.3 2.3 12.1 4.5 9.3 6.7" />
      <path d="M16 11.5H5.9" />
      <path d="M8.7 9.3 5.9 11.5 8.7 13.7" />
    </g>
  </svg>
);

interface NodeFocusMenuProps {
  readonly node: SceneNode;
  readonly focus: NodeFocus;
  readonly focusRequest: CanvasTextFocusRequest | null;
  readonly onUpdateNode: (nodeId: string, patch: Partial<SceneNode>) => void;
  readonly onUpdateRow: (nodeId: string, rowId: RowId, patch: Partial<TableRow>) => void;
  readonly onAddRow: (nodeId: string, sectionId?: SectionId, afterRowId?: RowId) => void;
  readonly onDeleteRow: (nodeId: string, rowId: RowId) => void;
  readonly onMoveRow: (nodeId: string, rowId: RowId, direction: "up" | "down") => void;
  readonly onFocusRow: (nodeId: string, rowId: RowId) => void;
  readonly onAddSection: (nodeId: string) => void;
  readonly onUpdateSection: (nodeId: string, sectionId: SectionId, patch: Partial<TableSection>) => void;
  readonly onSetSectionVisibility: (
    nodeId: string,
    sectionId: SectionId,
    visibility: Visibility | undefined,
  ) => void;
  readonly onDeleteSection: (nodeId: string, sectionId: SectionId) => void;
  readonly onDeleteNode: (nodeId: string) => void;
  readonly onMergeJunction?: (nodeId: string) => void;
  readonly junctionWireCount?: number;
  readonly onAddActivation: (nodeId: string, worldY: number) => void;
  readonly imageAssets: Readonly<Record<string, ImageAsset>>;
  readonly onAssignImage: (nodeId: string, file: File) => Promise<void>;
  readonly onUseImageAsset: (nodeId: string, assetId: string) => void;
  readonly onRemoveImage: (nodeId: string) => void;
  readonly onClose: () => void;
}

const CONSTRAINTS = ["PK", "FK", "NN", "UQ"] as const;
const VISIBILITIES: readonly Visibility[] = ["+", "-", "#", "~"];

const LockIcon = ({ locked }: { readonly locked: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    <rect
      x="3.2"
      y="7"
      width="9.6"
      height="6.3"
      rx="1.5"
      fill={locked ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.3"
    />
    {locked ? <circle cx="8" cy="10.15" r="1" fill="white" /> : null}
  </svg>
);

const ArrowIcon = ({ direction }: { readonly direction: "up" | "down" }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d={direction === "up" ? "M8 12.5V3.8M4.6 7.2 8 3.8l3.4 3.4" : "M8 3.5v8.7M4.6 8.8 8 12.2l3.4-3.4"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const focusElementId = (request: CanvasTextFocusRequest): string | null => {
  const target = request.target;
  switch (target.kind) {
    case "nodeName":
      return `node-${request.nodeId}-name`;
    case "stereotype":
      return `node-${request.nodeId}-stereotype`;
    case "sectionTitle":
      return `section-${target.sectionId}-title`;
    case "rowName":
      return `row-${target.rowId}-name`;
    case "rowType":
      return `row-${target.rowId}-type`;
    case "lifelineLabel":
      return `node-${request.nodeId}-lifeline-label`;
    case "caption":
      return `node-${request.nodeId}-caption`;
    case "commentBody":
      return `node-${request.nodeId}-comment`;
  }
};

export const NodeFocusMenu = ({
  node,
  focus,
  focusRequest,
  onUpdateNode,
  onUpdateRow,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onFocusRow,
  onAddSection,
  onUpdateSection,
  onSetSectionVisibility,
  onDeleteSection,
  onDeleteNode,
  onMergeJunction,
  junctionWireCount = 0,
  onAddActivation,
  imageAssets,
  onAssignImage,
  onUseImageAsset,
  onRemoveImage,
  onClose,
}: NodeFocusMenuProps) => {
  useEffect(() => {
    if (focusRequest === null) return;
    const id = focusElementId(focusRequest);
    if (id === null) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(id);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus();
        element.select();
        element.setSelectionRange(0, element.value.length);
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);

  if (node.kind !== "table" && node.kind !== "relationAttribute") {
    const kindTitle: Record<string, string> = {
      actor: "Actor",
      useCase: "Use case",
      object: "Object",
      state: "State",
      pseudostate: "Pseudostate",
      referencePoint: "Reference point",
      relationship: "Relationship",
      lifeline: "Lifeline",
      frame: "Frame",
      image: "Image",
      comment: "Comment",
      circuitComponent: "Component",
      circuitJunction: "Junction",
    };
    const objectTitle =
      node.kind === "referencePoint"
        ? node.referenceVariant === "dt"
          ? "Diagram to Text reference"
          : node.referenceVariant === "tdt"
            ? "Both ways reference"
            : "Text to Diagram reference"
        : node.kind === "circuitComponent"
        ? circuitComponent(node.component)?.label ?? kindTitle[node.kind]
        : node.kind === "circuitJunction" && node.measurement !== undefined
          ? node.measurement.kind === "voltage"
            ? "Voltage label"
            : node.measurement.kind === "loop-current"
              ? "Loop current label"
              : "Current label"
          : kindTitle[node.kind] ?? node.kind;
    const lockButton = (
      <button
        type="button"
        className={`icon-button lock-button ${node.locked ? "on" : ""}`}
        onClick={() => onUpdateNode(node.id, { locked: !node.locked })}
        title={node.locked ? "Unlock object from auto-layout" : "Lock object against auto-layout"}
        aria-label={node.locked ? "Unlock object" : "Lock object"}
        aria-pressed={node.locked}
      >
        <LockIcon locked={node.locked} />
      </button>
    );
    const head = (
      <div className="popover-head">
        <div>
          <strong>{objectTitle}</strong>
          <span>{node.kind === "comment" ? "note" : node.name}</span>
        </div>
        {focus.kind === "lifelineSpine" ? (
          <button type="button" className="icon-button" onClick={onClose} title="Close object menu">×</button>
        ) : (
          lockButton
        )}
      </div>
    );
    if (node.kind === "referencePoint") {
      const variant = node.referenceVariant ?? "td";
      const referenceId = node.referenceId || "ref-id";
      return (
        <div className="node-focus-menu">
          {head}
          <label className="field-label">
              Reference mode
          <div className="reference-variant-switch code-segmented">
            <button
              type="button"
              className={variant === "td" ? "active" : ""}
              aria-pressed={variant === "td"}
              title="Text references this diagram point"
              onClick={() =>
                onUpdateNode(node.id, { referenceVariant: "td" })}
            >
              Text → Diag
            </button>
            <button
              type="button"
              className={variant === "dt" ? "active" : ""}
              aria-pressed={variant === "dt"}
              title="This diagram point links to a text target"
              onClick={() =>
                onUpdateNode(node.id, { referenceVariant: "dt" })}
            >
              Diag → Text
            </button>
            <button
              type="button"
              className={variant === "tdt" ? "active" : ""}
              aria-pressed={variant === "tdt"}
              title="Both directions: text references this point, and the point links to a target"
              onClick={() =>
                onUpdateNode(node.id, { referenceVariant: "tdt" })}
            >
              Both ways
            </button>
          </div>
          </label>
          <label className="field-label">
            {variant === "dt" ? "Target reference ID" : "Reference ID"}
            <input
              id={`node-${node.id}-reference-id`}
              name={`node-${node.id}-reference-id`}
              value={node.referenceId}
              onChange={(event) => {
                const nextReferenceId = event.target.value.replace(
                  /[^A-Za-z0-9_.:-]+/g,
                  "-",
                );
                onUpdateNode(node.id, {
                  referenceId: nextReferenceId,
                  name: nextReferenceId,
                });
              }}
              placeholder="ref-id"
              spellCheck={false}
            />
          </label>
          {variant === "tdt" ? (
            <label className="field-label">
              Refer to ID
              <input
                id={`node-${node.id}-refer-to-id`}
                name={`node-${node.id}-refer-to-id`}
                value={node.referToId ?? ""}
                onChange={(event) => {
                  const referToId = event.target.value.replace(
                    /[^A-Za-z0-9_.:-]+/g,
                    "-",
                  );
                  onUpdateNode(node.id, { referToId });
                }}
                placeholder="target-ref"
                spellCheck={false}
              />
            </label>
          ) : null}
          {variant === "dt" ? (
            <>
              <p className="panel-footnote code-mono-hint">
                Mark the target with <code>&lt;{referenceId}&gt;</code>, for
                example <code>#figure(...) &lt;{referenceId}&gt;</code> or{" "}
                <code>= Heading &lt;{referenceId}&gt;</code>.
              </p>
              <p className="panel-footnote">
                Clicking this point navigates to target. Displays target's enumeration or `Ref`
              </p>
            </>
          ) : variant === "tdt" ? (
            <>
              <p className="panel-footnote code-mono-hint">
                Use <code>@{referenceId}</code> to reference this point.
              </p>
              <p className="panel-footnote code-mono-hint">
                Mark the target once with{" "}
                <code>&lt;{node.referToId || "target-ref"}&gt;</code>, e.g.{" "}
                <code>#figure(...) &lt;{node.referToId || "target-ref"}&gt;</code>.
              </p>
              <p className="panel-footnote">
                Reference this point with a clickable link.<br></br>Clicking this point navigates to target.
              </p>
            </>
          ) : (
            <>
              <p className="panel-footnote code-mono-hint">
                Use <code>@{referenceId}</code> to reference this point.
              </p>
              <p className="panel-footnote">
                Reference this point with a clickable link.
              </p>
            </>
          )}
          <TextStyleControls
            base={{ ...node.style.text, fontSize: node.labelSize }}
            value={node.textStyle}
            onChange={(textStyle) => {
              const color = textStyle?.color ?? node.style.text.color;
              onUpdateNode(node.id, {
                textStyle,
                style: {
                  ...node.style,
                  stroke: { ...node.style.stroke, color },
                },
              });
            }}
          />

          <div className="focus-actions">
            <button
              type="button"
              className="editor-add danger"
              onClick={() => {
                onDeleteNode(node.id);
                onClose();
              }}
            >
              Delete object
            </button>
          </div>
        </div>
      );
    }

    const objectTextBase = node.kind === "frame" || node.kind === "lifeline"
      ? { ...node.style.text, weight: 600 as const }
      : node.style.text;
    const applyObjectTextStyle = (textStyle: typeof node.textStyle): void => {
      if (node.kind === "circuitComponent" || node.kind === "circuitJunction") {
        const color = textStyle?.color ?? node.style.text.color;
        onUpdateNode(node.id, {
          textStyle,
          style: {
            ...node.style,
            stroke: { ...node.style.stroke, color },
          },
        });
        return;
      }
      onUpdateNode(node.id, { textStyle });
    };

    if (focus.kind === "lifelineSpine" && node.kind === "lifeline") {
      return (
        <div className="node-focus-menu">
          {head}
          <label className="field-label">
            Head label
            <input
              id={`node-${node.id}-lifeline-label`}
              name={`node-${node.id}-lifeline-label`}
              value={node.head.label ?? node.name}
              onChange={(event) =>
                onUpdateNode(node.id, {
                  head: { ...node.head, label: event.target.value },
                })}
            />
          </label>
          <div className="focus-actions">
            <button
              type="button"
              className="editor-add"
              onClick={() => onAddActivation(node.id, focus.y)}
            >
              + Add activation bar here
            </button>
            <button
              type="button"
              className="editor-add danger"
              onClick={() => {
                onDeleteNode(node.id);
                onClose();
              }}
            >
              Delete lifeline
            </button>
          </div>
        </div>
      );
    }

    if (node.kind === "comment") {
      return (
        <div className="node-focus-menu">
          {head}
          <label className="field-label">
            Comment
            <textarea
              id={`node-${node.id}-comment`}
              name={`node-${node.id}-comment`}
              rows={5}
              value={node.body}
              onChange={(event) => onUpdateNode(node.id, { body: event.target.value })}
            />
          </label>
          <BackgroundControl
            value={node.backgroundColor}
            fallback="#fffdf2"
            onChange={(backgroundColor) => onUpdateNode(node.id, { backgroundColor })}
          />
          <TextStyleControls
            base={node.style.text}
            value={node.textStyle}
            onChange={(textStyle) => onUpdateNode(node.id, { textStyle })}
          />
          <div className="focus-actions">
            <button
              type="button"
              className="editor-add danger"
              onClick={() => {
                onDeleteNode(node.id);
                onClose();
              }}
            >
              Delete comment
            </button>
          </div>
        </div>
      );
    }

    const label = node.kind === "image" ? "Caption" : node.kind === "lifeline" ? "Head label" : "Text";
    const value = node.kind === "image"
      ? node.caption ?? ""
      : node.kind === "lifeline"
        ? node.head.label ?? node.name
        : node.name;
    const id = node.kind === "image"
      ? `node-${node.id}-caption`
      : node.kind === "lifeline"
        ? `node-${node.id}-lifeline-label`
        : `node-${node.id}-name`;
    const update = (text: string): void => {
      if (node.kind === "image") {
        onUpdateNode(node.id, { caption: text || undefined });
      } else if (node.kind === "lifeline") {
        onUpdateNode(node.id, { head: { ...node.head, label: text } });
      } else {
        onUpdateNode(node.id, { name: text });
      }
    };
    return (
      <div className="node-focus-menu">
        {head}
        {node.kind === "image" ? (
          <ImageAssetControls
            node={node}
            imageAssets={imageAssets}
            onAssign={(file) => onAssignImage(node.id, file)}
            onUseAsset={(assetId) => onUseImageAsset(node.id, assetId)}
            onRemove={() => onRemoveImage(node.id)}
          />
        ) : null}
        <label className="field-label">
          {label}
          <input
            id={id}
            name={id}
            value={value}
            data-label-scope={
              node.kind === "circuitComponent" || node.kind === "circuitJunction"
                ? "node"
                : undefined
            }
            data-label-node-id={
              node.kind === "circuitComponent" || node.kind === "circuitJunction"
                ? node.id
                : undefined
            }
            placeholder={
              node.kind === "circuitComponent" || node.kind === "circuitJunction"
                ? 'e.g. R_1 or R_"12"'
                : undefined
            }
            onChange={(event) => update(event.target.value)}
          />
        </label>
        {node.kind === "circuitComponent" ? (
          <div className="circuit-rotation-controls">
            <span className="field-label">Rotation</span>
            <div className="circuit-rotation-row">
              <button
                type="button"
                className="chip"
                onClick={() =>
                  onUpdateNode(node.id, {
                    rotation: normalizeRotation(node.rotation - 45),
                  })
                }
                title="Rotate 45° counter-clockwise"
                aria-label="Rotate 45 degrees counter-clockwise"
              >
                <RotateGlyph clockwise={false} />
              </button>
              <span className="circuit-rotation-value">{node.rotation}°</span>
              <button
                type="button"
                className="chip"
                onClick={() =>
                  onUpdateNode(node.id, {
                    rotation: normalizeRotation(node.rotation + 45),
                  })
                }
                title="Rotate 45° clockwise"
                aria-label="Rotate 45 degrees clockwise"
              >
                <RotateGlyph clockwise={true} />
              </button>
              <span className="circuit-rotation-divider" aria-hidden="true" />
              <button
                type="button"
                className="chip"
                onClick={() =>
                  onUpdateNode(node.id, { mirrorY: node.mirrorY !== true })
                }
                title="Mirror vertically (wires follow the mirrored pins)"
                aria-label="Mirror vertically"
              >
                <MirrorGlyph axis="vertical" />
              </button>
              <button
                type="button"
                className="chip"
                onClick={() =>
                  onUpdateNode(node.id, { mirrorX: node.mirrorX !== true })
                }
                title="Mirror horizontally (wires follow the mirrored pins)"
                aria-label="Mirror horizontally"
              >
                <MirrorGlyph axis="horizontal" />
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  const axis = orientationAxisFor(node);
                  onUpdateNode(
                    node.id,
                    axis === "horizontal"
                      ? {
                        mirrorX: node.mirrorX !== true,
                        swapPinsX: node.swapPinsX !== true,
                      }
                      : {
                        mirrorY: node.mirrorY !== true,
                        swapPinsY: node.swapPinsY !== true,
                      },
                  );
                }}
                title="Change orientation and rewire the mirrored endings"
                aria-label="Change orientation"
              >
                <OrientationGlyph />
              </button>
            </div>
            {/* <div className="circuit-rotation-row">
              {ROTATIONS.map((rotation) => (
                <button
                  key={rotation}
                  type="button"
                  className={`chip ${node.rotation === rotation ? "on" : ""}`}
                  onClick={() => onUpdateNode(node.id, { rotation })}
                  title={`Rotate to ${rotation}°`}
                >
                  {rotation}°
                </button>
              ))}
            </div> */}
          </div>
        ) : null}
        {node.kind === "circuitComponent" && node.component === "switch" ? (
          <div className="circuit-junction-controls">
            <span className="field-label">Switch state</span>
            <div className="circuit-rotation-row">
              <button
                type="button"
                className={`chip ${node.switchClosed === true ? "on" : ""}`}
                onClick={() => onUpdateNode(node.id, { switchClosed: true })}
              >
                ON
              </button>
              <button
                type="button"
                className={`chip ${node.switchClosed !== true ? "on" : ""}`}
                onClick={() => onUpdateNode(node.id, { switchClosed: false })}
              >
                OFF
              </button>
            </div>
          </div>
        ) : null}
        {node.kind === "circuitJunction" ? (
          <div className="circuit-junction-controls">
            {node.measurement !== undefined ? (
              <>
                <span className="field-label">Measurement</span>
                <div className="circuit-rotation-row">
                  {node.measurement.kind !== "loop-current" ? (
                    <button
                      type="button"
                      className={`chip ${node.measurement.mirrorY === true ? "on" : ""}`}
                      aria-label="Mirror measurement arrow vertically"
                      title="Mirror measurement arrow vertically"
                      onClick={() => {
                        const measurement = node.measurement;
                        if (measurement === undefined) return;
                        onUpdateNode(node.id, {
                          measurement: {
                            ...measurement,
                            mirrorY: measurement.mirrorY !== true,
                          },
                        });
                      }}
                    >
                      <MirrorGlyph axis="vertical" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`chip ${node.measurement.mirrorX === true ? "on" : ""}`}
                    aria-label="Mirror measurement arrow horizontally"
                    title="Mirror measurement arrow horizontally"
                    onClick={() => {
                      const measurement = node.measurement;
                      if (measurement === undefined) return;
                      onUpdateNode(node.id, {
                        measurement: {
                          ...measurement,
                          mirrorX: measurement.mirrorX !== true,
                        },
                      });
                    }}
                  >
                    <MirrorGlyph axis="horizontal" />
                  </button>
                  <label className="field-inline">
                    <span>Angle</span>
                    <input
                      type="number"
                      value={Math.round(node.rotation ?? 0)}
                      step={1}
                      onChange={(event) =>
                        onUpdateNode(node.id, {
                          rotation: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <span className="field-label">Dot style</span>
                <div className="circuit-rotation-row">
                  {(["filled", "solid", "hollow", "none"] as const satisfies readonly CircuitJunctionStyle[]).map(
                    (style) => (
                      <button
                        key={style}
                        type="button"
                        className={`chip ${node.junctionStyle === style ? "on" : ""}`}
                        onClick={() => onUpdateNode(node.id, { junctionStyle: style })}
                      >
                        {style === "filled"
                          ? "● Filled"
                          : style === "solid"
                            ? "● Filled XL"
                            : style === "hollow"
                              ? "○ Hollow"
                              : "None"}
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
        <TextStyleControls
          base={objectTextBase}
          value={node.textStyle}
          objectColor={node.kind === "circuitComponent" || node.kind === "circuitJunction"}
          onChange={applyObjectTextStyle}
        />
        <div className="focus-actions">
          {node.kind === "circuitJunction" &&
            junctionWireCount === 2 &&
            onMergeJunction !== undefined ? (
            <button
              type="button"
              className="editor-add"
              onClick={() => {
                onMergeJunction(node.id);
                onClose();
              }}
            >
              Remove Junction (merge wires)
            </button>
          ) : null}
          <button
            type="button"
            className="editor-add danger"
            onClick={() => {
              onDeleteNode(node.id);
              onClose();
            }}
          >
            Delete object
          </button>
        </div>
      </div>
    );
  }

  const sections: readonly TableSection[] = node.kind === "table"
    ? node.sections
    : [{
      id: asSectionId(`${node.id}_attributes`),
      role: "attributes",
      rows: node.rows,
    }];
  const section = focus.kind === "section"
    ? sections.find((entry) => entry.id === focus.sectionId)
    : undefined;
  const row = focus.kind === "row"
    ? sections.flatMap((entry) => entry.rows).find((entry) => entry.id === focus.rowId)
    : undefined;
  const rowSection = row === undefined
    ? undefined
    : sections.find((entry) => entry.rows.some((candidate) => candidate.id === row.id));
  const weakEntity =
    node.kind === "table" && node.tableKind === "entity" && node.header.weak === true;

  if (focus.kind === "table") {
    return (
      <div className="node-focus-menu">
        <div className="popover-head">
          <div>
            <strong>Table header</strong>
            <span>{node.name}</span>
          </div>
          <button
            type="button"
            className={`icon-button lock-button ${node.locked ? "on" : ""}`}
            onClick={() => onUpdateNode(node.id, { locked: !node.locked })}
            title={node.locked ? "Unlock object from auto-layout" : "Lock object against auto-layout"}
            aria-label={node.locked ? "Unlock object" : "Lock object"}
            aria-pressed={node.locked}
          >
            <LockIcon locked={node.locked} />
          </button>
        </div>
        <div className="table-name-row">
          <label className="field-label">
            Entity table name
            <input
              id={`node-${node.id}-name`}
              name={`node-${node.id}-name`}
              value={node.name}
              onChange={(event) => onUpdateNode(node.id, { name: event.target.value })}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey
                ) {
                  return;
                }
                event.preventDefault();
                const firstRow = sections.flatMap((entry) => entry.rows)[0];
                if (firstRow !== undefined) {
                  onFocusRow(node.id, firstRow.id);
                } else {
                  onAddRow(node.id, sections[0]?.id);
                }
              }}
            />
          </label>
          {node.kind === "table" && node.tableKind === "entity" ? (
            <button
              type="button"
              className={`square-action weak-toggle ${weakEntity ? "on" : ""}`}
              onClick={() =>
                onUpdateNode(node.id, {
                  header: { ...node.header, weak: !weakEntity },
                })}
              aria-pressed={weakEntity}
              aria-label="Weak entity"
              title="Mark this entity as weak (partial key shown as D)"
            >
              W
            </button>
          ) : null}
        </div>
        {node.kind === "table" && node.tableKind === "class" ? (
          <>
            <label className="field-label">
              Stereotype
              <input
                id={`node-${node.id}-stereotype`}
                name={`node-${node.id}-stereotype`}
                placeholder="interface"
                value={node.header.stereotype ?? ""}
                onChange={(event) =>
                  onUpdateNode(node.id, {
                    header: withClassStereotype(node.header, event.target.value),
                  })}
              />
            </label>
            <div className="chip-row compact" role="group" aria-label="Class stereotype presets">
              {CLASS_STEREOTYPE_PRESETS.map((preset) => {
                const active =
                  normalizeStereotypeName(node.header.stereotype) === preset ||
                  (preset === "interface" && node.header.isInterface === true) ||
                  (preset === "abstract" && node.header.abstract === true);
                return (
                  <button
                    key={preset}
                    type="button"
                    className={`chip ${active ? "on" : ""}`}
                    aria-pressed={active}
                    title={active ? `Clear the ${preset} stereotype` : `Set stereotype to ${preset}`}
                    onClick={() =>
                      onUpdateNode(node.id, {
                        header: withClassStereotype(
                          node.header,
                          active ? undefined : preset,
                        ),
                      })}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        <BackgroundControl
          value={node.kind === "table" ? node.header.backgroundColor : undefined}
          fallback={node.style.headerFill.color ?? "#f3f1eb"}
          onChange={(backgroundColor) => {
            if (node.kind === "table") {
              onUpdateNode(node.id, {
                header: { ...node.header, backgroundColor },
              });
            } else {
              onUpdateNode(node.id, { backgroundColor });
            }
          }}
        />
        <TextStyleControls
          base={node.style.headerText}
          value={node.kind === "table" ? node.header.textStyle : node.textStyle}
          onChange={(textStyle) => {
            if (node.kind === "table") {
              onUpdateNode(node.id, {
                header: { ...node.header, textStyle },
              });
            } else {
              onUpdateNode(node.id, { textStyle });
            }
          }}
        />
        <div className="focus-actions">
          <button type="button" className="editor-add" onClick={() => onAddRow(node.id, sections[0]?.id)}>
            + Add row
          </button>
          <button type="button" className="editor-add" onClick={() => onAddSection(node.id)}>
            + Add section
          </button>
          <button
            type="button"
            className="editor-add danger"
            onClick={() => {
              onDeleteNode(node.id);
              onClose();
            }}
          >
            Delete object
          </button>
        </div>
      </div>
    );
  }

  if (focus.kind === "section" && section !== undefined) {
    const isClassTable = node.kind === "table" && node.tableKind === "class";
    const firstRow = section.rows[0];
    const commonVisibility = firstRow === undefined
      ? null
      : section.rows.every(
        (entry) =>
          entry.prefix === undefined &&
          entry.visibility === firstRow.visibility,
      )
        ? firstRow.visibility ?? "none"
        : "mixed";
    return (
      <div className="node-focus-menu">
        <div className="popover-head">
          <div>
            <strong>Section</strong>
            <span>{section.title ?? "untitled section"}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Close object menu">×</button>
        </div>
        {node.kind === "table" ? (
          <label className="field-label">
            Section header
            <input
              id={`section-${section.id}-title`}
              name={`section-${section.id}-title`}
              placeholder="section title"
              value={section.title ?? ""}
              onChange={(event) =>
                onUpdateSection(node.id, section.id, { title: event.target.value || undefined })}
            />
          </label>
        ) : null}
        {node.kind === "table" ? (
          <BackgroundControl
            value={section.backgroundColor}
            fallback={node.style.fill.color ?? "#ffffff"}
            onChange={(backgroundColor) => onUpdateSection(node.id, section.id, { backgroundColor })}
          />
        ) : null}
        <TextStyleControls
          base={{ ...node.style.text, weight: 600 }}
          value={section.textStyle}
          onChange={(textStyle) => onUpdateSection(node.id, section.id, { textStyle })}
        />
        {isClassTable ? (
          <div className="field-label">
            <span>Set visibility prefix to all</span>
            <div
              className="chip-row compact"
              role="group"
              aria-label="Set visibility prefix to all rows in this section"
            >
              <button
                type="button"
                className={`chip ${commonVisibility === "none" ? "on" : ""}`}
                onClick={() => onSetSectionVisibility(node.id, section.id, undefined)}
                title="No visibility prefix for all rows"
              >
                none
              </button>
              {VISIBILITIES.map((visibility) => (
                <button
                  key={visibility}
                  type="button"
                  className={`chip ${commonVisibility === visibility ? "on" : ""}`}
                  onClick={() => onSetSectionVisibility(node.id, section.id, visibility)}
                  title={`UML ${visibility} visibility for every row`}
                >
                  {visibility}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="focus-actions">
          <button type="button" className="editor-add" onClick={() => onAddRow(node.id, section.id)}>
            + Add row
          </button>
          {node.kind === "table" ? (
            <>
              <button type="button" className="editor-add" onClick={() => onAddSection(node.id)}>
                + Add section
              </button>
              <button
                type="button"
                className="editor-add danger"
                onClick={() => {
                  onDeleteSection(node.id, section.id);
                  onClose();
                }}
              >
                Delete section
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (focus.kind === "row" && row !== undefined) {
    const toggleConstraint = (constraint: (typeof CONSTRAINTS)[number]): void => {
      const current = row.constraints ?? [];
      onUpdateRow(node.id, row.id, {
        constraints: current.includes(constraint)
          ? current.filter((entry) => entry !== constraint)
          : [...current, constraint],
      });
    };
    const isMethod = row.kind === "method";
    const isClassRow = node.kind === "table" && node.tableKind === "class";
    const prefixValue = row.prefix ?? row.visibility ?? "";
    const typeValue = isMethod ? row.returnType ?? "" : row.type ?? "";
    const rowSectionIndex = rowSection === undefined
      ? -1
      : sections.findIndex((entry) => entry.id === rowSection.id);
    const rowIndexInSection = rowSection === undefined
      ? -1
      : rowSection.rows.findIndex((entry) => entry.id === row.id);
    const canMoveUp =
      rowIndexInSection > 0 || rowSectionIndex > 0;
    const canMoveDown =
      rowSection !== undefined &&
      rowSectionIndex >= 0 &&
      (rowIndexInSection < rowSection.rows.length - 1 ||
        rowSectionIndex < sections.length - 1);
    const focusTypeField = (): void => {
      const input = document.getElementById(`row-${row.id}-type`);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    };
    const moveAndKeepFocus = (direction: "up" | "down"): void => {
      onMoveRow(node.id, row.id, direction);
      // The row id (and therefore this menu) is stable across the move. Put
      // the caret back on the same row once React has committed the new order.
      window.setTimeout(() => {
        const input = document.getElementById(`row-${row.id}-name`);
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      }, 0);
    };
    const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        focusTypeField();
        return;
      }
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      event.preventDefault();
      if (row.name.trim() === "" && typeValue.trim() === "") {
        onDeleteRow(node.id, row.id);
        onClose();
        return;
      }
      focusTypeField();
    };
    const handleTypeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      event.preventDefault();
      onAddRow(node.id, rowSection?.id, row.id);
    };
    return (
      <div className="node-focus-menu">
        <div className="popover-head">
          <div>
            <strong>Row</strong>
            <span>{row.name}</span>
          </div>
          <div className="row-move-head-actions">
            <button
              type="button"
              className="square-action row-move-button"
              onClick={() => moveAndKeepFocus("up")}
              onMouseDown={(event) => event.preventDefault()}
              disabled={!canMoveUp}
              title="Move row up"
              aria-label="Move row up"
            >
              <ArrowIcon direction="up" />
            </button>
            <button
              type="button"
              className="square-action row-move-button"
              onClick={() => moveAndKeepFocus("down")}
              onMouseDown={(event) => event.preventDefault()}
              disabled={!canMoveDown}
              title="Move row down"
              aria-label="Move row down"
            >
              <ArrowIcon direction="down" />
            </button>
          </div>
        </div>
        {isClassRow ? (
          <div className="field-label">
            <span>Row type</span>
            <div className="chip-row compact" role="group" aria-label="Row type">
              <button
                type="button"
                className={`chip ${!isMethod ? "on" : ""}`}
                onClick={() =>
                  onUpdateRow(node.id, row.id, {
                    kind: "attribute",
                    type: row.returnType ?? row.type,
                    returnType: undefined,
                    parameters: undefined,
                  })}
              >
                Attribute
              </button>
              <button
                type="button"
                className={`chip ${isMethod ? "on" : ""}`}
                onClick={() =>
                  onUpdateRow(node.id, row.id, {
                    kind: "method",
                    returnType: row.type ?? row.returnType,
                    type: undefined,
                  })}
              >
                Method
              </button>
            </div>
          </div>
        ) : null}
        <label className="field-label">
          {isMethod ? "Method name" : "Attribute name"}
          <input
            id={`row-${row.id}-name`}
            name={`row-${row.id}-name`}
            placeholder={isMethod ? "operation" : "attribute"}
            value={row.name}
            onChange={(event) => onUpdateRow(node.id, row.id, { name: event.target.value })}
            onKeyDown={handleNameKeyDown}
          />
        </label>
        <label className="field-label">
          {isMethod ? "Return type" : "Data type"}
          <input
            id={`row-${row.id}-type`}
            name={`row-${row.id}-type`}
            placeholder={isMethod ? "returns" : "type"}
            value={typeValue}
            onChange={(event) =>
              onUpdateRow(node.id, row.id, isMethod
                ? { returnType: event.target.value || undefined }
                : { type: event.target.value || undefined })}
            onKeyDown={handleTypeKeyDown}
          />
        </label>
        {isClassRow ? (
          <>
            <div className="field-label">
              <span>Visibility prefix</span>
              <div className="chip-row compact" role="group" aria-label="Visibility prefix">
                <button
                  type="button"
                  className={`chip ${prefixValue === "" ? "on" : ""}`}
                  onClick={() =>
                    onUpdateRow(node.id, row.id, { visibility: undefined, prefix: undefined })}
                  title="No visibility prefix"
                >
                  none
                </button>
                {VISIBILITIES.map((visibility) => {
                  let title = `UML ${visibility} visibility`;
                  if (visibility === "+") title = "Public method";
                  if (visibility === "-") title = "Private method";
                  if (visibility === "#") title = "Protected method";
                  if (visibility === "~") title = "Package method";
                  return (
                    <button
                      key={visibility}
                      type="button"
                      className={`chip ${prefixValue === visibility ? "on" : ""}`}
                      onClick={() => onUpdateRow(node.id, row.id, { visibility, prefix: undefined })}
                      title={title}
                    >
                      {visibility}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="field-label">
              Custom prefix
              <input
                id={`row-${row.id}-prefix`}
                name={`row-${row.id}-prefix`}
                placeholder="e.g. static"
                value={row.prefix ?? ""}
                onChange={(event) =>
                  onUpdateRow(node.id, row.id, { prefix: event.target.value || undefined })}
              />
            </label>
          </>
        ) : null}
        {!isClassRow ? (
          <div className="chip-row compact">
            {CONSTRAINTS.map((constraint) => (
              <button
                key={constraint}
                type="button"
                className={`chip ${(row.constraints ?? []).includes(constraint) ? "on" : ""}`}
                onClick={() => toggleConstraint(constraint)}
                title={constraint === "PK" && weakEntity
                  ? "Partial key of a weak entity"
                  : `${constraint} constraint`}
              >
                {constraint === "PK" && weakEntity ? "D" : constraint}
              </button>
            ))}
          </div>
        ) : null}
        <TextStyleControls
          base={node.style.text}
          value={row.textStyle}
          onChange={(textStyle) => onUpdateRow(node.id, row.id, { textStyle })}
        />
        <div className="focus-actions">
          <button type="button" className="editor-add" onClick={() => onAddRow(node.id, rowSection?.id, row.id)}>
            + Add row
          </button>
          <button
            type="button"
            className="editor-add danger"
            onClick={() => {
              onDeleteRow(node.id, row.id);
              onClose();
            }}
          >
            Delete row
          </button>
        </div>
      </div>
    );
  }

  return null;
};
