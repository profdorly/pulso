import type { PulsoEdition, PulsoItem } from "./edition.js";

/**
 * The digest bullets are the edition's priorities. Everything else is radar:
 * still published, still linked, not given the same reading time.
 */
export function splitByPriority(edition: PulsoEdition): {
  featured: PulsoItem[];
  radar: PulsoItem[];
} {
  const featured: PulsoItem[] = [];
  const seen = new Set<string>();

  for (const bullet of edition.digest.bullets) {
    const match = edition.items.find((item) => item.url === bullet.url);
    if (match && !seen.has(match.id)) {
      featured.push(match);
      seen.add(match.id);
    }
  }

  return {
    featured,
    radar: edition.items.filter((item) => !seen.has(item.id)),
  };
}
