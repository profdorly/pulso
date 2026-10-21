import type { PulsoEdition, PulsoIndex } from "./edition.js";
import { editionPath } from "./editionPaths.js";
import { basePath, editionAssetUrl, pageRoute } from "./paths.js";
import {
  JOURNAL_OG_IMAGE_HEIGHT,
  JOURNAL_OG_IMAGE_PATH,
  JOURNAL_OG_IMAGE_WIDTH,
  PUBLISHER_NAME,
  PUBLISHER_URL,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_TAGLINE,
  coverSocialImagePath,
} from "./siteBase.js";
import { formatEditionDate } from "./formatPt.js";

/**
 * Per-route metadata for the prerendered HTML.
 *
 * Unique titles, descriptions and canonical URLs are what search engines use before (and
 * sometimes without) running JavaScript, and social crawlers never run it at all — so this
 * has to exist in the served HTML rather than being set at runtime.
 */

export interface PageMetadata {
  title: string;
  description: string;
  canonical: string;
  /** Absolute URL of the social image, when the route has one. */
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** `article` for editions, `website` for the rest. */
  ogType: "article" | "website";
  publishedTime?: string;
  modifiedTime?: string;
  /** JSON-LD document embedded as application/ld+json. */
  jsonLd: Record<string, unknown>;
  /**
   * True for routes that must stay out of the index: error pages and every dated edition.
   * Rendered as `noindex, follow`.
   */
  noindex?: boolean;
}

const DESCRIPTION_LIMIT = 155;

/** Absolute URL of a route or file, with the trailing slash a page directory is served at. */
export function absoluteUrl(routePath: string): string {
  const base = basePath().replace(/\/$/, "");
  return `${SITE_ORIGIN}${base}${pageRoute(routePath)}`;
}

/** Trims to a length search results will actually show, without cutting mid-word. */
export function clampDescription(text: string, limit = DESCRIPTION_LIMIT): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Social image for a page that has a cover.
 *
 * `og:image` is the PNG the site build rasterizes beside every cover SVG. Platforms
 * refuse to rasterize SVG, and a second `og:image` pointing at the SVG made some
 * crawlers pick the vector and show a blank card. The page itself still displays the SVG.
 */
function coverImage(edition: PulsoEdition): {
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
} {
  if (!edition.cover) return {};
  const relative = editionAssetUrl(edition.cover.path).replace(basePath(), "");
  return {
    image: absoluteUrl(coverSocialImagePath(relative)),
    imageAlt: edition.cover.alt,
    imageWidth: edition.cover.width,
    imageHeight: edition.cover.height,
  };
}

/** Card for sharing the journal, not today's edition. */
function journalImage(): {
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
} {
  return {
    image: absoluteUrl(JOURNAL_OG_IMAGE_PATH),
    imageAlt: SITE_TAGLINE,
    imageWidth: JOURNAL_OG_IMAGE_WIDTH,
    imageHeight: JOURNAL_OG_IMAGE_HEIGHT,
  };
}

function publisher() {
  return {
    "@type": "Person",
    name: PUBLISHER_NAME,
    url: PUBLISHER_URL,
  };
}

/**
 * NewsArticle for an edition.
 *
 * The cited sources go in `citation` so the structured data reflects what the edition
 * actually is: curation over other outlets, not original reporting. Each citation is the URL
 * alone: the headline and the outlet are already on the page, the edition is noindex (no rich
 * result to feed), and repeating fifty titles and outlets cost about 2 kB gzip on a full day.
 */
export function editionJsonLd(edition: PulsoEdition, canonical: string): Record<string, unknown> {
  const { image } = coverImage(edition);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: clampDescription(edition.digest.headline, 110),
    description: clampDescription(edition.digest.lede),
    datePublished: edition.capturedAt,
    dateModified: edition.capturedAt,
    inLanguage: "pt-BR",
    isAccessibleForFree: true,
    ...(image ? { image: [image] } : {}),
    author: publisher(),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: absoluteUrl(""),
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    citation: edition.items.map((item) => ({ "@type": "CreativeWork", url: item.url })),
  };
}

/**
 * The front door of the journal.
 *
 * Sharing the cover must present Pulso, not whichever edition happens to be on it. The dated
 * URL (`/YYYY-MM-DD/`) is what carries the issue's headline, lede and cover art.
 */
export function homeMetadata(): PageMetadata {
  const canonical = absoluteUrl("");
  // WhatsApp shows this whole blurb; the default 155-char clamp would cut the byline.
  const description = clampDescription(
    "Briefing de IA para founders e líderes de negócio. Todo dia às 07:30: o que mudou, por que importa e o caminho até a fonte. Publicado por Professor Dorly.",
    220
  );
  return {
    title: `Pulso — briefing de IA para o negócio | Professor Dorly`,
    description,
    canonical,
    ogType: "website",
    ...journalImage(),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      description,
      url: canonical,
      inLanguage: "pt-BR",
      isAccessibleForFree: true,
      publisher: publisher(),
    },
  };
}

/**
 * Edition pages stay out of the index.
 *
 * An archive that grows by one dated edition a day — most of it summaries of other outlets'
 * reporting — is not what the journal wants to be found by. What stays indexed is what does not
 * age: the cover, methodology, models and archive. `follow` is kept so the crawler still reaches
 * those through the dated pages' links.
 */
export function editionMetadata(edition: PulsoEdition): PageMetadata {
  const canonical = absoluteUrl(editionPath(edition.calendarDate, edition.slot));
  const dateLabel = formatEditionDate(edition.calendarDate);
  return {
    title: `${edition.digest.headline} — ${SITE_NAME}, ${dateLabel}`,
    description: clampDescription(edition.digest.lede),
    canonical,
    ogType: "article",
    publishedTime: edition.capturedAt,
    modifiedTime: edition.capturedAt,
    noindex: true,
    ...coverImage(edition),
    jsonLd: editionJsonLd(edition, canonical),
  };
}

export function archiveMetadata(index: PulsoIndex): PageMetadata {
  const canonical = absoluteUrl("arquivo");
  const count = index.editions.length;
  return {
    title: `Arquivo de edições — ${SITE_NAME}`,
    description: clampDescription(
      `Todas as ${count} edições do Pulso, com data e horário. Novidades de IA em português, com fonte citada em cada item.`
    ),
    canonical,
    ogType: "website",
    ...journalImage(),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `Arquivo de edições — ${SITE_NAME}`,
      inLanguage: "pt-BR",
      url: canonical,
      hasPart: index.editions.map((entry) => ({
        "@type": "NewsArticle",
        headline: clampDescription(entry.headline, 110),
        datePublished: entry.capturedAt,
        url: absoluteUrl(editionPath(entry.calendarDate, entry.slot)),
      })),
    },
  };
}

/**
 * Metadata for one page of the paginated archive.
 *
 * The canonical of page 1 carries NO page suffix, because `/arquivo/` and `/arquivo/1/` would be the
 * same list at two addresses — and a canonical pointing at a second URL for the same content is
 * how a site asks to be de-duplicated by a machine instead of deciding for itself.
 *
 * Only page 1 keeps the collection JSON-LD listing the editions. Repeating a `hasPart` array on
 * every page would restate the same claim once per page while describing a different slice.
 */
export function archivePageMetadata(
  index: PulsoIndex,
  page: number,
  totalPages: number
): PageMetadata {
  if (page <= 1) {
    return archiveMetadata(index);
  }
  const canonical = absoluteUrl(`arquivo/${page}`);
  return {
    title: `Arquivo de edições — página ${page} de ${totalPages} — ${SITE_NAME}`,
    description: clampDescription(
      `Página ${page} do arquivo do Pulso: edições anteriores, com data, horário e fonte citada em cada item.`
    ),
    canonical,
    ogType: "website",
    ...journalImage(),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `Arquivo de edições — página ${page} de ${totalPages}`,
      inLanguage: "pt-BR",
      url: canonical,
    },
  };
}

export function modelsMetadata(catalog: {
  capturedAt: string;
  sources: string[];
  sections: Array<{ models: unknown[] }>;
}): PageMetadata {
  const canonical = absoluteUrl("modelos");
  const sources = catalog.sources.length > 0 ? "Artificial Analysis" : "";
  const modelCount = catalog.sections.reduce((total, section) => total + section.models.length, 0);
  return {
    title: `Modelos de IA: capacidade, preço e preferência — ${SITE_NAME}`,
    description: clampDescription(
      sources
        ? `${modelCount} modelos com fonte, método e data em cada número. Dados de ${sources}.`
        : `${modelCount} modelos com fonte, método e data em cada número.`
    ),
    canonical,
    ogType: "website",
    modifiedTime: catalog.capturedAt,
    ...journalImage(),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `Modelos de IA — ${SITE_NAME}`,
      description:
        "Catálogo de modelos de IA com observações por métrica, cada uma com fonte, benchmark e data de captura.",
      inLanguage: "pt-BR",
      url: canonical,
      dateModified: catalog.capturedAt,
      creator: publisher(),
      isAccessibleForFree: true,
      ...(catalog.sources.length > 0
        ? {
            citation: [{ "@type": "Organization", name: "Artificial Analysis", url: "https://artificialanalysis.ai/" }],
          }
        : {}),
    },
  };
}

/**
 * The methodology page is indexable on purpose: it is the page that explains why the numbers
 * and the curation can be trusted, so it is the one worth citing. `TechArticle` is the
 * closest schema.org type for a how-it-works document.
 */
export function methodologyMetadata(): PageMetadata {
  const canonical = absoluteUrl("metodologia");
  return {
    title: `Metodologia: como o Pulso escolhe e verifica — ${SITE_NAME}`,
    description: clampDescription(
      "Como cada item é escolhido, o que é verificado antes de publicar, o que não é verificado, e o que os números de modelos significam."
    ),
    canonical,
    ogType: "article",
    ...journalImage(),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: "Metodologia do Pulso",
      description:
        "Regras de curadoria, verificação de link, checagem de evidência, auditoria de fidelidade e limites declarados do Pulso.",
      inLanguage: "pt-BR",
      url: canonical,
      author: publisher(),
      publisher: publisher(),
      isAccessibleForFree: true,
    },
  };
}

export function notFoundMetadata(): PageMetadata {
  const canonical = absoluteUrl("");
  return {
    title: `Página não encontrada — ${SITE_NAME}`,
    description: "Esse endereço não existe no Pulso.",
    canonical,
    ogType: "website",
    noindex: true,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Página não encontrada",
      inLanguage: "pt-BR",
    },
  };
}
