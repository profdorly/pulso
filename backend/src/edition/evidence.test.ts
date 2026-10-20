import { describe, expect, it } from "vitest";
import {
  buildEvidenceIndex,
  extractRiskyClaims,
  gateDigest,
  normalizeNumber,
  unsupportedClaims,
} from "./evidence.js";
import type { PulsoDigest, PulsoItem } from "./schema.js";

function item(overrides: Partial<PulsoItem> = {}): PulsoItem {
  return {
    id: "item-1",
    title: "OpenAI publica o guia do GPT-5.6",
    url: "https://openai.com/index/builders-guide",
    outlet: "OpenAI News",
    region: "us",
    kind: "lab",
    genre: "news" as const,
    publishedAt: "2026-08-14T10:00:00.000Z",
    firstSeenAt: "2026-08-14T10:32:00.000Z",
    ...overrides,
  };
}

describe("normalizeNumber", () => {
  it("reads PT-BR and EN forms into the same value", () => {
    expect(normalizeNumber("5,3")).toBe(5.3);
    expect(normalizeNumber("5.3")).toBe(5.3);
    expect(normalizeNumber("1.507")).toBe(1507);
    expect(normalizeNumber("1,507")).toBe(1507);
    expect(normalizeNumber("128000")).toBe(128000);
    expect(normalizeNumber("US$ 12,00")).toBe(12);
  });

  it("reads the full mixed-separator forms both languages use", () => {
    expect(normalizeNumber("1.234.567,89")).toBe(1234567.89);
    expect(normalizeNumber("1,234,567.89")).toBe(1234567.89);
    expect(normalizeNumber("R$ 1.234.567,89")).toBe(1234567.89);
  });

  it("returns null for text with no number", () => {
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber("")).toBeNull();
  });
});

describe("extractRiskyClaims", () => {
  it("picks up money, percentages, precise numbers and model versions", () => {
    const claims = extractRiskyClaims(
      "O GPT-5.6 custa US$ 12,00 por 1M de tokens, subiu 15% e marcou 1507 pontos."
    );
    const kinds = claims.map((claim) => claim.kind);
    expect(kinds).toContain("currency");
    expect(kinds).toContain("percent");
    expect(kinds).toContain("number");
    expect(kinds).toContain("model");
    expect(claims.some((claim) => claim.normalized === "1507")).toBe(true);
  });

  it("catches money written in prose without a symbol", () => {
    const claims = extractRiskyClaims(
      "O preço começa em 40 dólares por milhão de tokens, e o lab busca 150 bilhões de ienes."
    );
    // "40" has two digits, so the plain precise-number rule never saw it. The prose-currency
    // rule is why a fabricated "40 dólares" no longer sails through ungated.
    expect(claims.some((claim) => claim.kind === "currency" && claim.normalized === "40")).toBe(
      true
    );
    expect(claims.some((claim) => claim.kind === "currency" && claim.normalized === "150")).toBe(
      true
    );
  });

  it("ignores years and small counts so ordinary prose is not gated", () => {
    const claims = extractRiskyClaims("Em 2026, três labs e 8 modelos apareceram no dia 14.");
    expect(claims).toEqual([]);
  });

  it("finds nothing risky in claim-free prose", () => {
    expect(extractRiskyClaims("O lab publicou a documentação oficial nesta manhã.")).toEqual([]);
  });
});

describe("evidence gate", () => {
  const digest: PulsoDigest = {
    headline: "OpenAI publica o guia do GPT-5.6",
    lede: "O lab publicou documentação para quem coloca o modelo em produção.",
    bullets: [
      {
        text: "OpenAI: guia do construtor do GPT-5.6",
        url: "https://openai.com/index/builders-guide",
        outlet: "OpenAI News",
      },
    ],
  };

  it("keeps a claim that appears in the fetched page", () => {
    const evidence = buildEvidenceIndex({
      items: [item()],
      pageText: new Map([
        [item().url, "O guia do construtor do GPT-5.6 explica o preço de US$ 12,00 por 1M tokens."],
      ]),
    });

    const supported: PulsoDigest = {
      ...digest,
      bullets: [{ ...digest.bullets[0], text: "Saída custa US$ 12,00 por 1M de tokens" }],
    };

    const result = gateDigest(supported, [item()], evidence, digest);
    expect(result.digest.bullets).toHaveLength(1);
    expect(result.summary.bulletsDropped).toBe(0);
  });

  it("drops a bullet whose price is nowhere in the source", () => {
    const evidence = buildEvidenceIndex({
      items: [item()],
      pageText: new Map([[item().url, "O guia do construtor do GPT-5.6 não fala de preço."]]),
    });

    const invented: PulsoDigest = {
      ...digest,
      bullets: [{ ...digest.bullets[0], text: "Saída custa US$ 99,90 por 1M de tokens" }],
    };

    const result = gateDigest(invented, [item()], evidence, digest);
    expect(result.digest.bullets).toEqual(digest.bullets);
    expect(result.summary.bulletsDropped).toBe(1);
    expect(result.summary.unsupportedSamples.some((s) => s.includes("99,90"))).toBe(true);
  });

  it("falls back to the stub when the headline asserts an unsupported number", () => {
    const evidence = buildEvidenceIndex({
      items: [item()],
      pageText: new Map([[item().url, "O guia do construtor do GPT-5.6."]]),
    });

    const inflated: PulsoDigest = {
      ...digest,
      headline: "GPT-5.6 fica 4,5 vezes mais rápido",
    };

    const result = gateDigest(inflated, [item()], evidence, digest);
    expect(result.summary.headlineFellBack).toBe(true);
    expect(result.digest.headline).toBe(digest.headline);
  });

  it("strips an unsupported blurb but keeps the item and its link", () => {
    const withBlurb = item({ blurbPt: "O modelo ficou 37% mais barato." });
    const evidence = buildEvidenceIndex({
      items: [withBlurb],
      pageText: new Map([[withBlurb.url, "O guia do construtor do GPT-5.6, sem números de preço."]]),
    });

    const result = gateDigest(digest, [withBlurb], evidence, digest);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe(withBlurb.url);
    expect(result.items[0].blurbPt).toBeUndefined();
    expect(result.summary.blurbsDropped).toBe(1);
  });

  it("strips an unsupported paragraph but keeps the supported blurb beside it", () => {
    // The paragraphs need the gate more than the blurb does: they are longer, so there is more
    // room for a number to drift away from the page they were written from.
    const withBoth = item({
      blurbPt: "A OpenAI publicou um guia para desenvolvedores.",
      summaryPt:
        "A OpenAI publicou um guia para desenvolvedores. O documento afirma que o modelo custa US$ 42,50 por milhão de tokens.",
    });
    const evidence = buildEvidenceIndex({
      items: [withBoth],
      pageText: new Map([[withBoth.url, "A OpenAI publicou um guia para desenvolvedores, sem preço."]]),
    });

    const result = gateDigest(digest, [withBoth], evidence, digest);

    expect(result.items[0].summaryPt).toBeUndefined();
    expect(result.items[0].blurbPt).toBe("A OpenAI publicou um guia para desenvolvedores.");
    expect(result.items[0].url).toBe(withBoth.url);
    expect(result.summary.blurbsDropped).toBe(1);
  });

  it("keeps a paragraph the page supports", () => {
    const supported = item({
      summaryPt: "A OpenAI publicou um guia para desenvolvedores com exemplos de uso.",
    });
    const evidence = buildEvidenceIndex({
      items: [supported],
      pageText: new Map([
        [supported.url, "A OpenAI publicou um guia para desenvolvedores com exemplos de uso."],
      ]),
    });

    const result = gateDigest(digest, [supported], evidence, digest);
    expect(result.items[0].summaryPt).toContain("guia para desenvolvedores");
    expect(result.summary.blurbsDropped).toBe(0);
  });

  it("accepts benchmark numbers the edition itself carries, including the rounded form", () => {
    const evidence = buildEvidenceIndex({
      items: [item()],
      pageText: new Map([[item().url, "O guia do construtor."]]),
      benchmarkRows: [
        { modelId: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 63, priceInput: 15 },
      ],
    });

    // The cover renders the index as "63.0"; both forms must be supported.
    expect(unsupportedClaims("Claude Opus 5 marca 63.0 no índice", evidence.global())).toEqual([]);
    expect(unsupportedClaims("Claude Opus 5 marca 71.0 no índice", evidence.global())).toHaveLength(1);
  });

  it("does not let a benchmark score vouch for a currency claim in an article", () => {
    const story = item({ title: "Empresa anuncia acordo" });
    const evidence = buildEvidenceIndex({
      items: [story],
      pageText: new Map([[story.url, "A empresa cresceu no trimestre."]]),
      benchmarkRows: [
        { modelId: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 40 },
      ],
    });

    expect(unsupportedClaims("O acordo vale US$ 40 bilhões", evidence.forUrl(story.url)).length).toBeGreaterThan(
      0
    );
  });

  it("treats a shortened model name as supported by the fuller one in evidence", () => {
    const evidence = buildEvidenceIndex({
      items: [item({ title: "Guia do gpt-5.6-terra" })],
      pageText: new Map(),
    });
    expect(unsupportedClaims("O GPT-5.6 chegou", evidence.global())).toEqual([]);
  });

  it("does not gate prose with no risky claims", () => {
    const evidence = buildEvidenceIndex({ items: [item()], pageText: new Map() });
    const result = gateDigest(digest, [item()], evidence, digest);
    expect(result.summary.bulletsDropped).toBe(0);
    expect(result.summary.headlineFellBack).toBe(false);
    expect(result.digest).toEqual(digest);
  });
});
