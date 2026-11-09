import type { LayoutDirection, LayoutEngine } from "../model/scene.ts";

interface LayoutPanelProps {
  readonly direction: LayoutDirection;
  readonly engine: LayoutEngine;
  readonly note: string | null;
  readonly onDirectionChange: (direction: LayoutDirection) => void;
  readonly onRun: () => void;
}

export const LayoutPanel = ({
  direction,
  engine,
  note,
  onDirectionChange,
  onRun,
}: LayoutPanelProps) => (
  <section className="panel layout-panel">
    <div className="panel-heading">
      <span>Layout</span>
      <span className="panel-hint">{engine}</span>
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
    <button type="button" className="primary-action" onClick={onRun}>
      Run crossing-reduction layout
    </button>
    {note !== null ? <div className="layout-note">{note}</div> : null}
  </section>
);
