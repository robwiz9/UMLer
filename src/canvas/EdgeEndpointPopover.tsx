import { useEffect, useRef } from "react";
import type { SceneEdge } from "../model/edges.ts";
import { NO_MARKER } from "../model/edges.ts";
import type { DiagramKind } from "../model/scene.ts";
import type { EdgeEnd, EndpointMarker } from "../model/markers.ts";
import type { TextStyle, TextStyleOverride } from "../model/styles.ts";
import { TextStyleControls } from "../app/TextStyleControls.tsx";
import {
  CARDINALITY_CHIPS,
  ER_MARKER_OPTIONS,
  GENERIC_MARKER_OPTIONS,
  UML_MARKER_OPTIONS,
} from "../model/markers.ts";
import { MarkerIcon } from "./MarkerIcon.tsx";

interface EdgeEndpointPopoverProps {
  readonly edge: SceneEdge;
  readonly end: EdgeEnd;
  readonly diagramKind: DiagramKind;
  readonly focusToken?: number;
  readonly labelTextStyle: TextStyle;
  readonly onSetMarker: (marker: EndpointMarker) => void;
  readonly onSetLabel: (text: string) => void;
  readonly onSetLabelStyle: (style: TextStyleOverride | undefined) => void;
  readonly onClose: () => void;
}

export const EdgeEndpointPopover = ({
  edge,
  end,
  diagramKind,
  focusToken = 0,
  labelTextStyle,
  onSetMarker,
  onSetLabel,
  onSetLabelStyle,
  onClose,
}: EdgeEndpointPopoverProps) => {
  const textRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusToken <= 0) return;
    const timer = window.setTimeout(() => {
      textRef.current?.focus();
      textRef.current?.select();
      if (textRef.current !== null) {
        textRef.current.setSelectionRange(0, textRef.current.value.length);
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusToken]);
  const marker = edge.markers[end];
  const label = edge.labels.find((entry) => entry.zone === end)?.text ?? "";
  const labelStyle = edge.labels.find((entry) => entry.zone === end)?.textStyle;
  const isEr = diagramKind === "er" || edge.semantic.family === "er";
  const family = edge.semantic.family;
  const showUml = family === "uml" || diagramKind === "uml-class" || diagramKind === "uml-use-case";
  const terminalOptions: readonly EndpointMarker[] = [
    ...(isEr
      ? ER_MARKER_OPTIONS.map((option): EndpointMarker => ({ family: "er", kind: option.kind }))
      : []),
    ...(showUml
      ? UML_MARKER_OPTIONS
          .filter((option) => option.kind !== "realization" && option.kind !== "dependency")
          .map((option): EndpointMarker => ({ family: "uml", kind: option.kind }))
      : []),
    ...GENERIC_MARKER_OPTIONS.map((option): EndpointMarker => ({ family: "generic", kind: option.kind })),
  ];
  const isSelected = (option: EndpointMarker): boolean => {
    if (option.family === "none") return marker.family === "none";
    if (option.family !== marker.family) return false;
    return option.kind === marker.kind;
  };

  return (
    <div className="endpoint-popover endpoint-popover-compact" role="dialog" aria-label={`${end} terminal`}>
      <div className="popover-head">
        <div>
          <strong>{end === "source" ? "Source terminal" : "Target terminal"}</strong>
          <span>Applies to this line ending only</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close terminal menu">
          ×
        </button>
      </div>

      <div className="popover-section">
        <span className="popover-label">Cardinality text</span>
        <label className="field-label terminal-text-field">
          Custom text
          <input
            ref={textRef}
            id={`edge-${edge.id}-${end}-terminal-label`}
            name={`edge-${edge.id}-${end}-terminal-label`}
            value={label}
            placeholder="e.g. 0..1"
            onChange={(event) => onSetLabel(event.target.value)}
          />
        </label>
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${label.length === 0 ? "on" : ""}`}
            onClick={() => onSetLabel("")}
          >
            none
          </button>
          {CARDINALITY_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className={`chip ${label === chip ? "on" : ""}`}
              onClick={() => onSetLabel(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
        {label.length > 0 ? (
          <TextStyleControls
            base={labelTextStyle}
            value={labelStyle}
            onChange={onSetLabelStyle}
          />
        ) : null}
      </div>

      <div className="popover-section">
        <span className="popover-label">Terminal shape</span>
        <div className="terminal-grid">
          <button
            type="button"
            className={`terminal-button ${marker.family === "none" ? "on" : ""}`}
            onClick={() => onSetMarker(NO_MARKER)}
            title="No terminal (plain line)"
          >
            <MarkerIcon marker={NO_MARKER} end={end} />
          </button>
          {terminalOptions.map((option) => (
            <button
              key={`${option.family}-${option.kind}`}
              type="button"
              className={`terminal-button ${isSelected(option) ? "on" : ""}`}
              onClick={() => onSetMarker(option)}
              title={`${option.family} ${option.kind}`}
            >
              <MarkerIcon marker={option} end={end} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
