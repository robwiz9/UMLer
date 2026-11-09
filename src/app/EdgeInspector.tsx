import { useEffect, useRef } from "react";
import type { EdgeLayout } from "../model/layout.ts";
import type { EdgeLabelZone, EdgeRoutingMode, SceneEdge } from "../model/edges.ts";
import { edgeDisplayName } from "../model/edges.ts";
import { CARDINALITY_CHIPS, markerDefinition } from "../model/markers.ts";
import type { StrokePattern } from "../model/styles.ts";

interface EdgeInspectorProps {
  readonly edge: SceneEdge;
  readonly layout: EdgeLayout;
  readonly compact?: boolean;
  readonly idPrefix?: string;
  readonly focusToken?: number;
  readonly onSetLabel: (zone: EdgeLabelZone, text: string) => void;
  readonly onSetStrokePattern: (pattern: StrokePattern) => void;
  readonly onSetStrokeWidth: (width: number) => void;
  readonly onSetRoutingMode: (mode: EdgeRoutingMode) => void;
  readonly onReroute: () => void;
}

const zoneLabel: Record<EdgeLabelZone, string> = {
  source: "Source",
  center: "Center",
  target: "Target",
};

const PATTERNS: readonly StrokePattern[] = ["solid", "dashed", "dotted"];
const PATTERN_LABELS: Record<StrokePattern, string> = {
  solid: "Full",
  dashed: "Dashed",
  dotted: "Dotted",
};
const ROUTES: readonly EdgeRoutingMode[] = ["orthogonal", "straight"];

const LinePatternPreview = ({ pattern }: { readonly pattern: StrokePattern }) => (
  <svg viewBox="0 0 44 10" width="40" height="10" aria-hidden="true">
    <line
      x1={2}
      y1={5}
      x2={42}
      y2={5}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeDasharray={pattern === "dashed" ? "6 4" : pattern === "dotted" ? "2 3" : undefined}
    />
  </svg>
);

export const EdgeInspector = ({
  edge,
  layout,
  compact = false,
  idPrefix = "inspector",
  focusToken = 0,
  onSetLabel,
  onSetStrokePattern,
  onSetStrokeWidth,
  onSetRoutingMode,
  onReroute,
}: EdgeInspectorProps) => {
  const centerRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusToken <= 0) return;
    const timer = window.setTimeout(() => {
      centerRef.current?.focus();
      centerRef.current?.select();
      if (centerRef.current !== null) {
        centerRef.current.setSelectionRange(0, centerRef.current.value.length);
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusToken]);
  const labelFor = (zone: EdgeLabelZone): string =>
    edge.labels.find((label) => label.zone === zone)?.text ?? "";
  const isSequence = edge.semantic.family === "sequence";
  const centerField = (
    <label className="field-label">
      Center label
      <input
        ref={centerRef}
        id={`${idPrefix}-edge-${edge.id}-center-label`}
        name={`${idPrefix}-edge-${edge.id}-center-label`}
        value={labelFor("center")}
        placeholder="relationship name"
        onChange={(event) => onSetLabel("center", event.target.value)}
      />
    </label>
  );
  const lineControls = (
    <>
      <div className="line-style-row">
        <div className="field-label line-style-field">
          <span>Style</span>
          <div className="line-pattern-buttons" role="group" aria-label="Line style">
            {PATTERNS.map((pattern) => (
              <button
                key={pattern}
                type="button"
                className={`line-pattern-button ${edge.style.stroke.pattern === pattern ? "on" : ""}`}
                onClick={() => onSetStrokePattern(pattern)}
                title={`${PATTERN_LABELS[pattern]} line`}
                aria-label={`${PATTERN_LABELS[pattern]} line`}
              >
                <LinePatternPreview pattern={pattern} />
              </button>
            ))}
          </div>
        </div>
        <label className="field-label line-width-field">
          Width
          <input
            id={`${idPrefix}-edge-${edge.id}-width`}
            name={`${idPrefix}-edge-${edge.id}-width`}
            type="number"
            min={0.25}
            max={4}
            step={0.25}
            value={edge.style.stroke.width}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0.25 && value <= 4) onSetStrokeWidth(value);
            }}
          />
        </label>
      </div>
      {isSequence ? (
        <p className="panel-footnote sequence-routing-note">
          Sequence messages always stay straight on the time axis.
        </p>
      ) : (
        <label className="field-label">
          Routing
          <select
            id={`${idPrefix}-edge-${edge.id}-routing`}
            name={`${idPrefix}-edge-${edge.id}-routing`}
            value={edge.routing.mode}
            onChange={(event) => onSetRoutingMode(event.target.value as EdgeRoutingMode)}
          >
            {ROUTES.map((route) => (
              <option key={route} value={route}>
                {route === "orthogonal" ? "orthogonal (A*)" : route}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="edge-inspector">
        <div className="edge-menu-title">Line options</div>
        {centerField}
        {lineControls}
      </div>
    );
  }

  return (
    <div className="edge-inspector">
      <div className="selected-title">{edgeDisplayName(edge)}</div>
      <div className="selected-kind">
        {edge.id} · {edge.semantic.family} · {layout.routedBy} · {layout.bendCount} bends
      </div>
      <div className="endpoint-summary">
        <div>
          <span>Source</span>
          <strong>{markerDefinition(edge.markers.source).shortLabel}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{markerDefinition(edge.markers.target).shortLabel}</strong>
        </div>
      </div>

      <div className="editor-heading">
        <span>Labels</span>
        <span className="panel-hint">quick select</span>
      </div>
      {(["source", "center", "target"] as const).map((zone) => (
        <div className="edge-label-field" key={zone}>
          <label className="field-label">
            {zoneLabel[zone]}
            <input
              id={`${idPrefix}-edge-${edge.id}-${zone}-label`}
              name={`${idPrefix}-edge-${edge.id}-${zone}-label`}
              value={labelFor(zone)}
              placeholder={zone === "center" ? "relationship name" : "cardinality"}
              onChange={(event) => onSetLabel(zone, event.target.value)}
            />
          </label>
          {zone === "center" ? null : (
            <div className="chip-row compact">
              {CARDINALITY_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip ${labelFor(zone) === chip ? "on" : ""}`}
                  onClick={() => onSetLabel(zone, chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {lineControls}
      {isSequence ? null : (
        <button type="button" className="primary-action" onClick={onReroute}>
          Re-route with A*
        </button>
      )}
      <p className="panel-footnote">
        Click the edge on the canvas, then a square endpoint handle, to edit terminals.
        {isSequence
          ? " Sequence messages follow the straight time axis."
          : " Double-click the edge to rerun the obstacle-avoiding route."}
      </p>
    </div>
  );
};
