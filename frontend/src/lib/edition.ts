export type Slot = "manha" | "meio-dia" | "tarde";
export type Region = "brazil" | "us" | "europe" | "asia";
/** Values published before the region split; still present in archived editions. */
export type LegacyRegion = "us-global" | "china";
export type ItemKind = "lab" | "press" | "discovery";
export type Genre = "news" | "opinion";

export interface PulsoItem {
  id: string;
  title: string;
  /**
   * Headline in Portuguese. Preferred on screen; `title` is the fallback when the translation
   * was not produced or did not survive the evidence gate. The link always opens the original.
   */
  titlePt?: string;
  blurbPt?: string;
  /** One or two paragraphs in Portuguese, written from the article body. */
  summaryPt?: string;
  url: string;
  outlet: string;
  region: Region;
  kind: ItemKind;
  /** Absent on editions published before the split; treat as reporting. */
  genre?: Genre;
  /** Host the facts came from, when this item repeats a source that could not be fetched. */
  originHost?: string;
  /** Outlets in this edition that carried the same story, counting the original. */
  corroboration?: number;
  publishedAt: string;
  /** Absent on older editions; treat as a source timestamp. */
  publishedAtKind?: "source" | "collected";
  firstSeenAt: string;
}

export interface PulsoEdition {
  id: string;
  schemaVersion: 1;
  slot: Slot;
  calendarDate: string;
  timezone: "America/Sao_Paulo";
  capturedAt: string;
  status: "ok" | "partial";
  /** `quiet` means nothing survived verification; the cover says so instead of going blank. */
  kind?: "regular" | "quiet";
  /**
   * Sequential edition number shown as `PULSO #N`. Written once at publication, so it is
   * read here and never derived from the archive length — recomputing it would renumber
   * every past edition whenever one is added. Absent on editions published before numbering.
   */
  number?: number;
  predecessorId: string | null;
  digest: {
    headline: string;
    lede: string;
    bullets: { text: string; url: string; outlet: string }[];
  };
  items: PulsoItem[];
  sourceFailures: { sourceId: string; name: string; error: string }[];
  benchmarks: {
    capturedAt: string;
    previousCapturedAt: string | null;
    headline: { label: string; value: string; delta: string | null; metric?: string }[];
    attribution: string[];
    /** Always empty in a published edition: the full rows stay in the kitchen. */
    rows: unknown[];
  };
  models: { discovery: string; editorial: string; worker: string };
  costUsdApprox: number;
  /** Increments when a slot is republished; revision 1 is the first publication. */
  revision?: number;
  supersedesCapturedAt?: string | null;
  gate?: {
    checked: number;
    bulletsDropped: number;
    blurbsDropped: number;
    headlineFellBack: boolean;
    unsupportedSamples: string[];
  };
  costBreakdown?: Array<{
    step: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    webSearchCalls: number;
    usd: number;
  }>;
  cover?: { path: string; alt: string; width: number; height: number };
}

export interface PulsoIndex {
  schemaVersion: 1;
  latestId: string | null;
  editions: Array<{
    id: string;
    slot: Slot;
    calendarDate: string;
    capturedAt: string;
    number?: number;
    headline: string;
    path: string;
  }>;
}

export const SLOT_LABEL: Record<Slot, string> = {
  manha: "Manhã",
  "meio-dia": "Meio-dia",
  tarde: "Tarde",
};

/**
 * Regions as the reader sees them.
 *
 * Legacy keys stay in the map on purpose: older artifacts can still carry them, and a missing key
 * would render an empty label next to an item instead of naming where it came from.
 */
export const REGION_LABEL: Record<Region | LegacyRegion, string> = {
  brazil: "Brasil",
  us: "EUA",
  europe: "Europa",
  asia: "Ásia",
  "us-global": "EUA / global",
  china: "China",
};

/** Reader-facing headline: Portuguese when available, original otherwise. */
export function itemHeadline(item: Pick<PulsoItem, "title" | "titlePt">): string {
  return item.titlePt?.trim() || item.title;
}
