import { useEffect, useRef, useState } from "react";
import type { PreviewImage } from "../export/typst-preview.ts";

export type TypstPreviewStatus = "idle" | "rendering" | "ready" | "error";

export interface TypstPreviewState {
  readonly status: TypstPreviewStatus;
  readonly svg?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

/**
 * Debounced, stale-safe preview compilation. The compiler is a singleton and
 * compiles serially, so a newer source is simply queued behind the running one
 * and the older result is discarded by the version counter.
 */
export const useTypstPreview = (
  source: string,
  images: readonly PreviewImage[],
  enabled = true,
): TypstPreviewState => {
  const [state, setState] = useState<TypstPreviewState>({ status: "idle" });
  const version = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const current = version.current + 1;
    version.current = current;
    let cancelled = false;
    const started = performance.now();
    setState((previous) => ({
      status: "rendering",
      svg: previous.svg,
      error: undefined,
    }));
    const timer = window.setTimeout(() => {
      // Keep typst.ts and the WASM wrappers out of the editor/export-panel
      // bundle. The panel is usable immediately; this chunk is fetched only
      // once the preview actually needs to compile.
      void import("../export/typst-preview.ts")
        .then(({ renderTypstPreview }) => renderTypstPreview(source, images))
        .then((result) => {
          if (cancelled || version.current !== current) return;
          setState({
            status: "ready",
            svg: result.svg,
            durationMs: Math.round(performance.now() - started),
          });
        })
        .catch((error: unknown) => {
          if (cancelled || version.current !== current) return;
          setState({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, 550);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, source, images]);

  return state;
};
