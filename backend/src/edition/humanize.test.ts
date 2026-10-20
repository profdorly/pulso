import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { humanizeDigest, HUMANIZE_CONCURRENCY } from "./humanize.js";
import { HUMANIZE_SYSTEM_PROMPT } from "./humanizePrompt.js";
import type { PulsoItem } from "./schema.js";

function item(index: number): PulsoItem {
  return {
    id: `item-${index}`,
    title: `Notícia ${index}`,
    url: `https://exemplo.com/${index}`,
    outlet: "Veículo",
    region: "us",
    kind: "lab",
    genre: "news" as const,
    publishedAt: "2026-08-14T10:00:00.000Z",
    firstSeenAt: "2026-08-14T10:32:00.000Z",
  };
}

/** Copy with a detected tell in both fields, so the item is sent for revision. */
function withTells(index: number): PulsoItem {
  return {
    ...item(index),
    blurbPt: `Blurb original ${index}, reforçando a tese.`,
    summaryPt: `Resumo original ${index}. Além disso, o lab publicou o código.`,
  };
}

/** Copy the detector finds nothing in. */
function clean(index: number): PulsoItem {
  return {
    ...item(index),
    blurbPt: `Blurb limpo ${index}.`,
    summaryPt: `Resumo limpo ${index}.`,
  };
}

/** Which call this is: the cover revision or an item batch. */
function callKind(call: unknown): "capa" | "itens" {
  const body = call as { text: { format: { name: string } } };
  return body.text.format.name === "pulso_humanize_capa" ? "capa" : "itens";
}

interface SentItem {
  id: string;
  blurbPt?: string;
  summaryPt?: string;
  marcasBlurb?: string[];
  marcasResumo?: string[];
}

/** The items payload of a batch call: the JSON after the instruction line. */
function sentItems(call: unknown): SentItem[] {
  const body = call as { input: { content: string }[] };
  return JSON.parse(body.input[1].content.split("\n").slice(1).join("\n")) as SentItem[];
}

function coverReply(urls: string[]) {
  return {
    status: "completed",
    output_parsed: {
      headline: "Headline revisada",
      lede: "Lede revisada.",
      bullets: urls.map((url) => ({ text: `Bullet revisado ${url}`, url })),
    },
  };
}

/** Echoes every field it received, marked as revised. */
function itemsReply(sent: SentItem[]) {
  return {
    status: "completed",
    output_parsed: {
      blurbs: sent
        .filter((row) => row.blurbPt)
        .map((row) => ({ id: row.id, blurbPt: `Revisado: ${row.blurbPt}` })),
      summaries: sent
        .filter((row) => row.summaryPt)
        .map((row) => ({ id: row.id, summaryPt: `Revisado: ${row.summaryPt}` })),
    },
  };
}

function client(parse: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { parse } } as unknown as OpenAI;
}

describe("humanizeDigest", () => {
  it("revises the cover and every flagged item, splitting the items into batches", async () => {
    const items = [1, 2, 3, 4, 5].map(withTells);
    const draft = {
      headline: "Não é só um guia, é um divisor de águas",
      lede: "É importante ressaltar que a jornada configura-se como fundamental.",
      bullets: [{ text: "Guia", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockImplementation((call: unknown) =>
      Promise.resolve(
        callKind(call) === "capa" ? coverReply([items[0].url]) : itemsReply(sentItems(call))
      )
    );

    const result = await humanizeDigest(draft, items, {
      apiKey: "sk-test",
      batchSize: 2,
      client: client(parse),
    });

    expect(result.error).toBeUndefined();
    // 1 cover + 3 batches for 5 items at batchSize 2.
    expect(parse).toHaveBeenCalledTimes(4);
    expect(result.digest.headline).toBe("Headline revisada");
    expect(result.digest.bullets[0]?.outlet).toBe("Veículo");
    result.items.forEach((revised, index) => {
      expect(revised.blurbPt).toBe(`Revisado: Blurb original ${index + 1}, reforçando a tese.`);
      expect(revised.summaryPt).toBe(
        `Revisado: Resumo original ${index + 1}. Além disso, o lab publicou o código.`
      );
    });
    expect(result.flaggedItems).toBe(5);
    expect(result.cleanItems).toBe(0);
    expect(HUMANIZE_SYSTEM_PROMPT).toContain("última camada");
  });

  it("skips clean items and sends only the flagged fields, under ids, with what was found", async () => {
    const items: PulsoItem[] = [
      clean(1),
      { ...clean(2), summaryPt: "Resumo 2. Vale destacar que o teste é preliminar." },
      { ...clean(3), blurbPt: "Blurb 3, sinalizando a virada." },
    ];
    const draft = {
      headline: "Capa",
      lede: "Lede.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockImplementation((call: unknown) =>
      Promise.resolve(
        callKind(call) === "capa" ? coverReply([items[0].url]) : itemsReply(sentItems(call))
      )
    );

    const result = await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    const itemCalls = parse.mock.calls.filter((row) => callKind(row[0]) === "itens");
    expect(itemCalls).toHaveLength(1);
    const sent = sentItems(itemCalls[0]?.[0]);
    expect(sent).toEqual([
      {
        id: "1",
        summaryPt: "Resumo 2. Vale destacar que o teste é preliminar.",
        marcasResumo: ["'é importante ressaltar' e afins: \"Vale destacar\""],
      },
      {
        id: "2",
        blurbPt: "Blurb 3, sinalizando a virada.",
        marcasBlurb: ["gerúndio de enfeite no fim da frase: \", sinalizando\""],
      },
    ]);
    // URLs never travel in the item payload; the code maps ids back.
    expect(JSON.stringify(itemCalls[0]?.[0])).not.toContain("https://exemplo.com");

    expect(result.error).toBeUndefined();
    expect(result.items[0]).toEqual(items[0]);
    expect(result.items[1]?.blurbPt).toBe("Blurb limpo 2.");
    expect(result.items[1]?.summaryPt).toBe(
      "Revisado: Resumo 2. Vale destacar que o teste é preliminar."
    );
    expect(result.items[2]?.blurbPt).toBe("Revisado: Blurb 3, sinalizando a virada.");
    expect(result.items[2]?.summaryPt).toBe("Resumo limpo 3.");
    expect(result.flaggedItems).toBe(2);
    expect(result.cleanItems).toBe(1);
  });

  it("makes no item call when every item is clean, and still revises the cover", async () => {
    const items = [1, 2, 3].map(clean);
    const draft = {
      headline: "Capa",
      lede: "Lede.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };
    const parse = vi.fn().mockResolvedValue(coverReply([items[0].url]));

    const result = await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(callKind(parse.mock.calls[0]?.[0])).toBe("capa");
    expect(result.items).toEqual(items);
    expect(result.digest.headline).toBe("Headline revisada");
    expect(result.error).toBeUndefined();
    expect(result.cleanItems).toBe(3);
  });

  it("points the cover revision at the lines where tells were found", async () => {
    const items = [clean(1)];
    const draft = {
      headline: "Capa limpa",
      lede: "Lede limpa.",
      bullets: [{ text: "O lab abriu o código, reforçando a aposta.", url: items[0].url, outlet: "Veículo" }],
    };
    const parse = vi.fn().mockResolvedValue(coverReply([items[0].url]));

    await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    const content = JSON.stringify(parse.mock.calls[0]?.[0]);
    expect(content).toContain("Marcas de IA encontradas");
    expect(content).toContain("bullet 1");
    expect(content).toContain("reforçando");
    expect(content).not.toContain("headline —");
  });

  it("revises batches in parallel and still reports problems in batch order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map(withTells);
    const draft = {
      headline: "Rascunho",
      lede: "Lede.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };
    let inFlight = 0;
    let peak = 0;

    const parse = vi.fn().mockImplementation(async (call: unknown) => {
      if (callKind(call) === "capa") return coverReply([items[0].url]);
      const sent = sentItems(call);
      const first = Number(/original (\d+)/.exec(sent[0]?.blurbPt ?? "")?.[1] ?? 0);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Later batches answer first; every batch drops its last item so each one reports a problem.
      await new Promise((resolve) => setTimeout(resolve, 40 - first * 4));
      inFlight -= 1;
      return itemsReply(sent.slice(0, -1));
    });

    const result = await humanizeDigest(draft, items, {
      apiKey: "sk-test",
      batchSize: 2,
      client: client(parse),
    });

    expect(peak).toBe(HUMANIZE_CONCURRENCY);
    expect(parse).toHaveBeenCalledTimes(1 + 4);
    expect(result.items.map((row) => row.url)).toEqual(items.map((row) => row.url));
    expect(result.items[0]?.summaryPt).toContain("Revisado");
    expect(result.items[1]?.summaryPt).toBe(items[1].summaryPt);
    const labels = [...(result.error ?? "").matchAll(/lote (\d)\/4/g)].map((match) => match[1]);
    expect(labels).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps the approved text for items a batch failed to return, and revises the rest", async () => {
    const items = [1, 2].map(withTells);
    const draft = {
      headline: "Rascunho",
      lede: "Lede.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockImplementation((call: unknown) => {
      if (callKind(call) === "capa") return Promise.resolve(coverReply([items[0].url]));
      // Returns only the first item; the second is dropped.
      return Promise.resolve(itemsReply(sentItems(call).slice(0, 1)));
    });

    const result = await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    expect(result.items[0]?.summaryPt).toBe(`Revisado: ${items[0].summaryPt}`);
    // Untouched by the model, so the approved wording survives instead of being deleted.
    expect(result.items[1]?.summaryPt).toBe(items[1].summaryPt);
    expect(result.items[1]?.blurbPt).toBe(items[1].blurbPt);
    expect(result.error).toContain("resumos não revisados");
    // Problems name the URL even though the model only saw an id.
    expect(result.error).toContain("https://exemplo.com/2");
  });

  it("reports why a response was unusable, including the incomplete reason", async () => {
    const items = [withTells(1)];
    const draft = {
      headline: "Rascunho",
      lede: "Lede.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockResolvedValue({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_parsed: null,
    });

    const result = await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    expect(result.error).toContain("status=incomplete");
    expect(result.error).toContain("max_output_tokens");
    // Nothing was revised, so nothing was lost either.
    expect(result.digest).toEqual(draft);
    expect(result.items[0]?.summaryPt).toBe(items[0].summaryPt);
  });

  it("keeps the draft cover when only the cover call fails, still revising the items", async () => {
    const items = [withTells(1)];
    const draft = {
      headline: "Rascunho da capa",
      lede: "Lede do rascunho.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockImplementation((call: unknown) => {
      if (callKind(call) === "capa") return Promise.reject(new Error("timeout na capa"));
      return Promise.resolve(itemsReply(sentItems(call)));
    });

    const result = await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    expect(result.digest).toEqual(draft);
    expect(result.items[0]?.summaryPt).toBe(`Revisado: ${items[0].summaryPt}`);
    expect(result.error).toContain("capa: timeout na capa");
  });

  it("ignores invented ids instead of adding copy to the edition", async () => {
    const items = [withTells(1)];
    const draft = {
      headline: "Rascunho",
      lede: "Lede.",
      bullets: [{ text: "Bullet", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockImplementation((call: unknown) => {
      if (callKind(call) === "capa") return Promise.resolve(coverReply([items[0].url]));
      return Promise.resolve({
        status: "completed",
        output_parsed: {
          blurbs: [{ id: "9", blurbPt: "Blurb fantasma." }],
          summaries: [{ id: "9", summaryPt: "Resumo fantasma." }],
        },
      });
    });

    const result = await humanizeDigest(draft, items, { apiKey: "sk-test", client: client(parse) });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.summaryPt).toBe(items[0].summaryPt);
    expect(result.error).toContain("ids inventados");
  });

  it("keeps the approved headline when the revision repeats a published cover line", async () => {
    const items = [withTells(1)];
    const draft = {
      headline: "OpenAI publica o relatório da invasão",
      lede: "A tarde começa no lab.",
      bullets: [{ text: "Relatório oficial.", url: items[0].url, outlet: "Veículo" }],
    };

    const parse = vi.fn().mockImplementation((call: unknown) => {
      if (callKind(call) === "capa") {
        return Promise.resolve({
          status: "completed",
          output_parsed: {
            headline: "IA sob pressão",
            lede: "A tarde começa no lab, sem jargão.",
            bullets: [{ text: "Relatório oficial revisado.", url: items[0].url }],
          },
        });
      }
      return Promise.resolve(itemsReply(sentItems(call)));
    });

    const result = await humanizeDigest(draft, items, {
      apiKey: "sk-test",
      client: client(parse),
      reservedHeadlines: ["IA sob pressão"],
    });

    expect(result.digest.headline).toBe("OpenAI publica o relatório da invasão");
    expect(result.digest.lede).toBe("A tarde começa no lab, sem jargão.");
    const capaCall = parse.mock.calls.find((row) => callKind(row[0]) === "capa")?.[0] as {
      input: unknown;
    };
    expect(JSON.stringify(capaCall.input)).toContain("Manchetes já publicadas");
    expect(JSON.stringify(capaCall.input)).toContain("IA sob pressão");
  });
});
