import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { PULSO_WORKER_MODEL } from "./models.js";
import type { PulsoItem } from "./schema.js";
import { enrichEditionItems } from "./worker.js";

function mockClient(parse: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { parse } } as unknown as OpenAI;
}

function item(overrides: Partial<PulsoItem> & Pick<PulsoItem, "url" | "title">): PulsoItem {
  return {
    id: overrides.id ?? overrides.url,
    outlet: "Tecnoblog",
    region: "brazil",
    kind: "press",
    genre: "news" as const,
    publishedAt: "2026-08-14T10:00:00.000Z",
    firstSeenAt: "2026-08-14T10:32:00.000Z",
    ...overrides,
  };
}

describe("enrichEditionItems", () => {
  it("does not call OpenAI when there are no items", async () => {
    const parse = vi.fn();
    const result = await enrichEditionItems([], {
      apiKey: "sk-test",
      client: mockClient(parse),
    });
    expect(parse).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      dropped: [],
      unclassified: [],
      model: PULSO_WORKER_MODEL,
    });
  });

  it("drops Brazilian non-AI items and writes PT-BR blurbs", async () => {
    const ai = item({
      url: "https://tecnoblog.net/gpt",
      title: "GPT-5.6 no trabalho",
    });
    const games = item({
      url: "https://tecnoblog.net/ps5",
      title: "PS5 em promoção",
    });
    const lab = item({
      url: "https://openai.com/news/fresh",
      title: "OpenAI launches something",
      outlet: "OpenAI News",
      region: "us",
      kind: "lab",
    });
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        items: [
          { url: ai.url, keep: true, blurbPt: "Guia prático em português sobre o GPT-5.6." },
          { url: games.url, keep: false, blurbPt: "Promoção de console." },
          { url: lab.url, keep: false, blurbPt: "O lab anunciou uma novidade." },
        ],
      },
    });

    const result = await enrichEditionItems([ai, games, lab], {
      apiKey: "sk-test",
      client: mockClient(parse),
    });

    expect(result.error).toBeUndefined();
    expect(result.model).toBe(PULSO_WORKER_MODEL);
    expect(result.items.map((row) => row.url)).toEqual([ai.url]);
    expect(result.dropped.map((row) => row.url)).toEqual([games.url, lab.url]);
    expect(result.items[0]?.blurbPt).toBe("Guia prático em português sobre o GPT-5.6.");
    const call = parse.mock.calls[0]?.[0] as { model: string };
    expect(call.model).toBe(PULSO_WORKER_MODEL);
  });

  it("keeps a lab announcement the classifier marks as AI", async () => {
    const lab = item({
      url: "https://openai.com/news/fresh",
      title: "OpenAI launches something",
      outlet: "OpenAI News",
      region: "us",
      kind: "lab",
    });
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        items: [{ url: lab.url, keep: true, titlePt: "OpenAI lança novidade", blurbPt: "O lab anunciou." }],
      },
    });
    const result = await enrichEditionItems([lab], { apiKey: "sk-test", client: mockClient(parse) });
    expect(result.items.map((row) => row.url)).toEqual([lab.url]);
    expect(result.dropped).toEqual([]);
  });

  it("drops non-AI press from any region, not just Brazil, and writes the PT-BR headline", async () => {
    // The bug this covers: `keep` was honoured only for Brazilian items, so a general business
    // wire tagged `asia` put earnings, currencies and obituaries straight into the edition.
    const aiAsia = item({
      url: "https://asia.nikkei.com/ai-chips",
      title: "Japan's AI chip push gains a new plant",
      outlet: "Nikkei Asia",
      region: "asia",
    });
    const businessAsia = item({
      url: "https://asia.nikkei.com/bhp-copper",
      title: "Copper is new king for Australia's BHP as profit jumps 30%",
      outlet: "Nikkei Asia",
      region: "asia",
    });
    const discovery = item({
      url: "https://example.com/discovery",
      title: "Some finding",
      outlet: "Discovery",
      region: "us",
      kind: "discovery",
    });
    const parse = vi.fn().mockResolvedValue({
      output_parsed: {
        items: [
          {
            url: aiAsia.url,
            keep: true,
            titlePt: "Investida do Japão em chips de IA ganha nova fábrica",
            blurbPt: "O Japão ganhou uma fábrica ligada a chips de IA.",
          },
          {
            url: businessAsia.url,
            keep: false,
            titlePt: "Cobre vira o novo rei da BHP",
            blurbPt: "Lucro da BHP subiu 30%.",
          },
          { url: discovery.url, keep: false, titlePt: "Uma descoberta", blurbPt: "Resumo." },
        ],
      },
    });

    const result = await enrichEditionItems([aiAsia, businessAsia, discovery], {
      apiKey: "sk-test",
      client: mockClient(parse),
    });

    expect(result.items.map((entry) => entry.url)).toEqual([aiAsia.url]);
    expect(result.dropped.map((entry) => entry.url)).toEqual([businessAsia.url, discovery.url]);
    expect(result.items[0]?.titlePt).toBe("Investida do Japão em chips de IA ganha nova fábrica");
  });

  it("fails closed for broad press when OpenAI throws", async () => {
    const ai = item({ url: "https://tecnoblog.net/gpt", title: "GPT" });
    const parse = vi.fn().mockRejectedValue(new Error("down"));
    const result = await enrichEditionItems([ai], {
      apiKey: "sk-test",
      client: mockClient(parse),
    });
    expect(result.error).toBe("down");
    expect(result.items).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.unclassified).toEqual([ai]);
  });
});
