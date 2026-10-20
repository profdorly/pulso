export type SourceType = "rss" | "ai-discovery";
export type Category = "official-company" | "impartial-media" | "ai-discovery";

/**
 * Editorial regions, which exist to be balanced against each other.
 *
 * The reader asked for balance across the Americas, Europe and Asia, so the buckets have to
 * be comparable in kind — a bucket that means "the United States plus everywhere we did not
 * think about" cannot be balanced against anything. `us-global` and `china` were the previous
 * values and are still read from stored rows and published artifacts, but they are not part
 * of the type: quota code that forgets to normalize should fail to compile.
 *
 * China is folded into `asia` rather than kept as its own bucket. Four buckets over the press
 * slots of one edition is already tight, and Chinese presence is guaranteed by the source
 * catalogue itself — Pandaily, Sixth Tone, SCMP and TechNode, plus four Chinese labs on
 * discovery — not by a quota row.
 */
export const REGIONS = ["brazil", "us", "europe", "asia"] as const;
export type Region = (typeof REGIONS)[number];

/** Values written by earlier versions, still present in the database and in artifacts. */
const LEGACY_REGIONS: Record<string, Region> = {
  "us-global": "us",
  china: "asia",
};

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

/**
 * Maps a stored value onto a current region.
 *
 * Returns undefined for anything unrecognized rather than guessing: region drives editorial
 * balance, so a silent wrong bucket would skew the very thing it exists to guarantee.
 */
export function normalizeRegion(value: unknown): Region | undefined {
  if (isRegion(value)) return value;
  if (typeof value === "string" && value in LEGACY_REGIONS) return LEGACY_REGIONS[value];
  return undefined;
}

/** Zeroed tally over every region, so a count map cannot silently miss a bucket. */
export function emptyRegionCounts(): Record<Region, number> {
  return Object.fromEntries(REGIONS.map((region) => [region, 0])) as Record<Region, number>;
}

/**
 * Lifecycle of a discovered item.
 *
 * Dedupe keys off this, not off mere existence: only terminal states are skipped on a
 * later run. An item dropped by a timeout or a bot block must come back, or a transient
 * network failure silently becomes permanent news loss.
 */
export type CandidateState =
  | "discovered" // fetched and in play for the current run
  | "published" // made it into an edition — terminal
  | "rejected" // will never qualify — terminal
  | "retryable"; // failed for a transient reason — eligible again next run

export const TERMINAL_CANDIDATE_STATES: readonly CandidateState[] = ["published", "rejected"];

export function isTerminalCandidateState(state: CandidateState | undefined): boolean {
  return state !== undefined && TERMINAL_CANDIDATE_STATES.includes(state);
}

export type BlockId =
  | "official"
  | "impartial"
  | "ai-discovery"
  | "ai-digest"
  | "benchmarks"
  | "analytics";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  category: Category;
  region: Region;
  feedUrl?: string;
  homepage: string;
  block: BlockId;
}

export interface NewsItem {
  id: string;
  sourceId: string;
  block: BlockId;
  title: string;
  url: string;
  author?: string;
  summary?: string;
  aiSummary?: string;
  tags: string[];
  company?: string;
  region: Region;
  publishedAt: string; // ISO 8601
  fetchedAt: string; // ISO 8601
  /** Lifecycle state. Absent on freshly fetched items, set when persisted. */
  state?: CandidateState;
  /** Why the item reached its current state (e.g. "not-found", "not-ai", "cap"). */
  stateReason?: string;
  /** How many runs have already tried to publish this item. */
  attempts?: number;
  stateChangedAt?: string; // ISO 8601
}

export interface BenchmarkModelRow {
  modelId: string;
  name: string;
  creator?: string;
  region?: Region;
  intelligenceIndex?: number | null;
  codingIndex?: number | null;
  agenticIndex?: number | null;
  priceInput?: number | null;
  priceOutput?: number | null;
  throughput?: number | null;
  ttft?: number | null;
  e2eLatency?: number | null;
  contextWindow?: number | null;
  /** Which sources contributed the numbers in this row. */
  sources?: BenchmarkSource[];
}

export type BenchmarkSource = "artificial-analysis";

export interface BenchmarkSnapshot {
  id: string;
  /**
   * Whether the source answered. `none` means it did not — the snapshot must not claim a
   * provider that never responded, because the cover credits it by name. `lmarena` and
   * `combined` only appear on captures stored before the Arena mirror was dropped.
   */
  provider: "artificial-analysis" | "lmarena" | "combined" | "none";
  capturedAt: string; // ISO 8601
  payload: {
    rows: BenchmarkModelRow[];
  };
}
