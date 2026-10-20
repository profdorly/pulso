import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { EditionDataProvider, readPreloadedData } from "./lib/editionData.js";
import { basePath } from "./lib/paths.js";
import "./index.css";

/** Router basename must match the deploy base path, so both come from one place. */
const routerBasename = basePath().replace(/\/$/, "") || "/";

/**
 * The published site is static: each page is its own document, and only the weekly audio hydrates.
 * A router link on a hydrated page would render the next route in place, without the data that
 * page's own document carries, so links leave the router and load the next document instead.
 * The dev server (no prerendered markup, every route fetched) keeps client-side navigation.
 */
function navigateByDocument(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
  const next = new URL(anchor.href, window.location.href);
  if (next.origin !== window.location.origin) return;
  if (next.pathname === window.location.pathname) return;
  // Stopping here keeps the click from reaching React, so the browser follows the link itself.
  event.stopPropagation();
}

const container = document.getElementById("root")!;
const preloaded = readPreloadedData();

const tree = (
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <EditionDataProvider value={preloaded}>
        <App />
      </EditionDataProvider>
    </BrowserRouter>
  </StrictMode>
);

// A prerendered page arrives with markup already in #root: hydrate it instead of throwing
// it away, so there is no blank flash and no layout shift.
if (container.hasChildNodes()) {
  document.addEventListener("click", navigateByDocument, true);
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}
