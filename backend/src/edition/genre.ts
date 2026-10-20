/**
 * Tells a news report apart from a column.
 *
 * Opinion is marked, not excluded: good analysis is worth reading, and the harm is only in it
 * passing for a new fact. So an opinion piece can still make the edition, it just ranks below
 * reporting and carries a visible label.
 *
 * Detection is deliberately conservative — prefix and path matching only, no guessing from
 * tone. A false positive demotes and mislabels real reporting, which is worse than missing a
 * label on a column.
 */

export const GENRES = ["news", "opinion"] as const;
export type Genre = (typeof GENRES)[number];

/**
 * Markers outlets put at the start of a headline. Matched at the beginning only: "análise"
 * in the middle of a sentence is ordinary vocabulary, not a section label.
 */
const TITLE_PREFIXES = [
  "opiniao",
  "opinion",
  "editorial",
  "artigo",
  "coluna",
  "column",
  "ponto de vista",
  "op-ed",
  "oped",
  "comment",
  "commentary",
  "analysis",
  "perspective",
  "viewpoint",
];

/** Path segments publishers use for their opinion sections. */
const PATH_SEGMENTS = [
  "opiniao",
  "opinion",
  "opinions",
  "editorial",
  "editoriais",
  "colunas",
  "coluna",
  "columnists",
  "commentary",
  "op-ed",
  "oped",
  "viewpoint",
];

/** Strips accents and case so "OPINIÃO" and "opiniao" match the same marker. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasOpinionPrefix(title: string): boolean {
  const folded = fold(title).trimStart();
  return TITLE_PREFIXES.some((prefix) => {
    if (!folded.startsWith(prefix)) return false;
    // Require a separator, so "Analysis:" matches but "Analytics platform" does not.
    const next = folded.slice(prefix.length, prefix.length + 2).trim();
    return next === "" || /^[:\-–—|/]/.test(next);
  });
}

function hasOpinionPath(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const segments = fold(pathname)
    .split("/")
    .filter((segment) => segment !== "");
  return segments.some((segment) => PATH_SEGMENTS.includes(segment));
}

export function detectGenre(title: string, url: string): Genre {
  return hasOpinionPrefix(title) || hasOpinionPath(url) ? "opinion" : "news";
}
