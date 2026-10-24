import type { Repositories } from "../db/repositories/index.js";
import {
  getRssSources,
  getSourceById,
  isNarrowAiPressSource,
} from "../config/sources.js";
import { isTerminalCandidateState, type NewsItem } from "../types.js";
import type {
  BenchmarkFetcher,
  RssBatchResult,
  RssFetcher,
} from "./fetcherTypes.js";
import { createCostLedger, type CostLedger } from "./cost.js";
import type { CatalogFetchResult } from "../models/aa.js";
import type { ModelCatalog } from "../models/types.js";
import { catalogChanges } from "../models/changes.js";
import { bestOfEachFamily } from "../models/family.js";
import { buildEvidenceIndex, gateDigest, type GateSummary } from "./evidence.js";
import { EditionLockError, withEditionLock } from "./lock.js";
import { toPulsoItem } from "./mapItem.js";
import { writeEditionCover } from "./cover/render.js";
import { stubDigest, headlinesAlreadyPublished, withUniqueHeadline, type EditorialResult } from "./editorial.js";
import type { HumanizeResult } from "./humanize.js";
import { pulsoModelNames } from "./models.js";
import type { AuditPassResult } from "./auditPass.js";
import { resolveOrigins } from "./origin.js";
import type { SummarizeResult } from "./summarize.js";
import { NEW_ITEM_CAP, selectForEdition } from "./select.js";
import {
  type EditionJobResult,
  type PulsoBenchmarks,
  type PulsoEdition,
  type PulsoItem,
  type Slot,
} from "./schema.js";
import { createEditionStore, type EditionStore } from "./store.js";
import { calendarDateBrt, editionId } from "./timezone.js";
import type { LinkCheck, PageLinks, VerifyLinksResult } from "./verifyLinks.js";
import { type WorkerResult } from "./worker.js";
import { hostOf, type WebSearchInput, type WebSearchResult } from "../fetchers/webSearch.js";
import { PULSO_SEARCH_MODEL } from "./models.js";
import { evaluateShadowSearch, urlKey, webSearchMode } from "./webSearchShadow.js";

/** Re-exported so callers and tests keep one import site for the per-edition cap. */
export { NEW_ITEM_CAP } from "./select.js";

/**
 * How far back a run looks when no news-carrying predecessor closes the window: after a quiet
 * edition, on the very first run, and on every forced republish. One edition a day means the
 * normal window is ~24h, so this is a day plus margin; at 18h a run after a quiet day would
 * have marked the oldest six hours of pending news `out-of-window` for good.
 */
export const FIRST_WINDOW_MS = 30 * 60 * 60 * 1000;

/**
 * Items per thematic-classification call. Separate from the edition cap on purpose: the worker
 * answers in one structured response, and a bigger response is slower and loses more when it
 * fails. The loop below still classifies the whole window, just in batches of this size.
 */
export const CLASSIFY_BATCH_SIZE = 25;

/** How many runs may fail on the same item before it is given up on. */
export const MAX_ATTEMPTS = 3;
/** Upper bound on retryable items pulled back into a run, newest failure last. */
export const RETRY_POOL_LIMIT = 50;

/**
 * Spend ceiling per run. Once reached, remaining model steps are skipped and the edition
 * degrades to the cheaper path instead of quietly costing more.
 */
/**
 * Per-run spend ceiling.
 *
 * Raised from 1 when the item paragraphs started being written from the article body: that step
 * sends up to 12k characters of page text per item, so a busy edition sat near the old ceiling.
 * Raised again to 4 when the two daily editions became one: the edition now carries up to twice
 * the items, and the daily ceiling stays what two editions at 2 allowed. Hitting the ceiling is
 * not a soft event — the remaining model steps are skipped and the edition falls back to the
 * free stub path, which is the worst outcome available.
 */
export const DEFAULT_MAX_EDITION_USD = 4;

/**
 * How stale the previous cover may be before an empty run publishes a quiet edition.
 *
 * With a fresh predecessor, publishing nothing is right: the reader still sees recent
 * news. Past this age the last cover reads as current when it is not, so an honest empty
 * edition is better than a stale one.
 *
 * 36h, not 24h: with one run a day the previous cover is ~24h old at every run, so a 24h
 * boundary turned "quiet edition or not" into a coin flip decided by seconds of invocation
 * jitter. 36h keeps yesterday's cover after one empty morning and publishes the quiet edition
 * on the second, the same "a full cycle without news" rule the twice-daily cadence had.
 */
export const QUIET_EDITION_STALENESS_MS = 36 * 60 * 60 * 1000;

export interface EditionEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_MODEL_DISCOVERY?: string;
  OPENAI_MODEL_EDITORIAL?: string;
  OPENAI_MODEL_WORKER?: string;
  ARTIFICIAL_ANALYSIS_API_KEY?: string;
  /** Overrides DEFAULT_MAX_EDITION_USD. */
  PULSO_MAX_EDITION_USD?: string;
  /** "shadow" runs the web search beyond the feeds and logs it without publishing; else off. */
  PULSO_WEB_SEARCH?: string;
  /** Overrides PULSO_SEARCH_MODEL for that search. */
  OPENAI_MODEL_SEARCH?: string;
}

export function maxEditionUsd(env: EditionEnv = {}): number {
  const raw = Number(env.PULSO_MAX_EDITION_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_EDITION_USD;
}

export interface EditionFetchers
  extends Partial<RssFetcher>,
    Partial<BenchmarkFetcher> {
  fetchPulsoEditorial?: (
    items: PulsoItem[],
    options: { apiKey: string; model?: string; reservedHeadlines?: readonly string[] }
  ) => Promise<EditorialResult>;
  enrichEditionItems?: (
    items: PulsoItem[],
    options: { apiKey: string; model?: string; themeExemptUrls?: readonly string[] }
  ) => Promise<WorkerResult>;
  humanizeDigest?: (
    draft: PulsoEdition["digest"],
    items: PulsoItem[],
    options: { apiKey: string; model?: string; reservedHeadlines?: readonly string[] }
  ) => Promise<HumanizeResult>;
  verifyEditionLinks?: (items: PulsoItem[]) => Promise<VerifyLinksResult>;
  /** Audits each published paragraph against the article body it was written from. */
  auditEditionSummaries?: (input: {
    items: PulsoItem[];
    pageText: Map<string, string>;
    /** Feed teaser per URL: what the title and blurb were written from. */
    feedText?: Map<string, string>;
  }) => Promise<AuditPassResult & { model: string }>;
  /** Writes the Portuguese paragraphs from the body captured during verification. */
  summarizeEditionItems?: (
    items: PulsoItem[],
    options: { apiKey: string; model: string; pageText: Map<string, string> }
  ) => Promise<SummarizeResult>;
  /** Web search for the window's AI news that the feeds missed; shadow-only for now. */
  searchBeyondFeeds?: (input: WebSearchInput, options: { apiKey: string; model?: string }) => Promise<WebSearchResult>;
  /** Builds the model catalogue artifact; separate from the legacy cover strip. */
  fetchModelCatalog?: (options: { apiKey?: string }) => Promise<CatalogFetchResult>;
}

export interface RunEditionInput {
  slot: Slot;
  force?: boolean;
  benchmarksOnly?: boolean;
  now?: Date;
  editionsDir: string;
  lockPath: string;
  repositories: Repositories;
  env?: EditionEnv;
  fetchers?: EditionFetchers;
}

function modelNames(env: EditionEnv = {}): PulsoEdition["models"] {
  return pulsoModelNames(env);
}

function emptyBenchmarks(capturedAt: string): PulsoBenchmarks {
  return {
    capturedAt,
    previousCapturedAt: null,
    headline: [],
    attribution: [],
    rows: [],
  };
}

/**
 * Full snapshot rows, for build-time use only.
 *
 * The evidence gate needs every row to check a model-version claim, but no page reads them:
 * the reader-facing catalogue is `models.json`. Persisting them in the edition put ~163 KB
 * of unread JSON into every prerendered page, on the home page's LCP path.
 */
function benchmarkRowsFor(repositories: Repositories) {
  return repositories.benchmarkSnapshots.findLatest()?.payload.rows ?? [];
}

/**
 * The catalogue the page shows now, to compare the new capture with. One that no longer reads
 * under the current contract just means no comparison this week, not a failed capture.
 */
function previousCatalog(store: EditionStore): ModelCatalog | null {
  try {
    return store.readCatalog();
  } catch {
    return null;
  }
}

/** A capture this much newer than the page's catalogue starts a new week of comparison. */
const CATALOG_WEEK_MS = 6 * 24 * 3_600_000;

/**
 * What "o que mudou" compares a new capture with: the catalogue of the previous week.
 *
 * Normally that is the catalogue being replaced. A second capture in the same week (a manual
 * run, a re-run after a failure) must not compare with the one written hours earlier — the
 * week's changes would turn into "nothing changed". So the catalogue that opened the week is
 * kept apart, and a same-week capture compares with it instead.
 */
function catalogBaseline(current: ModelCatalog | null, store: EditionStore, now: Date): ModelCatalog | null {
  if (!current) return null;
  const age = now.getTime() - Date.parse(current.capturedAt);
  let kept: ModelCatalog | null;
  try {
    kept = store.readCatalogBaseline();
  } catch {
    kept = null;
  }
  if (age < CATALOG_WEEK_MS && kept && kept.capturedAt < current.capturedAt) return kept;
  store.writeCatalogBaseline(current);
  return current;
}

/**
 * The cover's model card: the five highest Artificial Analysis intelligence indexes, one row per
 * model (its best configuration), credited to the source only when there is a number to credit.
 */
function attachBenchmarks(repositories: Repositories, capturedAt: string): PulsoBenchmarks {
  const latest = repositories.benchmarkSnapshots.findLatest();
  if (!latest) {
    return emptyBenchmarks(capturedAt);
  }

  const ranked = latest.payload.rows
    .filter((row) => typeof row.intelligenceIndex === "number")
    .sort((a, b) => (b.intelligenceIndex ?? 0) - (a.intelligenceIndex ?? 0));
  const top = bestOfEachFamily(ranked, (row) => row.name)
    .slice(0, 5)
    .map((row) => ({
      label: row.name,
      value: (row.intelligenceIndex as number).toFixed(1),
      delta: null,
      metric: "Índice de inteligência",
    }));

  const previous = repositories.benchmarkSnapshots.findPreviousBefore(latest.capturedAt);

  return {
    capturedAt: latest.capturedAt,
    previousCapturedAt: previous?.capturedAt ?? null,
    headline: top,
    attribution: top.length > 0 ? ["Artificial Analysis"] : [],
    // Deliberately empty in the artifact — see benchmarkRowsFor.
    rows: [],
  };
}

function windowStart(predecessor: PulsoEdition | null, now: Date): Date {
  // Only a cover that actually carried news closes the window. A quiet edition publishes
  // nothing, so advancing past it would push still-pending items out of range.
  if (predecessor && predecessor.items.length > 0) {
    const parsed = new Date(predecessor.capturedAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(now.getTime() - FIRST_WINDOW_MS);
}

function inWindow(item: NewsItem, start: Date): boolean {
  const published = Date.parse(item.publishedAt);
  if (Number.isNaN(published)) return true;
  return published >= start.getTime();
}

/**
 * The teaser each feed published with its item, by URL: the text the worker wrote the title and
 * blurb from, and therefore the evidence the auditor holds them to. Discovery results are left
 * out because their summary was written by a model, and model text cannot vouch for itself.
 */
function feedTeasers(items: readonly NewsItem[]): Map<string, string> {
  const teasers = new Map<string, string>();
  for (const item of items) {
    const teaser = item.block === "ai-discovery" ? "" : (item.summary?.trim() ?? "");
    if (teaser) teasers.set(item.url, teaser);
  }
  return teasers;
}

/**
 * Whether a failed link check can succeed later.
 *
 * A timeout, a bot block or a 5xx says nothing about the article; a 404, a homepage, a
 * title mismatch or an unsafe target does. Only the first group may come back.
 */
export function isTransientLinkFailure(check: LinkCheck): boolean {
  if (check.reason === "unsafe-target") return false;
  if (check.reason === "network" || check.reason === "blocked") return true;
  if (check.reason === "http-error") return (check.status ?? 0) >= 500;
  return false;
}

function costBreakdownFor(ledger: CostLedger): PulsoEdition["costBreakdown"] {
  return ledger.entries().map((entry) => ({
    step: entry.step,
    model: entry.model,
    inputTokens: entry.usage.inputTokens,
    outputTokens: entry.usage.outputTokens,
    webSearchCalls: entry.usage.webSearchCalls ?? 0,
    usd: Number(entry.usd.toFixed(6)),
  }));
}

const EMPTY_GATE: GateSummary = {
  checked: 0,
  bulletsDropped: 0,
  blurbsDropped: 0,
  headlineFellBack: false,
  unsupportedSamples: [],
};

function withoutSummaries(items: PulsoItem[]): PulsoItem[] {
  return items.map((item) => {
    if (!item.summaryPt && !item.titlePt && !item.blurbPt) return item;
    const stripped: PulsoItem = { ...item };
    delete stripped.summaryPt;
    delete stripped.titlePt;
    delete stripped.blurbPt;
    return stripped;
  });
}

function mergeGateSummaries(first: GateSummary, second: GateSummary): GateSummary {
  return {
    checked: first.checked + second.checked,
    bulletsDropped: first.bulletsDropped + second.bulletsDropped,
    blurbsDropped: first.blurbsDropped + second.blurbsDropped,
    headlineFellBack: first.headlineFellBack || second.headlineFellBack,
    unsupportedSamples: [...new Set([...first.unsupportedSamples, ...second.unsupportedSamples])].slice(0, 8),
  };
}

/** Cover text for an edition that has nothing verified to report. */
export function quietDigest(checked: number, rejected: number): PulsoEdition["digest"] {
  const checkedPart =
    checked > 0
      ? `${checked} ${checked === 1 ? "candidato foi checado" : "candidatos foram checados"}`
      : "Nada novo apareceu nas fontes";
  const rejectedPart =
    rejected > 0
      ? ` ${rejected} ${rejected === 1 ? "não passou" : "não passaram"} na verificação de link ou de evidência.`
      : "";

  return {
    headline: "Sem novidade verificada nesta edição",
    lede:
      `${checkedPart} desde a última capa.${rejectedPart} ` +
      "Nada entrou porque nada foi confirmado na fonte. Os números dos modelos seguem abaixo, " +
      "com a data em que foram medidos.",
    bullets: [],
  };
}

export async function runEdition(input: RunEditionInput): Promise<EditionJobResult> {
  const now = input.now ?? new Date();
  const store = createEditionStore(input.editionsDir);
  // Out here, not inside the locked run: a run that throws after the models answered has still
  // spent that money, and used to report it as zero.
  const ledger = createCostLedger();
  const withCost = (result: EditionJobResult): EditionJobResult => ({
    ...result,
    costUsdApprox: ledger.totalUsd(),
    costBreakdown: costBreakdownFor(ledger),
  });

  try {
    return withCost(
      await withEditionLock(input.lockPath, () => runEditionLocked({ ...input, now, store, ledger }))
    );
  } catch (error) {
    if (error instanceof EditionLockError) {
      return withCost({
        status: "error",
        editionId: null,
        newItemCount: 0,
        costUsdApprox: 0,
        skippedReason: "locked",
        error: error.message,
      });
    }
    const message = error instanceof Error ? error.message : "edition failed";
    return withCost({
      status: "error",
      editionId: null,
      newItemCount: 0,
      costUsdApprox: 0,
      error: message,
    });
  }
}

async function runEditionLocked(
  input: RunEditionInput & { now: Date; store: EditionStore; ledger: CostLedger }
): Promise<EditionJobResult> {
  const { slot, repositories, store, now, ledger } = input;
  const force = input.force === true;
  const env = input.env ?? {};
  const fetchers = input.fetchers ?? {};
  const calendarDate = calendarDateBrt(now);
  const id = editionId(calendarDate, slot);
  const capturedAt = now.toISOString();
  const models = modelNames(env);
  const reservedHeadlines = headlinesAlreadyPublished(store.readIndex().editions, id);

  if (input.benchmarksOnly) {
    const catalogResult = fetchers.fetchModelCatalog
      ? await fetchers.fetchModelCatalog({ apiKey: env.ARTIFICIAL_ANALYSIS_API_KEY })
      : null;

    // Carried out of the catalogue branch so it survives to the return below. It used to be
    // computed and then dropped whenever fetchBenchmarks was also configured — which is always,
    // in production — so a total Artificial Analysis outage produced a run that reported itself
    // as `published` with no failures, while the models page silently froze on old numbers.
    let catalogFailures = "";

    if (catalogResult) {
      // The text list is what the page is for. A capture without it (the language endpoint
      // failed while the media ones answered) does not replace the last good catalogue: the
      // page keeps the previous numbers, and the next daily run tries again.
      const hasModels =
        (catalogResult.catalog.sections.find((section) => section.modality === "language")?.models.length ?? 0) > 0;
      if (hasModels) {
        // What moved since the catalogue the page showed last week, computed once here so the
        // page only has to render it.
        const current = previousCatalog(store);
        const baseline = catalogBaseline(current, store, now);
        const changes = catalogChanges(baseline, catalogResult.catalog);
        store.writeCatalog(changes ? { ...catalogResult.catalog, changes } : catalogResult.catalog);
      }
      const modelCount = catalogResult.catalog.sections.reduce(
        (total, section) => total + section.models.length,
        0
      );
      catalogFailures = catalogResult.errors
        .map((row) => `${row.modality}: ${row.error}`)
        .join("; ");

      if (!hasModels && catalogFailures.length === 0) {
        catalogFailures = "lista de modelos de texto voltou vazia; models.json mantém a captura anterior";
      }

      if (!fetchers.fetchBenchmarks) {
        return {
          status: !hasModels ? "unchanged" : catalogResult.errors.length > 0 ? "partial" : "published",
          editionId: store.readLatest()?.id ?? null,
          newItemCount: modelCount,
          costUsdApprox: 0,
          error: catalogFailures || undefined,
        };
      }
    }

    if (!fetchers.fetchBenchmarks) {
      return {
        status: "unchanged",
        editionId: store.readLatest()?.id ?? null,
        newItemCount: 0,
        costUsdApprox: 0,
      };
    }
    const result = await fetchers.fetchBenchmarks({
      aaApiKey: env.ARTIFICIAL_ANALYSIS_API_KEY,
    });
    if (result.snapshot.payload.rows.length > 0) {
      repositories.benchmarkSnapshots.insert(result.snapshot);
    }
    // An empty capture is reported, not hidden: "published with no failures" was the reason
    // nobody noticed when the cover once lost its numbers.
    const emptySnapshot =
      result.snapshot.payload.rows.length === 0
        ? "snapshot vazio; captura anterior mantida"
        : "";
    const benchmarkError = [result.error, catalogFailures, emptySnapshot]
      .filter((part) => part && part.length > 0)
      .join(" | ");
    return {
      status: benchmarkError ? "partial" : "published",
      editionId: store.readLatest()?.id ?? null,
      newItemCount: result.snapshot.payload.rows.length,
      costUsdApprox: 0,
      error: benchmarkError || undefined,
    };
  }

  const existingSlot = store.readEdition(calendarDate, slot);
  const predecessor = store.readLatest();
  const sourceFailures: PulsoEdition["sourceFailures"] = [];

  let rssItems: NewsItem[] = [];
  if (fetchers.fetchRssSources) {
    const rss: RssBatchResult = await fetchers.fetchRssSources(getRssSources());
    rssItems = rss.items;
    for (const result of rss.results) {
      if (result.error) {
        const source = getSourceById(result.sourceId);
        sourceFailures.push({
          sourceId: result.sourceId,
          name: source?.name ?? result.sourceId,
          error: result.error,
        });
      }
    }
  }

  const fetched = [...rssItems];
  const candidates: NewsItem[] = [];
  const seenUrls = new Set<string>();
  // Terminal items a feed still shows: their lifecycle is settled, but they were seen again.
  const seenAgain: string[] = [];

  for (const item of fetched) {
    if (seenUrls.has(item.url)) continue;
    const existing = repositories.newsItems.findByUrl(item.url);
    // Dedupe on lifecycle, not on mere existence: a retryable item must come back.
    if (existing && isTerminalCandidateState(existing.state)) {
      seenAgain.push(item.url);
      continue;
    }
    if (existing && (existing.attempts ?? 0) >= MAX_ATTEMPTS) {
      repositories.newsItems.markState(item.url, "rejected", "retry-exhausted", capturedAt, false);
      continue;
    }
    seenUrls.add(item.url);
    candidates.push(item);
  }
  repositories.newsItems.touchSeen(seenAgain, capturedAt);

  // Items whose feed entry has already rotated out still deserve their retries.
  for (const pending of repositories.newsItems.findRetryable(MAX_ATTEMPTS, RETRY_POOL_LIMIT)) {
    if (seenUrls.has(pending.url)) continue;
    seenUrls.add(pending.url);
    candidates.push(pending);
  }

  // A forced republish must be a superset of what it replaces, so the items already on
  // that slot are re-seeded even though they are in a terminal `published` state.
  if (force && existingSlot) {
    for (const published of existingSlot.items) {
      if (seenUrls.has(published.url)) continue;
      const stored = repositories.newsItems.findByUrl(published.url);
      if (!stored) continue;
      seenUrls.add(stored.url);
      candidates.push(stored);
    }
  }

  if (existingSlot && !force) {
    if (candidates.length > 0) {
      return {
        status: "error",
        editionId: existingSlot.id,
        newItemCount: candidates.length,
        costUsdApprox: 0,
        revision: existingSlot.revision,
        skippedReason: "slot-already-published",
        error: `slot ${slot} already published on ${calendarDate}; pass force to republish or use the next slot`,
      };
    }
    return {
      status: "unchanged",
      editionId: existingSlot.id,
      newItemCount: 0,
      costUsdApprox: 0,
      revision: existingSlot.revision,
      skippedReason: "slot-already-published",
    };
  }

  const start = windowStart(force ? null : predecessor, now);
  const inWindowUrls = new Set(
    candidates.filter((item) => inWindow(item, start)).map((item) => item.url)
  );

  // A forced republish returns a superset of the slot it replaces, so the slot's own items
  // stay in no matter how old they are. Without this, a republish late in the day could push an
  // item captured the previous morning past the FIRST_WINDOW_MS window: the replacement
  // artifact ships smaller than the one it supersedes and the carried URL is terminally
  // re-marked `rejected/out-of-window`, corrupting the lifecycle record of live journalism.
  if (force && existingSlot) {
    for (const published of existingSlot.items) {
      inWindowUrls.add(published.url);
    }
  }

  for (const item of candidates) {
    if (!inWindowUrls.has(item.url)) {
      repositories.newsItems.upsert(item);
      // Age never improves, so this is terminal rather than a retry.
      repositories.newsItems.markState(item.url, "rejected", "out-of-window", capturedAt, false);
    }
  }

  const windowed = candidates.filter((item) => inWindowUrls.has(item.url));
  // The thematic gate now runs before quotas. Persist every candidate first because lifecycle
  // transitions are UPDATEs and must also work for candidates that never reach the edition cap.
  for (const item of windowed) {
    repositories.newsItems.upsert(item);
  }

  const budget = maxEditionUsd(env);
  const overBudget = () => ledger.totalUsd() >= budget;
  function noteBudgetSkip(step: string): void {
    sourceFailures.push({
      sourceId: "pulso-cost",
      name: "Custo",
      error: `teto de US$ ${budget.toFixed(2)} atingido antes de ${step}; etapa pulada`,
    });
  }

  /** Single write path, shared by regular and quiet editions. */
  function publish(input: {
    kind: PulsoEdition["kind"];
    digest: PulsoEdition["digest"];
    items: PulsoItem[];
    gate: GateSummary;
  }): EditionJobResult {
    const status = sourceFailures.length > 0 ? "partial" : "ok";
    const revision = existingSlot ? existingSlot.revision + 1 : 1;
    // A republish is the same edition rewritten, so it keeps its number and only moves
    // `revision`. Handing it a fresh number would make the archive grow every time a slot
    // was fixed, and would break any link a reader saved to that number.
    const number = existingSlot?.number ?? store.nextEditionNumber();

    const edition: PulsoEdition = {
      id,
      schemaVersion: 1,
      slot,
      calendarDate,
      timezone: "America/Sao_Paulo",
      capturedAt,
      status,
      kind: input.kind,
      number,
      predecessorId: predecessor?.id ?? null,
      revision,
      supersedesCapturedAt: existingSlot?.capturedAt ?? null,
      digest: input.digest,
      items: input.items,
      sourceFailures,
      benchmarks: attachBenchmarks(repositories, capturedAt),
      models,
      costUsdApprox: ledger.totalUsd(),
      costBreakdown: costBreakdownFor(ledger),
      gate: input.gate,
    };

    // Finish every fallible render before preserving and replacing the canonical edition.
    // A failed cover render therefore leaves the previously published slot untouched.
    edition.cover = writeEditionCover(edition, store.dir);
    const supersededName = existingSlot ? store.supersede(calendarDate, slot) : null;
    store.writePublished(edition);

    for (const item of input.items) {
      repositories.newsItems.markState(
        item.url,
        "published",
        supersededName ? "republished" : undefined,
        capturedAt,
        false
      );
    }

    return {
      status: status === "ok" ? "published" : "partial",
      editionId: edition.id,
      newItemCount: input.items.length,
      costUsdApprox: edition.costUsdApprox,
      revision,
    };
  }

  /**
   * Nothing publishable. Either stay quiet — correct while the last cover is still
   * recent — or publish an honest empty edition once that cover has gone stale.
   */
  function finishWithoutItems(checked: number, rejected: number): EditionJobResult {
    const predecessorAge = predecessor
      ? now.getTime() - Date.parse(predecessor.capturedAt)
      : Number.POSITIVE_INFINITY;
    const staleCover = !Number.isFinite(predecessorAge) || predecessorAge > QUIET_EDITION_STALENESS_MS;

    if (!existingSlot && staleCover) {
      return publish({
        kind: "quiet",
        digest: quietDigest(checked, rejected),
        items: [],
        gate: { ...EMPTY_GATE, checked },
      });
    }

    return {
      status: "unchanged",
      editionId: predecessor?.id ?? null,
      newItemCount: 0,
      costUsdApprox: ledger.totalUsd(),
      skippedReason: "no-delta",
    };
  }

  if (windowed.length === 0) {
    return finishWithoutItems(candidates.length, candidates.length);
  }

  // The web search beyond the feeds starts now, so its one or two minutes overlap the thematic
  // classification below, and is awaited right after it: every later exit then reports its cost.
  // Shadow mode only — what it finds is checked and logged, never published (webSearchShadow.ts).
  const searchModel = env.OPENAI_MODEL_SEARCH ?? PULSO_SEARCH_MODEL;
  const knownKeys = new Set([...rssItems, ...candidates].map((item) => urlKey(item.url)));
  const shadowSearch: Promise<void> =
    webSearchMode(env.PULSO_WEB_SEARCH) === "shadow" &&
    fetchers.searchBeyondFeeds &&
    env.OPENAI_API_KEY &&
    !overBudget()
      ? (async () => {
          const apiKey = env.OPENAI_API_KEY ?? "";
          try {
            const search = await fetchers.searchBeyondFeeds!(
              {
                windowStart: start,
                windowEnd: now,
                knownTitles: windowed.map((item) => item.title),
                blockedDomains: getRssSources()
                  .map((source) => hostOf(source.homepage))
                  .filter(Boolean),
              },
              { apiKey, model: searchModel }
            );
            ledger.record("search", searchModel, search.usage);
            const { report, classifyUsage } = await evaluateShadowSearch({
              search,
              windowStart: start,
              windowEnd: now,
              model: searchModel,
              isKnown: (url) =>
                knownKeys.has(urlKey(url)) || repositories.newsItems.findByUrl(url) !== undefined,
              verifyLinks: (items) =>
                fetchers.verifyEditionLinks
                  ? fetchers.verifyEditionLinks(items)
                  : Promise.resolve({ items: [], dropped: [] }),
              classify: (items) =>
                fetchers.enrichEditionItems
                  ? fetchers.enrichEditionItems(items, { apiKey, model: models.worker })
                  : Promise.resolve({ items: [], dropped: items, model: models.worker }),
            });
            ledger.record("search-filter", models.worker, classifyUsage);
            process.stdout.write(`${JSON.stringify({ ...report, editionId: id })}\n`);
          } catch (error) {
            // Shadow mode must never cost the edition anything but money.
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`busca na web (sombra) falhou: ${message}\n`);
          }
        })()
      : Promise.resolve();

  const allCandidateItems = windowed.map((item) => toPulsoItem(item, capturedAt));
  const forceApprovedUrls = new Set(force ? existingSlot?.items.map((item) => item.url) ?? [] : []);
  const themeExemptUrls = new Set(
    windowed
      .filter(
        (item) => isNarrowAiPressSource(item.sourceId) || forceApprovedUrls.has(item.url)
      )
      .map((item) => item.url)
  );
  const isThemeExempt = (item: PulsoItem) =>
    item.kind !== "press" || themeExemptUrls.has(item.url);

  const themeEligibleItems: PulsoItem[] = [];
  let rejectedCount = 0;

  function deferUnclassified(
    items: PulsoItem[],
    reason: "classification-missing" | "classification-error" | "classification-unavailable",
    bumpAttempts: boolean
  ): void {
    rejectedCount += items.length;
    for (const item of items) {
      repositories.newsItems.markState(item.url, "retryable", reason, capturedAt, bumpAttempts);
    }
  }

  function keepExemptAndDeferBroad(items: PulsoItem[], reason: "classification-error" | "classification-unavailable"): void {
    const exempt = items.filter(isThemeExempt);
    const broad = items.filter((item) => !isThemeExempt(item));
    themeEligibleItems.push(...exempt);
    deferUnclassified(broad, reason, false);
  }

  if (fetchers.enrichEditionItems && env.OPENAI_API_KEY) {
    // Classify the whole eligible window before the cap, but keep each structured response small.
    // Discovery still runs only once and each URL is classified at most once in this run.
    for (let offset = 0; offset < allCandidateItems.length; offset += CLASSIFY_BATCH_SIZE) {
      const batch = allCandidateItems.slice(offset, offset + CLASSIFY_BATCH_SIZE);
      if (overBudget()) {
        noteBudgetSkip("o filtro temático");
        keepExemptAndDeferBroad(
          allCandidateItems.slice(offset),
          "classification-unavailable"
        );
        break;
      }

      const worker: WorkerResult = await fetchers.enrichEditionItems(batch, {
        apiKey: env.OPENAI_API_KEY,
        model: models.worker,
        themeExemptUrls: batch
          .filter((item) => themeExemptUrls.has(item.url))
          .map((item) => item.url),
      });
      ledger.record("worker", models.worker, worker.usage);
      themeEligibleItems.push(...worker.items);
      rejectedCount += worker.dropped.length;

      for (const dropped of worker.dropped) {
        repositories.newsItems.markState(dropped.url, "rejected", "not-ai", capturedAt, false);
      }

      deferUnclassified(
        worker.unclassified ?? [],
        worker.error ? "classification-error" : "classification-missing",
        !worker.error
      );

      if (worker.error) {
        sourceFailures.push({
          sourceId: "pulso-worker",
          name: "Worker",
          error: worker.error,
        });
        keepExemptAndDeferBroad(
          allCandidateItems.slice(offset + CLASSIFY_BATCH_SIZE),
          "classification-error"
        );
        break;
      }
    }
  } else {
    const unavailableReason = !env.OPENAI_API_KEY
      ? "OPENAI_API_KEY ausente"
      : "classificador temático não configurado";
    keepExemptAndDeferBroad(allCandidateItems, "classification-unavailable");
    if (allCandidateItems.some((item) => !isThemeExempt(item))) {
      sourceFailures.push({
        sourceId: "pulso-worker",
        name: "Worker",
        error: `${unavailableReason}; imprensa ampla adiada`,
      });
    }
  }

  await shadowSearch;

  if (themeEligibleItems.length === 0) {
    return finishWithoutItems(windowed.length, rejectedCount);
  }

  const enrichedByUrl = new Map(themeEligibleItems.map((item) => [item.url, item]));
  const eligibleNewsItems = windowed.filter((item) => enrichedByUrl.has(item.url));
  const unavailableUrls = new Set<string>();
  const checkedUrls = new Set<string>();
  const verifiedByUrl = new Map<string, PulsoItem>();
  const pageEvidence = new Map<string, string>();
  const pageLinks = new Map<string, PageLinks>();
  let finalSelection = selectForEdition(eligibleNewsItems, { cap: NEW_ITEM_CAP });
  let keptItems: PulsoItem[] = [];

  // Link failures and replicated copies release their slots to the next eligible candidates.
  // The loop is monotonic: every retry checks a new URL or makes one unavailable for this run.
  for (let pass = 0; pass <= eligibleNewsItems.length; pass += 1) {
    const available = eligibleNewsItems.filter((item) => !unavailableUrls.has(item.url));
    finalSelection = selectForEdition(available, { cap: NEW_ITEM_CAP });
    const selectedItems = finalSelection.selected
      .map((item) => enrichedByUrl.get(item.url))
      .filter((item): item is PulsoItem => item !== undefined);

    if (selectedItems.length === 0) {
      keptItems = [];
      break;
    }

    if (!fetchers.verifyEditionLinks) {
      keptItems = selectedItems;
      break;
    }

    const pending = selectedItems.filter((item) => !checkedUrls.has(item.url));
    if (pending.length > 0) {
      const checked = await fetchers.verifyEditionLinks(pending);
      const returnedUrls = new Set(checked.items.map((item) => item.url));
      const droppedUrls = new Set(checked.dropped.map((row) => row.item.url));

      for (const item of pending) {
        checkedUrls.add(item.url);
      }
      for (const item of checked.items) {
        verifiedByUrl.set(item.url, item);
      }
      for (const [url, text] of checked.evidence ?? new Map<string, string>()) {
        pageEvidence.set(url, text);
      }
      for (const [url, links] of checked.links ?? new Map<string, PageLinks>()) {
        pageLinks.set(url, links);
      }

      for (const check of checked.dropped) {
        unavailableUrls.add(check.item.url);
        rejectedCount += 1;
        if (isTransientLinkFailure(check)) {
          repositories.newsItems.markState(
            check.item.url,
            "retryable",
            check.reason ?? "transient",
            capturedAt
          );
        } else {
          repositories.newsItems.markState(
            check.item.url,
            "rejected",
            check.reason ?? "invalid",
            capturedAt,
            false
          );
        }
      }

      // A verifier must account for every input. Treat an omitted result as transient rather
      // than silently publishing an unchecked item.
      for (const item of pending) {
        if (!returnedUrls.has(item.url) && !droppedUrls.has(item.url)) {
          unavailableUrls.add(item.url);
          rejectedCount += 1;
          repositories.newsItems.markState(
            item.url,
            "retryable",
            "verification-missing",
            capturedAt
          );
        }
      }

      if (checked.dropped.length > 0) {
        sourceFailures.push({
          sourceId: "pulso-links",
          name: "Links",
          error: checked.dropped
            .map((row) => `${row.item.url} (${row.reason ?? "invalid"})`)
            .join("; "),
        });
      }
      continue;
    }

    keptItems = selectedItems
      .map((item) => verifiedByUrl.get(item.url))
      .filter((item): item is PulsoItem => item !== undefined);

    // Original before replication. Only runs on items whose pages were actually fetched, so a
    // story is credited only to a source we could read.
    if (pageLinks.size > 0 && keptItems.length > 1) {
      const resolved = resolveOrigins({ items: keptItems, links: pageLinks });
      for (const item of resolved.items) {
        verifiedByUrl.set(item.url, item);
      }
      if (resolved.dropped.length > 0) {
        rejectedCount += resolved.dropped.length;
        for (const row of resolved.dropped) {
          unavailableUrls.add(row.item.url);
          repositories.newsItems.markState(
            row.item.url,
            "rejected",
            "replication",
            capturedAt,
            false
          );
        }
        sourceFailures.push({
          sourceId: "pulso-origin",
          name: "Fonte original",
          error: resolved.dropped
            .map((row) => `${row.item.url} repete ${row.inFavorOf}`)
            .join("; "),
        });
        continue;
      }
      keptItems = resolved.items;
    }
    break;
  }

  // Only candidates left out of the stable, final selection are deferred by cap. Candidates
  // rejected by theme, link or replication already received their own lifecycle state above.
  for (const item of finalSelection.deferred) {
    repositories.newsItems.markState(item.url, "retryable", "cap", capturedAt, false);
  }

  if (keptItems.length === 0) {
    return finishWithoutItems(eligibleNewsItems.length, rejectedCount);
  }

  // Paragraphs come from the body the link check already downloaded, so this runs after
  // verification and only over items that survived it. Skipped when over budget: the edition
  // still publishes, just with titles and links.
  if (fetchers.summarizeEditionItems && env.OPENAI_API_KEY && pageEvidence.size > 0) {
    if (overBudget()) {
      noteBudgetSkip("os resumos");
    } else {
      const result = await fetchers.summarizeEditionItems(keptItems, {
        apiKey: env.OPENAI_API_KEY,
        model: models.worker,
        pageText: pageEvidence,
      });
      ledger.record("summarize", models.worker, result.usage);
      if (result.summaries.size > 0) {
        keptItems = keptItems.map((item) => {
          const summary = result.summaries.get(item.url);
          return summary ? { ...item, summaryPt: summary } : item;
        });
      }
      if (result.error) {
        sourceFailures.push({
          sourceId: "pulso-summary",
          name: "Resumos",
          error: result.error,
        });
      }
    }
  }

  let digest = stubDigest(keptItems);
  if (fetchers.fetchPulsoEditorial && env.OPENAI_API_KEY) {
    if (overBudget()) {
      noteBudgetSkip("o editorial");
    } else {
      const result: EditorialResult = await fetchers.fetchPulsoEditorial(keptItems, {
        apiKey: env.OPENAI_API_KEY,
        model: models.editorial,
        reservedHeadlines,
      });
      digest = result.digest;
      ledger.record("editorial", models.editorial, result.usage);
      if (result.error) {
        sourceFailures.push({
          sourceId: "pulso-editorial",
          name: "Editorial",
          error: result.error,
        });
      }
    }
  }

  // First deterministic approval. The semantic auditor only receives text whose risky
  // numbers and model claims already match the downloaded source material.
  const evidence = buildEvidenceIndex({
    items: keptItems,
    pageText: pageEvidence,
    benchmarkRows: benchmarkRowsFor(repositories),
  });

  function recordGateFailure(summary: GateSummary, phase: string): void {
    if (
      summary.bulletsDropped === 0 &&
      summary.blurbsDropped === 0 &&
      !summary.headlineFellBack
    ) {
      return;
    }
    sourceFailures.push({
      sourceId: "pulso-evidence",
      name: "Evidência",
      error:
        `${phase}: alegações sem suporte na fonte: ${summary.bulletsDropped} bullet(s), ` +
        `${summary.blurbsDropped} texto(s) de item` +
        (summary.headlineFellBack ? ", headline/lede revertidos ao stub" : "") +
        (summary.unsupportedSamples.length > 0
          ? ` — exemplos: ${summary.unsupportedSamples.join(", ")}`
          : ""),
    });
  }

  const firstGate = gateDigest(digest, keptItems, evidence, stubDigest(keptItems));
  digest = firstGate.digest;
  keptItems = firstGate.items;
  let gateSummary = firstGate.summary;
  recordGateFailure(firstGate.summary, "antes do humanizador");

  // Style revision runs BEFORE the semantic audit, which is the opposite of the original order.
  //
  // Two things were wrong with humanizing last. The auditor approved a paragraph that the
  // humanizer then rewrote, so the published text was not the text that had been approved; only
  // the deterministic gate saw the final wording, and it reads numbers, not meaning. And a
  // failed style pass discarded copy that had already cleared the evidence gate and the
  // auditor, which in practice published editions with no journalism at all rather than
  // editions with slightly stiff prose.
  //
  // Humanizing first fixes both: the auditor now judges exactly what ships, and a humanizer
  // failure costs polish instead of content.
  const hasGeneratedCopy =
    fetchers.fetchPulsoEditorial !== undefined ||
    keptItems.some((item) => item.blurbPt || item.summaryPt);
  let humanizerRevisedItems = false;

  if (hasGeneratedCopy) {
    if (!env.OPENAI_API_KEY) {
      sourceFailures.push({
        sourceId: "pulso-humanize",
        name: "Humanizador",
        error: "OPENAI_API_KEY ausente; texto aprovado publicado sem revisão de estilo",
      });
    } else if (!fetchers.humanizeDigest) {
      sourceFailures.push({
        sourceId: "pulso-humanize",
        name: "Humanizador",
        error: "humanizador não configurado; texto aprovado publicado sem revisão de estilo",
      });
    } else if (overBudget()) {
      noteBudgetSkip("o humanizador");
    } else {
      const revised = await fetchers.humanizeDigest(digest, keptItems, {
        apiKey: env.OPENAI_API_KEY,
        model: models.editorial,
        reservedHeadlines,
      });
      ledger.record("humanize", models.editorial, revised.usage);
      // A humanizer that does not report how many items it touched is assumed to have touched
      // them, so the independence check below errs toward warning.
      humanizerRevisedItems = (revised.flaggedItems ?? keptItems.length) > 0;

      // Applied even when partial: the humanizer returns approved wording for anything it
      // could not revise, so this never publishes text that skipped a factual control.
      digest = revised.digest;
      keptItems = revised.items;

      if (revised.error) {
        sourceFailures.push({
          sourceId: "pulso-humanize",
          name: "Humanizador",
          error: revised.error,
        });
      }
    }
  }

  // Last model stage, and the one that now sees the published wording. A rejected, unreadable
  // or unauditable paragraph is removed; there is no model rewrite and therefore no second loop.
  if (keptItems.some((item) => item.summaryPt || item.titlePt || item.blurbPt)) {
    if (!fetchers.auditEditionSummaries) {
      keptItems = withoutSummaries(keptItems);
      sourceFailures.push({
        sourceId: "pulso-audit",
        name: "Auditoria",
        error: "auditor não configurado; texto gerado removido antes da publicação",
      });
    } else if (overBudget()) {
      noteBudgetSkip("a auditoria do texto");
      keptItems = withoutSummaries(keptItems);
    } else {
      const audit = await fetchers.auditEditionSummaries({
        items: keptItems,
        pageText: pageEvidence,
        feedText: feedTeasers(eligibleNewsItems),
      });
      keptItems = audit.items;
      ledger.record("audit", audit.model, audit.usage);

      // The judge should not review its own writing. The item copy it audits is written by the
      // worker and, for the items the humanizer flagged, revised by the editorial model; judging
      // with either is self-review, so it ships as a visible warning instead of passing silently.
      // Sharing a company with the writers is the accepted, measured trade-off since Bedrock went
      // away (research/auditor-eval.md) and is not flagged.
      const reviewers = new Set([models.worker, ...(humanizerRevisedItems ? [models.editorial] : [])]);
      if (reviewers.has(audit.model)) {
        sourceFailures.push({
          sourceId: "pulso-audit",
          name: "Auditoria",
          error:
            `auditor é o mesmo modelo que escreveu ou revisou o texto auditado (${audit.model}); ` +
            "veredito sem independência",
        });
      }

      if (audit.removed > 0 || audit.unusable > 0) {
        sourceFailures.push({
          sourceId: "pulso-audit",
          name: "Auditoria",
          error:
            `${audit.audited} texto(s) auditado(s)` +
            (audit.withoutPage ? `, ${audit.withoutPage} pelo resumo do feed (página não abriu)` : "") +
            `: ${audit.removed} removido(s)` +
            (audit.trimmed ? `, ${audit.trimmed} só no trecho reprovado` : "") +
            (audit.unusable > 0 ? `, ${audit.unusable} veredito(s) ilegível(is)` : "") +
            (audit.samples.length > 0 ? ` — exemplos: ${audit.samples.join("; ")}` : ""),
        });
      }
    }
  }

  // Unconditional final guard over whatever survived, including the case where no model stage
  // ran. It only checks that the published text carries no unsupported number, price,
  // percentage or model version.
  const finalEvidence = buildEvidenceIndex({
    items: keptItems,
    pageText: pageEvidence,
    benchmarkRows: benchmarkRowsFor(repositories),
  });
  const finalGate = gateDigest(digest, keptItems, finalEvidence, stubDigest(keptItems));
  digest = finalGate.digest;
  keptItems = finalGate.items;
  gateSummary = mergeGateSummaries(gateSummary, finalGate.summary);
  recordGateFailure(finalGate.summary, "depois da auditoria");

  // Last write of the cover line, after every model stage and the evidence stub. A prompt
  // asking the model not to repeat is not a guarantee — Pulso #1 and #4 both shipped
  // "IA sob pressão". If the line still matches an earlier edition, replace it with a
  // title grounded in this edition's items.
  const unique = withUniqueHeadline(digest, keptItems, reservedHeadlines);
  if (unique.headline !== digest.headline) {
    sourceFailures.push({
      sourceId: "pulso-editorial",
      name: "Editorial",
      error: `manchete repetia capa anterior ("${digest.headline}"); publicada como "${unique.headline}"`,
    });
    digest = unique;
  }

  const unpriced = ledger.unpricedModels();
  if (unpriced.length > 0) {
    sourceFailures.push({
      sourceId: "pulso-cost",
      name: "Custo",
      error: `modelo sem preço conhecido, custo subestimado: ${unpriced.join(", ")}`,
    });
  }

  return publish({ kind: "regular", digest, items: keptItems, gate: gateSummary });
}
