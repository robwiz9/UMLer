import { useEffect } from "react";
import type { SceneNode, TableRow, TableSection } from "../model/nodes.ts";
import type { NodeFocus } from "../model/node-focus.ts";
import type { CanvasTextFocusRequest } from "../model/text-targets.ts";
import type { RowId, SectionId } from "../model/ids.ts";
import { asSectionId } from "../model/ids.ts";

interface NodeFocusMenuProps {
  readonly node: SceneNode;
  readonly focus: NodeFocus;
  readonly focusRequest: CanvasTextFocusRequest | null;
  readonly onUpdateNode: (nodeId: string, patch: Partial<SceneNode>) => void;
  readonly onUpdateRow: (nodeId: string, rowId: RowId, patch: Partial<TableRow>) => void;
  readonly onAddRow: (nodeId: string, sectionId?: SectionId) => void;
  readonly onDeleteRow: (nodeId: string, rowId: RowId) => void;
  readonly onAddSection: (nodeId: string) => void;
  readonly onUpdateSection: (nodeId: string, sectionId: SectionId, patch: Partial<TableSection>) => void;
  readonly onDeleteSection: (nodeId: string, sectionId: SectionId) => void;
  readonly onDeleteNode: (nodeId: string) => void;
  readonly onAddActivation: (nodeId: string, worldY: number) => void;
  readonly onClose: () => void;
}

const CONSTRAINTS = ["PK", "FK", "NN", "UQ"] as const;

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
  onAddSection,
  onUpdateSection,
  onDeleteSection,
  onDeleteNode,
  onAddActivation,
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
      relationship: "Relationship",
      lifeline: "Lifeline",
      frame: "Frame",
      image: "Image",
      comment: "Comment",
    };
    const head = (
      <div className="popover-head">
        <div>
          <strong>{kindTitle[node.kind] ?? node.kind}</strong>
          <span>{node.kind === "comment" ? "note" : node.name}</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close object menu">×</button>
      </div>
    );

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
        <label className="field-label">
          {label}
          <input id={id} name={id} value={value} onChange={(event) => update(event.target.value)} />
        </label>
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

  if (focus.kind === "table") {
    return (
      <div className="node-focus-menu">
        <div className="popover-head">
          <div>
            <strong>Table header</strong>
            <span>{node.name}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Close object menu">×</button>
        </div>
        <label className="field-label">
          Entity table name
          <input
            id={`node-${node.id}-name`}
            name={`node-${node.id}-name`}
            value={node.name}
            onChange={(event) => onUpdateNode(node.id, { name: event.target.value })}
          />
        </label>
        {node.kind === "table" && node.tableKind === "class" ? (
          <label className="field-label">
            Stereotype
            <input
              id={`node-${node.id}-stereotype`}
              name={`node-${node.id}-stereotype`}
              placeholder="interface"
              value={node.header.stereotype ?? ""}
              onChange={(event) =>
                onUpdateNode(node.id, { header: { ...node.header, stereotype: event.target.value || undefined } })}
            />
          </label>
        ) : null}
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
    return (
      <div className="node-focus-menu">
        <div className="popover-head">
          <div>
            <strong>Row</strong>
            <span>{row.name}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Close object menu">×</button>
        </div>
        <label className="field-label">
          Attribute name
          <input
            id={`row-${row.id}-name`}
            name={`row-${row.id}-name`}
            value={row.name}
            onChange={(event) => onUpdateRow(node.id, row.id, { name: event.target.value })}
          />
        </label>
        <label className="field-label">
          {isMethod ? "Return type" : "Data type"}
          <input
            id={`row-${row.id}-type`}
            name={`row-${row.id}-type`}
            value={isMethod ? row.returnType ?? "" : row.type ?? ""}
            onChange={(event) =>
              onUpdateRow(node.id, row.id, isMethod
                ? { returnType: event.target.value || undefined }
                : { type: event.target.value || undefined })}
          />
        </label>
        <div className="chip-row compact">
          {CONSTRAINTS.map((constraint) => (
            <button
              key={constraint}
              type="button"
              className={`chip ${(row.constraints ?? []).includes(constraint) ? "on" : ""}`}
              onClick={() => toggleConstraint(constraint)}
            >
              {constraint}
            </button>
          ))}
        </div>
        <div className="focus-actions">
          <button type="button" className="editor-add" onClick={() => onAddRow(node.id, rowSection?.id)}>
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
