import { useId } from "react";
import {
  hasTextStyleOverride,
  MONO_FONT,
  resolveTextStyle,
  type TextStyle,
  type TextStyleOverride,
} from "../model/styles.ts";
import { DeferredColorInput } from "./DeferredColorInput.tsx";

interface TextStyleControlsProps {
  readonly base: TextStyle;
  readonly value?: TextStyleOverride;
  readonly onChange: (next: TextStyleOverride | undefined) => void;
}

const clean = (value: TextStyleOverride): TextStyleOverride | undefined => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as TextStyleOverride);
};

export const TextStyleControls = ({
  base,
  value,
  onChange,
}: TextStyleControlsProps) => {
  const id = useId();
  const effective = resolveTextStyle(base, value);
  const bold = effective.weight >= 600;
  const italic = effective.italic === true;
  const monospace = effective.fontFamily === MONO_FONT;

  const patch = (next: Partial<TextStyleOverride>): void => {
    onChange(clean({ ...value, ...next }));
  };

  return (
    <div className="text-style-controls">
      <div className="text-style-heading">
        <span>Text style</span>
        {hasTextStyleOverride(value) ? (
          <button
            type="button"
            className="text-style-reset"
            onClick={() => onChange(undefined)}
            title="Reset text overrides"
          >
            Reset
          </button>
        ) : (
          <span className="panel-hint">theme</span>
        )}
      </div>
      <div className="text-style-row">
        <button
          type="button"
          className={`style-toggle ${bold ? "on" : ""}`}
          aria-pressed={bold}
          title="Bold"
          onClick={() => patch({ bold: !bold })}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`style-toggle ${italic ? "on" : ""}`}
          aria-pressed={italic}
          title="Italic"
          onClick={() => patch({ italic: !italic })}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={`style-toggle mono ${monospace ? "on" : ""}`}
          aria-pressed={monospace}
          title="Monospaced"
          onClick={() => patch({ monospace: !monospace })}
        >
          M
        </button>
        <label className="text-style-size" title="Font size">
          <span aria-hidden="true">Aa</span>
          <input
            id={`${id}-size`}
            name={`${id}-size`}
            type="number"
            min={5}
            max={48}
            step={0.5}
            value={value?.fontSize ?? base.fontSize}
            onChange={(event) => {
              const size = Number(event.target.value);
              if (!Number.isFinite(size) || size < 5 || size > 48) return;
              patch({
                fontSize: Math.abs(size - base.fontSize) < 0.01 ? undefined : size,
              });
            }}
          />
        </label>
        <label className="text-style-color" title="Font Color">
          <DeferredColorInput
            id={`${id}-color`}
            name={`${id}-color`}
            value={value?.color ?? base.color}
            onCommit={(color) => {
              patch({ color: color.toLowerCase() === base.color.toLowerCase() ? undefined : color });
            }}
          />
        </label>
      </div>
    </div>
  );
};
