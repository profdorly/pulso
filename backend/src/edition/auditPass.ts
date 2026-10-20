import type { AuditFinding, AuditInput, AuditResult } from "./auditor.js";
import type { TokenUsage } from "./cost.js";
import type { PulsoItem } from "./schema.js";

/**
 * Runs the fidelity auditor over an edition's paragraphs.
 *
 * Each item receives its own verdict so one bad paragraph does not empty the edition. Supported
 * copy stays; a rejection removes the text its findings point at, and an unreadable verdict
 * removes all of it. There is deliberately no model rewrite here: asking another model to repair
 * rejected copy creates new prose that would need another complete approval cycle.
 *
 * The evidence is what the writers actually had: the page body, for the summary, and the feed's
 * teaser, which is what the worker wrote the title and blurb from. An item whose page did not
 * open used to lose all of its Portuguese text unaudited — a third of the items of some outlets
 * that block robots. It is now audited against the title and the teaser instead, minus the
 * summary, which only exists when there was a page to write it from.
 */

/** Kept explicit so the coupling between paragraphs and their audit is a visible policy. */
export const PUBLISH_UNAUDITED_SUMMARIES = false;

/** How many findings are carried into the run log; enough to diagnose, not a transcript. */
const SAMPLE_CAP = 5;

export interface AuditPassInput {
  items: PulsoItem[];
  /** Article body per item URL, from the verification pass. */
  pageText: Map<string, string>;
  /** Feed teaser per item URL: the source the title and blurb were written from. */
  feedText?: Map<string, string>;
  audit: (input: AuditInput) => Promise<AuditResult>;
  /** Overrides AUDIT_CONCURRENCY; tests pin it to 1 when they need strict call order. */
  concurrency?: number;
}

export interface AuditPassResult {
  items: PulsoItem[];
  /** Texts submitted to the auditor. */
  audited: number;
  /** Texts removed; the items themselves stay. */
  removed: number;
  /** Verdicts that could not be read. */
  unusable: number;
  /** Items audited against the feed teaser because their page did not open. */
  withoutPage?: number;
  /** Rejected items that lost only the rejected text and still publish part of their copy. */
  trimmed?: number;
  usage?: TokenUsage;
  samples: string[];
}

function addUsage(total: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!next) return total;
  if (!total) return { ...next };
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
  };
}

function withoutGeneratedCopy(item: PulsoItem): PulsoItem {
  const stripped: PulsoItem = { ...item };
  delete stripped.summaryPt;
  delete stripped.titlePt;
  delete stripped.blurbPt;
  return stripped;
}

type CopyField = "titlePt" | "blurbPt" | "summaryPt";
const COPY_FIELDS: readonly CopyField[] = ["titlePt", "blurbPt", "summaryPt"];

function normalizedForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(text: string): string[] {
  return normalizedForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
}

/**
 * The published fields a finding points at, or null when it cannot be placed.
 *
 * The auditor is asked for "as palavras exatas", so a normalized substring is the usual case; a
 * looser word match covers an excerpt with its punctuation trimmed or a quote mark changed. An
 * excerpt that matches nothing — paraphrased, or spanning fields — certifies nothing, and the
 * caller falls back to removing every generated text.
 */
function fieldsOfFinding(excerpt: string, item: PulsoItem): CopyField[] | null {
  const needle = normalizedForMatch(excerpt).replace(/^["'.…\s]+|["'.…\s]+$/g, "");
  if (needle.length < 8) return null;
  const exact = COPY_FIELDS.filter((field) => {
    const text = item[field];
    return text ? normalizedForMatch(text).includes(needle) : false;
  });
  if (exact.length > 0) return exact;
  const words = wordsOf(excerpt);
  if (words.length < 3) return null;
  const loose = COPY_FIELDS.filter((field) => {
    const text = item[field];
    if (!text) return false;
    const present = new Set(wordsOf(text));
    return words.filter((word) => present.has(word)).length / words.length >= 0.8;
  });
  return loose.length > 0 ? loose : null;
}

/**
 * Removes what the verdict rejected, and only that.
 *
 * The verdict covers title, blurb and summary as one block, but its findings name the sentences
 * that are not supported, and the rest of the block is what the auditor read and let stand. So a
 * summary that turned a plan into a launch costs the summary, not the title and blurb with it —
 * which used to leave the item showing only its English headline. Any finding that cannot be
 * placed, or a rejection with no findings at all, still removes every generated text.
 */
function withoutRejectedCopy(item: PulsoItem, findings: AuditFinding[]): PulsoItem {
  const rejected = new Set<CopyField>();
  for (const finding of findings) {
    const fields = fieldsOfFinding(finding.excerpt, item);
    if (!fields) return withoutGeneratedCopy(item);
    for (const field of fields) rejected.add(field);
  }
  if (rejected.size === 0) return withoutGeneratedCopy(item);
  const kept: PulsoItem = { ...item };
  for (const field of rejected) delete kept[field];
  return kept;
}

/** Title, blurb and summary as one blob so the auditor sees every published sentence. */
export function publishedCopy(item: PulsoItem): string | undefined {
  const parts: string[] = [];
  if (item.titlePt?.trim()) parts.push(`TITULO: ${item.titlePt.trim()}`);
  if (item.blurbPt?.trim()) parts.push(`BLURB: ${item.blurbPt.trim()}`);
  if (item.summaryPt?.trim()) parts.push(`RESUMO: ${item.summaryPt.trim()}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Audits in flight at once.
 *
 * The pass used to be strictly sequential, which was fine at 25 items and is not at 50: the daily
 * edition would spend most of its Lambda budget waiting on one verdict after another. Three keeps
 * well inside Bedrock's per-minute token allowance, and the auditor client already retries
 * throttling adaptively.
 */
export const AUDIT_CONCURRENCY = 3;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function auditEditionSummaries(input: AuditPassInput): Promise<AuditPassResult> {
  const concurrency = Math.max(1, input.concurrency ?? AUDIT_CONCURRENCY);
  const samples: string[] = [];
  let audited = 0;
  let removed = 0;
  let unusable = 0;
  let withoutPage = 0;
  let trimmed = 0;
  let usage: TokenUsage | undefined;

  function sample(text: string): void {
    if (samples.length < SAMPLE_CAP) samples.push(text.slice(0, 120));
  }

  // Verdicts are requested a few at a time but read back in item order, so the published edition,
  // the counters and the sampled findings come out exactly as a one-by-one pass would leave them.
  const verdicts = await mapPool(input.items, concurrency, async (item) => {
    if (!publishedCopy(item)) return null;
    const body = input.pageText.get(item.url)?.trim() ?? "";
    // Without a page the summary cannot be checked, and it cannot have been written either; what
    // is left to audit is the title and blurb, against the teaser they were written from.
    const candidate: PulsoItem = { ...item };
    if (!body) delete candidate.summaryPt;
    const copy = publishedCopy(candidate);
    const result = copy
      ? await input.audit({
          body,
          feed: input.feedText?.get(item.url),
          summary: copy,
          title: item.title,
          outlet: item.outlet,
        })
      : null;
    return { candidate, fromFeed: !body, droppedSummary: !body && Boolean(item.summaryPt), result };
  });

  const items: PulsoItem[] = [];

  input.items.forEach((item, index) => {
    const verdict = verdicts[index];
    if (!verdict) {
      items.push(item);
      return;
    }
    const { candidate, fromFeed, droppedSummary, result } = verdict;

    if (droppedSummary) {
      removed += 1;
      sample(`resumo sem página: ${item.url}`);
    }
    if (!result) {
      items.push(candidate);
      return;
    }

    audited += 1;
    if (fromFeed) withoutPage += 1;
    usage = addUsage(usage, result.usage);

    if (result.verdict?.supported === true) {
      items.push(candidate);
      return;
    }

    removed += 1;
    if (result.verdict === null) {
      unusable += 1;
      sample(`veredito ilegível: ${result.error ?? item.url}`);
      items.push(PUBLISH_UNAUDITED_SUMMARIES ? candidate : withoutGeneratedCopy(item));
      return;
    }
    for (const finding of result.verdict.findings) sample(finding.excerpt);
    if (PUBLISH_UNAUDITED_SUMMARIES) {
      items.push(candidate);
      return;
    }
    const trimmedItem = withoutRejectedCopy(candidate, result.verdict.findings);
    if (publishedCopy(trimmedItem)) trimmed += 1;
    items.push(trimmedItem);
  });

  return {
    items,
    audited,
    removed,
    unusable,
    withoutPage,
    trimmed,
    ...(usage ? { usage } : {}),
    samples,
  };
}

/**
 * Wires the audit pass to the configured provider. Kept separate so the publication policy
 * stays testable without a network and provider selection can change independently.
 */
export interface ConfiguredAuditPassInput {
  items: PulsoItem[];
  pageText: Map<string, string>;
  feedText?: Map<string, string>;
}

export interface AuditPassDeps {
  /** Environment used to build the auditor; an unconfigured auditor is reported, not assumed. */
  env: {
    OPENAI_API_KEY?: string;
    PULSO_AUDITOR_PROVIDER?: string;
    PULSO_AUDITOR_MODEL?: string;
    PULSO_AUDITOR_REASONING_EFFORT?: string;
    AWS_REGION?: string;
  };
}

/**
 * Builds the configured pass, or a pass that removes every paragraph. Publishing unaudited
 * prose would ship the risk the auditor exists to contain, so there is no permissive fallback.
 */
export async function runConfiguredAuditPass(
  input: ConfiguredAuditPassInput,
  deps: AuditPassDeps
): Promise<AuditPassResult & { model: string }> {
  const { auditorFromEnv } = await import("./auditorModels.js");
  const { auditSummary } = await import("./auditor.js");

  const configured = auditorFromEnv(deps.env);

  if ("reason" in configured) {
    const stripped = input.items.map((item) => (publishedCopy(item) ? withoutGeneratedCopy(item) : item));
    const removed = input.items.filter((item) => publishedCopy(item)).length;
    return {
      items: stripped,
      audited: 0,
      removed,
      unusable: removed,
      samples: [`auditor não configurado: ${configured.reason}`],
      model: "none",
    };
  }

  const result = await auditEditionSummaries({
    items: input.items,
    pageText: input.pageText,
    ...(input.feedText ? { feedText: input.feedText } : {}),
    audit: (auditInput) => auditSummary(auditInput, configured.model),
  });

  return { ...result, model: configured.model.id };
}
