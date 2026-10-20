import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { usageFromResponse, type TokenUsage } from "./cost.js";
import { HUMANIZE_SYSTEM_PROMPT } from "./humanizePrompt.js";
import { PULSO_EDITORIAL_MODEL } from "./models.js";
import { sanitizeDigest, uniqueHeadline, isHeadlineTaken, reservedHeadlinesForPrompt } from "./editorial.js";
import type { PulsoDigest, PulsoItem } from "./schema.js";
import { findAiTells, TELL_LABELS, type AiTell } from "./tells.js";

/**
 * Final style pass over copy that is already written, evidence-checked and about to be audited.
 *
 * Three decisions here exist because the previous single-call, all-or-nothing version spent
 * three days silently publishing stub editions:
 *
 * **The revision is split.** One call for the cover, then the item copy in small batches. The
 * old version asked one response to echo every text in the edition perfectly — forty-odd
 * strings — and rejected the whole thing if a single URL was missing. One weak response now
 * costs one batch instead of the entire edition.
 *
 * **A partial revision is applied, not discarded.** Text the humanizer could not reach keeps
 * its approved wording. That copy already passed the deterministic evidence gate and still
 * faces the semantic auditor downstream, so publishing it is safe — it is merely less polished.
 * Discarding it, as before, threw away the journalism to protect the prose style.
 *
 * **Failures are described, not summarised.** The old error string said only that the revision
 * was incomplete, which made the live failure undiagnosable. Every problem now names the batch,
 * the response status and the URLs involved.
 *
 * Two more keep the daily edition affordable at fifty items, where this step is output-bound:
 *
 * **Only flagged item texts are revised.** The cover is always revised; an item blurb or summary
 * goes to the model only when `findAiTells` finds something in it, together with what it found.
 * The writers follow the same rules, so most drafts arrive clean, and echoing a clean paragraph
 * back cost as much as fixing a bad one.
 *
 * **Items travel under short ids.** The model used to copy every URL back, twice per item;
 * a batch now answers with "1", "2"… and the code maps them back to URLs.
 */

export interface HumanizeOptions {
  apiKey: string;
  model?: string;
  client?: OpenAI;
  /** Items per revision call; smaller batches contain a bad response more tightly. */
  batchSize?: number;
  /** Item batches revised at once; overrides HUMANIZE_CONCURRENCY. */
  concurrency?: number;
  /** Already-published cover lines; a revision that repeats one is discarded. */
  reservedHeadlines?: readonly string[];
}

export interface HumanizeResult {
  digest: PulsoDigest;
  items: PulsoItem[];
  model: string;
  usage?: TokenUsage;
  /** Items sent for revision because a blurb or summary carried a detected tell. */
  flaggedItems?: number;
  /** Items with copy and no detected tell, published as approved without a model call. */
  cleanItems?: number;
  /**
   * Set when any part could not be revised. The parts that were revised are still applied, so
   * this reports degraded style — never lost content.
   */
  error?: string;
}

/** Items per call. Six keeps one response near 1.5k output tokens at measured lengths. */
export const HUMANIZE_ITEM_BATCH = 6;

/**
 * Item batches revised in parallel.
 *
 * The batches are independent — each sees only its own items — and used to run one after the
 * other. At 50 items a day that is nine calls in a row, minutes of the Lambda budget spent
 * waiting. Problems are still reported in batch order.
 */
export const HUMANIZE_CONCURRENCY = 3;

/**
 * Explicit output caps, so a response that outgrows its budget fails as `incomplete` with a
 * readable reason instead of returning silently truncated JSON.
 */
const DIGEST_MAX_OUTPUT_TOKENS = 1500;

function itemsMaxOutputTokens(count: number): number {
  return count * 700 + 1000;
}

const DigestRevisionSchema = z.object({
  headline: z.string(),
  lede: z.string(),
  bullets: z.array(z.object({ text: z.string(), url: z.string() })),
});

const ItemsRevisionSchema = z.object({
  blurbs: z.array(z.object({ id: z.string(), blurbPt: z.string() })),
  summaries: z.array(z.object({ id: z.string(), summaryPt: z.string() })),
});

/** An item whose blurb, summary or both carry detected tells; an empty list means "not sent". */
interface ItemRevision {
  item: PulsoItem;
  blurbTells: AiTell[];
  summaryTells: AiTell[];
}

/** What the model is told about a text: the rule and the exact words that tripped it. */
function describeTells(tells: AiTell[]): string[] {
  return tells.map((tell) => `${TELL_LABELS[tell.id]}: "${tell.excerpt}"`);
}

/** Items worth a revision call, in edition order. */
function itemsToRevise(items: PulsoItem[]): ItemRevision[] {
  return items
    .map((item) => ({
      item,
      blurbTells: findAiTells(item.blurbPt),
      summaryTells: findAiTells(item.summaryPt),
    }))
    .filter((entry) => entry.blurbTells.length > 0 || entry.summaryTells.length > 0);
}

/** Cover lines with detected tells, so the cover revision knows where to look first. */
function coverTells(draft: PulsoDigest): string[] {
  const lines: string[] = [];
  const add = (label: string, text: string) => {
    const found = describeTells(findAiTells(text));
    if (found.length > 0) lines.push(`${label} — ${found.join("; ")}`);
  };
  add("headline", draft.headline);
  add("lede", draft.lede);
  draft.bullets.forEach((row, index) => add(`bullet ${index + 1}`, row.text));
  return lines;
}

/** Minimal shape read from a Responses API result, including why it stopped early. */
interface ResponseShape {
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clipBlurb(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 239).trim()}…`;
}

function sortedUrls(values: string[]): string[] {
  return values.slice().sort((a, b) => a.localeCompare(b));
}

function sameUrls(expected: string[], received: string[]): boolean {
  return JSON.stringify(sortedUrls(expected)) === JSON.stringify(sortedUrls(received));
}

/** Turns a stopped-early response into something an operator can act on. */
function describeResponse(response: unknown): string {
  const shape = response as ResponseShape;
  const status = shape.status ?? "sem status";
  const reason = shape.incomplete_details?.reason;
  return reason ? `status=${status}, motivo=${reason}` : `status=${status}`;
}

function sample(urls: string[]): string {
  return urls.slice(0, 3).join(", ") + (urls.length > 3 ? ` e mais ${urls.length - 3}` : "");
}

function addUsage(
  total: TokenUsage | undefined,
  next: TokenUsage | undefined
): TokenUsage | undefined {
  if (!next) return total;
  if (!total) return { ...next };
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
  };
}

interface DigestOutcome {
  digest?: PulsoDigest;
  usage?: TokenUsage;
  problem?: string;
}

async function reviseDigest(
  client: OpenAI,
  model: string,
  draft: PulsoDigest,
  items: PulsoItem[],
  reservedHeadlines: readonly string[] = []
): Promise<DigestOutcome> {
  try {
    const listed = reservedHeadlinesForPrompt(reservedHeadlines);
    const listedBlock =
      listed.length > 0
        ? `\nManchetes já publicadas — não devolva nenhuma delas, nem com pontuação diferente:\n${JSON.stringify(listed)}\n`
        : "";
    const flagged = coverTells(draft);
    const flaggedBlock =
      flagged.length > 0
        ? `\nMarcas de IA encontradas pelo verificador automático (corrija estas primeiro):\n${flagged.join("\n")}\n`
        : "";
    const response = await client.responses.parse({
      model,
      max_output_tokens: DIGEST_MAX_OUTPUT_TOKENS,
      input: [
        { role: "system", content: HUMANIZE_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Revise a capa. Devolva headline, lede e todos os bullets, com as mesmas URLs.\n" +
            listedBlock +
            flaggedBlock +
            JSON.stringify({
              headline: draft.headline,
              lede: draft.lede,
              bullets: draft.bullets.map((row) => ({ text: row.text, url: row.url })),
            }),
        },
      ],
      text: { format: zodTextFormat(DigestRevisionSchema, "pulso_humanize_capa") },
    });

    const usage = usageFromResponse(response);
    const parsed = response.output_parsed;
    if (!parsed) {
      return { usage, problem: `sem JSON utilizável (${describeResponse(response)})` };
    }

    const expected = draft.bullets.map((row) => row.url);
    const received = parsed.bullets.map((row) => row.url);
    if (!sameUrls(expected, received)) {
      const missing = expected.filter((url) => !received.includes(url));
      const invented = received.filter((url) => !expected.includes(url));
      const detail = [
        missing.length > 0 ? `faltando ${missing.length} (${sample(missing)})` : "",
        invented.length > 0 ? `inventados ${invented.length} (${sample(invented)})` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return { usage, problem: `bullets divergentes: ${detail}` };
    }

    if (
      parsed.headline.trim().length === 0 ||
      parsed.lede.trim().length === 0 ||
      parsed.bullets.some((row) => row.text.trim().length === 0)
    ) {
      return { usage, problem: "headline, lede ou bullet devolvido vazio" };
    }

    const revised = sanitizeDigest(parsed, items);
    return {
      usage,
      digest: {
        ...revised,
        headline: isHeadlineTaken(revised.headline, reservedHeadlines)
          ? uniqueHeadline(draft.headline, items, reservedHeadlines)
          : revised.headline,
      },
    };
  } catch (err) {
    return { problem: errorMessage(err) };
  }
}

interface ItemsOutcome {
  blurbs: Map<string, string>;
  summaries: Map<string, string>;
  usage?: TokenUsage;
  problems: string[];
}

async function reviseItems(
  client: OpenAI,
  model: string,
  batch: ItemRevision[]
): Promise<ItemsOutcome> {
  const blurbs = new Map<string, string>();
  const summaries = new Map<string, string>();
  const problems: string[] = [];

  // Ids are positions in this batch. Only the flagged fields travel, each with what was found.
  const urlById = new Map(batch.map((entry, index) => [String(index + 1), entry.item.url]));
  const expectedBlurbs = batch
    .map((entry, index) => (entry.blurbTells.length > 0 ? String(index + 1) : ""))
    .filter(Boolean);
  const expectedSummaries = batch
    .map((entry, index) => (entry.summaryTells.length > 0 ? String(index + 1) : ""))
    .filter(Boolean);
  const urlsOf = (ids: string[]) => ids.map((id) => urlById.get(id) ?? id);

  try {
    const response = await client.responses.parse({
      model,
      max_output_tokens: itemsMaxOutputTokens(batch.length),
      input: [
        { role: "system", content: HUMANIZE_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Revise os textos destes itens. Cada texto veio com as marcas de IA que o verificador " +
            "automático encontrou nele: corrija essas marcas e qualquer outra que achar no mesmo " +
            "texto. Devolva cada id com os mesmos campos de texto que recebeu (blurbPt em blurbs, " +
            "summaryPt em summaries). Não crie campo que não veio.\n" +
            JSON.stringify(
              batch.map((entry, index) => ({
                id: String(index + 1),
                ...(entry.blurbTells.length > 0
                  ? { blurbPt: entry.item.blurbPt, marcasBlurb: describeTells(entry.blurbTells) }
                  : {}),
                ...(entry.summaryTells.length > 0
                  ? {
                      summaryPt: entry.item.summaryPt,
                      marcasResumo: describeTells(entry.summaryTells),
                    }
                  : {}),
              }))
            ),
        },
      ],
      text: { format: zodTextFormat(ItemsRevisionSchema, "pulso_humanize_itens") },
    });

    const usage = usageFromResponse(response);
    const parsed = response.output_parsed;
    if (!parsed) {
      problems.push(`sem JSON utilizável (${describeResponse(response)})`);
      return { blurbs, summaries, usage, problems };
    }

    // Accepted per id rather than per batch: one dropped item should not cost the other five.
    for (const row of parsed.blurbs) {
      const url = urlById.get(row.id);
      if (url && expectedBlurbs.includes(row.id) && row.blurbPt.trim().length > 0) {
        blurbs.set(url, row.blurbPt);
      }
    }
    for (const row of parsed.summaries) {
      const url = urlById.get(row.id);
      if (url && expectedSummaries.includes(row.id) && row.summaryPt.trim().length > 0) {
        summaries.set(url, row.summaryPt);
      }
    }

    const missingBlurbs = urlsOf(expectedBlurbs).filter((url) => !blurbs.has(url));
    const missingSummaries = urlsOf(expectedSummaries).filter((url) => !summaries.has(url));
    const invented = [...parsed.blurbs, ...parsed.summaries]
      .map((row) => row.id)
      .filter((id) => !expectedBlurbs.includes(id) && !expectedSummaries.includes(id));

    if (missingBlurbs.length > 0) {
      problems.push(`blurbs não revisados: ${missingBlurbs.length} (${sample(missingBlurbs)})`);
    }
    if (missingSummaries.length > 0) {
      problems.push(
        `resumos não revisados: ${missingSummaries.length} (${sample(missingSummaries)})`
      );
    }
    if (invented.length > 0) {
      problems.push(`ids inventados e ignorados: ${invented.length} (${sample(invented)})`);
    }

    return { blurbs, summaries, usage, problems };
  } catch (err) {
    problems.push(errorMessage(err));
    return { blurbs, summaries, problems };
  }
}

export async function humanizeDigest(
  draft: PulsoDigest,
  items: PulsoItem[],
  options: HumanizeOptions
): Promise<HumanizeResult> {
  const model = options.model ?? PULSO_EDITORIAL_MODEL;
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey });
  const batchSize = Math.max(1, options.batchSize ?? HUMANIZE_ITEM_BATCH);

  const problems: string[] = [];
  let usage: TokenUsage | undefined;

  // The cover call runs alongside the item batches: neither reads the other's output.
  const digestRevision = reviseDigest(client, model, draft, items, options.reservedHeadlines ?? []);

  const withCopy = items.filter((item) => item.blurbPt || item.summaryPt);
  const flagged = itemsToRevise(withCopy);
  const revisedBlurbs = new Map<string, string>();
  const revisedSummaries = new Map<string, string>();
  const batchList: ItemRevision[][] = [];
  for (let index = 0; index < flagged.length; index += batchSize) {
    batchList.push(flagged.slice(index, index + batchSize));
  }
  const concurrency = Math.max(1, options.concurrency ?? HUMANIZE_CONCURRENCY);
  const outcomes = new Array<Awaited<ReturnType<typeof reviseItems>>>(batchList.length);
  let nextBatch = 0;
  async function worker(): Promise<void> {
    while (nextBatch < batchList.length) {
      const position = nextBatch;
      nextBatch += 1;
      outcomes[position] = await reviseItems(client, model, batchList[position]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batchList.length) }, () => worker()));

  const digestOutcome = await digestRevision;
  usage = addUsage(usage, digestOutcome.usage);
  const digest = digestOutcome.digest ?? draft;
  if (digestOutcome.problem) {
    problems.push(`capa: ${digestOutcome.problem}`);
  }

  outcomes.forEach((outcome, position) => {
    usage = addUsage(usage, outcome.usage);
    for (const [url, text] of outcome.blurbs) revisedBlurbs.set(url, text);
    for (const [url, text] of outcome.summaries) revisedSummaries.set(url, text);
    if (outcome.problems.length > 0) {
      problems.push(`lote ${position + 1}/${batchList.length}: ${outcome.problems.join("; ")}`);
    }
  });

  const revisedItems = items.map((item) => {
    const blurbPt = revisedBlurbs.get(item.url);
    const summaryPt = revisedSummaries.get(item.url);
    return {
      ...item,
      ...(item.blurbPt && blurbPt ? { blurbPt: clipBlurb(blurbPt) } : {}),
      ...(item.summaryPt && summaryPt ? { summaryPt } : {}),
    };
  });

  return {
    digest,
    items: revisedItems,
    model,
    ...(usage ? { usage } : {}),
    flaggedItems: flagged.length,
    cleanItems: withCopy.length - flagged.length,
    ...(problems.length > 0
      ? {
          error:
            "revisão parcial, texto aprovado mantido onde o humanizador não chegou — " +
            problems.join(" | "),
        }
      : {}),
  };
}
