import { getSourceById } from "../config/sources.js";
import type { NewsItem } from "../types.js";
import { detectGenre } from "./genre.js";
import type { PulsoItem } from "./schema.js";

export function itemKind(item: NewsItem): PulsoItem["kind"] {
  if (item.block === "official") return "lab";
  if (item.block === "ai-discovery") return "discovery";
  return "press";
}

export function itemOutlet(item: NewsItem): string {
  const source = getSourceById(item.sourceId);
  return source?.name ?? item.company ?? item.sourceId;
}

export function toPulsoItem(item: NewsItem, firstSeenAt: string): PulsoItem {
  const pulso: PulsoItem = {
    id: item.id,
    title: item.title,
    url: item.url,
    outlet: itemOutlet(item),
    region: item.region,
    kind: itemKind(item),
    genre: detectGenre(item.title, item.url),
    publishedAt: item.publishedAt,
    ...(item.publishedAt === item.fetchedAt ? { publishedAtKind: "collected" as const } : { publishedAtKind: "source" as const }),
    firstSeenAt,
  };
  const blurb = item.summary?.trim() || item.aiSummary?.trim();
  if (blurb) {
    pulso.blurbPt = blurb.slice(0, 240);
  }
  return pulso;
}
