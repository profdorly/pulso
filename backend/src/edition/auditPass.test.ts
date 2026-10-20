import { describe, expect, it, vi } from "vitest";
import type { AuditInput, AuditResult } from "./auditor.js";
import { AUDIT_CONCURRENCY, auditEditionSummaries } from "./auditPass.js";
import type { PulsoItem } from "./schema.js";

const BODY = "A empresa abriu lista de espera e pretende liberar o modelo neste trimestre.";
const SUMMARY = "A empresa abriu lista de espera e pretende liberar o modelo neste trimestre, segundo o anúncio.";

function item(overrides: Partial<PulsoItem> & Pick<PulsoItem, "url">): PulsoItem {
  return {
    id: overrides.url,
    title: overrides.title ?? "Company opens waiting list",
    outlet: overrides.outlet ?? "Wired",
    region: overrides.region ?? "us",
    kind: "press",
    genre: "news",
    publishedAt: "2026-08-14T12:00:00.000Z",
    firstSeenAt: "2026-08-14T12:30:00.000Z",
    ...overrides,
  };
}

function ok(usage = { inputTokens: 100, outputTokens: 20 }): AuditResult {
  return { verdict: { supported: true, findings: [] }, usage };
}

function bad(excerpt = "lançou o modelo"): AuditResult {
  return {
    verdict: { supported: false, findings: [{ excerpt, why: "o texto diz que pretende liberar" }] },
    usage: { inputTokens: 100, outputTokens: 30 },
  };
}

const pageText = new Map([["https://wired.com/a", BODY]]);
const oneItem = [item({ url: "https://wired.com/a", summaryPt: SUMMARY })];

describe("auditEditionSummaries", () => {
  it("keeps a paragraph the auditor supports", async () => {
    const audit = vi.fn(() => Promise.resolve(ok()));
    const result = await auditEditionSummaries({ items: oneItem, pageText, audit });

    expect(result.items[0]?.summaryPt).toBe(SUMMARY);
    expect(result.audited).toBe(1);
    expect(result.removed).toBe(0);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("drops a rejected paragraph after one verdict instead of generating another text", async () => {
    const audit = vi.fn(() => Promise.resolve(bad()));
    const result = await auditEditionSummaries({ items: oneItem, pageText, audit });

    expect(audit).toHaveBeenCalledTimes(1);
    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.removed).toBe(1);
    expect(result.items[0]?.url).toBe("https://wired.com/a");
  });

  it("drops the paragraph when the verdict cannot be read", async () => {
    const audit = vi.fn(() => Promise.resolve({ verdict: null, error: "timeout" }));
    const result = await auditEditionSummaries({ items: oneItem, pageText, audit });

    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.unusable).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("judges each item on its own so one bad paragraph does not empty the edition", async () => {
    const items = [
      item({ url: "https://wired.com/a", summaryPt: SUMMARY }),
      item({ url: "https://wired.com/b", summaryPt: SUMMARY, title: "Second story" }),
      item({ url: "https://wired.com/c", summaryPt: SUMMARY, title: "Third story" }),
    ];
    const text = new Map(items.map((entry) => [entry.url, BODY]));
    const audit = vi
      .fn<(input: AuditInput) => Promise<AuditResult>>()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(bad())
      .mockResolvedValueOnce(ok());

    const result = await auditEditionSummaries({ items, pageText: text, audit });

    expect(result.items.map((entry) => entry.summaryPt !== undefined)).toEqual([true, false, true]);
    expect(result.audited).toBe(3);
    expect(result.removed).toBe(1);
  });

  it("does not call the auditor for an item with no paragraph", async () => {
    const audit = vi.fn(() => Promise.resolve(ok()));
    const result = await auditEditionSummaries({
      items: [item({ url: "https://wired.com/a" })],
      pageText,
      audit,
    });

    expect(audit).not.toHaveBeenCalled();
    expect(result.audited).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("drops a summary whose page did not open, since nothing can check it", async () => {
    const audit = vi.fn(() => Promise.resolve(ok()));
    const result = await auditEditionSummaries({
      items: [item({ url: "https://sem-corpo.example/b", summaryPt: SUMMARY })],
      pageText,
      audit,
    });

    expect(audit).not.toHaveBeenCalled();
    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.removed).toBe(1);
    expect(result.unusable).toBe(0);
    expect(result.samples[0]).toContain("resumo sem página");
  });

  it("audits the title and blurb against the feed teaser when the page did not open", async () => {
    const url = "https://bloqueado.example/c";
    const teaser = "The company opened a waiting list and plans to release the model this quarter.";
    const audit = vi.fn((input: AuditInput) => Promise.resolve(input.feed ? ok() : bad()));
    const result = await auditEditionSummaries({
      items: [
        item({
          url,
          titlePt: "Empresa abre lista de espera",
          blurbPt: "A empresa pretende liberar o modelo neste trimestre.",
          summaryPt: SUMMARY,
        }),
      ],
      pageText,
      feedText: new Map([[url, teaser]]),
      audit,
    });

    expect(audit).toHaveBeenCalledTimes(1);
    const sent = audit.mock.calls[0]?.[0];
    expect(sent?.body).toBe("");
    expect(sent?.feed).toBe(teaser);
    expect(sent?.summary).toContain("TITULO: Empresa abre lista de espera");
    expect(sent?.summary).not.toContain("RESUMO:");
    // Title and blurb survive; the summary could not have been checked and is gone.
    expect(result.items[0]?.titlePt).toBe("Empresa abre lista de espera");
    expect(result.items[0]?.blurbPt).toBe("A empresa pretende liberar o modelo neste trimestre.");
    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.withoutPage).toBe(1);
    expect(result.audited).toBe(1);
  });

  it("removes only the generated copy the feed teaser does not support", async () => {
    const url = "https://bloqueado.example/d";
    const audit = vi.fn(() => Promise.resolve(bad("lançou o modelo")));
    const result = await auditEditionSummaries({
      items: [item({ url, titlePt: "Empresa lançou o modelo", blurbPt: "O modelo já está disponível." })],
      pageText,
      feedText: new Map([[url, "The company plans to release the model."]]),
      audit,
    });

    // The finding quotes the title, so the title goes and the blurb the auditor let stand stays.
    expect(result.items[0]?.titlePt).toBeUndefined();
    expect(result.items[0]?.blurbPt).toBe("O modelo já está disponível.");
    expect(result.items[0]?.title).toBe("Company opens waiting list");
    expect(result.removed).toBe(1);
    expect(result.trimmed).toBe(1);
  });

  it("removes only the summary when the findings are all in it", async () => {
    const audit = vi.fn(() =>
      Promise.resolve(bad("pretende liberar o modelo neste trimestre, segundo o anúncio"))
    );
    const result = await auditEditionSummaries({
      items: [
        item({
          url: "https://wired.com/a",
          titlePt: "Empresa abre lista de espera",
          blurbPt: "A lista de espera já está aberta.",
          summaryPt: SUMMARY,
        }),
      ],
      pageText,
      audit,
    });

    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.items[0]?.titlePt).toBe("Empresa abre lista de espera");
    expect(result.items[0]?.blurbPt).toBe("A lista de espera já está aberta.");
    expect(result.trimmed).toBe(1);
  });

  it("places an excerpt whose quotes and punctuation differ from the text", async () => {
    const audit = vi.fn(() =>
      Promise.resolve({
        verdict: {
          supported: false,
          findings: [{ excerpt: '"Pretende liberar o modelo neste trimestre"…', why: "x" }],
        },
      })
    );
    const result = await auditEditionSummaries({
      items: [item({ url: "https://wired.com/a", titlePt: "Empresa abre lista", summaryPt: SUMMARY })],
      pageText,
      audit,
    });

    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.items[0]?.titlePt).toBe("Empresa abre lista");
  });

  it("removes every generated text when a finding cannot be placed", async () => {
    const audit = vi.fn(() =>
      Promise.resolve({
        verdict: {
          supported: false,
          findings: [
            { excerpt: "pretende liberar o modelo neste trimestre", why: "x" },
            { excerpt: "uma frase que não está em lugar nenhum", why: "y" },
          ],
        },
      })
    );
    const result = await auditEditionSummaries({
      items: [item({ url: "https://wired.com/a", titlePt: "Empresa abre lista", summaryPt: SUMMARY })],
      pageText,
      audit,
    });

    expect(result.items[0]?.titlePt).toBeUndefined();
    expect(result.items[0]?.summaryPt).toBeUndefined();
    expect(result.trimmed).toBe(0);
  });

  it("removes every generated text when a rejection carries no findings", async () => {
    const audit = vi.fn(() => Promise.resolve({ verdict: { supported: false, findings: [] } }));
    const result = await auditEditionSummaries({
      items: [item({ url: "https://wired.com/a", titlePt: "Empresa abre lista", summaryPt: SUMMARY })],
      pageText,
      audit,
    });

    expect(result.items[0]?.titlePt).toBeUndefined();
    expect(result.items[0]?.summaryPt).toBeUndefined();
  });

  it("gives the auditor the feed teaser next to the page body", async () => {
    const teaser = "The company opened a waiting list.";
    const audit = vi.fn((input: AuditInput) => Promise.resolve(input.body && input.feed ? ok() : bad()));
    const result = await auditEditionSummaries({
      items: oneItem,
      pageText,
      feedText: new Map([["https://wired.com/a", teaser]]),
      audit,
    });

    expect(audit.mock.calls[0]?.[0]).toMatchObject({ body: BODY, feed: teaser });
    expect(result.items[0]?.summaryPt).toBe(SUMMARY);
    expect(result.withoutPage).toBe(0);
  });

  it("carries a bounded sample of findings for the run log", async () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item({ url: `https://wired.com/${index}`, summaryPt: SUMMARY })
    );
    const text = new Map(items.map((entry) => [entry.url, BODY]));
    const audit = vi.fn((input: AuditInput) => Promise.resolve(bad(`trecho de ${input.outlet}`)));

    const result = await auditEditionSummaries({ items, pageText: text, audit });

    expect(result.removed).toBe(8);
    expect(result.samples.length).toBeLessThanOrEqual(5);
    expect(result.samples.length).toBeGreaterThan(0);
  });

  it("audits a Portuguese headline even when there is no summary", async () => {
    const onlyTitle = [
      item({ url: "https://wired.com/a", titlePt: "A empresa lançou o modelo neste trimestre." }),
    ];
    const audit = vi.fn(() => Promise.resolve(bad("lançou o modelo")));
    const result = await auditEditionSummaries({ items: onlyTitle, pageText, audit });

    expect(audit).toHaveBeenCalledTimes(1);
    expect(result.items[0]?.titlePt).toBeUndefined();
    expect(result.removed).toBe(1);
  });

  it("audits a few at a time but returns the edition in item order", async () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({ url: `https://wired.com/${i}`, title: `Item ${i}`, summaryPt: SUMMARY })
    );
    const text = new Map(items.map((entry) => [entry.url, BODY]));
    let inFlight = 0;
    let peak = 0;
    // Later items answer first, so results written in completion order would come out shuffled.
    const audit = vi.fn(async (input: AuditInput) => {
      const position = Number((input.title ?? "").replace("Item ", ""));
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40 - position * 4));
      inFlight -= 1;
      return position === 5 ? bad() : ok();
    });

    const result = await auditEditionSummaries({ items, pageText: text, audit });

    expect(peak).toBe(AUDIT_CONCURRENCY);
    expect(audit).toHaveBeenCalledTimes(items.length);
    expect(result.items.map((entry) => entry.url)).toEqual(items.map((entry) => entry.url));
    expect(result.audited).toBe(items.length);
    expect(result.removed).toBe(1);
    expect(result.items[5]?.summaryPt).toBeUndefined();
    expect(result.items.filter((entry) => entry.summaryPt === SUMMARY)).toHaveLength(items.length - 1);
    expect(result.samples).toEqual(["lançou o modelo"]);
  });
});
