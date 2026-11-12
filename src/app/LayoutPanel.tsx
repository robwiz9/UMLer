import type {
  LayoutDirection,
  LayoutEngine,
  LayoutSpacing,
} from "../model/scene.ts";

interface LayoutPanelProps {
  readonly direction: LayoutDirection;
  readonly spacing: LayoutSpacing;
  readonly engine: LayoutEngine;
  readonly note: string | null;
  readonly onDirectionChange: (direction: LayoutDirection) => void;
  readonly onSpacingChange: (spacing: LayoutSpacing) => void;
  readonly onRun: () => void;
}

export const LayoutPanel = ({
  direction,
  spacing,
  engine,
  note,
  onDirectionChange,
  onSpacingChange,
  onRun,
}: LayoutPanelProps) => (
  <section className="panel layout-panel">
    <div className="panel-heading">
      <span>Layout</span>
      {/* <span className="panel-hint">{engine}</span> */}
    </div>
    <div className="layout-direction" role="group" aria-label="Layout direction">
      <button
        type="button"
        className={`chip ${direction === "TB" ? "on" : ""}`}
        onClick={() => onDirectionChange("TB")}
      >
        Top → bottom
      </button>
      <button
        type="button"
        className={`chip ${direction === "LR" ? "on" : ""}`}
        onClick={() => onDirectionChange("LR")}
      >
        Left → right
      </button>
    </div>
    <div className="layout-spacing-label">Spacing</div>
    <div className="layout-direction layout-spacing" role="group" aria-label="Layout spacing">
      {(["tight", "normal", "wide"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={`chip ${spacing === value ? "on" : ""}`}
          onClick={() => onSpacingChange(value)}
        >
          {value === "tight" ? "Tight" : value === "normal" ? "Normal" : "Wide"}
        </button>
      ))}
    </div>
    <button type="button" className="primary-action" onClick={onRun}>
      Run crossing-reduction layout
    </button>
    {note !== null ? <div className="layout-note">{note}</div> : null}
  </section>
);
