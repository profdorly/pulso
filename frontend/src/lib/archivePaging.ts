/**
 * One definition of how the archive is cut into pages.
 *
 * The reader and the prerender step must agree exactly: the build emits `/arquivo/2` as a real
 * document, and the page that renders at that URL has to show the same slice the build assumed.
 * A page size duplicated in two files is a page that silently drops or repeats editions the day
 * one of the two is edited.
 */

/** Editions per archive page. */
export const ARCHIVE_PAGE_SIZE = 30;

/** Total pages for `total` entries. Always at least 1, so an empty archive still has a page. */
export function pageCount(total: number, pageSize = ARCHIVE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps an arbitrary (possibly user-typed) page number into range. */
export function normalizePage(raw: unknown, total: number, pageSize = ARCHIVE_PAGE_SIZE): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "1"), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.trunc(parsed), pageCount(total, pageSize));
}

export function sliceForPage<T>(
  entries: readonly T[],
  page: number,
  pageSize = ARCHIVE_PAGE_SIZE
): T[] {
  const start = (page - 1) * pageSize;
  return entries.slice(start, start + pageSize);
}

/**
 * Route for an archive page, with the trailing slash its document is served at. Page 1 is
 * `/arquivo/`, never `/arquivo/1/` — two URLs serving the same list is a duplicate the canonical
 * would then have to disown.
 */
export function archivePageRoute(page: number): string {
  return page <= 1 ? "/arquivo/" : `/arquivo/${page}/`;
}
