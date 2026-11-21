import { useMemo, useRef, useState } from "react";
import type { ObjectTemplateId } from "../model/object-catalog.ts";
import { objectTemplate } from "../model/object-catalog.ts";
import type { CircuitStandard } from "../model/circuit.ts";
import {
  CIRCUIT_COMPONENTS,
  circuitComponent,
  circuitComponentsByGroup,
} from "../model/circuit-catalog.ts";
import { CircuitSymbolPreview } from "./CircuitSymbols.tsx";
import { useCircuitRecents } from "../app/use-circuit-recents.ts";

interface CircuitAddObjectMenuProps {
  readonly standard: CircuitStandard;
  readonly onPick: (templateId: ObjectTemplateId) => void;
  readonly onClose: () => void;
}

const MEASUREMENT_TEMPLATES = [
  {
    id: "circuit-voltage-label" as const,
    label: "Voltage label",
    icon: "⌒",
    description: "Semi-elliptical voltage measurement arrow",
    keywords: ["voltage", "measure", "meter", "u", "v"],
  },
  {
    id: "circuit-current-label" as const,
    label: "Current label",
    icon: "→",
    description: "Straight current measurement arrow",
    keywords: ["current", "measure", "meter", "i"],
  },
  {
    id: "circuit-loop-current-label" as const,
    label: "Loop current label",
    icon: "↻",
    description: "3/4-circle loop current arrow",
    keywords: ["loop", "current", "mesh", "measure", "i"],
  },
];

export const CircuitAddObjectMenu = ({
  standard,
  onPick,
  onClose,
}: CircuitAddObjectMenuProps) => {
  const [query, setQuery] = useState("");
  const { recents, remember } = useCircuitRecents();
  const tableRef = useRef<HTMLDivElement | null>(null);
  const normalized = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (normalized.length === 0) return CIRCUIT_COMPONENTS;
    return CIRCUIT_COMPONENTS.filter((component) =>
      [
        component.label,
        component.description,
        component.prefix,
        ...component.keywords,
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [normalized]);

  const groups = useMemo(
    () =>
      circuitComponentsByGroup()
        .map((group) => ({
          ...group,
          components: group.components.filter((component) => matches.includes(component)),
        }))
        .filter((group) => group.components.length > 0),
    [matches],
  );

  const nodeMatches =
    normalized.length === 0 ||
    ["node", "junction", "dot", "branch", "connection"].some((word) =>
      word.includes(normalized) || normalized.includes(word),
    );

  const measurementMatches = MEASUREMENT_TEMPLATES.filter(
    (template) =>
      normalized.length === 0 ||
      [template.label, template.description, ...template.keywords].some(
        (value) => value.toLowerCase().includes(normalized),
      ),
  );

  const referenceMatches =
    normalized.length === 0 ||
    ["reference", "point", "typst", "annotation", "ref"].some(
      (word) => word.includes(normalized) || normalized.includes(word),
    );

  const pick = (templateId: ObjectTemplateId): void => {
    remember(templateId);
    onPick(templateId);
  };

  const recentItems = normalized.length === 0
    ? recents.flatMap((id) => {
        const template = objectTemplate("circuit", id);
        return template === undefined ? [] : [{ id, template }];
      })
    : [];

  return (
    <div className="add-object-menu circuit-add-menu" role="menu" aria-label="Add circuit object">
      <div className="popover-head">
        <div>
          <strong>Add component</strong>
          <span>Circuit</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close add menu">
          ×
        </button>
      </div>

      <input
        className="circuit-search"
        type="search"
        value={query}
        placeholder="Search components…"
        aria-label="Search circuit components"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            const first = tableRef.current?.querySelector<HTMLButtonElement>("[data-circuit-row]");
            first?.focus();
          }
        }}
      />

      {recentItems.length > 0 ? (
        <div className="add-object-group circuit-recent-group">
          <div className="add-object-group-title">Recently placed</div>
          <div className="circuit-recent-row">
            {recentItems.map(({ id, template }) => {
              const component = template.componentKind === undefined
                ? undefined
                : circuitComponent(template.componentKind);
              return (
                <button
                  key={id}
                  type="button"
                  className="circuit-recent-chip"
                  title={template.label}
                  onClick={() => pick(id)}
                >
                  {component === undefined ? (
                    <span className="circuit-recent-dot" aria-hidden="true">●</span>
                  ) : (
                    <CircuitSymbolPreview component={component} standard={standard} width={30} height={20} />
                  )}
                  <span>{template.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="circuit-add-scroll">
        <div className="circuit-table-head" aria-hidden="true">
          <span>Symbol</span>
          <span>Component</span>
          <span>Ref</span>
          <span>Description</span>
        </div>
        <div className="circuit-table" ref={tableRef} role="group" aria-label="Circuit components">
        {groups.length === 0 && !nodeMatches && measurementMatches.length === 0 ? (
          <div className="circuit-empty">No components match “{query.trim()}”.</div>
        ) : (
          groups.map((group) => (
            <div key={group.group} className="circuit-table-group">
              <div className="circuit-table-group-title">{group.label}</div>
              {group.components.map((component) => (
                <button
                  key={component.kind}
                  type="button"
                  className="circuit-table-row"
                  data-circuit-row="true"
                  role="menuitem"
                  onClick={() => pick(`circuit:${component.kind}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onClose();
                    }
                  }}
                >
                  <span className="circuit-table-symbol">
                    <CircuitSymbolPreview component={component} standard={standard} width={42} height={24} />
                  </span>
                  <span className="circuit-table-name">{component.label}</span>
                  <span className="circuit-table-ref">{component.prefix}</span>
                  <span className="circuit-table-desc">{component.description}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {referenceMatches ? (
        <div className="circuit-table-group">
          <div className="circuit-table-group-title">Annotations</div>
          <button
            type="button"
            className="circuit-table-row"
            data-circuit-row="true"
            role="menuitem"
            onClick={() => pick("reference-point")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          >
            <span className="circuit-table-symbol">
              <span className="circuit-node-symbol" aria-hidden="true">◉</span>
            </span>
            <span className="circuit-table-name">Reference point</span>
            <span className="circuit-table-ref">—</span>
            <span className="circuit-table-desc">Text reference or diagram-to-text link</span>
          </button>
        </div>
      ) : null}

      {nodeMatches ? (
        <div className="circuit-table-group">
          <div className="circuit-table-group-title">Nodes</div>
          <button
            type="button"
            className="circuit-table-row"
            data-circuit-row="true"
            role="menuitem"
            onClick={() => pick("circuit-node")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          >
            <span className="circuit-table-symbol">
              <span className="circuit-node-symbol" aria-hidden="true">●</span>
            </span>
            <span className="circuit-table-name">Node</span>
            <span className="circuit-table-ref">—</span>
            <span className="circuit-table-desc">Branch point; filled, hollow or hidden dot</span>
          </button>
        </div>
      ) : null}

      {measurementMatches.length > 0 ? (
        <div className="circuit-table-group">
          <div className="circuit-table-group-title">Measurements</div>
          {measurementMatches.map((template) => (
            <button
              key={template.id}
              type="button"
              className="circuit-table-row"
              data-circuit-row="true"
              role="menuitem"
              onClick={() => pick(template.id)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                }
              }}
            >
              <span className="circuit-table-symbol">
                <span className="circuit-node-symbol" aria-hidden="true">
                  {template.icon}
                </span>
              </span>
              <span className="circuit-table-name">{template.label}</span>
              <span className="circuit-table-ref">—</span>
              <span className="circuit-table-desc">{template.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="circuit-annotations">
        <div className="add-object-group-title">Annotations</div>
        <button
          type="button"
          className="circuit-annotation-row"
          onClick={() => pick("image")}
        >
          <span className="add-object-icon" aria-hidden="true">▨</span>
          <span className="add-object-copy">
            <strong>Image</strong>
            <small>PNG / JPG / SVG, or a placeholder frame</small>
          </span>
        </button>
        <button
          type="button"
          className="circuit-annotation-row"
          onClick={() => pick("comment")}
        >
          <span className="add-object-icon" aria-hidden="true">▧</span>
          <span className="add-object-copy">
            <strong>Comment</strong>
            <small>Free-standing note</small>
          </span>
        </button>
      </div>

      <p className="add-object-footnote">
        Drag from a pin handle to wire components. Wires are plain lines; crossings get an omega bridge.
      </p>
      </div>
    </div>
  );
};
