import { describe, expect, it, vi } from "vitest";
import {
  BlockedUrlError,
  TooManyRedirectsError,
  assertPublicUrl,
  guardedFetch,
  isBlockedHostname,
  isPrivateAddress,
  isPrivateIpv4,
  isPrivateIpv6,
  lookupPinnedTo,
} from "./safeFetch.js";

function publicLookup() {
  return Promise.resolve([{ address: "93.184.216.34" }]);
}

function privateLookup() {
  return Promise.resolve([{ address: "10.1.2.3" }]);
}

function response(status: number, headers: Record<string, string> = {}, url = ""): Response {
  return {
    status,
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(""),
  } as Response;
}

describe("isPrivateIpv4", () => {
  it("blocks loopback, private, link-local and reserved ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "240.0.0.1",
    ]) {
      expect(isPrivateIpv4(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "192.169.0.1"]) {
      expect(isPrivateIpv4(address), address).toBe(false);
    }
  });
});

describe("isPrivateIpv6", () => {
  it("blocks loopback, unique-local, link-local, multicast and mapped v4", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIpv6(address), address).toBe(true);
    }
  });

  it("allows a public v6 address", () => {
    expect(isPrivateIpv6("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isPrivateAddress("2606:2800:220::1")).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  it("blocks internal names", () => {
    for (const host of [
      "localhost",
      "api.localhost",
      "metadata.google.internal",
      "instance-data",
      "service.internal",
      "printer.local",
      "",
    ]) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
  });

  it("allows real news hosts", () => {
    for (const host of ["tecnoblog.net", "openai.com", "www.theverge.com"]) {
      expect(isBlockedHostname(host), host).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("accepts a public https URL", async () => {
    const url = await assertPublicUrl("https://openai.com/news/x", { lookup: publicLookup });
    expect(url.hostname).toBe("openai.com");
  });

  it("rejects non-http protocols", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("gopher://example.com")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects embedded credentials", async () => {
    await expect(
      assertPublicUrl("https://user:pass@openai.com/news", { lookup: publicLookup })
    ).rejects.toThrow(/credentials/);
  });

  it("rejects the cloud metadata endpoint by literal IP", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private address/
    );
  });

  it("rejects a public-looking hostname that resolves to a private address", async () => {
    await expect(
      assertPublicUrl("https://rebind.example.com/article", { lookup: privateLookup })
    ).rejects.toThrow(/resolves to private address/);
  });

  it("rejects a hostname that does not resolve", async () => {
    await expect(
      assertPublicUrl("https://nowhere.example.com/a", {
        lookup: () => Promise.reject(new Error("ENOTFOUND")),
      })
    ).rejects.toThrow(/could not resolve/);
  });
});

describe("guardedFetch", () => {
  it("validates every redirect hop, not just the first", async () => {
    const fetchImpl = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://news.example.com")) {
        return Promise.resolve(
          response(302, { location: "http://169.254.169.254/latest/meta-data/" }, url)
        );
      }
      return Promise.resolve(response(200, { "content-type": "text/html" }, url));
    });

    await expect(
      guardedFetch(
        "https://news.example.com/article",
        {},
        { fetch: fetchImpl as unknown as typeof fetch, lookup: publicLookup }
      )
    ).rejects.toThrow(/private address/);

    // The inward hop was never requested.
    const requested = fetchImpl.mock.calls.map(([input]) => String(input));
    expect(requested.some((url) => url.includes("169.254.169.254"))).toBe(false);
  });

  it("follows a safe redirect and reports the final URL", async () => {
    const fetchImpl = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/old")) {
        return Promise.resolve(response(301, { location: "https://openai.com/new" }, url));
      }
      return Promise.resolve(response(200, { "content-type": "text/html" }, url));
    });

    const { response: final, finalUrl } = await guardedFetch(
      "https://openai.com/old",
      {},
      { fetch: fetchImpl as unknown as typeof fetch, lookup: publicLookup }
    );

    expect(final.status).toBe(200);
    expect(finalUrl).toBe("https://openai.com/new");
  });

  it("gives up after too many redirects instead of looping", async () => {
    const fetchImpl = vi.fn((input: string | URL) =>
      Promise.resolve(response(302, { location: "https://openai.com/loop" }, String(input)))
    );

    await expect(
      guardedFetch(
        "https://openai.com/loop",
        {},
        { fetch: fetchImpl as unknown as typeof fetch, lookup: publicLookup, maxRedirects: 3 }
      )
    ).rejects.toBeInstanceOf(TooManyRedirectsError);
  });
});

describe("lookupPinnedTo", () => {
  it("returns the already-validated address instead of resolving again", () => {
    const lookup = lookupPinnedTo(["93.184.216.34"]);
    const received: Array<{ address: string; family: number }> = [];
    lookup("evil.example", {}, (err: Error | null, address: string | Array<{ address: string }>, family?: number) => {
      expect(err).toBeNull();
      const resolved = typeof address === "string" ? address : address[0]?.address;
      received.push({ address: resolved ?? "", family: family ?? 0 });
    });
    expect(received).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});
