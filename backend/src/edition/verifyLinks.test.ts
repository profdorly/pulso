import { describe, expect, it, vi } from "vitest";
import {
  extractPageLinks,
  extractPublishedAt,
  isListingUrl,
  readLimitedText,
  titleMatches,
  verifyEditionLinks,
} from "./verifyLinks.js";
import type { PulsoItem } from "./schema.js";

function item(overrides: Partial<PulsoItem> & Pick<PulsoItem, "url" | "title">): PulsoItem {
  return {
    id: overrides.id ?? overrides.url,
    outlet: overrides.outlet ?? "Tecnoblog",
    region: overrides.region ?? "brazil",
    kind: overrides.kind ?? "press",
    genre: overrides.genre ?? ("news" as const),
    publishedAt: "2026-08-14T19:20:00.000Z",
    firstSeenAt: "2026-08-14T21:32:00.000Z",
    ...overrides,
  };
}

function htmlResponse(status: number, html: string, url: string, contentType = "text/html"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: () => Promise.resolve(html),
  } as Response;
}

describe("extractPublishedAt", () => {
  const url = "https://example.com/news/story";

  it.each([
    ['<meta property="article:published_time" content="2026-10-09T09:34:17+08:00">', "2026-10-09T01:34:17.000Z"],
    ['<meta content="2026-10-09T13:21:50Z" property="article:published_time" />', "2026-10-09T13:21:50.000Z"],
    ['<script type="application/ld+json">{"datePublished": "2026-10-08T21:27:22-03:00"}</script>', "2026-10-09T00:27:22.000Z"],
    ['<meta name="parsely-pub-date" content="2026-10-09T08:00:02Z">', "2026-10-09T08:00:02.000Z"],
    ['<time datetime="2026-10-09">9 de outubro</time>', "2026-10-09"],
  ])("reads %s", (html, expected) => {
    expect(extractPublishedAt(html, url)).toBe(expected);
  });

  it("falls back to a date in the URL path, at day precision", () => {
    expect(extractPublishedAt("<p>sem data</p>", "https://elpais.com/mexico/2026-10-08/cae-la-red.html")).toBe(
      "2026-10-08"
    );
    expect(extractPublishedAt("<p>sem data</p>", "https://site.com/2026/10/09/story/")).toBe("2026-10-09");
  });

  it("returns undefined when neither the page nor the URL states a date", () => {
    expect(extractPublishedAt("<p>nada</p>", "https://www.sicoob.com.br/noticias/id/325742018")).toBeUndefined();
    expect(extractPublishedAt('<meta property="article:published_time" content="ontem">', url)).toBeUndefined();
  });
});

describe("titleMatches", () => {
  it("accepts a page whose title shares the distinctive words", () => {
    expect(
      titleMatches(
        "Nova ferramenta do ChatGPT lembra recurso do Windows 11",
        "Nova ferramenta do ChatGPT lembra recurso do Windows 11 que caiu em desgraça • Tecnoblog"
      )
    ).toBe(true);
  });

  it("rejects a live page about something else", () => {
    expect(
      titleMatches("A corrida chinesa vista do Brasil", "Galaxy Buds 4 Pro com áudio de alta fidelidade • Tecnoblog")
    ).toBe(false);
  });

  it("matches headlines in scripts without spaces, which used to fold to nothing", () => {
    const page = "リコー、約350億パラメータのMoE型「リコーLMM_35B-A3B」を開発 - Impress Watch";
    expect(titleMatches("リコー、約350億パラメータのMoE型「リコーLMM_35B-A3B」を開発", page)).toBe(true);
    expect(titleMatches("铭芯启睿官宣超4亿元新融资", "闪电快讯｜铭芯启睿官宣超4亿元新融资，超20年经验芯片老将加盟")).toBe(true);
    // Same script, different story: still a mismatch.
    expect(titleMatches("声優の無断学習・AI問題に歯止め", page)).toBe(false);
  });

  it("matches Arabic word by word, and Korean by letter pairs so particles do not break it", () => {
    expect(titleMatches("عبدالله بن سالم القاسمي يشهد إطلاق نجم", "عبدالله بن سالم القاسمي يشهد إطلاق نجم وكيل الذكاء")).toBe(true);
    expect(titleMatches("삼성전자 인공지능 반도체 공개", "삼성전자, 인공지능 반도체 신제품 공개 - 연합뉴스")).toBe(true);
    // The model paraphrases; the page inflects.
    expect(titleMatches("삼성전자 인공지능 반도체 공개", "삼성전자가 인공지능 반도체를 공개했다")).toBe(true);
    expect(titleMatches("삼성전자 인공지능 반도체 공개", "현대차 전기차 판매 증가")).toBe(false);
  });

  it("keeps Devanagari and Thai words whole instead of matching on fragments", () => {
    const hindi = "गूगल ने नया एआई मॉडल लॉन्च किया";
    expect(titleMatches(hindi, `${hindi} - दैनिक भास्कर`)).toBe(true);
    // Before marks counted as part of the word, "गूगल" and "मॉडल" both left a "गल"/"डल" shard,
    // and shards like these matched unrelated stories.
    expect(titleMatches(hindi, "मौसम विभाग ने भारी बारिश की चेतावनी दी")).toBe(false);
    // Same template, different company: rejected, as the English pair is.
    expect(titleMatches(hindi, "माइक्रोसॉफ्ट ने नया एआई चिप लॉन्च किया")).toBe(false);
    expect(titleMatches("กูเกิลเปิดตัวโมเดลปัญญาประดิษฐ์ใหม่", "กูเกิลเปิดตัวโมเดลปัญญาประดิษฐ์ใหม่ - ไทยรัฐ")).toBe(true);
    expect(titleMatches("กูเกิลเปิดตัวโมเดลปัญญาประดิษฐ์ใหม่", "ราคาน้ำมันวันนี้ปรับขึ้น")).toBe(false);
  });
});

describe("isListingUrl", () => {
  it("rejects homepages and section indexes", () => {
    expect(isListingUrl("https://tecnoblog.net/")).toBe(true);
    expect(isListingUrl("https://openai.com/news")).toBe(true);
    expect(
      isListingUrl(
        "https://tecnoblog.net/noticias/nova-ferramenta-do-chatgpt-lembra-recurso-do-windows-11-que-caiu-em-desgraca/"
      )
    ).toBe(false);
  });
});

describe("verifyEditionLinks", () => {
  it("drops 404s and invented slugs", async () => {
    const dead = item({
      title: "O que muda para quem usa GPT-5.6 no trabalho",
      url: "https://tecnoblog.net/gpt-5-6-trabalho",
    });
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(404, "Not Found", dead.url));
    const result = await verifyEditionLinks([dead], { fetch: fetchImpl, skipDnsCheck: true });
    expect(result.items).toEqual([]);
    expect(result.dropped[0]?.reason).toBe("not-found");
  });

  it("keeps a 200 whose page title matches the item", async () => {
    const live = item({
      title: "Nova ferramenta do ChatGPT lembra recurso do Windows 11 que caiu em desgraça",
      url: "https://tecnoblog.net/noticias/nova-ferramenta-do-chatgpt-lembra-recurso-do-windows-11-que-caiu-em-desgraca/",
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      htmlResponse(
        200,
        "<title>Nova ferramenta do ChatGPT lembra recurso do Windows 11 que caiu em desgraça • Tecnoblog</title>",
        live.url
      )
    );
    const result = await verifyEditionLinks([live], { fetch: fetchImpl, skipDnsCheck: true });
    expect(result.items).toEqual([live]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a 200 that is the outlet homepage or a soft 404", async () => {
    const home = item({
      title: "Maritaca publica nota sobre o Sabiá",
      url: "https://www.maritaca.ai/",
      outlet: "Maritaca AI",
    });
    const soft = item({
      title: "A corrida chinesa vista do Brasil",
      url: "https://mittechreview.com.br/corrida-chinesa",
      outlet: "MIT Technology Review Brasil",
    });
    const fetchImpl = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("maritaca")) {
        return Promise.resolve(
          htmlResponse(200, "<title>Maritaca AI — Inteligência artificial para o Brasil</title>", url)
        );
      }
      return Promise.resolve(htmlResponse(200, "<title>Página não encontrada</title>", url));
    });
    const result = await verifyEditionLinks([home, soft], { fetch: fetchImpl as typeof fetch, skipDnsCheck: true });
    expect(result.items).toEqual([]);
    expect(result.dropped.map((row) => row.reason).sort()).toEqual(["homepage", "soft-404"]);
  });

  it("drops a live page that is not the cited article", async () => {
    const mismatch = item({
      title: "O que muda para quem usa GPT-5.6 no trabalho",
      url: "https://tecnoblog.net/noticias/nubank-caiu-aplicativo-fica-fora-do-ar-nesta-sexta-14/",
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      htmlResponse(200, "<title>Nubank caiu? App e cartão voltam a funcionar • Tecnoblog</title>", mismatch.url)
    );
    const result = await verifyEditionLinks([mismatch], { fetch: fetchImpl, skipDnsCheck: true });
    expect(result.dropped[0]?.reason).toBe("title-mismatch");
  });

  it("keeps a bot-blocked RSS item on the outlet host and drops a blocked discovery URL", async () => {
    const rss = item({
      title: "The builder's guide to GPT-5.6",
      url: "https://openai.com/index/builders-guide-to-gpt-5-6",
      outlet: "OpenAI News",
      kind: "lab",
      region: "us",
    });
    const discovery = item({
      title: "Sabiá: o que muda na API da Maritaca",
      url: "https://maritaca.ai/news/sabia",
      outlet: "Maritaca AI",
      kind: "discovery",
    });
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(403, "Forbidden", "https://blocked.example"));
    const result = await verifyEditionLinks([rss, discovery], { fetch: fetchImpl, skipDnsCheck: true });
    expect(result.items.map((row) => row.url)).toEqual([rss.url]);
    expect(result.dropped[0]?.reason).toBe("blocked");
  });

  it("drops an item pointing at an internal address without requesting it", async () => {
    const internal = item({
      title: "Metadados internos",
      url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      outlet: "Desconhecido",
      kind: "discovery",
    });
    const fetchImpl = vi.fn();

    const result = await verifyEditionLinks([internal], { fetch: fetchImpl as typeof fetch });

    expect(result.items).toEqual([]);
    expect(result.dropped[0]?.reason).toBe("unsafe-target");
    // The guard runs before any request leaves the process.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


describe("extractPageLinks", () => {
  const PAGE = "https://tecnoblog.net/noticias/glm-5-3";

  it("keeps a canonical that points at another host", () => {
    const html = `
      <html><head>
        <link rel="canonical" href="https://www.wired.com/story/glm-5-3" />
      </head><body><p>texto</p></body></html>`;

    expect(extractPageLinks(html, PAGE).canonical).toBe("https://www.wired.com/story/glm-5-3");
  });

  it("ignores a self-canonical, which says nothing about origin", () => {
    const html = `<link rel="canonical" href="${PAGE}" />`;
    expect(extractPageLinks(html, PAGE).canonical).toBeUndefined();
  });

  it("resolves a relative canonical before deciding whether it left the host", () => {
    const html = `<link rel="canonical" href="/noticias/glm-5-3" />`;
    expect(extractPageLinks(html, PAGE).canonical).toBeUndefined();
  });

  it("collects outbound article links and drops same-host navigation", () => {
    const html = `
      <a href="/noticias/outra">interna</a>
      <a href="https://tecnoblog.net/reviews/x">também interna</a>
      <a href="https://www.wired.com/story/glm-5-3">a matéria original</a>
      <a href="https://openai.com/news/gpt">outra fonte</a>`;

    const result = extractPageLinks(html, PAGE);
    expect(result.outbound).toEqual([
      "https://www.wired.com/story/glm-5-3",
      "https://openai.com/news/gpt",
    ]);
  });

  it("skips anchors, mailto and javascript hrefs", () => {
    const html = `
      <a href="#topo">topo</a>
      <a href="mailto:a@b.com">email</a>
      <a href="javascript:void(0)">nada</a>
      <a href="https://www.wired.com/story/x">fonte</a>`;

    expect(extractPageLinks(html, PAGE).outbound).toEqual(["https://www.wired.com/story/x"]);
  });

  it("dedupes repeated links and stays bounded on a link-heavy page", () => {
    const repeated = Array.from({ length: 5 }, () => `<a href="https://a.example/x">x</a>`).join("");
    const many = Array.from(
      { length: 200 },
      (_, index) => `<a href="https://b.example/${index}">y</a>`
    ).join("");

    const result = extractPageLinks(repeated + many, PAGE);
    expect(result.outbound.filter((href) => href === "https://a.example/x")).toHaveLength(1);
    // A page with hundreds of outbound links is a listing, not an article citing a source.
    expect(result.outbound.length).toBeLessThanOrEqual(60);
  });

  it("returns nothing usable for markup with no links", () => {
    expect(extractPageLinks("<p>só texto</p>", PAGE)).toEqual({ outbound: [] });
  });
});

describe("readLimitedText", () => {
  it("falls back to text() when the body stream is missing", async () => {
    const response = htmlResponse(200, "abc".repeat(10), "https://example.com/x");
    await expect(readLimitedText(response, 5)).resolves.toHaveLength(5);
  });
});
