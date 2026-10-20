import type { BenchmarkModelRow } from "../types.js";
import type { PulsoDigest, PulsoItem } from "./schema.js";

/**
 * Narrow evidence gate.
 *
 * The published text is model-generated, so the claims that cause real damage when wrong
 * are checked against the source before publication: money, percentages, precise numbers
 * and model versions. Prose, framing and editorial judgement are not checked — verifying
 * everything would cost a second model pass per item and reject far more than it caught.
 *
 * The evidence is the page text already downloaded during link verification, plus the
 * item metadata and the benchmark snapshot the edition itself carries. No extra fetches
 * and no extra model calls, so the gate does not move the cost per edition.
 *
 * Failing closed is the point: an unsupported claim removes the sentence carrying it, and
 * an unsupported headline falls back to the stub built only from source titles.
 */

export type ClaimKind = "currency" | "percent" | "number" | "model";

export interface RiskyClaim {
  kind: ClaimKind;
  /** Text as it appears in the generated copy. */
  raw: string;
  /** Comparable form: numeric value, or a folded model token. */
  normalized: string;
}

const CURRENCY = /(?:US\$|R\$|USD|\$)\s?\d[\d.,]*/gi;
/**
 * Money written in prose, without a symbol: "40 dólares", "1,2 bilhão de reais", "150 bilhões
 * de ienes". The symbol forms above miss exactly these, and a fabricated value in words is
 * the drift a PT-BR reader is least able to check against an English page. The scale words
 * are part of the match but not of the value: normalization keeps only the digits, which is
 * what the source page states.
 */
const CURRENCY_WORD =
  /\b\d[\d.,]*\s*(?:mil(?:h(?:ões|ão))?|bilh(?:ões|ão)|trilh(?:ões|ão))?\s*(?:de\s+)?(?:d[óo]lares|reais|euros|i[êe]ns|ienes|yuans?|renminbis?|r[úu]pias|libras|francos|pesos|wons?)\b/giu;
const PERCENT = /\d[\d.,]*\s?%/g;
/** Decimals (5.3 / 5,3) and integers with three or more digits (1507, 128000). */
const PRECISE_NUMBER = /\b\d+(?:[.,]\d+)+\b|\b\d{3,}\b/g;
/** Known model families followed by a version number. */
const MODEL_VERSION =
  /\b(?:gpt|claude|gemini|llama|qwen|deepseek|kimi|glm|grok|mistral|sabi[aá]|nova|titan|phi|command|opus|sonnet|haiku)[\w.-]*\d[\w.-]*/gi;

/** Years read as ordinary prose, not as claims needing a source. */
function isYearLike(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Parses a number written in PT-BR or EN form into a comparable value.
 *
 * `1.507` is thousands, `5,3` and `5.3` are decimals, and the full mixed forms both languages
 * use — `1.234.567,89` and `1,234,567.89` — resolve by their separator shape. Ambiguity is
 * resolved by shape, and anything unparseable returns null so it is simply not treated as a
 * numeric claim.
 */
export function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  let candidate = cleaned;
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    candidate = cleaned.replace(/\./g, "");
  } else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    candidate = cleaned.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(cleaned)) {
    candidate = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(cleaned)) {
    candidate = cleaned.replace(/,/g, "");
  } else if (/^\d+,\d+$/.test(cleaned)) {
    candidate = cleaned.replace(",", ".");
  }

  const value = Number(candidate);
  return Number.isFinite(value) ? value : null;
}

function pushNumeric(claims: RiskyClaim[], kind: ClaimKind, raw: string): void {
  const value = normalizeNumber(raw);
  if (value === null) return;
  if (kind === "number" && isYearLike(value)) return;
  claims.push({ kind, raw: raw.trim(), normalized: String(value) });
}

/** Extracts only the claim types the gate is willing to vouch for. */
export function extractRiskyClaims(text: string): RiskyClaim[] {
  if (!text) return [];
  const claims: RiskyClaim[] = [];

  for (const match of text.matchAll(CURRENCY)) {
    pushNumeric(claims, "currency", match[0]);
  }
  for (const match of text.matchAll(CURRENCY_WORD)) {
    pushNumeric(claims, "currency", match[0]);
  }
  for (const match of text.matchAll(PERCENT)) {
    pushNumeric(claims, "percent", match[0]);
  }
  for (const match of text.matchAll(PRECISE_NUMBER)) {
    pushNumeric(claims, "number", match[0]);
  }
  for (const match of text.matchAll(MODEL_VERSION)) {
    claims.push({
      kind: "model",
      raw: match[0],
      normalized: fold(match[0]).replace(/[^a-z0-9.]/g, ""),
    });
  }

  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = `${claim.kind}:${claim.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface EvidenceIndex {
  /** Evidence scoped to one cited URL. */
  forUrl(url: string): SupportSet;
  /** Union of every source in the edition, for text that spans items. */
  global(): SupportSet;
}

export interface SupportSet {
  numbers: Set<string>;
  percents: Set<string>;
  currencies: Set<string>;
  models: Set<string>;
  text: string;
}

function buildSupport(sources: string[]): SupportSet {
  const joined = sources.join(" \n ");
  const text = fold(joined);
  const numbers = new Set<string>();
  const percents = new Set<string>();
  const currencies = new Set<string>();
  const models = new Set<string>();

  for (const claim of extractRiskyClaims(joined)) {
    if (claim.kind === "model") models.add(claim.normalized);
    else if (claim.kind === "percent") percents.add(claim.normalized);
    else if (claim.kind === "currency") currencies.add(claim.normalized);
    else numbers.add(claim.normalized);
  }

  return { numbers, percents, currencies, models, text };
}

export interface EvidenceInput {
  items: PulsoItem[];
  /** Page text captured during link verification, keyed by item URL. */
  pageText?: Map<string, string>;
  benchmarkRows?: BenchmarkModelRow[];
}

function benchmarkEvidence(rows: BenchmarkModelRow[] | undefined): string[] {
  if (!rows?.length) return [];
  const parts: string[] = [];
  for (const row of rows) {
    parts.push(row.name, row.modelId, row.creator ?? "");
    for (const value of [
      row.intelligenceIndex,
      row.codingIndex,
      row.agenticIndex,
      row.priceInput,
      row.priceOutput,
      row.throughput,
      row.contextWindow,
    ]) {
      if (typeof value === "number" && Number.isFinite(value)) {
        // Both the raw and one-decimal forms, since the cover renders scores rounded.
        parts.push(String(value), value.toFixed(1));
      }
    }
  }
  return parts;
}

export function buildEvidenceIndex(input: EvidenceInput): EvidenceIndex {
  const benchmark = benchmarkEvidence(input.benchmarkRows);
  const perUrl = new Map<string, SupportSet>();
  const itemSources: string[] = [];

  for (const item of input.items) {
    // Deliberately excludes item.blurbPt and item.summaryPt: both are model-generated, so
    // letting either act as evidence would let a fabricated claim validate itself.
    // Benchmarks stay out of per-URL support: a model score of 40 must not vouch for
    // "US$ 40 bilhões" in an unrelated article.
    const sources = [item.title, item.outlet, item.url, input.pageText?.get(item.url) ?? ""];
    itemSources.push(...sources);
    perUrl.set(item.url, buildSupport(sources));
  }

  const globalSupport = buildSupport([...itemSources, ...benchmark]);

  return {
    forUrl(url) {
      return perUrl.get(url) ?? globalSupport;
    },
    global() {
      return globalSupport;
    },
  };
}

export function isClaimSupported(claim: RiskyClaim, support: SupportSet): boolean {
  if (claim.kind === "model") {
    if (support.models.has(claim.normalized)) return true;
    // A shorter form still counts: "GPT-5.6" is supported by "gpt-5.6-terra".
    for (const known of support.models) {
      if (known.startsWith(claim.normalized) || claim.normalized.startsWith(known)) return true;
    }
    return support.text.includes(claim.normalized);
  }
  if (claim.kind === "percent") {
    return support.percents.has(claim.normalized) || support.text.includes(fold(claim.raw));
  }
  if (claim.kind === "currency") {
    return support.currencies.has(claim.normalized) || support.text.includes(fold(claim.raw));
  }
  return support.numbers.has(claim.normalized) || support.text.includes(fold(claim.raw));
}

export function unsupportedClaims(text: string, support: SupportSet): RiskyClaim[] {
  return extractRiskyClaims(text).filter((claim) => !isClaimSupported(claim, support));
}

export interface GateSummary {
  checked: number;
  bulletsDropped: number;
  blurbsDropped: number;
  headlineFellBack: boolean;
  unsupportedSamples: string[];
}

export interface GateResult {
  digest: PulsoDigest;
  items: PulsoItem[];
  summary: GateSummary;
}

const SAMPLE_CAP = 8;

/**
 * Applies the gate to a finished digest.
 *
 * A bullet with an unsupported claim is removed rather than rewritten — rewriting would
 * need another model call and could introduce a fresh unsupported claim. If the headline
 * or lede cannot be supported, the whole digest falls back to `stubFallback`, which is
 * built only from source titles and therefore cannot assert anything new.
 */
export function gateDigest(
  digest: PulsoDigest,
  items: PulsoItem[],
  evidence: EvidenceIndex,
  stubFallback: PulsoDigest
): GateResult {
  const samples: string[] = [];
  let checked = 0;

  function note(claims: RiskyClaim[]): void {
    for (const claim of claims) {
      if (samples.length < SAMPLE_CAP) samples.push(`${claim.kind}:${claim.raw}`);
    }
  }

  const keptBullets = digest.bullets.filter((bullet) => {
    checked += 1;
    const unsupported = unsupportedClaims(bullet.text, evidence.forUrl(bullet.url));
    if (unsupported.length === 0) return true;
    note(unsupported);
    return false;
  });
  const bulletsDropped = digest.bullets.length - keptBullets.length;

  const gatedItems = items.map((item) => {
    let stripped: PulsoItem | undefined;

    // The translated headline is checked like any other generated string. A number that drifts
    // in translation is exactly the kind of error a reader would never catch, since they cannot
    // compare against the original. Losing it costs nothing: the reader falls back to `title`.
    if (item.titlePt) {
      checked += 1;
      const unsupported = unsupportedClaims(item.titlePt, evidence.forUrl(item.url));
      if (unsupported.length > 0) {
        note(unsupported);
        stripped = { ...item };
        delete stripped.titlePt;
      }
    }

    if (item.blurbPt) {
      checked += 1;
      const unsupported = unsupportedClaims(item.blurbPt, evidence.forUrl(item.url));
      if (unsupported.length > 0) {
        note(unsupported);
        // Drop only the unverifiable sentence; the item, its title and its link stay.
        stripped = { ...(stripped ?? item) };
        delete stripped.blurbPt;
      }
    }

    // The paragraphs get the same treatment, and need it more: they are longer than a blurb,
    // so there is more room for a number to drift away from the page they were written from.
    if (item.summaryPt) {
      checked += 1;
      const unsupported = unsupportedClaims(item.summaryPt, evidence.forUrl(item.url));
      if (unsupported.length > 0) {
        note(unsupported);
        stripped = { ...(stripped ?? item) };
        delete stripped.summaryPt;
      }
    }

    return stripped ?? item;
  });
  const blurbsDropped = gatedItems.filter(
    (item, index) =>
      (items[index].titlePt && !item.titlePt) ||
      (items[index].blurbPt && !item.blurbPt) ||
      (items[index].summaryPt && !item.summaryPt)
  ).length;

  checked += 2;
  const global = evidence.global();
  const headlineUnsupported = unsupportedClaims(digest.headline, global);
  const ledeUnsupported = unsupportedClaims(digest.lede, global);
  const headlineFellBack = headlineUnsupported.length > 0 || ledeUnsupported.length > 0;
  note([...headlineUnsupported, ...ledeUnsupported]);

  const gatedDigest: PulsoDigest = (() => {
    // Losing every bullet would leave the cover without navigation, so fall back to the
    // stub bullets, which are built from source titles and assert nothing new.
    const bullets = keptBullets.length > 0 ? keptBullets : stubFallback.bullets;
    return headlineFellBack ? { ...stubFallback, bullets } : { ...digest, bullets };
  })();

  return {
    digest: gatedDigest,
    items: gatedItems,
    summary: {
      checked,
      bulletsDropped,
      blurbsDropped,
      headlineFellBack,
      unsupportedSamples: samples,
    },
  };
}
