import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PulsoItem } from "../../lib/edition.js";

const edition = { calendarDate: "2026-08-31", number: 42 };
const item: PulsoItem = {
  id: "abc",
  title: "OpenAI ships something",
  titlePt: "OpenAI lança algo",
  url: "https://example.com/a",
  outlet: "The Verge — AI",
  region: "us",
  kind: "press",
  publishedAt: "2026-08-31T10:00:00.000Z",
  firstSeenAt: "2026-08-31T10:00:00.000Z",
};

/** The address is a module constant, so each state needs a fresh module graph. */
async function withContactEmail(address: string) {
  vi.resetModules();
  vi.doMock("../../lib/siteBase.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/siteBase.js")>()),
    CONTACT_EMAIL: address,
  }));
  return (await import("./CorrectionLink.js")).CorrectionLink;
}

afterEach(() => {
  vi.doUnmock("../../lib/siteBase.js");
  vi.resetModules();
});

describe("CorrectionLink", () => {
  it("renders nothing while no address is configured", async () => {
    const CorrectionLink = await withContactEmail("");
    expect(renderToStaticMarkup(<CorrectionLink edition={edition} />)).toBe("");
    expect(renderToStaticMarkup(<CorrectionLink edition={edition} item={item} />)).toBe("");
  });

  it("pre-fills the subject with edition number and date", async () => {
    const CorrectionLink = await withContactEmail("pulso@example.com");
    const html = renderToStaticMarkup(<CorrectionLink edition={edition} />);
    expect(html).toContain("mailto:pulso@example.com");
    expect(html).toContain(encodeURIComponent("Pulso #42 · 2026-08-31"));
  });

  it("adds the headline when the correction is about one item", async () => {
    const CorrectionLink = await withContactEmail("pulso@example.com");
    const html = renderToStaticMarkup(<CorrectionLink edition={edition} item={item} />);
    expect(html).toContain(encodeURIComponent("OpenAI lança algo"));
    expect(html).toContain("Corrigir este item");
  });

  it("omits the number on an edition published before numbering", async () => {
    const CorrectionLink = await withContactEmail("pulso@example.com");
    const html = renderToStaticMarkup(
      <CorrectionLink edition={{ calendarDate: "2026-08-14", number: undefined }} />
    );
    expect(html).toContain(encodeURIComponent("Pulso · 2026-08-14"));
    expect(html).not.toContain("%23");
  });

  it("promises no reply time, because there is no queue behind the address", async () => {
    const CorrectionLink = await withContactEmail("pulso@example.com");
    const html = renderToStaticMarkup(<CorrectionLink edition={edition} item={item} />);
    for (const promise of ["24h", "48h", "prazo", "responderemos", "em breve"]) {
      expect(html.toLowerCase()).not.toContain(promise);
    }
  });

  it("pre-fills no body text — the message is the reader's to write", async () => {
    const CorrectionLink = await withContactEmail("pulso@example.com");
    const html = renderToStaticMarkup(<CorrectionLink edition={edition} item={item} />);
    expect(html).not.toContain("body=");
  });
});
