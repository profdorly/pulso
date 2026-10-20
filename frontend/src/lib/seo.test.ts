import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  archiveMetadata,
  archivePageMetadata,
  clampDescription,
  editionMetadata,
  homeMetadata,
  modelsMetadata,
  notFoundMetadata,
} from "./seo.js";
import type { PulsoEdition, PulsoIndex } from "./edition.js";
import type { ModelCatalog } from "./modelCatalog.js";

const ORIGIN = "https://pulso.dorly.com.br";

const edition: PulsoEdition = {
  id: "2026-10-09-manha",
  schemaVersion: 1,
  slot: "manha",
  calendarDate: "2026-10-09",
  timezone: "America/Sao_Paulo",
  capturedAt: "2026-10-09T10:32:00.000Z",
  status: "ok",
  predecessorId: null,
  digest: {
    headline: "Zhipu lança o GLM-5.3",
    lede: "A Pandaily descreve o lançamento horas depois do teaser. O Olhar Digital traz o recorte brasileiro.",
    bullets: [
      { text: "GLM-5.3 chega", url: "https://pandaily.com/glm-5-3", outlet: "Pandaily" },
    ],
  },
  items: [
    {
      id: "a",
      title: "GLM-5.3 Arrives",
      url: "https://pandaily.com/glm-5-3",
      outlet: "Pandaily",
      region: "asia",
      kind: "press",
      publishedAt: "2026-10-09T08:10:00.000Z",
      firstSeenAt: "2026-10-09T09:32:00.000Z",
    },
  ],
  sourceFailures: [],
  benchmarks: {
    capturedAt: "2026-10-05T12:00:00.000Z",
    previousCapturedAt: null,
    headline: [],
    attribution: ["Artificial Analysis"],
    rows: [],
  },
  models: { discovery: "gpt-5.6-terra", editorial: "gpt-6.1-sol", worker: "gpt-6-luna" },
  costUsdApprox: 0.08,
  cover: {
    path: "2026-10-09/manha.cover-r1.svg",
    alt: "PULSO · 9 OUT 2026",
    width: 1200,
    height: 675,
  },
};

const index: PulsoIndex = {
  schemaVersion: 1,
  latestId: edition.id,
  editions: [
    {
      id: edition.id,
      slot: "manha",
      calendarDate: "2026-10-09",
      capturedAt: edition.capturedAt,
      headline: edition.digest.headline,
      path: "/2026-10-09/",
    },
  ],
};

const catalog: ModelCatalog = {
  schemaVersion: 1,
  capturedAt: "2026-10-05T02:00:00.000Z",
  sources: ["artificial-analysis"],
  sections: [
    {
      modality: "language",
      group: "texto",
      availableMetrics: ["intelligence-index"],
      models: [
        {
          id: "gpt-5-6-terra",
          name: "GPT-5.6 Terra",
          creator: "OpenAI",
          modality: "language",
          observations: [
            {
              metric: "intelligence-index",
              value: 57.4,
              source: "artificial-analysis",
              benchmark: "Artificial Analysis Intelligence Index",
              capturedAt: "2026-10-05T02:00:00.000Z",
              methodologyUrl: "https://artificialanalysis.ai/methodology",
            },
          ],
        },
      ],
      totalAvailable: 198,
      notes: [],
    },
  ],
  coverage: [
    { modality: "language", metric: "intelligence-index", withData: 1, total: 1 },
  ],
};

describe("absoluteUrl", () => {
  it("builds page URLs with the trailing slash their directory is served at", () => {
    expect(absoluteUrl("")).toBe(`${ORIGIN}/`);
    expect(absoluteUrl("modelos")).toBe(`${ORIGIN}/modelos/`);
    expect(absoluteUrl("/arquivo")).toBe(`${ORIGIN}/arquivo/`);
    expect(absoluteUrl("/2026-10-09")).toBe(`${ORIGIN}/2026-10-09/`);
  });

  it("leaves file URLs without a trailing slash", () => {
    expect(absoluteUrl("feed.xml")).toBe(`${ORIGIN}/feed.xml`);
    expect(absoluteUrl("og-pulso.png")).toBe(`${ORIGIN}/og-pulso.png`);
  });
});

describe("clampDescription", () => {
  it("leaves a short description untouched", () => {
    expect(clampDescription("Curto e direto.")).toBe("Curto e direto.");
  });

  it("cuts on a word boundary and marks the truncation", () => {
    const long = `${"palavra ".repeat(40)}fim`;
    const result = clampDescription(long);
    expect(result.length).toBeLessThanOrEqual(155);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toMatch(/palav…$/);
  });

  it("collapses whitespace so metadata stays on one line", () => {
    expect(clampDescription("linha um\n\n  linha dois")).toBe("linha um linha dois");
  });
});

describe("page metadata", () => {
  it("gives every route a distinct title and canonical", () => {
    const metas = [homeMetadata(), editionMetadata(edition), archiveMetadata(index), modelsMetadata(catalog)];
    const titles = new Set(metas.map((meta) => meta.title));
    const canonicals = new Set(metas.map((meta) => meta.canonical));
    expect(titles.size).toBe(metas.length);
    expect(canonicals.size).toBe(metas.length);
  });

  it("points a daily edition at its date alone, everywhere a URL is emitted", () => {
    const meta = editionMetadata(edition);
    expect(meta.canonical).toBe(`${ORIGIN}/2026-10-09/`);
    expect(meta.jsonLd).toMatchObject({ mainEntityOfPage: { "@id": `${ORIGIN}/2026-10-09/` } });
    // The data and the cover keep their slot in the file name: only the page is date-only.
    expect(meta.image).toBe(`${ORIGIN}/editions/2026-10-09/manha.cover-r1.og.png`);

    const archive = archiveMetadata(index);
    expect((archive.jsonLd.hasPart as Array<{ url: string }>).map((part) => part.url)).toEqual([
      `${ORIGIN}/2026-10-09/`,
    ]);
  });

  it("names the day, not a slot, in an edition title", () => {
    const meta = editionMetadata(edition);
    expect(meta.title).toContain(edition.digest.headline);
    expect(meta.title).toContain("9 de outubro de 2026");
    expect(meta.title).not.toContain("Manhã");
  });

  it("marks an edition as an article and the rest as website", () => {
    expect(editionMetadata(edition).ogType).toBe("article");
    expect(archiveMetadata(index).ogType).toBe("website");
    expect(modelsMetadata(catalog).ogType).toBe("website");
  });

  it("gives the journal home a brand card instead of the current cover", () => {
    const home = homeMetadata();
    expect(home.canonical).toBe(`${ORIGIN}/`);
    expect(home.title).toBe("Pulso — briefing de IA para o negócio | Professor Dorly");
    expect(home.title).not.toContain(edition.digest.headline);
    expect(home.description).toContain("founders");
    expect(home.ogType).toBe("website");
    expect(home.image).toBe(`${ORIGIN}/og-pulso.png`);
    expect((home.jsonLd as { "@type": string })["@type"]).toBe("WebSite");
  });

  it("points the social image at the raster, never the cover SVG", () => {
    const meta = editionMetadata(edition);
    expect(meta.image).not.toMatch(/\.svg$/);
    expect(meta.imageAlt).toContain("PULSO");
  });

  it("credits the benchmark source in the models description", () => {
    expect(modelsMetadata(catalog).description).toContain("Artificial Analysis");
  });

  it("emits NewsArticle structured data citing the sources", () => {
    const jsonLd = editionMetadata(edition).jsonLd as Record<string, unknown>;
    expect(jsonLd["@type"]).toBe("NewsArticle");
    expect(jsonLd.datePublished).toBe(edition.capturedAt);
    expect(jsonLd.inLanguage).toBe("pt-BR");
    const citations = jsonLd.citation as Array<{ url: string }>;
    expect(citations.map((row) => row.url)).toEqual(["https://pandaily.com/glm-5-3"]);
  });

  it("keeps the error page and every edition page out of the index", () => {
    expect(notFoundMetadata().noindex).toBe(true);
    expect(editionMetadata(edition).noindex).toBe(true);
    expect(editionMetadata({ ...edition, kind: "quiet" }).noindex).toBe(true);
  });

  it("indexes the pages that do not age", () => {
    for (const meta of [homeMetadata(), archiveMetadata(index), modelsMetadata(catalog)]) {
      expect(meta.noindex).toBeUndefined();
    }
  });
});

describe("archivePageMetadata", () => {
  it("page 1 has no page suffix in its canonical", () => {
    const meta = archivePageMetadata(index, 1, 4);
    expect(meta.canonical).toBe(`${ORIGIN}/arquivo/`);
  });

  it("page 1 is exactly the unpaginated archive metadata", () => {
    expect(archivePageMetadata(index, 1, 4)).toEqual(archiveMetadata(index));
  });

  it("a later page carries its own canonical and says which page it is", () => {
    const meta = archivePageMetadata(index, 3, 4);
    expect(meta.canonical).toBe(`${ORIGIN}/arquivo/3/`);
    expect(meta.title).toContain("página 3 de 4");
  });

  it("stays indexable — the archive is the point of the site", () => {
    expect(archivePageMetadata(index, 2, 4).noindex).toBeUndefined();
  });

  it("does not repeat the edition list on every page", () => {
    expect(archivePageMetadata(index, 2, 4).jsonLd).not.toHaveProperty("hasPart");
    expect(archiveMetadata(index).jsonLd).toHaveProperty("hasPart");
  });
});
