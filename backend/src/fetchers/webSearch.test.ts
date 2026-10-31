import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { searchBeyondFeeds, WEB_SEARCH_MAX_CALLS, WEB_SEARCH_REGIONS, WEB_SEARCH_TOPICS } from "./webSearch.js";

const CALLS = WEB_SEARCH_REGIONS.length * WEB_SEARCH_TOPICS.length;

interface FakeItem {
  title: string;
  url: string;
  outlet: string;
  publishedAt: string;
  region: string;
  language: string;
  why: string;
}

function found(url: string, title = `Notícia ${url}`): FakeItem {
  return { title, url, outlet: "Veículo", publishedAt: "2026-10-09T09:00:00Z", region: "asia", language: "en", why: "importa" };
}

/** A Responses API result: search calls with their sources, then the parsed answer. */
function reply(items: FakeItem[], sources: string[], searches = 2) {
  return {
    output: [
      ...Array.from({ length: searches }, (_, index) => ({
        type: "web_search_call",
        action: { type: "search", query: `consulta ${index}`, sources: sources.map((url) => ({ type: "url", url })) },
      })),
      { type: "message", content: [] },
    ],
    output_parsed: { items },
    usage: { input_tokens: 20_000, output_tokens: 800 },
  };
}

const input = {
  windowStart: new Date("2026-10-08T10:30:00Z"),
  windowEnd: new Date("2026-10-09T10:30:00Z"),
  knownTitles: ["China anuncia 19 medidas para acelerar a IA"],
  blockedDomains: ["tecnoblog.net"],
};

function client(parse: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { parse } } as unknown as OpenAI;
}

describe("searchBeyondFeeds", () => {
  it("asks each region and topic with capped searches, a location, the feeds' sites blocked and the known list", async () => {
    const parse = vi.fn().mockResolvedValue(reply([], []));
    await searchBeyondFeeds(input, { apiKey: "k", client: client(parse) });

    expect(parse).toHaveBeenCalledTimes(CALLS);
    const request = parse.mock.calls[0]?.[0] as {
      model: string;
      reasoning: { effort: string };
      max_tool_calls: number;
      tool_choice: string;
      tools: Array<{
        type: string;
        search_context_size: string;
        user_location: { type: string; country?: string };
        filters: { blocked_domains: string[] };
      }>;
      input: Array<{ content: string }>;
    };
    expect(request.model).toBe("gpt-6.1-terra");
    expect(request.reasoning.effort).toBe("medium");
    expect(request.max_tool_calls).toBe(WEB_SEARCH_MAX_CALLS);
    expect(request.tool_choice).toBe("required");
    expect(request.tools[0]?.search_context_size).toBe("high");
    // The tool assumes a US reader when no location is sent; the first region must not.
    expect(request.tools[0]?.user_location).toEqual({ type: "approximate" });
    const latam = parse.mock.calls.at(-1)?.[0] as { tools: Array<{ user_location: { country?: string } }> };
    expect(latam.tools[0]?.user_location.country).toBe("BR");
    expect(request.tools[0]?.filters.blocked_domains).toEqual(
      expect.arrayContaining(["tecnoblog.net", "news.google.com", "linkedin.com", "apnews.com"])
    );
    expect(request.input[0]?.content).toContain("2026-10-08T10:30:00.000Z");
    expect(request.input[0]?.content).toContain(WEB_SEARCH_TOPICS[0].focus);
    expect(request.input[1]?.content).toContain("China anuncia 19 medidas");
  });

  it("keeps only URLs the search returned, outside blocked hosts, once across calls", async () => {
    const good = "https://www.livemint.com/ai/india-plans-ai-regulation-1179";
    const parse = vi
      .fn()
      .mockResolvedValueOnce(
        reply(
          [found(good), found("https://invented.example/story"), found("https://tecnoblog.net/noticia"), found("https://www.linkedin.com/posts/x")],
          [good, "https://tecnoblog.net/noticia", "https://www.linkedin.com/posts/x"],
          3
        )
      )
      .mockResolvedValueOnce(reply([found(`${good}/`)], [good], 2))
      .mockResolvedValue(reply([], [], 0));

    const result = await searchBeyondFeeds(input, { apiKey: "k", client: client(parse) });

    expect(result.candidates.map((row) => row.url)).toEqual([good]);
    expect(result.candidates[0]?.searchRegion).toBe(WEB_SEARCH_REGIONS[0].id);
    expect(result.usage).toEqual({ inputTokens: 20_000 * CALLS, outputTokens: 800 * CALLS, webSearchCalls: 5 });
    expect(result.queries).toHaveLength(5);
    expect(result.errors).toEqual([]);
  });

  it("reports a failed call and still returns what the others found", async () => {
    const good = "https://www.straitstimes.com/tech/elevenlabs-singapore";
    const parse = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockResolvedValueOnce(reply([found(good)], [good]))
      .mockResolvedValue(reply([], []));

    const result = await searchBeyondFeeds(input, { apiKey: "k", client: client(parse) });

    expect(result.candidates.map((row) => row.url)).toEqual([good]);
    expect(result.errors).toEqual([`${WEB_SEARCH_REGIONS[0].id}/${WEB_SEARCH_TOPICS[0].id}: 429 rate limited`]);
  });
});
