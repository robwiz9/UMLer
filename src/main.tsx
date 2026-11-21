import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { loadUiPreferences } from "./app/ui-preferences.ts";
import "./styles.css";

const initialPreferences = loadUiPreferences();
document.documentElement.dataset.colorMode = initialPreferences.colorMode;

/**
 * A deploy can replace the entry bundle while an open tab still holds the old
 * one. If that tab then requests a lazy chunk from the previous deploy, Vite
 * raises `vite:preloadError`. Reload onto the current build once instead of
 * leaving the Typst preview (or another lazy feature) in a broken state.
 */
const PRELOAD_RELOAD_KEY = "umler.preload-reload-at";
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  try {
    const lastReload = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? "0");
    if (Number.isFinite(lastReload) && Date.now() - lastReload < 30_000) return;
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage a retry loop cannot be bounded; leave the error visible.
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("build", Date.now().toString(36));
  window.location.replace(url.toString());
});

// Double-clicking an inline code token copies/shows its full text; the
// browser's default word selection would only grab part of ids such as
// `ref-1` or `edge_123`.
document.addEventListener("dblclick", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const code = target.closest("code");
  if (code === null) return;
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
  event.preventDefault();
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
