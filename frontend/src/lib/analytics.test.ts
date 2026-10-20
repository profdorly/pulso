import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GA_MEASUREMENT_ID } from "./siteBase.js";
import { trackEvent } from "./analytics.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("trackEvent", () => {
  afterEach(() => {
    delete window.gtag;
  });

  it("is a no-op when gtag is missing", () => {
    expect(() => trackEvent("source_outbound", { outlet: "Tecnoblog" })).not.toThrow();
  });

  it("forwards the event name and params", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    trackEvent("share_success", { method: "copy" });
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "share_success",
      expect.objectContaining({ method: "copy", send_to: GA_MEASUREMENT_ID })
    );
  });
});

describe("GA4 bootstrap", () => {
  it("keeps the portfolio measurement id in the HTML snippet", () => {
    const html = readFileSync(path.join(repoRoot, "frontend/index.html"), "utf8");
    expect(html).toContain(`gtag/js?id=${GA_MEASUREMENT_ID}`);
    expect(html).toContain(`gtag('config', '${GA_MEASUREMENT_ID}')`);
  });
});
