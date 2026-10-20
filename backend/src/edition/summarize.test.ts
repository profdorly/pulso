import { describe, expect, it, vi } from "vitest";
import type { PulsoItem } from "./schema.js";
import {
  BODY_INPUT_LIMIT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  summarizeEditionItems,
} from "./summarize.js";

function item(overrides: Partial<PulsoItem> & Pick<PulsoItem, "url">): PulsoItem {
  return {
    id: overrides.url,
    title: overrides.title ?? "Wired on the launch",
    outlet: overrides.outlet ?? "Wired",
    region: overrides.region ?? "us",
    kind: overrides.kind ?? "press",
    genre: overrides.genre ?? "news",
    publishedAt: "2026-08-14T12:00:00.000Z",
    firstSeenAt: "2026-08-14T12:30:00.000Z",
    ...overrides,
  };
}

const BODY = `A empresa apresentou o modelo nesta quinta-feira. ${"Detalhe factual da matéria. ".repeat(30)}`;
const GOOD_SUMMARY = `Resumo em português com substância suficiente para ser publicado. ${"Mais uma frase factual do texto original. ".repeat(6)}`;

function stubClient(handler: (body: string) => { summaryPt: string } | Error) {
  const parse = vi.fn((request: { input: Array<{ role: string; content: string }> }) => {
    const userContent = request.input.find((entry) => entry.role === "user")?.content ?? "";
    const outcome = handler(userContent);
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve({
      output_parsed: outcome,
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
  });
  return { client: { responses: { parse } } as never, parse };
}

describe("summarizeEditionItems", () => {
  it("writes from the article body, not from the headline", async () => {
    const { client, parse } = stubClient((body) => {
      // The body has to be in the prompt: writing from the title is the defect this fixes.
      expect(body).toContain("A empresa apresentou o modelo nesta quinta-feira");
      expect(body).toContain("TITULO_ORIGINAL: Wired on the launch");
      return { summaryPt: GOOD_SUMMARY };
    });

    const result = await summarizeEditionItems([item({ url: "https://wired.com/a" })], {
      apiKey: "k",
      client,
      pageText: new Map([["https://wired.com/a", BODY]]),
    });

    expect(result.summaries.get("https://wired.com/a")).toContain("Resumo em português");
    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
  });

  it("skips an item whose body was never fetched", async () => {
    const { client, parse } = stubClient(() => ({ summaryPt: GOOD_SUMMARY }));

    const result = await summarizeEditionItems(
      [item({ url: "https://wired.com/a" }), item({ url: "https://sem-corpo.example/b" })],
      { apiKey: "k", client, pageText: new Map([["https://wired.com/a", BODY]]) }
    );

    // Summarizing without the page would break the rule the pipeline rests on.
    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.summaries.has("https://sem-corpo.example/b")).toBe(false);
  });

  it("treats an empty answer as a valid outcome instead of publishing filler", async () => {
    const { client } = stubClient(() => ({ summaryPt: "" }));

    const result = await summarizeEditionItems([item({ url: "https://wired.com/a" })], {
      apiKey: "k",
      client,
      pageText: new Map([["https://wired.com/a", BODY]]),
    });

    expect(result.summaries.size).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("drops an answer too short to be a paragraph", async () => {
    const { client } = stubClient(() => ({ summaryPt: "Curto demais." }));

    const result = await summarizeEditionItems([item({ url: "https://wired.com/a" })], {
      apiKey: "k",
      client,
      pageText: new Map([["https://wired.com/a", BODY]]),
    });

    expect(result.summaries.size).toBe(0);
  });

  it("keeps the items that worked when one call fails", async () => {
    const { client } = stubClient((body) =>
      body.includes("quebra") ? new Error("500 do provedor") : { summaryPt: GOOD_SUMMARY }
    );

    const result = await summarizeEditionItems(
      [
        item({ url: "https://wired.com/a" }),
        item({ url: "https://wired.com/b", title: "quebra aqui" }),
      ],
      {
        apiKey: "k",
        client,
        pageText: new Map([
          ["https://wired.com/a", BODY],
          ["https://wired.com/b", `quebra ${BODY}`],
        ]),
      }
    );

    expect(result.summaries.has("https://wired.com/a")).toBe(true);
    expect(result.summaries.has("https://wired.com/b")).toBe(false);
    expect(result.error).toContain("500 do provedor");
  });

  it("clamps a long answer on a sentence boundary", async () => {
    const long = `${"Uma frase factual completa sobre o lançamento do modelo. ".repeat(60)}`;
    const { client } = stubClient(() => ({ summaryPt: long }));

    const result = await summarizeEditionItems([item({ url: "https://wired.com/a" })], {
      apiKey: "k",
      client,
      pageText: new Map([["https://wired.com/a", BODY]]),
    });

    const summary = result.summaries.get("https://wired.com/a")!;
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(summary.endsWith(".")).toBe(true);
  });

  it("bounds how much body reaches the model", async () => {
    const huge = "x".repeat(BODY_INPUT_LIMIT * 3);
    let seen = 0;
    const { client } = stubClient((body) => {
      seen = body.length;
      return { summaryPt: GOOD_SUMMARY };
    });

    await summarizeEditionItems([item({ url: "https://wired.com/a" })], {
      apiKey: "k",
      client,
      pageText: new Map([["https://wired.com/a", huge]]),
    });

    // Prompt scaffolding adds a little; the body itself must be capped.
    expect(seen).toBeLessThan(BODY_INPUT_LIMIT + 500);
  });

  it("makes no call at all when nothing has a usable body", async () => {
    const { client, parse } = stubClient(() => ({ summaryPt: GOOD_SUMMARY }));

    const result = await summarizeEditionItems([item({ url: "https://wired.com/a" })], {
      apiKey: "k",
      client,
      pageText: new Map([["https://wired.com/a", "curto"]]),
    });

    expect(parse).not.toHaveBeenCalled();
    expect(result.summaries.size).toBe(0);
    expect(SUMMARY_MIN_CHARS).toBeGreaterThan(5);
  });
});
