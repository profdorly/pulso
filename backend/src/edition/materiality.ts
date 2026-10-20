import { detectGenre } from "./genre.js";
import type { NewsItem } from "../types.js";

/**
 * Scores how much an item matters to a founder or business leader.
 *
 * Geography and recency are handled elsewhere. This is the missing axis: a Meta Reels
 * festival and an EU fine are not the same news, even when they share a region and a
 * timestamp. The score is heuristic and conservative — keywords over inference — so a
 * miss leaves recency as the tiebreaker instead of inventing importance.
 */

const CATEGORIES: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "capital",
    pattern:
      /\b(aquisi[cç][aã]o|compra a|fus[aã]o|ipo|rodada|valuation|funding|invest[ei]|us\$|r\$|bilh[oõ]es?|milh[oõ]es?|billion|million)\b/i,
  },
  {
    id: "regulation",
    pattern:
      /\b(regula(?:[cç][aã]o)?|regulament|ai act|lei de ia|congresso|senado|stf|multa|antitruste|antitrust|pro[ií]be|banimento)\b/i,
  },
  {
    id: "product",
    pattern: /\b(lan[cç]a|lançamento|release|disponibiliza|general availability|\bga\b|preview)\b/i,
  },
  {
    id: "risk",
    pattern:
      /\b(vazamento|breach|outage|incidente|process[oa]|lawsuit|demiss[aã]o|layoff|queda de|falha de seguran[cç]a)\b/i,
  },
  {
    id: "infrastructure",
    pattern: /\b(datacenter|data center|gpu|chip|nvidia|energia|nuclear|infraestrutura)\b/i,
  },
  {
    id: "decision",
    pattern:
      /\b(parceria|contrato|cliente|pre[cç]o|tarifa|open source|open-source|modelo de neg[oó]cio)\b/i,
  },
];

const CATEGORY_WEIGHT = 3;
const PRIMARY_WEIGHT = 1;

export function executiveMateriality(item: Pick<NewsItem, "title" | "summary" | "block">): number {
  const haystack = `${item.title} ${item.summary ?? ""}`;
  let score = 0;
  for (const category of CATEGORIES) {
    if (category.pattern.test(haystack)) score += CATEGORY_WEIGHT;
  }
  if (item.block === "official" || item.block === "ai-discovery") {
    score += PRIMARY_WEIGHT;
  }
  return score;
}

export function compareByEditorialRank(
  left: NewsItem,
  right: NewsItem,
  publishedTime: (item: NewsItem) => number
): number {
  const leftOpinion = detectGenre(left.title, left.url) === "opinion" ? 1 : 0;
  const rightOpinion = detectGenre(right.title, right.url) === "opinion" ? 1 : 0;
  if (leftOpinion !== rightOpinion) return leftOpinion - rightOpinion;

  const materiality = executiveMateriality(right) - executiveMateriality(left);
  if (materiality !== 0) return materiality;

  return publishedTime(right) - publishedTime(left);
}
