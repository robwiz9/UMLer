import { useEffect, useId, useState } from "react";
import {
  DEFAULT_DIAGRAM_FONT_SIZE,
  DEFAULT_THEME,
  type Theme,
} from "../model/styles.ts";
import { DeferredColorInput } from "./DeferredColorInput.tsx";

interface ThemePanelProps {
  readonly theme: Theme;
  readonly onChange: (theme: Theme) => void;
}

const withTint = (theme: Theme, color: string | null): Theme => ({
  ...theme,
  table: {
    ...theme.table,
    headerFill: { ...theme.table.headerFill, color },
  },
});

const withBackground = (theme: Theme, color: string | null): Theme => ({
  ...theme,
  table: { ...theme.table, fill: { ...theme.table.fill, color } },
  shape: { ...theme.shape, fill: { ...theme.shape.fill, color } },
});

const withFontColor = (theme: Theme, color: string): Theme => ({
  ...theme,
  table: {
    ...theme.table,
    text: { ...theme.table.text, color },
    headerText: { ...theme.table.headerText, color },
  },
  shape: { ...theme.shape, text: { ...theme.shape.text, color } },
  edge: { ...theme.edge, labelText: { ...theme.edge.labelText, color } },
});

const withFontSize = (theme: Theme, fontSize: number): Theme => ({
  ...theme,
  table: {
    ...theme.table,
    text: { ...theme.table.text, fontSize },
    headerText: { ...theme.table.headerText, fontSize: fontSize + 1 },
  },
  shape: { ...theme.shape, text: { ...theme.shape.text, fontSize } },
  edge: {
    ...theme.edge,
    labelText: { ...theme.edge.labelText, fontSize: Math.max(6, fontSize - 1) },
  },
});

const withLabelBackground = (theme: Theme, color: string | null): Theme => ({
  ...theme,
  edge: {
    ...theme.edge,
    labelFill: { ...theme.edge.labelFill, color },
  },
});

export const ThemePanel = ({ theme, onChange }: ThemePanelProps) => {
  const id = useId();
  const transparent =
    theme.table.fill.color === null || theme.shape.fill.color === null;
  const transparentTint = theme.table.headerFill.color === null;
  const transparentLabels = theme.edge.labelFill.color === null;
  const [background, setBackground] = useState(
    theme.table.fill.color ?? "#ffffff",
  );
  const [tint, setTint] = useState(theme.table.headerFill.color ?? "#f3f1eb");

  useEffect(() => {
    const next = theme.table.fill.color ?? theme.shape.fill.color;
    if (next !== null) setBackground(next);
  }, [theme.shape.fill.color, theme.table.fill.color]);

  useEffect(() => {
    const next = theme.table.headerFill.color;
    if (next !== null) setTint(next);
  }, [theme.table.headerFill.color]);

  const fontColor = theme.table.text.color;
  const fontSize = theme.table.text.fontSize;

  return (
    <section className="panel theme-panel">
      <div className="panel-heading">
        <span>Theme</span>
        {/* <span className="panel-hint">defaults</span> */}
      </div>

      <div className="theme-grid">
        <label className="theme-field">
          <span>Tint</span>
          <DeferredColorInput
            id={`${id}-tint`}
            name={`${id}-tint`}
            value={tint}
            disabled={transparentTint}
            title="Header and attribute-chip tint"
            onCommit={(color) => {
              setTint(color);
              onChange(withTint(theme, color));
            }}
          />
        </label>
        <label className="theme-field">
          <span>Background</span>
          <DeferredColorInput
            id={`${id}-background`}
            name={`${id}-background`}
            value={background}
            disabled={transparent}
            title="Object background Color"
            onCommit={(color) => {
              setBackground(color);
              onChange(withBackground(theme, color));
            }}
          />
        </label>
        <label className="theme-field">
          <span>Text</span>
          <DeferredColorInput
            id={`${id}-font-color`}
            name={`${id}-font-color`}
            value={fontColor}
            title="Default diagram font Color"
            onCommit={(color) => onChange(withFontColor(theme, color))}
          />
        </label>
        <label className="theme-field">
          <span>Size</span>
          <input
            id={`${id}-font-size`}
            name={`${id}-font-size`}
            type="number"
            min={6}
            max={32}
            step={0.5}
            value={fontSize}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 6 && next <= 32) {
                onChange(withFontSize(theme, next));
              }
            }}
            title="Default diagram font size"
          />
        </label>
      </div>

      <label className="theme-transparent">
        <input
          id={`${id}-transparent-tint`}
          name={`${id}-transparent-tint`}
          type="checkbox"
          checked={transparentTint}
          onChange={(event) => {
            onChange(withTint(theme, event.target.checked ? null : tint));
          }}
        />
        Transparent tint
      </label>

      <label className="theme-transparent">
        <input
          id={`${id}-transparent`}
          name={`${id}-transparent`}
          type="checkbox"
          checked={transparent}
          onChange={(event) => {
            onChange(withBackground(theme, event.target.checked ? null : background));
          }}
        />
        Transparent object background
      </label>

      <label className="theme-transparent">
        <input
          id={`${id}-transparent-labels`}
          name={`${id}-transparent-labels`}
          type="checkbox"
          checked={transparentLabels}
          onChange={(event) => {
            onChange(withLabelBackground(
              theme,
              event.target.checked ? null : theme.colors.canvas,
            ));
          }}
        />
        Transparent label background
      </label>

      <button
        type="button"
        className="theme-reset"
        onClick={() => onChange(DEFAULT_THEME)}
        title={`Restore the default ${DEFAULT_DIAGRAM_FONT_SIZE}pt theme`}
      >
        Reset theme
      </button>
    </section>
  );
};
