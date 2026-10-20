/* eslint-disable react-refresh/only-export-components --
   Server-only entry: it is never hot-reloaded, and colocating the metadata re-exports lets
   the prerender script load `render` and the metadata helpers from a single built file. */
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import App from "./App.js";
import { EditionDataProvider, type PreloadedEditionData } from "./lib/editionData.js";
import { basePath } from "./lib/paths.js";

export {
  archivePageMetadata,
  editionMetadata,
  homeMetadata,
  methodologyMetadata,
  modelsMetadata,
  notFoundMetadata,
  absoluteUrl,
  clampDescription,
} from "./lib/seo.js";
export { ARCHIVE_PAGE_SIZE, archivePageRoute, pageCount } from "./lib/archivePaging.js";
export { SITE_BASE, SITE_ORIGIN, SITE_NAME, PUBLISHER_NAME } from "./lib/siteBase.js";
/** The edition URL rule, so `prerender.mjs` writes each page where the reader links to it. */
export { editionPath } from "./lib/editionPaths.js";
export { pageRoute } from "./lib/paths.js";

/**
 * Renders one route to HTML at build time.
 *
 * MemoryRouter is used instead of a server router because the prerender step already knows
 * the exact route; the data comes in preloaded so the pages render their real content rather
 * than a loading state.
 */
export function render(route: string, preloaded: PreloadedEditionData): string {
  const base = basePath().replace(/\/$/, "");
  const initialEntry = route.startsWith(base) ? route : `${base}${route.startsWith("/") ? route : `/${route}`}`;

  return renderToString(
    <StrictMode>
      <MemoryRouter basename={base || "/"} initialEntries={[initialEntry]}>
        <EditionDataProvider value={preloaded}>
          <App />
        </EditionDataProvider>
      </MemoryRouter>
    </StrictMode>
  );
}
