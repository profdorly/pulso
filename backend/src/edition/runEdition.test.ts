import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../db/test-helper.js";
import type { NewsItem } from "../types.js";
import { hashUrl } from "../services/normalize.js";
import { MAX_ATTEMPTS, NEW_ITEM_CAP, runEdition, type EditionFetchers } from "./runEdition.js";
import type { PulsoDigest, PulsoItem } from "./schema.js";
import { createEditionStore } from "./store.js";

function item(overrides: Partial<NewsItem> & Pick<NewsItem, "title" | "url" | "sourceId" | "block">): NewsItem {
  return {
    id: hashUrl(overrides.url),
    region: "us",
    tags: [],
    publishedAt: "2026-08-14T10:30:00.000Z",
    fetchedAt: "2026-08-14T10:35:00.000Z",
    ...overrides,
  };
}

function acceptAudit(input: { items: PulsoItem[]; pageText: Map<string, string> }) {
  return Promise.resolve({
    items: input.items,
    audited: input.items.filter((entry) => entry.summaryPt && input.pageText.has(entry.url)).length,
    removed: 0,
    unusable: 0,
    samples: [],
    model: "auditor-test",
  });
}

function passHumanizer(digest: PulsoDigest, items: PulsoItem[]) {
  return Promise.resolve({ digest, items, model: "humanizer-test" });
}

function passWorker(items: PulsoItem[]) {
  return Promise.resolve({
    items,
    dropped: [],
    unclassified: [],
    model: "worker-test",
  });
}

describe("runEdition", () => {
  let testDb: ReturnType<typeof createTestDb>;
  let editionsDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDb = createTestDb();
    editionsDir = mkdtempSync(path.join(tmpdir(), "pulso-editions-"));
    lockPath = path.join(editionsDir, "edition.lock");
  });

  afterEach(() => {
    testDb.close();
    rmSync(editionsDir, { recursive: true, force: true });
  });

  const now = new Date("2026-08-14T10:40:00.000-03:00");

  it("publishes an honest quiet edition on a first run with nothing to report", async () => {
    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [], results: [] }),
      },
    });

    // With no previous cover at all, an empty page is worse than an empty edition.
    expect(result.status).toBe("published");
    expect(result.newItemCount).toBe(0);
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.kind).toBe("quiet");
    expect(edition?.items).toEqual([]);
    // A quiet edition is still an edition and takes its place in the numbered run: skipping
    // it would leave a hole in the sequence readers can see in the archive.
    expect(edition?.number).toBe(1);
    expect(edition?.digest.headline).toBe("Sem novidade verificada nesta edição");
    expect(edition?.digest.bullets).toEqual([]);
  });

  it("stays quiet without writing anything when the previous cover is still recent", async () => {
    const fresh = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/recent",
      sourceId: "openai-news",
      block: "official",
    });
    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
      },
    });
    const first = createEditionStore(editionsDir).readLatest();

    const second = await runEdition({
      slot: "meio-dia",
      now: new Date("2026-08-14T15:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [], results: [] }),
      },
    });

    expect(second.status).toBe("unchanged");
    expect(second.skippedReason).toBe("no-delta");
    // The recent cover still reads as current, so no quiet edition is written.
    expect(createEditionStore(editionsDir).readLatest()?.id).toBe(first?.id);
    expect(existsSync(path.join(editionsDir, "2026-08-14", "meio-dia.json"))).toBe(false);
  });

  it("keeps yesterday's cover on one empty morning: the daily cadence is not a coin flip", async () => {
    const yesterday = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/yesterday",
      sourceId: "openai-news",
      block: "official",
      publishedAt: "2026-08-13T10:00:00.000Z",
    });
    await runEdition({
      slot: "manha",
      now: new Date("2026-08-13T07:30:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [yesterday],
            results: [{ sourceId: "openai-news", items: [yesterday] }],
          }),
      },
    });
    const first = createEditionStore(editionsDir).readLatest();

    // The next daily run starts a few seconds more than 24h later. Under a 24h boundary that
    // jitter alone decided whether a quiet edition replaced a cover that is still the day's news.
    const result = await runEdition({
      slot: "manha",
      now: new Date("2026-08-14T07:30:09.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [], results: [] }),
      },
    });

    expect(result.status).toBe("unchanged");
    expect(result.skippedReason).toBe("no-delta");
    expect(createEditionStore(editionsDir).readLatest()?.id).toBe(first?.id);
    expect(existsSync(path.join(editionsDir, "2026-08-14", "manha.json"))).toBe(false);
  });

  it("publishes a quiet edition once the previous cover has gone stale", async () => {
    const stale = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/stale",
      sourceId: "openai-news",
      block: "official",
      publishedAt: "2026-08-12T10:00:00.000Z",
    });
    await runEdition({
      slot: "manha",
      now: new Date("2026-08-12T10:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [stale],
            results: [{ sourceId: "openai-news", items: [stale] }],
          }),
      },
    });

    // Two days later with nothing new: the old cover would read as today's news.
    const result = await runEdition({
      slot: "manha",
      now: new Date("2026-08-14T10:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [], results: [] }),
      },
    });

    expect(result.status).toBe("published");
    expect(createEditionStore(editionsDir).readLatest()?.kind).toBe("quiet");
  });

  it("does not let a quiet edition close the window on pending items", async () => {
    const pending = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/pending",
      sourceId: "openai-news",
      block: "official",
      publishedAt: "2026-08-14T10:30:00.000Z",
    });
    const feed = {
      fetchRssSources: () =>
        Promise.resolve({
          items: [pending],
          results: [{ sourceId: "openai-news", items: [pending] }],
        }),
    };

    // First run: link check fails transiently, so a quiet edition is published.
    const first = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        ...feed,
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items: [],
            dropped: items.map((row) => ({
              item: row,
              ok: false as const,
              reason: "network" as const,
            })),
          }),
      },
    });
    expect(createEditionStore(editionsDir).readLatest()?.kind).toBe("quiet");
    // The run recorded a link failure, so it is partial rather than clean.
    expect(first.status).toBe("partial");

    // Second run hours later: the item must still be in window despite the quiet cover.
    const second = await runEdition({
      slot: "meio-dia",
      now: new Date("2026-08-14T15:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        ...feed,
        verifyEditionLinks: (items) => Promise.resolve({ items, dropped: [] }),
      },
    });

    expect(second.status).toBe("published");
    expect(second.newItemCount).toBe(1);
    expect(createEditionStore(editionsDir).readLatest()?.items[0]?.url).toBe(pending.url);
  });

  it("publishes a JSON snapshot for new URLs and names the outlet", async () => {
    const fresh = item({
      title: "OpenAI launches something",
      url: "https://openai.com/news/fresh",
      sourceId: "openai-news",
      block: "official",
      company: undefined,
    });

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
      },
    });

    expect(result.status).toBe("published");
    expect(result.newItemCount).toBe(1);
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.id).toBe("2026-08-14-manha");
    expect(edition?.items[0]?.outlet).toBe("OpenAI News");
    expect(edition?.digest.headline.length).toBeGreaterThan(0);
    expect(edition?.timezone).toBe("America/Sao_Paulo");
    expect(edition?.models).toEqual({
      discovery: "gpt-5.6-terra",
      editorial: "gpt-6.1-sol",
      worker: "gpt-6-luna",
    });
  });

  it("keeps the benchmark strip but leaves the full rows out of the artifact", async () => {
    // 600 rows is the real free-tier size; it used to serialise into every published page.
    testDb.repositories.benchmarkSnapshots.insert({
      id: "snapshot-big",
      provider: "artificial-analysis",
      capturedAt: "2026-08-14T10:00:00.000Z",
      payload: {
        rows: Array.from({ length: 600 }, (_, index) => ({
          modelId: `model-${index}`,
          name: `Model ${index}`,
          creator: "Lab",
          region: "us" as const,
          intelligenceIndex: index / 10,
        })),
      },
    });

    const fresh = item({
      title: "OpenAI launches something",
      url: "https://openai.com/news/slim",
      sourceId: "openai-news",
      block: "official",
      company: undefined,
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
      },
    });

    const edition = createEditionStore(editionsDir).readLatest();
    // The cover strip still has its numbers and its attribution.
    expect(edition?.benchmarks.headline.length).toBe(5);
    expect(edition?.benchmarks.attribution).toEqual(["Artificial Analysis"]);
    expect(edition?.benchmarks.capturedAt).toBe("2026-08-14T10:00:00.000Z");
    // No page reads the rows, and the catalogue lives in models.json, so they stay out.
    expect(edition?.benchmarks.rows).toEqual([]);
    expect(JSON.stringify(edition).length).toBeLessThan(20_000);
  });

  it("shows each model once on the cover card, at its best configuration", async () => {
    const variants = (name: string, scores: number[]) =>
      scores.map((score, index) => ({
        modelId: `${name}-${index}`,
        name: `${name} (Setting ${index})`,
        intelligenceIndex: score,
      }));
    testDb.repositories.benchmarkSnapshots.insert({
      id: "snapshot-variants",
      provider: "artificial-analysis",
      capturedAt: "2026-08-14T10:00:00.000Z",
      payload: {
        rows: [...variants("Opus", [60, 59, 58]), ...variants("Gemini", [57, 50]), { modelId: "solo", name: "Solo", intelligenceIndex: 40 }],
      },
    });
    const fresh = item({ title: "OpenAI launches", url: "https://openai.com/news/variants", sourceId: "openai-news", block: "official" });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [fresh], results: [{ sourceId: "openai-news", items: [fresh] }] }),
      },
    });

    const card = createEditionStore(editionsDir).readLatest()?.benchmarks.headline;
    expect(card?.map((row) => [row.label, row.value])).toEqual([
      ["Opus (Setting 0)", "60.0"],
      ["Gemini (Setting 0)", "57.0"],
      ["Solo", "40.0"],
    ]);
  });

  it("records what moved since the previous catalogue on the Monday capture", async () => {
    const capture = (capturedAt: string, index: number) => ({
      catalog: {
        schemaVersion: 1 as const,
        capturedAt,
        sources: ["artificial-analysis" as const],
        sections: [
          {
            modality: "language" as const,
            group: "texto" as const,
            availableMetrics: ["intelligence-index" as const],
            totalAvailable: 1,
            notes: [],
            models: [
              {
                id: "m",
                name: "M",
                creator: "Lab",
                modality: "language" as const,
                observations: [
                  {
                    metric: "intelligence-index" as const,
                    value: index,
                    source: "artificial-analysis" as const,
                    benchmark: "b",
                    capturedAt,
                    methodologyUrl: "u",
                  },
                ],
              },
            ],
          },
        ],
        coverage: [],
      },
      errors: [],
    });
    const run = (capturedAt: string, index: number, empty = false) => {
      const result = capture(capturedAt, index);
      if (empty) result.catalog.sections[0].models = [];
      return runEdition({
        slot: "manha",
        now: new Date(capturedAt),
        benchmarksOnly: true,
        editionsDir,
        lockPath,
        repositories: testDb.repositories,
        fetchers: { fetchModelCatalog: () => Promise.resolve(result) },
      });
    };
    const store = createEditionStore(editionsDir);
    const weekMove = {
      since: "2026-08-10T11:00:00.000Z",
      moved: [{ id: "m", metric: "intelligence-index", before: 50, after: 53 }],
    };

    await run("2026-08-10T11:00:00.000Z", 50);
    expect(store.readCatalog()?.changes).toBeUndefined();

    await run("2026-08-17T11:00:00.000Z", 53);
    expect(store.readCatalog()?.changes).toMatchObject(weekMove);

    // A second capture the same week still compares with last week, not with this morning.
    await run("2026-08-17T15:00:00.000Z", 53);
    expect(store.readCatalog()).toMatchObject({ capturedAt: "2026-08-17T15:00:00.000Z", changes: weekMove });

    // A capture whose text list came back empty does not replace the catalogue.
    const result = await run("2026-08-24T11:00:00.000Z", 0, true);
    expect(result.status).toBe("unchanged");
    expect(store.readCatalog()?.capturedAt).toBe("2026-08-17T15:00:00.000Z");
  });

  it("keeps a published item alive while its feed still lists it", async () => {
    const old = item({
      title: "OpenAI launches something",
      url: "https://openai.com/news/old",
      sourceId: "openai-news",
      block: "official",
      fetchedAt: "2026-05-01T00:00:00.000Z",
    });
    testDb.repositories.newsItems.upsert(old);
    testDb.repositories.newsItems.markState(old.url, "published", undefined, "2026-05-01T00:00:00.000Z", false);

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [old], results: [{ sourceId: "openai-news", items: [old] }] }),
      },
    });

    // Seen in this run's fetch, so the 90-day retention starts over; still published.
    expect(testDb.repositories.newsItems.findByUrl(old.url)).toMatchObject({ state: "published", fetchedAt: now.toISOString() });
  });

  it("balances the published cover across regions instead of taking the newest", async () => {
    // The exact failure the reader reported: five Brazilian items and nothing else. Brazilian
    // outlets are both more numerous and newer, so recency alone published only them.
    // Deliberately more Brazilian items than the whole edition holds: with pure recency the
    // cover filled up before reaching anything foreign, which is exactly what happened in
    // production.
    const brazilian = Array.from({ length: NEW_ITEM_CAP + 5 }, (_, index) =>
      item({
        title: `Notícia brasileira ${index}`,
        url: `https://tecnoblog.net/noticias/br-${index}`,
        sourceId: "tecnoblog",
        block: "impartial",
        region: "brazil",
        publishedAt: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
      })
    );
    const foreign = [
      item({
        title: "SCMP on Chinese labs",
        url: "https://www.scmp.com/tech/china-labs",
        sourceId: "scmp-tech",
        block: "impartial",
        region: "asia",
        publishedAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
      }),
      item({
        title: "Guardian on EU rules",
        url: "https://www.theguardian.com/technology/eu-rules",
        sourceId: "guardian-tech",
        block: "impartial",
        region: "europe",
        publishedAt: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
      }),
      item({
        title: "Wired on the launch",
        url: "https://www.wired.com/story/launch",
        sourceId: "wired-ai",
        block: "impartial",
        region: "us",
        publishedAt: new Date(now.getTime() - 7 * 3_600_000).toISOString(),
      }),
    ];
    const all = [...brazilian, ...foreign];

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: all,
            results: [{ sourceId: "tecnoblog", items: all }],
          }),
        enrichEditionItems: passWorker,
      },
    });

    expect(result.status).toBe("published");
    const edition = createEditionStore(editionsDir).readLatest();
    const regions = new Set((edition?.items ?? []).map((entry) => entry.region));
    // Every region that had something to say is on the cover, despite being hours older and
    // vastly outnumbered.
    expect([...regions].sort()).toEqual(["asia", "brazil", "europe", "us"]);
    // And Brazil no longer owns the whole edition.
    const brazilCount = (edition?.items ?? []).filter((entry) => entry.region === "brazil").length;
    expect(brazilCount).toBeLessThan(edition?.items.length ?? 0);
  });

  it("publishes the original and drops the outlet that only repeated it", async () => {
    const original = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
      publishedAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(),
    });
    const replication = item({
      title: "Tecnoblog traduz o lançamento",
      url: "https://tecnoblog.net/noticias/launch",
      sourceId: "tecnoblog",
      block: "impartial",
      region: "brazil",
      publishedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    });

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [replication, original],
            results: [{ sourceId: "tecnoblog", items: [replication, original] }],
          }),
        enrichEditionItems: passWorker,
        // The fetched replication declares the fetched Wired item as canonical.
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, entry.title])),
            links: new Map([
              [
                "https://tecnoblog.net/noticias/launch",
                {
                  canonical: "https://www.wired.com/story/launch",
                  outbound: [],
                },
              ],
              ["https://www.wired.com/story/launch", { outbound: [] }],
            ]),
          }),
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    // The reader gets the source, even though the Brazilian rewrite was far newer.
    expect(edition?.items.map((entry) => entry.url)).toEqual([
      "https://www.wired.com/story/launch",
    ]);
    expect(edition?.items[0]?.corroboration).toBe(2);
    expect(edition?.sourceFailures.some((row) => row.sourceId === "pulso-origin")).toBe(true);

    // The copy is terminal: retrying it would reintroduce the duplicate.
    const copyState = testDb.repositories.newsItems.findByUrl(
      "https://tecnoblog.net/noticias/launch"
    );
    expect(copyState?.state).toBe("rejected");
    expect(copyState?.stateReason).toBe("replication");
  });

  it("writes the item paragraphs from the fetched body, not from the headline", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });
    const body =
      "A empresa apresentou o modelo nesta quinta-feira, com foco em uso corporativo. " +
      "O anúncio detalha limites de contexto e disponibilidade por região.";

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-5.6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, body])),
            links: new Map(),
          }),
        summarizeEditionItems: (items, options) => {
          // The step only ever sees text that was actually downloaded.
          expect(options.pageText.get(items[0].url)).toBe(body);
          return Promise.resolve({
            summaries: new Map([
              [
                items[0].url,
                "A empresa apresentou o modelo nesta quinta-feira, com foco em uso corporativo. O anúncio detalha limites de contexto e disponibilidade por região.",
              ],
            ]),
            model: "gpt-5.6-luna",
            usage: { inputTokens: 2000, outputTokens: 300 },
          });
        },
        auditEditionSummaries: acceptAudit,
        humanizeDigest: passHumanizer,
      },
    });

    expect(result.status).toBe("published");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.items[0]?.summaryPt).toContain("uso corporativo");
    // Title stays in the original language; the summary is the bridge into Portuguese.
    expect(edition?.items[0]?.title).toBe("Wired on the launch");
    // The paragraphs are billed like any other model step.
    expect(edition?.costBreakdown.some((row) => row.step === "summarize")).toBe(true);
  });

  it("reports what was already spent when a later step throws", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL_WORKER: "gpt-6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        enrichEditionItems: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            unclassified: [],
            model: "gpt-6-luna",
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
          }),
        verifyEditionLinks: () => Promise.reject(new Error("rede caiu")),
      },
    });

    expect(result.status).toBe("error");
    // 1M input tokens of gpt-6-luna at US$ 0.10 per million: spent before the failure.
    expect(result.costUsdApprox).toBeCloseTo(0.1, 6);
    expect(result.costBreakdown).toEqual([
      { step: "worker", model: "gpt-6-luna", inputTokens: 1_000_000, outputTokens: 0, webSearchCalls: 0, usd: 0.1 },
    ]);
  });

  it("carries the cost breakdown on a run that publishes nothing", async () => {
    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k" },
      fetchers: {
        fetchRssSources: () => Promise.resolve({ items: [], results: [] }),
      },
    });

    expect(result.status).not.toBe("error");
    expect(result.costUsdApprox).toBe(0);
    expect(result.costBreakdown).toEqual([]);
  });

  it("removes a paragraph the auditor rejects and keeps the item", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });
    const body = "A empresa abriu lista de espera e pretende liberar o modelo neste trimestre.";

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-5.6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, body])),
            links: new Map(),
          }),
        summarizeEditionItems: (items) =>
          Promise.resolve({
            summaries: new Map([
              [items[0].url, "A empresa lançou o modelo nesta terça-feira, já disponível para todos."],
            ]),
            model: "gpt-5.6-luna",
          }),
        auditEditionSummaries: ({ items, pageText }) => {
          // The audit is handed the same body the paragraph was written from.
          expect(pageText.get(items[0].url)).toBe(body);
          const stripped = items.map((entry) => {
            const next = { ...entry };
            delete next.summaryPt;
            return next;
          });
          return Promise.resolve({
            items: stripped,
            audited: 1,
            removed: 1,
            unusable: 0,
            samples: ["lançou o modelo"],
            usage: { inputTokens: 500, outputTokens: 40 },
            model: "gpt-5.6-luna",
          });
        },
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    // Paragraph gone, item intact with its title and link.
    expect(edition?.items[0]?.summaryPt).toBeUndefined();
    expect(edition?.items[0]?.url).toBe("https://www.wired.com/story/launch");
    expect(edition?.items[0]?.title).toBe("Wired on the launch");
    expect(edition?.sourceFailures.some((row) => row.sourceId === "pulso-audit")).toBe(true);
    expect(edition?.costBreakdown.some((row) => row.step === "audit")).toBe(true);
  });

  it("warns visibly when the auditor is the same model that wrote the copy", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });
    const body = "A empresa abriu lista de espera para o modelo.";

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-5.6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, body])),
            links: new Map(),
          }),
        summarizeEditionItems: (items) =>
          Promise.resolve({
            summaries: new Map([[items[0].url, "A empresa abriu lista de espera para o modelo."]]),
            model: "gpt-5.6-luna",
          }),
        auditEditionSummaries: ({ items }) =>
          Promise.resolve({
            items,
            audited: 1,
            removed: 0,
            unusable: 0,
            samples: [],
            // Same id the writer step reported: self-review, which must not pass silently.
            model: "gpt-5.6-luna",
          }),
        humanizeDigest: passHumanizer,
      },
    });

    // The warning is not cosmetic: a run audited by its own writer model is not a healthy
    // run, so it reports partial like any other source failure — visible on /status.
    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    const warning = edition?.sourceFailures.find(
      (row) => row.error.includes("mesmo modelo que escreve") && row.error.includes("gpt-5.6-luna")
    );
    expect(warning).toBeDefined();
  });

  it.each([
    { flaggedItems: 0, warns: false },
    { flaggedItems: 2, warns: true },
  ])(
    "flags the editorial model as self-review only when the humanizer revised items ($flaggedItems)",
    async ({ flaggedItems, warns }) => {
      const fresh = item({
        title: "Wired on the launch",
        url: "https://www.wired.com/story/launch",
        sourceId: "wired-ai",
        block: "impartial",
        region: "us",
      });
      const body = "A empresa abriu lista de espera para o modelo.";

      await runEdition({
        slot: "tarde",
        now,
        editionsDir,
        lockPath,
        repositories: testDb.repositories,
        env: { OPENAI_API_KEY: "k" },
        fetchers: {
          fetchRssSources: () =>
            Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
          verifyEditionLinks: (items) =>
            Promise.resolve({
              items,
              dropped: [],
              evidence: new Map(items.map((entry) => [entry.url, body])),
              links: new Map(),
            }),
          summarizeEditionItems: (items) =>
            Promise.resolve({
              summaries: new Map([[items[0].url, "A empresa abriu lista de espera para o modelo."]]),
              model: "gpt-6-luna",
            }),
          humanizeDigest: (digest, items) =>
            Promise.resolve({ digest, items, model: "gpt-6.1-sol", flaggedItems }),
          auditEditionSummaries: ({ items }) =>
            Promise.resolve({ items, audited: 1, removed: 0, unusable: 0, samples: [], model: "gpt-6.1-sol" }),
        },
      });

      const edition = createEditionStore(editionsDir).readLatest();
      const warning = edition?.sourceFailures.find((row) => row.error.includes("sem independência"));
      expect(Boolean(warning)).toBe(warns);
    }
  );

  it("hands the auditor the feed teaser each title and blurb was written from", async () => {
    const teaser = "The company opened a waiting list and plans to release the model this quarter.";
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
      summary: teaser,
    });
    let received: Map<string, string> | undefined;

    await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        // The page did not open: no body, so the teaser is all the evidence there is.
        verifyEditionLinks: (items) =>
          Promise.resolve({ items, dropped: [], evidence: new Map(), links: new Map() }),
        enrichEditionItems: (items) =>
          Promise.resolve({
            items: items.map((entry) => ({ ...entry, titlePt: "Empresa abre lista de espera" })),
            dropped: [],
            model: "gpt-6-luna",
          }),
        humanizeDigest: passHumanizer,
        auditEditionSummaries: ({ items, feedText }) => {
          received = feedText;
          return Promise.resolve({ items, audited: 1, removed: 0, unusable: 0, samples: [], model: "gpt-6.1-sol" });
        },
      },
    });

    expect(received?.get("https://www.wired.com/story/launch")).toBe(teaser);
  });

  describe("web search beyond the feeds", () => {
    const fresh = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/feed-item",
      sourceId: "openai-news",
      block: "official",
    });
    const found = "https://www.livemint.com/ai/india-plans-ai-regulation";

    function fetchersWithSearch(search: ReturnType<typeof vi.fn>): EditionFetchers {
      return {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "openai-news", items: [fresh] }] }),
        enrichEditionItems: passWorker,
        verifyEditionLinks: (items: PulsoItem[]) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map<string, string>(),
            links: new Map(),
            dates: new Map(items.map((entry) => [entry.url, "2026-08-14T09:00:00.000Z"])),
          }),
        humanizeDigest: passHumanizer,
        searchBeyondFeeds: search as unknown as EditionFetchers["searchBeyondFeeds"],
      };
    }

    it("runs in shadow mode: checks and logs what it found, publishes none of it, charges the edition", async () => {
      const search = vi.fn().mockResolvedValue({
        candidates: [
          {
            title: "India plans AI regulation",
            url: found,
            outlet: "Mint",
            publishedAt: "2026-08-14T09:00:00.000Z",
            region: "asia",
            language: "en",
            why: "regulação",
            searchRegion: "asia",
          },
        ],
        usage: { inputTokens: 30_000, outputTokens: 1_000, webSearchCalls: 6 },
        queries: ["India AI regulation"],
        errors: [],
      });
      const writes: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });

      try {
        await runEdition({
          slot: "manha",
          now,
          editionsDir,
          lockPath,
          repositories: testDb.repositories,
          env: { OPENAI_API_KEY: "k", PULSO_WEB_SEARCH: "shadow" },
          fetchers: fetchersWithSearch(search),
        });
      } finally {
        spy.mockRestore();
      }

      expect(search).toHaveBeenCalledTimes(1);
      const [searchInput] = search.mock.calls[0] as [{ knownTitles: string[]; blockedDomains: string[] }];
      expect(searchInput.knownTitles).toEqual(["OpenAI publica algo"]);
      expect(searchInput.blockedDomains).toContain("openai.com");

      const edition = createEditionStore(editionsDir).readLatest();
      expect(edition?.items.map((row) => row.url)).toEqual([fresh.url]);
      const searchCost = edition?.costBreakdown.find((row) => row.step === "search");
      expect(searchCost?.webSearchCalls).toBe(6);
      // 6 searches at US$ 0.01, plus Luna tokens.
      expect(searchCost?.usd).toBeCloseTo(0.06 + 0.003 + 0.0005, 6);

      const line = writes.find((text) => text.includes("pulso-web-search-shadow"));
      expect(line).toBeDefined();
      const report = JSON.parse(line ?? "{}") as { wouldAdd: Array<{ url: string }>; editionId: string };
      expect(report.wouldAdd.map((row) => row.url)).toEqual([found]);
      expect(report.editionId).toBe(edition?.id);
    });

    it("does not search unless shadow mode is on", async () => {
      const search = vi.fn();
      await runEdition({
        slot: "manha",
        now,
        editionsDir,
        lockPath,
        repositories: testDb.repositories,
        env: { OPENAI_API_KEY: "k" },
        fetchers: fetchersWithSearch(search),
      });

      expect(search).not.toHaveBeenCalled();
    });

    it("never costs the edition more than money when the search fails", async () => {
      const search = vi.fn().mockRejectedValue(new Error("busca fora do ar"));
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const result = await runEdition({
          slot: "manha",
          now,
          editionsDir,
          lockPath,
          repositories: testDb.repositories,
          env: { OPENAI_API_KEY: "k", PULSO_WEB_SEARCH: "shadow" },
          fetchers: fetchersWithSearch(search),
        });
        expect(result.status).toBe("published");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("does not publish unaudited paragraphs when the run hits its cost ceiling", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });
    const body = "A empresa abriu lista de espera e pretende liberar o modelo neste trimestre.";
    const audit = vi.fn();

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      // Ceiling crossed by the summary step itself, so paragraphs exist and the audit does not.
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-5.6-luna", PULSO_MAX_EDITION_USD: "0.01" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, body])),
            links: new Map(),
          }),
        summarizeEditionItems: (items) =>
          Promise.resolve({
            summaries: new Map([[items[0].url, "Um resumo qualquer com tamanho suficiente para passar."]]),
            model: "gpt-5.6-luna",
            // Enough tokens to exhaust the ceiling right after the paragraphs are written.
            usage: { inputTokens: 100_000, outputTokens: 1_000 },
          }),
        auditEditionSummaries: audit as never,
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    // The audit never ran...
    expect(audit).not.toHaveBeenCalled();
    // ...so the ceiling must not become a way to ship prose without the control that contains it.
    expect(edition?.items[0]?.summaryPt).toBeUndefined();
    expect(edition?.items[0]?.url).toBe("https://www.wired.com/story/launch");
    expect(
      edition?.sourceFailures.some(
        (row) => row.sourceId === "pulso-cost" && row.error.includes("auditoria")
      )
    ).toBe(true);
  });

  it("returns unchanged on the second run with the same URLs and does not rewrite", async () => {
    const fresh = item({
      title: "Once",
      url: "https://openai.com/news/once",
      sourceId: "openai-news",
      block: "official",
    });
    const fetchers = {
      fetchRssSources: () =>
        Promise.resolve({
          items: [fresh],
          results: [{ sourceId: "openai-news", items: [fresh] }],
        }),
    };

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers,
    });
    const first = createEditionStore(editionsDir).readLatest();
    const second = await runEdition({
      slot: "meio-dia",
      now: new Date("2026-08-14T15:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers,
    });

    expect(second.status).toBe("unchanged");
    expect(second.skippedReason).toBe("no-delta");
    expect(createEditionStore(editionsDir).readLatest()?.id).toBe(first?.id);
  });

  it("refuses to rewrite a slot already published when new items arrive", async () => {
    const firstItem = item({
      title: "First",
      url: "https://openai.com/news/first",
      sourceId: "openai-news",
      block: "official",
    });
    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [firstItem],
            results: [{ sourceId: "openai-news", items: [firstItem] }],
          }),
      },
    });

    const secondItem = item({
      title: "Second",
      url: "https://openai.com/news/second",
      sourceId: "openai-news",
      block: "official",
    });
    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [firstItem, secondItem],
            results: [{ sourceId: "openai-news", items: [firstItem, secondItem] }],
          }),
      },
    });

    expect(result.status).toBe("error");
    expect(result.skippedReason).toBe("slot-already-published");
    expect(testDb.repositories.newsItems.findByUrl(secondItem.url)).toBeUndefined();
  });

  it("drops items older than the 18h first-edition window", async () => {
    const old = item({
      title: "Old",
      url: "https://openai.com/news/old",
      sourceId: "openai-news",
      block: "official",
      publishedAt: "2026-08-10T10:00:00.000Z",
    });
    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [old],
            results: [{ sourceId: "openai-news", items: [old] }],
          }),
      },
    });
    // Nothing publishable and no previous cover, so the run reports a quiet edition.
    expect(result.newItemCount).toBe(0);
    expect(createEditionStore(editionsDir).readLatest()?.kind).toBe("quiet");
    const stored = testDb.repositories.newsItems.findByUrl(old.url);
    expect(stored).toBeDefined();
    expect(stored?.state).toBe("rejected");
    expect(stored?.stateReason).toBe("out-of-window");
  });

  it("keeps the editorial model even if OPENAI_MODEL is Luna", async () => {
    const fresh = item({
      title: "OpenAI launches something",
      url: "https://openai.com/news/fresh-luna",
      sourceId: "openai-news",
      block: "official",
    });
    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_MODEL: "gpt-5.6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
      },
    });
    expect(result.status).toBe("published");
    expect(createEditionStore(editionsDir).readLatest()?.models).toEqual({
      discovery: "gpt-5.6-terra",
      editorial: "gpt-6.1-sol",
      worker: "gpt-5.6-luna",
    });
  });

  it("drops Brazilian non-AI items via the worker and uses the Terra digest", async () => {
    const lab = item({
      title: "OpenAI launches something",
      url: "https://openai.com/news/keep",
      sourceId: "openai-news",
      block: "official",
    });
    const games = item({
      title: "PS5 em promoção",
      url: "https://tecnoblog.net/ps5",
      sourceId: "tecnoblog",
      block: "impartial",
      region: "brazil",
    });

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [lab, games],
            results: [
              { sourceId: "openai-news", items: [lab] },
              { sourceId: "tecnoblog", items: [games] },
            ],
          }),
        enrichEditionItems: (items) =>
          Promise.resolve({
            items: items.filter((row) => row.url === lab.url),
            dropped: items.filter((row) => row.url === games.url),
            model: "gpt-5.6-luna",
          }),
        fetchPulsoEditorial: () =>
          Promise.resolve({
            digest: {
              headline: "OpenAI entra na capa",
              lede: "O lab anunciou. O console ficou de fora.",
              bullets: [
                {
                  text: "O anúncio oficial entra agora",
                  url: lab.url,
                  outlet: "OpenAI News",
                },
              ],
            },
            model: "gpt-5.6-terra",
          }),
        humanizeDigest: (digest, items) =>
          Promise.resolve({
            digest: { ...digest, headline: "OpenAI na capa, sem jargão" },
            items: items.map((row) => ({ ...row, blurbPt: "O lab publicou o guia." })),
            model: "gpt-5.6-terra",
          }),
        auditEditionSummaries: acceptAudit,
      },
    });

    expect(result.status).toBe("published");
    expect(result.newItemCount).toBe(1);
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.digest.headline).toBe("OpenAI na capa, sem jargão");
    expect(edition?.items[0]?.blurbPt).toBe("O lab publicou o guia.");
    expect(edition?.cover?.path).toBe("/editions/2026-08-14/manha.cover-r1.svg");
    expect(existsSync(path.join(editionsDir, "2026-08-14", "manha.cover-r1.svg"))).toBe(true);
    expect(readFileSync(path.join(editionsDir, "2026-08-14", "manha.cover-r1.svg"), "utf8")).toContain(
      "OpenAI na capa, sem jargão"
    );
    expect(edition?.items).toHaveLength(1);
    expect(edition?.items[0]?.url).toBe(lab.url);
    expect(testDb.repositories.newsItems.findByUrl(games.url)).toBeDefined();
  });

  it("fails closed when generated copy needs the humanizer but the API key is missing", async () => {
    const fresh = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/needs-humanizer",
      sourceId: "openai-news",
      block: "official",
    });
    const editorial = vi.fn();
    const humanize = vi.fn();

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: {},
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        fetchPulsoEditorial: editorial as never,
        humanizeDigest: humanize as never,
      },
    });

    expect(editorial).not.toHaveBeenCalled();
    expect(humanize).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.digest).toEqual({
      headline: fresh.title,
      lede: `Nesta edição, uma novidade desde a última capa. Destaque: ${fresh.title} (OpenAI News).`,
      bullets: [{ text: fresh.title, url: fresh.url, outlet: "OpenAI News" }],
    });
    expect(
      edition?.sourceFailures.some(
        (row) => row.sourceId === "pulso-humanize" && row.error.includes("OPENAI_API_KEY")
      )
    ).toBe(true);
  });

  it("does not publish an item whose link is dead", async () => {
    const live = item({
      title: "OpenAI launches something",
      url: "https://openai.com/index/builders-guide-to-gpt-5-6",
      sourceId: "openai-news",
      block: "official",
    });
    const dead = item({
      title: "O que muda para quem usa GPT-5.6 no trabalho",
      url: "https://tecnoblog.net/gpt-5-6-trabalho",
      sourceId: "tecnoblog",
      block: "impartial",
      region: "brazil",
    });

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [live, dead],
            results: [
              { sourceId: "openai-news", items: [live] },
              { sourceId: "tecnoblog", items: [dead] },
            ],
          }),
        enrichEditionItems: passWorker,
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items: items.filter((row) => row.url === live.url),
            dropped: items
              .filter((row) => row.url === dead.url)
              .map((row) => ({ item: row, ok: false as const, reason: "not-found" as const })),
          }),
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.items).toHaveLength(1);
    expect(edition?.items[0]?.url).toBe(live.url);
    expect(edition?.sourceFailures.some((row) => row.sourceId === "pulso-links")).toBe(true);
  });

  it("keeps a transiently failed item retryable and publishes it on a later run", async () => {
    const flaky = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/flaky",
      sourceId: "openai-news",
      block: "official",
    });
    const feed = {
      fetchRssSources: () =>
        Promise.resolve({
          items: [flaky],
          results: [{ sourceId: "openai-news", items: [flaky] }],
        }),
    };

    const first = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        ...feed,
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items: [],
            dropped: items.map((row) => ({
              item: row,
              ok: false as const,
              reason: "network" as const,
            })),
          }),
      },
    });

    expect(first.status).toBe("partial");
    const afterFirst = testDb.repositories.newsItems.findByUrl(flaky.url);
    expect(afterFirst?.state).toBe("retryable");
    expect(afterFirst?.attempts).toBe(1);

    const second = await runEdition({
      slot: "meio-dia",
      now: new Date("2026-08-14T15:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        ...feed,
        verifyEditionLinks: (items) => Promise.resolve({ items, dropped: [] }),
      },
    });

    expect(second.status).toBe("published");
    expect(createEditionStore(editionsDir).readLatest()?.items[0]?.url).toBe(flaky.url);
    expect(testDb.repositories.newsItems.findByUrl(flaky.url)?.state).toBe("published");
  });

  it("never retries a permanently dead link", async () => {
    const dead = item({
      title: "Matéria removida",
      url: "https://tecnoblog.net/removida",
      sourceId: "tecnoblog",
      block: "impartial",
      region: "brazil",
    });
    const feed = {
      fetchRssSources: () =>
        Promise.resolve({
          items: [dead],
          results: [{ sourceId: "tecnoblog", items: [dead] }],
        }),
      verifyEditionLinks: (items: PulsoItem[]) =>
        Promise.resolve({
          items: [],
          dropped: items.map((row) => ({
            item: row,
            ok: false as const,
            status: 404,
            reason: "not-found" as const,
          })),
        }),
    };

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: { ...feed, enrichEditionItems: passWorker },
    });

    const stored = testDb.repositories.newsItems.findByUrl(dead.url);
    expect(stored?.state).toBe("rejected");
    expect(stored?.stateReason).toBe("not-found");
    expect(stored?.attempts).toBe(0);
    expect(testDb.repositories.newsItems.findRetryable(MAX_ATTEMPTS, 10)).toEqual([]);
  });

  it("defers items beyond the per-edition cap instead of losing them", async () => {
    const many = Array.from({ length: NEW_ITEM_CAP + 3 }, (_, index) =>
      item({
        title: `Notícia ${index}`,
        url: `https://openai.com/news/item-${index}`,
        sourceId: "openai-news",
        block: "official",
        publishedAt: new Date(Date.parse("2026-08-14T10:00:00.000Z") + index * 60_000).toISOString(),
      })
    );

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: many,
            results: [{ sourceId: "openai-news", items: many }],
          }),
      },
    });

    expect(result.status).toBe("published");
    expect(result.newItemCount).toBe(NEW_ITEM_CAP);

    const deferred = testDb.repositories.newsItems.findRetryable(MAX_ATTEMPTS, 50);
    expect(deferred).toHaveLength(3);
    expect(deferred.every((row) => row.stateReason === "cap")).toBe(true);
    // Deferral is scheduling, not failure: it must not burn a retry attempt.
    expect(deferred.every((row) => row.attempts === 0)).toBe(true);
  });

  it("republishes a slot with force, versioning the artifact it replaces", async () => {
    const first = item({
      title: "Primeira",
      url: "https://openai.com/news/primeira",
      sourceId: "openai-news",
      block: "official",
    });
    const second = item({
      title: "Segunda",
      url: "https://openai.com/news/segunda",
      sourceId: "openai-news",
      block: "official",
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [first],
            results: [{ sourceId: "openai-news", items: [first] }],
          }),
      },
    });

    const original = createEditionStore(editionsDir).readEdition("2026-08-14", "manha");
    expect(original?.revision).toBe(1);
    expect(original?.number).toBe(1);

    const forced = await runEdition({
      slot: "manha",
      now,
      force: true,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [first, second],
            results: [{ sourceId: "openai-news", items: [first, second] }],
          }),
      },
    });

    expect(forced.status).toBe("published");
    expect(forced.revision).toBe(2);

    const republished = createEditionStore(editionsDir).readEdition("2026-08-14", "manha");
    expect(republished?.revision).toBe(2);
    expect(original?.cover?.path).toBe("/editions/2026-08-14/manha.cover-r1.svg");
    expect(republished?.cover?.path).toBe("/editions/2026-08-14/manha.cover-r2.svg");
    expect(existsSync(path.join(editionsDir, "2026-08-14", "manha.cover-r1.svg"))).toBe(true);
    expect(existsSync(path.join(editionsDir, "2026-08-14", "manha.cover-r2.svg"))).toBe(true);
    // The number is the reader's handle on the edition, so a republish keeps it: a fresh
    // number would make the archive grow on every fix and break a saved link to "#1".
    expect(republished?.number).toBe(1);
    expect(republished?.supersedesCapturedAt).toBe(original?.capturedAt);
    // A republish is a superset: the item already on the cover is still there.
    expect(republished?.items.map((row) => row.url).sort()).toEqual(
      [first.url, second.url].sort()
    );

    const supersededName = `manha.superseded-${original?.capturedAt.replace(/[:.]/g, "-")}.json`;
    expect(existsSync(path.join(editionsDir, "2026-08-14", supersededName))).toBe(true);
  });

  it("keeps a slot's early items through a late same-day forced republish", async () => {
    // Captured at 23:00 BRT of the previous evening — hours older than any window a late
    // republish could use, yet already on the cover.
    const first = item({
      title: "Primeira",
      url: "https://openai.com/news/primeira",
      sourceId: "openai-news",
      block: "official",
      publishedAt: "2026-08-14T02:00:00.000Z",
    });
    const second = item({
      title: "Segunda",
      url: "https://openai.com/news/segunda",
      sourceId: "openai-news",
      block: "official",
    });
    const feed = (items: NewsItem[]) => ({
      fetchRssSources: () =>
        Promise.resolve({ items, results: [{ sourceId: "openai-news", items }] }),
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: feed([first]),
    });

    // 22:30 BRT of the same calendar date: the slot still resolves to this morning's
    // edition, but 18h back from now is past `first`'s publication time.
    const lateEvening = new Date("2026-08-15T01:30:00.000Z");
    const forced = await runEdition({
      slot: "manha",
      now: lateEvening,
      force: true,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: feed([first, second]),
    });

    expect(forced.status).toBe("published");
    const republished = createEditionStore(editionsDir).readEdition("2026-08-14", "manha");
    // The superset promise holds even when the carried item predates the whole window.
    expect(republished?.items.map((row) => row.url).sort()).toEqual(
      [first.url, second.url].sort()
    );

    // And the lifecycle record was never corrupted into a rejection: the item is still
    // live journalism, not an out-of-window castaway.
    const carried = testDb.repositories.newsItems.findByUrl(first.url);
    expect(carried?.state).not.toBe("rejected");
    expect(carried?.stateReason).not.toBe("out-of-window");
  });

  it("refuses to republish without force and says how to proceed", async () => {
    const first = item({
      title: "Primeira",
      url: "https://openai.com/news/only",
      sourceId: "openai-news",
      block: "official",
    });
    const feed = (items: NewsItem[]) => ({
      fetchRssSources: () =>
        Promise.resolve({ items, results: [{ sourceId: "openai-news", items }] }),
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: feed([first]),
    });

    const second = item({
      title: "Segunda",
      url: "https://openai.com/news/second-attempt",
      sourceId: "openai-news",
      block: "official",
    });
    const blocked = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: feed([first, second]),
    });

    expect(blocked.status).toBe("error");
    expect(blocked.skippedReason).toBe("slot-already-published");
    expect(blocked.error).toMatch(/force/);
    expect(testDb.repositories.newsItems.findByUrl(second.url)).toBeUndefined();
  });

  it("does not republish an item the previous day's edition already carried", async () => {
    const first = item({
      title: "Primeira",
      url: "https://openai.com/news/primeira",
      sourceId: "openai-news",
      block: "official",
    });
    const second = item({
      title: "Segunda",
      url: "https://openai.com/news/segunda",
      sourceId: "openai-news",
      block: "official",
      // Published on day 2, inside the window that opens at the previous cover's capture.
      publishedAt: "2026-08-15T12:00:00.000Z",
    });
    const feed = (items: NewsItem[]) => ({
      fetchRssSources: () =>
        Promise.resolve({ items, results: [{ sourceId: "openai-news", items }] }),
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: feed([first]),
    });

    // The next day the feed still returns yesterday's story alongside a new one. The reader
    // must get the new story only: a journal that repeats itself is not a journal.
    const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const result = await runEdition({
      slot: "manha",
      now: nextDay,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      fetchers: feed([first, second]),
    });

    expect(result.status).toBe("published");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.calendarDate).toBe("2026-08-15");
    const urls = edition?.items.map((row) => row.url) ?? [];
    expect(urls).toContain(second.url);
    expect(urls).not.toContain(first.url);

    // And the lifecycle record stays coherent: yesterday's item remains published, was not
    // re-marked as out-of-window, and never re-entered the retry pool.
    const carried = testDb.repositories.newsItems.findByUrl(first.url);
    expect(carried?.state).toBe("published");
    expect(testDb.repositories.newsItems.findRetryable(MAX_ATTEMPTS, 10)).toEqual([]);
  });

  it("publishes a measured cost from reported token usage", async () => {
    const fresh = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/cost",
      sourceId: "openai-news",
      block: "official",
    });

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test", PULSO_MAX_EDITION_USD: "20" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        enrichEditionItems: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            model: "gpt-5.6-luna",
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
          }),
        fetchPulsoEditorial: (items) =>
          Promise.resolve({
            digest: {
              headline: "Capa",
              lede: "Lede.",
              bullets: [{ text: "Item", url: items[0].url, outlet: items[0].outlet }],
            },
            model: "gpt-5.6-terra",
            usage: { inputTokens: 0, outputTokens: 1_000_000 },
          }),
        humanizeDigest: passHumanizer,
      },
    });

    expect(result.status).toBe("published");
    // Priced by the configured roles: GPT-6 Luna input 1M = $0.10, GPT-6.1 Sol output 1M = $10.00
    expect(result.costUsdApprox).toBeCloseTo(10.1, 6);

    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.costUsdApprox).toBeCloseTo(10.1, 6);
    expect(edition?.costBreakdown.map((row) => row.step).sort()).toEqual(["editorial", "worker"]);
    expect(edition?.costBreakdown.find((row) => row.step === "worker")?.usd).toBeCloseTo(0.1, 6);
  });

  it("flags an unpriced model instead of reporting it as free", async () => {
    const fresh = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/unpriced",
      sourceId: "openai-news",
      block: "official",
    });

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test", OPENAI_MODEL_WORKER: "gpt-9-unknown" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        enrichEditionItems: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            model: "gpt-9-unknown",
            usage: { inputTokens: 1000, outputTokens: 1000 },
          }),
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.sourceFailures.some((row) => row.sourceId === "pulso-cost")).toBe(true);
  });

  it("drops an invented number from the cover using the page text already fetched", async () => {
    const fresh = item({
      title: "OpenAI publica o guia do GPT-5.6",
      url: "https://openai.com/index/builders-guide",
      sourceId: "openai-news",
      block: "official",
    });

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            // The page says nothing about price or speed.
            evidence: new Map(items.map((row) => [row.url, "Guia do construtor do GPT-5.6."])),
          }),
        fetchPulsoEditorial: (items) =>
          Promise.resolve({
            digest: {
              headline: "OpenAI publica o guia do GPT-5.6",
              lede: "O lab publicou a documentação oficial.",
              bullets: [
                {
                  text: "Saída passa a custar US$ 99,90 por 1M de tokens",
                  url: items[0].url,
                  outlet: items[0].outlet,
                },
              ],
            },
            model: "gpt-5.6-terra",
          }),
        humanizeDigest: passHumanizer,
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(JSON.stringify(edition?.digest)).not.toContain("99,90");
    expect(edition?.gate.bulletsDropped).toBe(1);
    expect(edition?.sourceFailures.some((row) => row.sourceId === "pulso-evidence")).toBe(true);
  });

  it("keeps a cover claim that the fetched page supports", async () => {
    const fresh = item({
      title: "OpenAI publica o guia do GPT-5.6",
      url: "https://openai.com/index/builders-guide",
      sourceId: "openai-news",
      block: "official",
    });

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(
              items.map((row) => [row.url, "O guia informa saída a US$ 12,00 por 1M de tokens."])
            ),
          }),
        fetchPulsoEditorial: (items) =>
          Promise.resolve({
            digest: {
              headline: "OpenAI publica o guia do GPT-5.6",
              lede: "O lab publicou a documentação oficial.",
              bullets: [
                {
                  text: "Saída custa US$ 12,00 por 1M de tokens",
                  url: items[0].url,
                  outlet: items[0].outlet,
                },
              ],
            },
            model: "gpt-5.6-terra",
          }),
        humanizeDigest: passHumanizer,
      },
    });

    expect(result.status).toBe("published");
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.digest.bullets[0]?.text).toContain("US$ 12,00");
    expect(edition?.gate.bulletsDropped).toBe(0);
  });

  it("stops calling models once the run hits its cost ceiling", async () => {
    const fresh = item({
      title: "OpenAI publica algo",
      url: "https://openai.com/news/ceiling",
      sourceId: "openai-news",
      block: "official",
    });
    const editorial = vi.fn();
    const humanize = vi.fn();

    const result = await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test", PULSO_MAX_EDITION_USD: "0.10" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        enrichEditionItems: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            model: "gpt-5.6-luna",
            // 1M Luna input tokens = US$ 0.20, over the US$ 0.10 ceiling.
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
          }),
        fetchPulsoEditorial: editorial as never,
        humanizeDigest: humanize as never,
      },
    });

    expect(editorial).not.toHaveBeenCalled();
    expect(humanize).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    // Still publishes, on the free stub digest, and says why the steps were skipped.
    expect(edition?.items).toHaveLength(1);
    expect(
      edition?.sourceFailures.filter((row) => row.sourceId === "pulso-cost").length
    ).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(edition?.sourceFailures)).toContain("teto");
  });

  it("audits the humanized wording, not the draft the humanizer replaced", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });
    const body = "A empresa apresentou o modelo nesta quinta-feira, com foco em uso corporativo.";
    const audited: string[] = [];

    await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-5.6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, body])),
            links: new Map(),
          }),
        summarizeEditionItems: (items) =>
          Promise.resolve({
            summaries: new Map([[items[0].url, "Resumo do rascunho, antes do estilo."]]),
            model: "gpt-5.6-luna",
          }),
        humanizeDigest: (digest, items) =>
          Promise.resolve({
            digest,
            items: items.map((entry) => ({
              ...entry,
              ...(entry.summaryPt ? { summaryPt: "Resumo humanizado, o que vai ao ar." } : {}),
            })),
            model: "humanizer-test",
          }),
        auditEditionSummaries: (input) => {
          for (const entry of input.items) {
            if (entry.summaryPt) audited.push(entry.summaryPt);
          }
          return acceptAudit(input);
        },
      },
    });

    // The whole point of the reorder: the auditor sees the published wording.
    expect(audited).toEqual(["Resumo humanizado, o que vai ao ar."]);
  });

  it("publishes the approved copy when the humanizer fails instead of falling back to the stub", async () => {
    const fresh = item({
      title: "Wired on the launch",
      url: "https://www.wired.com/story/launch",
      sourceId: "wired-ai",
      block: "impartial",
      region: "us",
    });
    const body = "A empresa apresentou o modelo nesta quinta-feira, com foco em uso corporativo.";

    const result = await runEdition({
      slot: "tarde",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-5.6-luna" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({ items: [fresh], results: [{ sourceId: "wired-ai", items: [fresh] }] }),
        verifyEditionLinks: (items) =>
          Promise.resolve({
            items,
            dropped: [],
            evidence: new Map(items.map((entry) => [entry.url, body])),
            links: new Map(),
          }),
        summarizeEditionItems: (items) =>
          Promise.resolve({
            summaries: new Map([
              [items[0].url, "A empresa apresentou o modelo com foco em uso corporativo."],
            ]),
            model: "gpt-5.6-luna",
          }),
        // Returns the approved text untouched plus a diagnostic, as the real one now does.
        humanizeDigest: (digest, items) =>
          Promise.resolve({
            digest,
            items,
            model: "humanizer-test",
            error: "revisão parcial, texto aprovado mantido — lote 1/1: sem JSON utilizável",
          }),
        auditEditionSummaries: acceptAudit,
      },
    });

    expect(result.status).toBe("partial");
    const edition = createEditionStore(editionsDir).readLatest();
    // The regression this guards: a failed style pass used to erase audited journalism.
    expect(edition?.items[0]?.summaryPt).toContain("uso corporativo");
    expect(
      edition?.sourceFailures.some((row) => row.sourceId === "pulso-humanize")
    ).toBe(true);
  });

  it("does not let a later cover reuse a headline that already ran", async () => {
    const morning = item({
      title: "Folha processa a Perplexity",
      url: "https://openai.com/news/folha-perplexity",
      sourceId: "openai-news",
      block: "official",
    });
    const afternoon = item({
      title: "OpenAI publica o relatório da invasão",
      url: "https://openai.com/news/hugging-face-report",
      sourceId: "openai-news",
      block: "official",
      publishedAt: "2026-08-14T18:00:00.000Z",
      fetchedAt: "2026-08-14T18:05:00.000Z",
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [morning],
            results: [{ sourceId: "openai-news", items: [morning] }],
          }),
        fetchPulsoEditorial: (items) =>
          Promise.resolve({
            digest: {
              headline: "IA sob pressão",
              lede: "Regulação pauta a capa.",
              bullets: [{ text: "Processo no Brasil.", url: items[0].url, outlet: items[0].outlet }],
            },
            model: "editorial-test",
          }),
        humanizeDigest: passHumanizer,
      },
    });

    let reservedHeadlines: readonly string[] | undefined;
    const editorial = vi.fn(
      (items: PulsoItem[], options?: { reservedHeadlines?: readonly string[] }) => {
        reservedHeadlines = options?.reservedHeadlines;
        return Promise.resolve({
          digest: {
            headline: "IA sob Pressão.",
            lede: "Segurança de agentes pauta a tarde.",
            bullets: [{ text: "Relatório da OpenAI.", url: items[0].url, outlet: items[0].outlet }],
          },
          model: "editorial-test",
        });
      }
    );

    const result = await runEdition({
      slot: "tarde",
      now: new Date("2026-08-14T19:40:00.000-03:00"),
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [afternoon],
            results: [{ sourceId: "openai-news", items: [afternoon] }],
          }),
        fetchPulsoEditorial: editorial,
        humanizeDigest: passHumanizer,
      },
    });

    expect(result.status).toBe("partial");
    expect(reservedHeadlines).toEqual(expect.arrayContaining(["IA sob pressão"]));
    const edition = createEditionStore(editionsDir).readLatest();
    expect(edition?.id).toBe("2026-08-14-tarde");
    expect(edition?.digest.headline).toBe("OpenAI publica o relatório da invasão");
    expect(edition?.digest.lede).toContain("Segurança de agentes");
    expect(
      edition?.sourceFailures.some(
        (row) =>
          row.sourceId === "pulso-editorial" &&
          row.error.includes("repetia capa anterior") &&
          row.error.includes("IA sob Pressão.")
      )
    ).toBe(true);
  });

  it("lets a forced republish keep the slot's own headline", async () => {
    const fresh = item({
      title: "OpenAI publica o guia",
      url: "https://openai.com/news/republish-headline",
      sourceId: "openai-news",
      block: "official",
    });

    await runEdition({
      slot: "manha",
      now,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        fetchPulsoEditorial: (items) =>
          Promise.resolve({
            digest: {
              headline: "OpenAI entra na capa",
              lede: "O lab publicou o guia.",
              bullets: [{ text: "Guia oficial.", url: items[0].url, outlet: items[0].outlet }],
            },
            model: "editorial-test",
          }),
        humanizeDigest: passHumanizer,
      },
    });

    const result = await runEdition({
      slot: "manha",
      now: new Date("2026-08-14T11:10:00.000-03:00"),
      force: true,
      editionsDir,
      lockPath,
      repositories: testDb.repositories,
      env: { OPENAI_API_KEY: "sk-test" },
      fetchers: {
        fetchRssSources: () =>
          Promise.resolve({
            items: [fresh],
            results: [{ sourceId: "openai-news", items: [fresh] }],
          }),
        fetchPulsoEditorial: (items) =>
          Promise.resolve({
            digest: {
              headline: "OpenAI entra na capa",
              lede: "O lab publicou o guia, de novo.",
              bullets: [{ text: "Guia oficial.", url: items[0].url, outlet: items[0].outlet }],
            },
            model: "editorial-test",
          }),
        humanizeDigest: passHumanizer,
      },
    });

    expect(result.status).toBe("published");
    expect(createEditionStore(editionsDir).readLatest()?.digest.headline).toBe(
      "OpenAI entra na capa"
    );
  });
});
