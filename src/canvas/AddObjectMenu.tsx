import type { DiagramKind } from "../model/scene.ts";
import { DIAGRAM_KIND_LABELS } from "../model/scene.ts";
import type { ObjectTemplate, ObjectTemplateId } from "../model/object-catalog.ts";
import { objectTemplatesFor } from "../model/object-catalog.ts";

interface AddObjectMenuProps {
  readonly diagramKind: DiagramKind;
  readonly onPick: (templateId: ObjectTemplateId) => void;
  readonly onClose: () => void;
}

const GROUPS: readonly {
  readonly key: ObjectTemplate["group"];
  readonly title: string;
}[] = [
  { key: "diagram", title: "Diagram objects" },
  { key: "annotation", title: "Annotations" },
];

export const AddObjectMenu = ({ diagramKind, onPick, onClose }: AddObjectMenuProps) => {
  const templates = objectTemplatesFor(diagramKind);
  return (
    <div className="add-object-menu" role="menu" aria-label="Add object">
      <div className="popover-head">
        <div>
          <strong>Add object</strong>
          <span>{DIAGRAM_KIND_LABELS[diagramKind]}</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close add menu">
          ×
        </button>
      </div>

      {GROUPS.map((group) => {
        const items = templates.filter((template) => template.group === group.key);
        if (items.length === 0) return null;
        return (
          <div key={group.key} className="add-object-group">
            <div className="add-object-group-title">{group.title}</div>
            {items.map((template) => (
              <button
                key={template.id}
                type="button"
                className="add-object-item"
                role="menuitem"
                onClick={() => onPick(template.id)}
              >
                <span className="add-object-icon" aria-hidden="true">{template.icon}</span>
                <span className="add-object-copy">
                  <strong>{template.label}</strong>
                  <small>{template.hint}</small>
                </span>
              </button>
            ))}
          </div>
        );
      })}

      <p className="add-object-footnote">
        Lines are drawn from the border handles of a selected object, not from this menu.
      </p>
    </div>
  );
};
