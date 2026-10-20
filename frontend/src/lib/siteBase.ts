/**
 * The one place that knows where the reader is deployed.
 *
 * Imported by vite.config.ts (as `base` and to serve edition artifacts in dev), by the router
 * basename, and by every URL the build writes. Keeping it a plain constant — instead of
 * `import.meta.env.BASE_URL` — means tests resolve the same paths production does.
 */
export const SITE_BASE = "/";

/** Canonical origin, used to build absolute URLs for canonical tags, OG and the sitemap. */
export const SITE_ORIGIN = "https://pulso.dorly.com.br";

/** Public name used in metadata and structured data. */
export const SITE_NAME = "Pulso";
export const SITE_TAGLINE = "O que mudou em IA. Por que importa para o negócio.";
export const PUBLISHER_NAME = "Professor Dorly";
export const PUBLISHER_URL = "https://dorly.com.br";
export const ARTICLES_URL = "https://dorly.com.br/artigos/";

/** Approved Papel & Brasa wordmarks for each color mode. */
export const BRAND_LOGO_LIGHT_PATH = "brand/logo-tinta.png";
export const BRAND_LOGO_DARK_PATH = "brand/logo-papel.png";

/**
 * Social card for the journal itself — home, arquivo, modelos, metodologia.
 * Edition URLs keep their own cover; sharing the cover must not look like today's issue.
 */
export const JOURNAL_OG_IMAGE_PATH = "og-pulso.png";
export const JOURNAL_OG_IMAGE_WIDTH = 1200;
export const JOURNAL_OG_IMAGE_HEIGHT = 675;

/**
 * Share raster for an edition cover. Distinct from the `.svg` the kitchen writes, which no
 * social platform renders. Keep in sync with scripts/og-raster.mjs.
 */
const COVER_OG_IMAGE_SUFFIX = ".og.png";

export function coverSocialImagePath(svgPath: string): string {
  return svgPath.replace(/\.svg$/i, COVER_OG_IMAGE_SUFFIX);
}

/** Same GA4 property as the rest of dorly.com.br; the bootstrap lives in `frontend/index.html`. */
export const GA_MEASUREMENT_ID = "G-60D496205Q";

/**
 * Where a reader reports an error.
 *
 * Curation runs without human review, so readers are the only correction channel there is.
 * Left empty deliberately: an unset address renders no link at all, which is better than
 * shipping a `mailto:` that goes nowhere. Set it to enable the correction affordance.
 */
export const CONTACT_EMAIL = "";
