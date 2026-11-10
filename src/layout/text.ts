import type { TextMeasurement, TextMeasurer } from "../model/layout.ts";
import type { TextStyle } from "../model/styles.ts";

const ELLIPSIS = "…";

export const cssFont = (style: TextStyle): string =>
  `${style.italic ? "italic " : ""}${style.weight} ${style.fontSize}px "${style.fontFamily}"`;

/**
 * Browser text measurement through a 2D canvas.
 *
 * This is deliberately synchronous: the skeleton pass must be able to measure
 * during a drag frame. The canvas is created once and reused. The measured
 * width is the browser's own advance width, which is why the app embeds the
 * same font that Typst uses rather than relying on a CSS fallback stack.
 */
export class CanvasTextMeasurer implements TextMeasurer {
  private readonly context: CanvasRenderingContext2D;
  private readonly cache = new Map<string, TextMeasurement>();

  constructor() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is required for text measurement");
    }
    this.context = context;
  }

  measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement {
    const font = cssFont(style);
    const key = [
      font,
      style.color,
      style.underline === true ? "underline" : "",
      style.align ?? "",
      style.lineHeight ?? "",
      maxWidth ?? "",
      text,
    ].join("\u0000");
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    this.context.font = font;
    const fullWidth = this.context.measureText(text).width;
    let displayed = text;
    let width = fullWidth;
    let truncated = false;

    if (maxWidth !== undefined && maxWidth > 0 && fullWidth > maxWidth) {
      displayed = this.truncate(text, maxWidth);
      width = this.context.measureText(displayed).width;
      truncated = true;
    }

    const measurement: TextMeasurement = {
      text: displayed,
      width,
      height: style.fontSize * (style.lineHeight ?? 1.2),
      lines: 1,
      truncated,
      style,
    };
    this.cache.set(key, measurement);
    return measurement;
  }

  private truncate(text: string, maxWidth: number): string {
    if (this.context.measureText(ELLIPSIS).width >= maxWidth) return "";
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = `${text.slice(0, mid)}${ELLIPSIS}`;
      if (this.context.measureText(candidate).width <= maxWidth) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return `${text.slice(0, low)}${ELLIPSIS}`;
  }
}

/** Deterministic measurer used by Node-based layout tests. */
export class FixedTextMeasurer implements TextMeasurer {
  private readonly characterWidth: number;

  constructor(characterWidth = 5.4) {
    this.characterWidth = characterWidth;
  }

  measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement {
    const available = maxWidth ?? Number.POSITIVE_INFINITY;
    let displayed = text;
    let truncated = false;
    let width = text.length * this.characterWidth * (style.fontSize / 9);

    if (width > available && available > 0) {
      const maxChars = Math.max(0, Math.floor(available / (this.characterWidth * (style.fontSize / 9))) - 1);
      displayed = `${text.slice(0, maxChars)}…`;
      truncated = true;
      width = displayed.length * this.characterWidth * (style.fontSize / 9);
    }

    return {
      text: displayed,
      width,
      height: style.fontSize * (style.lineHeight ?? 1.2),
      lines: 1,
      truncated,
      style,
    };
  }
}
