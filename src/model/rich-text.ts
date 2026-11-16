/**
 * Small Typst-like rich-label notation for circuit labels.
 *
 *   R_1          → R with subscript 1
 *   R_"12"       → R with subscript 12
 *   R_"12"_"34"  → sequential subscript runs
 *   V^2          → superscript
 *
 * A backslash escapes the next character (`\_`, `\^`, `\"`). Only circuit
 * labels and wire labels use this parser; ordinary diagram text is untouched.
 */

import type {
  RichTextSegment,
  TextMeasurement,
  TextMeasurer,
  TextScript,
} from "./layout.ts";
import type { TextStyle } from "./styles.ts";

interface ParsedSegment {
  readonly text: string;
  readonly script: TextScript;
  readonly depth: number;
}

export const parseRichText = (input: string): readonly ParsedSegment[] => {
  const segments: ParsedSegment[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer.length > 0) {
      segments.push({ text: buffer, script: "normal", depth: 0 });
      buffer = "";
    }
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? "";
    if (character === "\\" && index + 1 < input.length) {
      buffer += input[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (character !== "_" && character !== "^") {
      buffer += character;
      continue;
    }

    flush();
    const script: TextScript = character === "_" ? "sub" : "super";
    const previous = segments[segments.length - 1];
    const depth = previous !== undefined && previous.script !== "normal"
      ? previous.depth + 1
      : 1;
    index += 1;
    if (index >= input.length) {
      buffer += character;
      continue;
    }
    if (input[index] === '"') {
      index += 1;
      let quoted = "";
      while (index < input.length) {
        const inner = input[index] ?? "";
        if (inner === "\\" && index + 1 < input.length) {
          quoted += input[index + 1] ?? "";
          index += 2;
          continue;
        }
        if (inner === '"') {
          index += 1;
          break;
        }
        quoted += inner;
        index += 1;
      }
      if (quoted.length > 0) segments.push({ text: quoted, script, depth });
      index -= 1;
      continue;
    }
    segments.push({ text: input[index] ?? "", script, depth });
  }
  flush();
  return segments.length > 0 ? segments : [{ text: input, script: "normal", depth: 0 }];
};

export const hasRichText = (input: string): boolean =>
  /(^|[^\\])[_^]/.test(input);

export const measureRichText = (
  input: string,
  style: TextStyle,
  measurer: TextMeasurer,
  maxWidth?: number,
): TextMeasurement => {
  if (!hasRichText(input)) return measurer.measure(input, style, maxWidth);
  const parsed = parseRichText(input);
  let width = 0;
  let height = style.fontSize * 1.25;
  const segments: RichTextSegment[] = parsed.map((segment) => {
    const fontSize = segment.script === "normal"
      ? style.fontSize
      : Math.max(4, style.fontSize * 0.68 ** segment.depth);
    const segmentStyle = fontSize === style.fontSize ? style : { ...style, fontSize };
    const measured = measurer.measure(segment.text, segmentStyle);
    width += measured.width;
    height = Math.max(height, measured.height);
    return {
      text: segment.text,
      script: segment.script,
      depth: segment.depth,
      fontSize,
      width: measured.width,
    };
  });
  return {
    text: input,
    width,
    height,
    lines: 1,
    truncated: maxWidth !== undefined && width > maxWidth,
    style,
    segments,
  };
};
