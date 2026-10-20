/**
 * Single source of truth for how the reader resolves URLs.
 *
 * The app is served under a base path (`SITE_BASE`). Edition assets live under
 * `<base>/editions/`, so every fetch and every asset `src` is resolved against the base — never
 * hardcoded site-absolute — and the reader keeps working wherever it is mounted.
 */

import { SITE_BASE } from "./siteBase.js";

/** Base path the app is served from, always with a trailing slash (e.g. `/`). */
export function basePath(): string {
  return SITE_BASE.endsWith("/") ? SITE_BASE : `${SITE_BASE}/`;
}

/** A file from `frontend/public`, resolved under the deploy base. */
export function publicAssetUrl(relativePath: string): string {
  return `${basePath()}${relativePath.replace(/^\/+/, "")}`;
}

/**
 * A reader route as the address a static host serves without a redirect.
 *
 * Every page is written as `<route>/index.html`, and a static host answers `/arquivo` with a
 * redirect to `/arquivo/`. Links and canonicals therefore carry the trailing slash themselves;
 * a path whose last segment has an extension (`feed.xml`) is a file and is left as it is.
 */
export function pageRoute(routePath: string): string {
  const clean = `/${routePath.replace(/^\/+/, "")}`;
  if (clean === "/" || clean.endsWith("/")) return clean;
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  return last.includes(".") ? clean : `${clean}/`;
}

/** Absolute URL for an edition artifact, given its path relative to the editions root. */
export function editionsUrl(relativePath: string): string {
  return `${basePath()}editions/${relativePath.replace(/^\/+/, "")}`;
}

/**
 * Resolves an asset path recorded inside an edition artifact (currently the cover).
 *
 * Tolerates both shapes so old and new artifacts render from the same reader:
 * - site-absolute legacy paths: `/editions/2026-08-14/tarde.cover.svg`
 * - editions-relative paths: `2026-08-14/tarde.cover.svg`
 *
 * Fully-qualified URLs are returned untouched.
 */
export function editionAssetUrl(recordedPath: string): string {
  if (/^https?:\/\//i.test(recordedPath)) {
    return recordedPath;
  }
  const relative = recordedPath.replace(/^\/+/, "").replace(/^editions\//, "");
  return editionsUrl(relative);
}
