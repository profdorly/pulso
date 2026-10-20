/**
 * The site's Content Security Policy, delivered in a <meta> tag: GitHub Pages sends no custom
 * headers. A meta policy cannot carry `frame-ancestors`, `report-uri` or `sandbox`; everything
 * else applies, from the point in the document where the tag appears — so it goes first in <head>,
 * before any script.
 *
 * What it allows: the site's own files; the one inline script (the Google Analytics bootstrap),
 * by hash; and the Google Analytics endpoints for a property without Ads features, as Google
 * lists them (developers.google.com/tag-platform/security/guides/csp). Styles allow inline
 * attributes, which the weekly player sets. Nothing else runs, loads or connects.
 */
import { createHash } from "node:crypto";

const NOT_EXECUTED = new Set(["application/json", "application/ld+json"]);

/** sha256 of every inline script the browser would execute, as CSP source expressions. */
export function inlineScriptHashes(html) {
  const hashes = [];
  // Case-insensitive, and ending where a browser ends the block (`</script` up to ">"): a script
  // this misses would not be hashed and would fail closed (blocked), but the check must see all.
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    const attrs = match[1];
    if (/\bsrc=/.test(attrs)) continue;
    const type = /\btype="([^"]+)"/.exec(attrs)?.[1]?.toLowerCase();
    if (type && NOT_EXECUTED.has(type)) continue;
    hashes.push(`'sha256-${createHash("sha256").update(match[2], "utf8").digest("base64")}'`);
  }
  return [...new Set(hashes)];
}

export function contentSecurityPolicy(scriptHashes) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src 'self' ${scriptHashes.join(" ")} https://www.googletagmanager.com`.replace(/\s+/g, " "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com",
    "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com",
    "font-src 'self'",
    "media-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function cspMetaTag(policy) {
  return `<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll('"', "&quot;")}" />`;
}

/** The policy a document declares in a meta tag, or null. */
export function cspOf(html) {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]?.replaceAll("&quot;", '"') ?? null;
}
