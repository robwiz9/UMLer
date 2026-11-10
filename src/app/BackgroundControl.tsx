import { useEffect, useId, useState } from "react";
import { DeferredColorInput } from "./DeferredColorInput.tsx";

interface BackgroundControlProps {
  readonly value: string | null | undefined;
  readonly fallback: string;
  readonly allowTransparent?: boolean;
  readonly onChange: (value: string | null | undefined) => void;
}

export const BackgroundControl = ({
  value,
  fallback,
  allowTransparent = true,
  onChange,
}: BackgroundControlProps) => {
  const id = useId();
  const [color, setColor] = useState(
    typeof value === "string" ? value : fallback,
  );
  const transparent = value === null;

  useEffect(() => {
    setColor(typeof value === "string" ? value : fallback);
  }, [fallback, value]);

  return (
    <div className="background-control">
      <div className="background-control-heading">
        <span>Background</span>
        {value !== undefined ? (
          <button
            type="button"
            className="text-style-reset"
            onClick={() => onChange(undefined)}
            title="Use the theme background"
          >
            Reset
          </button>
        ) : (
          <span className="panel-hint">theme</span>
        )}
      </div>
      <div className="background-control-row">
        <DeferredColorInput
          id={`${id}-background`}
          name={`${id}-background`}
          value={color}
          disabled={transparent}
          title="Background colour override"
          onCommit={(next) => {
            setColor(next);
            onChange(next);
          }}
        />
        {allowTransparent ? (
          <label className="background-transparent">
            <input
              id={`${id}-transparent`}
              name={`${id}-transparent`}
              type="checkbox"
              checked={transparent}
              onChange={(event) => {
                onChange(event.target.checked ? null : undefined);
              }}
            />
            Transparent
          </label>
        ) : null}
      </div>
    </div>
  );
};
