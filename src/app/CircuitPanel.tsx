import type { CircuitStandard } from "../model/circuit.ts";
import { circuitComponent } from "../model/circuit-catalog.ts";
import { CircuitSymbolPreview } from "../canvas/CircuitSymbols.tsx";

interface CircuitPanelProps {
  readonly standard: CircuitStandard;
  readonly onChange: (standard: CircuitStandard) => void;
}

export const CircuitPanel = ({ standard, onChange }: CircuitPanelProps) => {
  const resistor = circuitComponent("resistor");
  return (
    <section className="panel circuit-panel" aria-label="Circuit appearance">
      <div className="panel-heading">
        <span>Circuit</span>
      </div>
      <div className="layout-direction circuit-standard" role="group" aria-label="Circuit standard">
        <button
          type="button"
          className={`chip ${standard === "iec" ? "on" : ""}`}
          aria-pressed={standard === "iec"}
          onClick={() => onChange("iec")}
          title="IEC / European symbols"
        >
          IEC / EU
        </button>
        <button
          type="button"
          className={`chip ${standard === "ansi" ? "on" : ""}`}
          aria-pressed={standard === "ansi"}
          onClick={() => onChange("ansi")}
          title="ANSI / US symbols"
        >
          ANSI / US
        </button>
      </div>
      {resistor !== undefined ? (
        <div className="circuit-preview-card">
          <CircuitSymbolPreview component={resistor} standard={standard} width={108} height={42} />
          <span>{standard === "iec" ? "Resistor · rectangular body" : "Resistor · zigzag body"}</span>
        </div>
      ) : null}
    </section>
  );
};
