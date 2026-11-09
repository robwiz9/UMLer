import type {
  RelationAttributeNode,
  TableLikeNode,
  TableNode,
  TableRow,
  TableSection,
  Visibility,
} from "../model/nodes.ts";
import type { RowId, SectionId } from "../model/ids.ts";

interface TableEditorProps {
  readonly node: TableLikeNode;
  readonly onUpdateNode: (patch: Partial<TableNode | RelationAttributeNode>) => void;
  readonly onUpdateRow: (rowId: RowId, patch: Partial<TableRow>) => void;
  readonly onAddRow: (sectionId?: SectionId) => void;
  readonly onDeleteRow: (rowId: RowId) => void;
  readonly onAddSection: () => void;
  readonly onUpdateSection: (sectionId: SectionId, patch: Partial<TableSection>) => void;
}

const VISIBILITIES: readonly Visibility[] = ["+", "-", "#", "~"];
const CONSTRAINTS = ["PK", "FK", "NN", "UQ"] as const;

const RowEditor = ({
  row,
  showVisibility,
  showConstraints,
  onUpdate,
  onDelete,
}: {
  readonly row: TableRow;
  readonly showVisibility: boolean;
  readonly showConstraints: boolean;
  readonly onUpdate: (patch: Partial<TableRow>) => void;
  readonly onDelete: () => void;
}) => {
  const toggleConstraint = (constraint: (typeof CONSTRAINTS)[number]): void => {
    const current = row.constraints ?? [];
    onUpdate({
      constraints: current.includes(constraint)
        ? current.filter((entry) => entry !== constraint)
        : [...current, constraint],
    });
  };
  return (
    <div className="row-editor">
      <div className={`row-editor-head ${showVisibility ? "" : "no-visibility"}`}>
        {showVisibility ? (
          <select
            id={`row-${row.id}-visibility`}
            name={`row-${row.id}-visibility`}
            aria-label={`Visibility for ${row.name}`}
            value={row.visibility ?? ""}
            onChange={(event) => onUpdate({ visibility: (event.target.value || undefined) as Visibility | undefined })}
          >
            <option value="">–</option>
            {VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {visibility}
              </option>
            ))}
          </select>
        ) : null}
        <input
          id={`row-${row.id}-name`}
          name={`row-${row.id}-name`}
          aria-label="Row name"
          value={row.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
        <input
          id={`row-${row.id}-type`}
          name={`row-${row.id}-type`}
          aria-label={row.kind === "method" ? "Return type" : "Attribute type"}
          placeholder={row.kind === "method" ? "returns" : "type"}
          value={row.kind === "method" ? row.returnType ?? "" : row.type ?? ""}
          onChange={(event) =>
            onUpdate(row.kind === "method"
              ? { returnType: event.target.value || undefined }
              : { type: event.target.value || undefined })
          }
        />
        <button type="button" className="row-delete" onClick={onDelete} title="Delete row">
          ×
        </button>
      </div>
      {showConstraints ? (
        <div className="constraint-row">
          {CONSTRAINTS.map((constraint) => (
            <label key={constraint} className={`constraint-chip ${(row.constraints ?? []).includes(constraint) ? "on" : ""}`}>
              <input
                id={`row-${row.id}-constraint-${constraint}`}
                name={`row-${row.id}-constraint-${constraint}`}
                type="checkbox"
                checked={(row.constraints ?? []).includes(constraint)}
                onChange={() => toggleConstraint(constraint)}
              />
              {constraint}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const TableEditor = ({
  node,
  onUpdateNode,
  onUpdateRow,
  onAddRow,
  onDeleteRow,
  onAddSection,
  onUpdateSection,
}: TableEditorProps) => {
  const sections: readonly TableSection[] = node.kind === "table"
    ? node.sections
    : [{
        id: "relation_attributes" as SectionId,
        role: "attributes" as const,
        rows: node.rows,
      }];
  const showVisibility = node.kind === "table" && node.tableKind === "class";
  const showConstraints = node.kind === "relationAttribute" ||
    (node.kind === "table" && node.tableKind !== "class");

  return (
    <div className="table-editor">
      <div className="editor-heading">
        <span>Table content</span>
        <span className="panel-hint">live</span>
      </div>
      <label className="field-label">
        Name
        <input
          id={`node-${node.id}-name`}
          name={`node-${node.id}-name`}
          value={node.name}
          onChange={(event) => onUpdateNode({ name: event.target.value })}
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
              onUpdateNode({ header: { ...node.header, stereotype: event.target.value || undefined } })}
          />
        </label>
      ) : null}

      {sections.map((section) => (
        <div className="section-editor" key={section.id}>
          {node.kind === "table" && section.title !== undefined ? (
            <label className="field-label section-title-field">
              Section
              <input
                id={`section-${section.id}-title`}
                name={`section-${section.id}-title`}
                placeholder="section title"
                value={section.title}
                onChange={(event) =>
                  onUpdateSection(section.id, { title: event.target.value || undefined })}
              />
            </label>
          ) : null}
          {section.rows.map((row) => (
            <RowEditor
              key={row.id}
              row={row}
              showVisibility={showVisibility}
              showConstraints={showConstraints}
              onUpdate={(patch) => onUpdateRow(row.id, patch)}
              onDelete={() => onDeleteRow(row.id)}
            />
          ))}
          <button type="button" className="editor-add" onClick={() => onAddRow(section.id)}>
            + Add row
          </button>
        </div>
      ))}
      {node.kind === "table" ? (
        <button type="button" className="editor-add section-add" onClick={onAddSection}>
          + Add section
        </button>
      ) : null}
    </div>
  );
};
