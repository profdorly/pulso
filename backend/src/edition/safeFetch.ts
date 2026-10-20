import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Guarded outbound fetch for untrusted URLs.
 *
 * Every URL the publisher opens comes from an external feed or from a model, so it is
 * attacker-influenced. `redirect: "follow"` would let a single hop land on a private
 * address, so redirects are followed manually and every hop is revalidated: protocol,
 * hostname, and the addresses the hostname actually resolves to (which also blocks DNS
 * answers that point inward).
 */

export const MAX_REDIRECTS = 5;

/** Hostnames that never belong to a news article. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

export class BlockedUrlError extends Error {
  constructor(
    readonly url: string,
    readonly why: string
  ) {
    super(`blocked url ${url}: ${why}`);
    this.name = "BlockedUrlError";
  }
}

export class TooManyRedirectsError extends Error {
  constructor(readonly url: string) {
    super(`too many redirects for ${url}`);
    this.name = "TooManyRedirectsError";
  }
}

function ipv4ToLong(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    total = total * 256 + octet;
  }
  return total;
}

const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isPrivateIpv4(value: string): boolean {
  const long = ipv4ToLong(value);
  if (long === null) return false;
  for (const [network, bits] of IPV4_BLOCKED_RANGES) {
    const base = ipv4ToLong(network);
    if (base === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((long & mask) === (base & mask)) return true;
  }
  return false;
}

export function isPrivateIpv6(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (address === "::1" || address === "::") return true;

  // IPv4-mapped and IPv4-compatible forms carry a v4 address to check.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);

  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(address)) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateAddress(value: string): boolean {
  return value.includes(":") ? isPrivateIpv6(value) : isPrivateIpv4(value);
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return false;
}

export interface UrlGuardOptions {
  /** Injected for tests; defaults to real DNS resolution. */
  lookup?: (hostname: string) => Promise<Array<{ address: string }>>;
  /** Skip DNS resolution (used when only shape checks are wanted). */
  skipDnsCheck?: boolean;
}

async function defaultLookup(hostname: string): Promise<Array<{ address: string }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

/**
 * Throws BlockedUrlError unless the URL is a public http(s) endpoint.
 *
 * DNS is resolved and every returned address checked, so a hostname that answers with a
 * private address is rejected even though its name looks ordinary. The addresses are
 * returned so the subsequent fetch can pin the connection to them (DNS rebinding).
 */
export async function resolvePublicUrl(
  rawUrl: string,
  options: UrlGuardOptions = {}
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(rawUrl, "not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(rawUrl, `unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError(rawUrl, "embedded credentials");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) {
    throw new BlockedUrlError(rawUrl, `blocked hostname ${hostname}`);
  }
  if (isPrivateAddress(hostname)) {
    throw new BlockedUrlError(rawUrl, `private address ${hostname}`);
  }

  if (options.skipDnsCheck) return { url, addresses: [] };

  // A literal IP has already been checked; only names need resolving.
  const isLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  if (isLiteral) return { url, addresses: [hostname] };

  let addresses: Array<{ address: string }>;
  try {
    addresses = await (options.lookup ?? defaultLookup)(hostname);
  } catch {
    throw new BlockedUrlError(rawUrl, `could not resolve ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new BlockedUrlError(rawUrl, `no addresses for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedUrlError(rawUrl, `${hostname} resolves to private address ${address}`);
    }
  }
  return { url, addresses: addresses.map((row) => row.address) };
}

export async function assertPublicUrl(rawUrl: string, options: UrlGuardOptions = {}): Promise<URL> {
  const { url } = await resolvePublicUrl(rawUrl, options);
  return url;
}

export function lookupPinnedTo(addresses: string[]): LookupFunction {
  const address = addresses[0];
  const family = address?.includes(":") ? 6 : 4;
  const lookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, address ?? "0.0.0.0", family);
  };
  return lookup;
}

export interface GuardedFetchOptions extends UrlGuardOptions {
  fetch?: typeof fetch;
  maxRedirects?: number;
}

function fetchPinned(url: URL, addresses: string[], init: RequestInit): Promise<Response> {
  const address = addresses[0];
  if (!address) {
    return fetch(url, init);
  }
  const dispatcher = new Agent({
    connect: {
      servername: url.hostname,
      lookup: lookupPinnedTo(addresses),
    },
  });
  return undiciFetch(url.toString(), { ...init, dispatcher });
}

/**
 * Fetches a URL, validating the target before every hop.
 *
 * Returns the final response plus the URL it came from. Response bodies are still
 * untrusted input; callers must treat them as data. When the default fetch is used,
 * the TCP connection is pinned to the addresses already validated, so a second DNS
 * lookup cannot rebind onto a private address.
 */
export async function guardedFetch(
  rawUrl: string,
  init: RequestInit,
  options: GuardedFetchOptions = {}
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const resolved = await resolvePublicUrl(current, options);
    const response = options.fetch
      ? await options.fetch(resolved.url.toString(), { ...init, redirect: "manual" })
      : await fetchPinned(resolved.url, resolved.addresses, { ...init, redirect: "manual" });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (!isRedirect || !location) {
      return { response, finalUrl: response.url || resolved.url.toString() };
    }

    current = new URL(location, resolved.url).toString();
  }

  throw new TooManyRedirectsError(rawUrl);
}
