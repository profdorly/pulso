/**
 * A link to another site, only if it is a web address. The kitchen already refuses anything but
 * http(s) before an item is published; this is the second lock, at the point where a URL from a
 * feed becomes an `href`. Returned unchanged, so the address the reader sees is the one recorded.
 */
export function externalHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}
