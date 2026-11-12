/**
 * Live Typst/CeTZ preview through typst.ts 0.7 (Typst 0.14.2).
 *
 * The compiler is a WASM module, so it runs entirely in the page. CeTZ and
 * oxifmt are pulled from packages.typst.org through typst.ts' package
 * registry; image bytes are supplied through the compiler's shadow VFS, which
 * is why they never need to be embedded in the generated source.
 */

import { $typst } from "@myriaddreamin/typst.ts";
import { TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";
import compilerWasmUrl from "@myriaddreamin/typst-ts-web-compiler/wasm?url";
import rendererWasmUrl from "@myriaddreamin/typst-ts-renderer/wasm?url";

import romanRegularUrl from "../res/LatinModern/lmroman10-regular.otf?url";
import romanBoldUrl from "../res/LatinModern/lmroman10-bold.otf?url";
import romanItalicUrl from "../res/LatinModern/lmroman10-italic.otf?url";
import romanBoldItalicUrl from "../res/LatinModern/lmroman10-bolditalic.otf?url";
import monoRegularUrl from "../res/LatinModern/lmmono10-regular.otf?url";
import monoItalicUrl from "../res/LatinModern/lmmono10-italic.otf?url";
import monoBoldUrl from "../res/LatinModern/lmmonolt10-bold.otf?url";
import monoBoldItalicUrl from "../res/LatinModern/lmmonolt10-boldoblique.otf?url";

/** Only the faces the editor can emit; avoids loading the full LM family. */
const FONT_URLS = [
  romanRegularUrl,
  romanBoldUrl,
  romanItalicUrl,
  romanBoldItalicUrl,
  monoRegularUrl,
  monoItalicUrl,
  monoBoldUrl,
  monoBoldItalicUrl,
];

export interface PreviewImage {
  /** Path used in the generated Typst source, relative to the main file. */
  readonly path: string;
  /** Bytes are decoded from the project asset's data URL. */
  readonly dataUrl?: string;
}

export interface TypstPreviewResult {
  readonly svg: string;
}

interface PreviewRuntime {
  initialization?: Promise<void>;
  queue: Promise<unknown>;
}

const RUNTIME_KEY = "__umlerTypstPreviewRuntime";
const runtimeHost = globalThis as typeof globalThis & {
  [RUNTIME_KEY]?: PreviewRuntime;
};
const runtime: PreviewRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  queue: Promise.resolve(),
});

const isAlreadyInitialized = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("has been initialized");

/** 1×1 transparent PNG used when a session has no bytes for an image node. */
const TRANSPARENT_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const PLACEHOLDER_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100">' +
    '<rect width="160" height="100" fill="#f0ede5"/>' +
    '<path d="M8 8L152 92M152 8L8 92" stroke="#d7d2c8" stroke-width="1.2"/>' +
    "</svg>",
);

const placeholderBytes = (path: string): Uint8Array =>
  path.toLowerCase().endsWith(".svg") ? PLACEHOLDER_SVG : TRANSPARENT_PNG;

const decodeDataUrl = (dataUrl: string): Uint8Array | null => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    if (meta.includes(";base64")) {
      const binary = atob(payload.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
};

const initialize = async (): Promise<void> => {
  try {
    $typst.setCompilerInitOptions({
      getModule: () => compilerWasmUrl,
    });
    $typst.setRendererInitOptions({
      getModule: () => rendererWasmUrl,
    });
    $typst.use(
      TypstSnippet.disableDefaultFontAssets(),
      TypstSnippet.preloadFonts(FONT_URLS),
      TypstSnippet.fetchPackageRegistry(),
    );
  } catch (error) {
    // Vite HMR can reload this module while the typst.ts singleton (a separate
    // module instance) is already initialized. The previous init options and
    // font/package providers are still in place, so reusing that compiler is
    // correct; only a genuinely different configuration would need a reload.
    if (!isAlreadyInitialized(error)) throw error;
  }
  // A tiny compile warms the 28 MB compiler and the package registry. It also
  // surfaces font/package failures before the first diagram is requested.
  await $typst.addSource(
    "/umler-warmup.typ",
    "#set text(font: (\"Latin Modern Roman\", \"LMRoman10\"))\nWarmup",
  );
  await $typst.svg({ mainFilePath: "/umler-warmup.typ", root: "/" });
};

const ensureInitialized = (): Promise<void> => {
  runtime.initialization ??= initialize().catch((error: unknown) => {
    runtime.initialization = undefined;
    throw error;
  });
  return runtime.initialization;
};

/** Compiles one preview at a time; the shared typst.ts instance is stateful. */
export const renderTypstPreview = async (
  source: string,
  images: readonly PreviewImage[],
): Promise<TypstPreviewResult> => {
  const run = runtime.queue.then(async () => {
    await ensureInitialized();
    await $typst.resetShadow();
    await $typst.addSource("/main.typ", source);
    for (const image of images) {
      const decoded = image.dataUrl === undefined ? null : decodeDataUrl(image.dataUrl);
      const path = image.path.startsWith("/") ? image.path : `/${image.path}`;
      await $typst.mapShadow(path, decoded ?? placeholderBytes(path));
    }
    const svg = await $typst.svg({ mainFilePath: "/main.typ", root: "/" });
    return { svg };
  });
  runtime.queue = run.catch(() => undefined);
  return run;
};
